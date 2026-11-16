import type { BarSig, Cell, Track } from '../core/types';
import { audioState, ensureAudio, playDrum, preview } from '../audio/engine';
import { clone, rowsOf, stepsOf } from '../core/constants';
import { library, appState, currentTrack, normalize, strip } from '../core/state';
import { canEdit, carry, dirty } from '../sync/cloud';
import { placeCursor, renderAll, renderBar, renderPad, renderScore, renderTop, toast } from './render';

/* ================= editing ================= */
export function pushUndo() {
  appState.undo.push(strip(appState.song));
  if (appState.undo.length > 40) appState.undo.shift();
  appState.redo.length = 0;
}
export function swapHistory(from, to) {
  if (!from.length) return;
  to.push(strip(appState.song));
  const s = normalize(JSON.parse(from.pop()));
  carry(appState.song, s);
  delete s._demo;
  library.songs[s.id] = s;
  appState.song = s;
  dirty();
  renderAll();
}
export function commit(barIdx?: number) {
  dirty();
  if (barIdx === undefined) renderScore();
  else renderBar(barIdx);
  renderTop();
  renderPad();
}
export function moveStep(d: number, grow?: boolean) {
  let { bar, step } = appState.cur;
  const bars = appState.song.bars;
  step += d;
  while (step < 0) {
    if (bar === 0) {
      step = 0;
      break;
    }
    bar--;
    step += stepsOf(bars[bar]);
  }
  while (step >= stepsOf(bars[bar])) {
    if (bar === bars.length - 1) {
      if (!grow) {
        step = stepsOf(bars[bar]) - 1;
        break;
      }
      insertBar(bar + 1, bars[bar]);
      step -= stepsOf(bars[bar]);
      bar++;
      appState.cur.bar = bar;
      appState.cur.step = step;
      renderScore();
      placeCursor();
      return;
    }
    step -= stepsOf(bars[bar]);
    bar++;
  }
  appState.cur.bar = bar;
  appState.cur.step = step;
  placeCursor();
}
export function putChord(tr, c, step, str, f, pm, level) {
  // a note, plus its fifth and octave on the next strings when asked
  const mk = (fr) => {
      const n: Cell = { f: fr };
      if (pm) n.pm = 1;
      return n;
    },
    p = tr.tuning[str] + f;
  delete c[step + '_R'];
  c[step + '_' + str] = mk(f);
  if (level >= 1 && str >= 1) {
    const f2 = p + 7 - tr.tuning[str - 1];
    if (f2 >= 0 && f2 <= 24) c[step + '_' + (str - 1)] = mk(f2);
  }
  if (level >= 2 && str >= 2) {
    const f3 = p + 12 - tr.tuning[str - 2];
    if (f3 >= 0 && f3 <= 24) c[step + '_' + (str - 2)] = mk(f3);
  }
  return c[step + '_' + str];
}
export function enterFret(n) {
  const tr = currentTrack();
  if (tr.type === 'drums' || !canEdit()) return;
  const f = Math.min(24, appState.tens * 10 + n);
  appState.tens = 0;
  pushUndo();
  const { bar, step, str } = appState.cur,
    c = tr.bars[bar];
  const cell = putChord(tr, c, step, str, f, appState.pm, appState.chord);
  preview(cell, str);
  if (appState.chord && c[step + '_' + (str - 1)] && str > 0) preview(c[step + '_' + (str - 1)], str - 1);
  dirty();
  renderBar(bar);
  renderTop();
  if (appState.adv) moveStep(appState.adv, true);
  renderPad();
}
export function toggleDrum(bar, step, lane) {
  if (!canEdit()) {
    toast('View only. Make your own copy to change it.');
    return;
  }
  pushUndo();
  const c = currentTrack().bars[bar],
    key = step + '_' + lane;
  if (c[key] && (c[key].v || 2) === appState.vel) delete c[key];
  else {
    c[key] = { v: appState.vel };
    if (!appState.playing && ensureAudio())
      playDrum(appState.ti, lane, audioState.ctx.currentTime + 0.005, appState.vel);
  }
  appState.cur.bar = bar;
  commit(bar);
}
export function insertBar(at, like) {
  const sig = { n: like.n, d: like.d, g: like.g };
  appState.song.bars.splice(at, 0, sig);
  appState.song.tracks.forEach((t) => t.bars.splice(at, 0, {}));
}
export function setSig(i, n, d, g) {
  const bar = appState.song.bars[i],
    og = bar.g,
    nst = (n * 4 * g) / d;
  if (!Number.isInteger(nst) || nst < 1) return false;
  appState.song.tracks.forEach((t) => {
    const c = t.bars[i],
      out = {},
      late = [];
    for (const key in c) {
      const p = key.split('_'),
        x = (+p[0] * g) / og;
      if (Number.isInteger(x)) {
        if (x < nst) out[x + '_' + p[1]] = c[key];
      } else late.push([Math.round(x), p[1], c[key]]);
    }
    late.forEach(([x, k, v]) => {
      if (x < nst && !out[x + '_' + k]) out[x + '_' + k] = v;
    });
    t.bars[i] = out;
  });
  bar.n = n;
  bar.d = d;
  bar.g = g;
  return true;
}
export function copyBar(i) {
  const b0 = appState.song.bars[i],
    sig = { n: b0.n, d: b0.d, g: b0.g };
  appState.clip =
    appState.scope === 'all'
      ? { all: true, sig, cells: appState.song.tracks.map((t) => clone(t.bars[i])), n: appState.song.tracks.length }
      : {
          all: false,
          sig,
          cells: clone(currentTrack().bars[i]),
          drums: currentTrack().type === 'drums',
          rows: rowsOf(currentTrack())
        };
  toast(appState.scope === 'all' ? `Copied bar ${i + 1}, all tracks` : `Copied bar ${i + 1} of ${currentTrack().name}`);
}
export function pasteBar(i) {
  const cl = appState.clip;
  if (!cl) return false;
  if (cl.all) {
    Object.assign(appState.song.bars[i], cl.sig);
    appState.song.tracks.forEach((t, k) => {
      t.bars[i] = k < cl.cells.length ? clone(cl.cells[k]) : {};
    });
  } else {
    const tr = currentTrack();
    if ((tr.type === 'drums') !== cl.drums) {
      toast('That bar was copied from a different kind of track');
      return false;
    }
    const bar = appState.song.bars[i],
      st = stepsOf(bar),
      out = {};
    for (const key in cl.cells) {
      const p = key.split('_'),
        x = (+p[0] * bar.g) / cl.sig.g;
      if (Number.isInteger(x) && x < st && (p[1] === 'R' || +p[1] < rowsOf(tr)))
        out[x + '_' + p[1]] = clone(cl.cells[key]);
    }
    tr.bars[i] = out;
  }
  return true;
}
