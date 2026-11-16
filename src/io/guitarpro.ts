import type { BarSig, Cell, Track } from '../core/types';
import { BASS_TUNINGS, DRUMS, GUITAR_TUNINGS, drumLane, TONES, clamp, newId, stepsOf } from '../core/constants';
import { fretFor } from '../core/notes';
import { library, normalize } from '../core/state';
import { queuePush, saveLocal } from '../sync/cloud';
import { openSong, toast } from '../ui/render';
import { openSheet } from '../ui/sheets';

/* ================= Guitar Pro import / export (via alphaTab's file readers) ================= */
export const DRUM_MIDI = {
  35: 'kk',
  36: 'kk',
  37: 'sn',
  38: 'sn',
  39: 'sn',
  40: 'sn',
  41: 'ft',
  43: 'ft',
  45: 't2',
  47: 't2',
  48: 't1',
  50: 't1',
  42: 'hh',
  44: 'hh',
  46: 'ho',
  49: 'cr',
  55: 'cr',
  57: 'cr',
  52: 'ch',
  51: 'rd',
  53: 'rd',
  59: 'rd'
};
export const DRUM_ALIAS = {
  91: 38,
  92: 46,
  93: 51,
  94: 51,
  95: 55,
  96: 52,
  97: 49,
  98: 57,
  114: 43,
  115: 49,
  116: 49,
  84: 53,
  123: 53,
  126: 59,
  127: 59,
  29: 59,
  30: 49,
  31: 40,
  33: 37,
  34: 38
};
export function placePitch(tuning, p) {
  // comfortable position first, then anything that works
  for (let k = tuning.length - 1; k >= 0; k--) {
    const f = p - tuning[k];
    if (f >= 0 && f <= (k === 0 ? 24 : 6)) return { k, f };
  }
  return fretFor({ tuning }, p);
}
export function unrollRepeats(mbs, max) {
  const out = [];
  let i = 0,
    start = 0,
    pass = 0,
    guard = 0;
  while (i < mbs.length && out.length < max && guard++ < 20000) {
    const m = mbs[i];
    if (m.isRepeatStart && start !== i) {
      start = i;
      pass = 0;
    }
    if (m.alternateEndings && !(m.alternateEndings & (1 << pass))) {
      i++;
      continue;
    }
    out.push(i);
    if (m.repeatCount > 0) {
      if (pass < m.repeatCount - 1) {
        pass++;
        i = start;
        continue;
      }
      pass = 0;
      start = i + 1;
    }
    i++;
  }
  return out;
}
export function gpImport(at, bytes) {
  const sc = at.importer.ScoreLoader.loadScoreFromBytes(bytes, new at.Settings());
  const M = at.model,
    warn = new Set(),
    MAXB = 500;
  const order = unrollRepeats(sc.masterBars, MAXB);
  if (order.length >= MAXB) warn.add('only the first ' + MAXB + ' bars were imported');
  if (order.length !== sc.masterBars.length) warn.add('repeats were written out in full');
  const song = {
    id: newId(),
    title: [sc.artist, sc.title].filter(Boolean).join(' – ') || 'Imported tab',
    tempo: clamp(Math.round(sc.tempo) || 120, 30, 320),
    updatedAt: Date.now(),
    bars: [],
    tracks: []
  };
  const src = sc.tracks.map((t) => {
    const st = t.staves[0],
      pi = t.playbackInfo,
      drum = !!st.isPercussion;
    const tr: Track = {
      name: (t.name || 'Track').slice(0, 24),
      type: 'guitar',
      vol: 0.8,
      pan: clamp(((pi.balance == null ? 8 : pi.balance) - 8) / 8, -1, 1),
      mute: !!pi.isMute,
      solo: !!pi.isSolo,
      bars: []
    };
    let byPitch = false;
    if (drum) {
      tr.type = 'drums';
      tr.vol = 0.9;
    } else {
      let tun = (st.tuning || []).map((v) => v + (st.capo || 0));
      if (!tun.length) {
        tun = GUITAR_TUNINGS['E standard'].slice();
        byPitch = true;
        warn.add('“' + tr.name + '” has no tab, so its notes were placed on a guitar neck');
      }
      tr.type = (pi.program >= 32 && pi.program <= 39) || tun[0] <= 50 ? 'bass' : 'guitar';
      tr.tuning = tun;
      const set = tr.type === 'bass' ? BASS_TUNINGS : GUITAR_TUNINGS;
      tr.tun = Object.keys(set).find((k) => set[k].join() === tun.join()) || 'Custom';
      tr.tone =
        tr.type === 'bass'
          ? 'bass'
          : pi.program === 29
            ? 'crunch'
            : pi.program === 30 || pi.program === 31
              ? 'highgain'
              : pi.program < 29
                ? 'clean'
                : 'highgain';
      tr.ring = false;
    }
    return { t, st, tr, drum, byPitch, ringing: false, notes: 0, lr: 0 };
  });
  let tempo = song.tempo;
  order.forEach((mi, bi) => {
    const mb = sc.masterBars[mi];
    let n = mb.timeSignatureNumerator,
      d = mb.timeSignatureDenominator;
    while (d < 4) {
      n *= 2;
      d *= 2;
    }
    while (d > 16 && n % 2 === 0) {
      n /= 2;
      d /= 2;
    }
    if (d > 16 || n > 32 || n < 1) {
      warn.add('an unusual time signature was changed to 4/4');
      n = 4;
      d = 4;
    }
    const ticks = ((n * 4) / d) * 960;
    // every note start in this bar, across tracks, decides the grid
    const pos = new Set<number>();
    src.forEach((s) => {
      const b = s.st.bars[mi];
      if (!b) return;
      b.voices.forEach((v) =>
        v.beats.forEach((be) => {
          if (be.graceType) return;
          if (be.notes.some((nt) => !nt.isTieDestination)) pos.add(be.playbackStart);
        })
      );
    });
    let g = 0;
    for (const c of [4, 3, 8, 6, 12]) {
      if (!Number.isInteger((n * 4 * c) / d)) continue;
      const u = 960 / c;
      let ok = true;
      pos.forEach((p) => {
        if (p % u) ok = false;
      });
      if (ok) {
        g = c;
        break;
      }
    }
    if (!g) {
      g = [12, 8, 4, 2].find((c) => Number.isInteger((n * 4 * c) / d)) || 4;
      warn.add('some very fast or odd-tuplet rhythms were snapped to the nearest step');
    }
    const bar: BarSig = { n, d, g },
      steps = (n * 4 * g) / d,
      u = 960 / g;
    const auto = (mb.tempoAutomations && mb.tempoAutomations[0]) || mb.tempoAutomation;
    if (auto && auto.value) {
      const tv = clamp(Math.round(auto.value), 30, 320);
      if (bi === 0) {
        song.tempo = tempo = tv;
      } else if (tv !== tempo) {
        bar.t = tempo = tv;
      }
    }
    song.bars.push(bar);
    src.forEach((s) => {
      const cells = {},
        b = s.st.bars[mi],
        tr = s.tr;
      s.tr.bars.push(cells);
      if (!b) return;
      const rests = [];
      b.voices.forEach((v, vi) =>
        v.beats.forEach((be) => {
          if (be.graceType) {
            warn.add('grace notes were left out');
            return;
          }
          const step = Math.round(be.playbackStart / u);
          if (step < 0 || step >= steps || be.playbackStart >= ticks) return;
          if (be.isRest) {
            if (vi === 0 && !be.isEmpty && !s.drum) rests.push(step);
            return;
          }
          be.notes.forEach((nt) => {
            if (nt.isTieDestination) return;
            if (s.drum) {
              const arts = s.t.percussionArticulations,
                pa = nt.percussionArticulation;
              const midi = arts && pa >= 0 && pa < arts.length ? arts[pa].outputMidiNumber : DRUM_ALIAS[pa] || pa,
                id = DRUM_MIDI[midi];
              if (!id) {
                warn.add('some percussion sounds have no match here and were left out');
                return;
              }
              let vel = 2;
              if (nt.isGhost || nt.dynamics <= 2) vel = 1;
              else if (nt.accentuated || nt.dynamics === 6 || nt.dynamics === 7) vel = 3;
              const key = step + '_' + drumLane(id);
              if (!cells[key] || cells[key].v < vel) cells[key] = { v: vel };
              return;
            }
            let k, f;
            if (s.byPitch) {
              let p = nt.realValue;
              while (p < 40) p += 12;
              while (p > 88) p -= 12;
              const at2 = placePitch(tr.tuning, p);
              if (!at2) return;
              k = at2.k;
              f = at2.f;
            } else {
              k = tr.tuning.length - nt.string;
              f = nt.fret;
            }
            if (k < 0 || k >= tr.tuning.length || f < 0) return;
            const cell: Cell = { f: Math.min(f, 36) };
            if (nt.isPalmMute || be.isPalmMute) cell.pm = 1;
            if (nt.isDead) cell.t = 'x';
            else if (nt.harmonicType === 2 || nt.harmonicType === 3 || nt.harmonicType === 5) cell.t = 'ph';
            else if (nt.hasBend) cell.t = 'b';
            else if (nt.slideOutType) cell.t = 's';
            else if (nt.hammerPullOrigin) cell.t = 'h';
            else if (nt.vibrato || be.vibrato) cell.t = 'v';
            s.notes++;
            if (nt.isLetRing || be.isLetRing) s.lr++;
            cells[step + '_' + k] = cell;
          });
        })
      );
      // a rest only matters when it cuts a ringing note
      if (!s.drum) {
        const cols = new Set<number>();
        for (const key in cells) cols.add(+key.split('_')[0]);
        const ev = [...cols]
          .map((x) => [x, 1])
          .concat(rests.filter((x) => !cols.has(x)).map((x) => [x, 0]))
          .sort((a, b) => a[0] - b[0]);
        ev.forEach(([x, isNote]) => {
          if (isNote) s.ringing = true;
          else if (s.ringing) {
            cells[x + '_R'] = { r: 1 };
            s.ringing = false;
          }
        });
      }
    });
  });
  src.forEach((s) => {
    if (!s.drum && s.notes && s.lr / s.notes > 0.4) s.tr.ring = true;
    song.tracks.push(s.tr);
  });
  return { song, warn: [...warn] };
}
// split a bar into note values: quarter spans, halved or tripled until every note start sits on a boundary
export function barRhythm(bar, starts) {
  const st = stepsOf(bar),
    g = bar.g,
    has = new Set(starts),
    out = [];
  const span = (a, len, val) => {
    const inner = [];
    for (let p = 1; p < len; p++) if (has.has(a + p)) inner.push(p);
    if (!inner.length) {
      out.push({ s: a, len, val, tup: false });
      return;
    }
    if (len % 3 === 0 && inner.every((x) => x % (len / 3) === 0)) {
      const u = len / 3,
        cuts = [0, ...inner, len];
      for (let i = 0; i < cuts.length - 1; i++) {
        const l = (cuts[i + 1] - cuts[i]) / u;
        out.push({ s: a + cuts[i], len: l * u, val: l === 2 ? val : val * 2, tup: true });
      }
      return;
    }
    if (len % 2 === 0) {
      span(a, len / 2, val * 2);
      span(a + len / 2, len / 2, val * 2);
      return;
    }
    out.push({ s: a, len, val, tup: false });
  };
  for (let q = 0; q < st; q += g) {
    if (q + g <= st) {
      span(q, g, 4);
      continue;
    }
    let a = q,
      rem = st - q,
      size = g / 2,
      val = 8;
    while (rem > 0 && Number.isInteger(size) && size >= 1) {
      if (rem >= size) {
        span(a, size, val);
        a += size;
        rem -= size;
      } else {
        size /= 2;
        val *= 2;
      }
    }
  }
  out.forEach((p) => {
    p.cont = !has.has(p.s);
  });
  // join plain quarters that only continue the note before them into halves and wholes
  for (const [unit, val] of [
    [g, 4],
    [2 * g, 2]
  ]) {
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i],
        b = out[i + 1];
      if (
        !a.tup &&
        !b.tup &&
        a.val === val &&
        b.val === val &&
        a.len === unit &&
        b.len === unit &&
        b.cont &&
        a.s % (2 * unit) === 0
      ) {
        a.len *= 2;
        a.val = val / 2;
        out.splice(i + 1, 1);
      }
    }
  }
  return out;
}
export let drumKit = null;
export function gpDrumKit(at) {
  // Guitar Pro stores drum notes as positions in the track's kit list, so read that list back once
  if (drumKit) return drumKit;
  const M = at.model,
    sc = new M.Score(),
    mb = new M.MasterBar();
  sc.addMasterBar(mb);
  const t = new M.Track();
  t.ensureStaveCount(1);
  t.staves[0].isPercussion = true;
  sc.addTrack(t);
  const b = new M.Bar();
  t.staves[0].addBar(b);
  const v = new M.Voice();
  b.addVoice(v);
  const be = new M.Beat();
  v.addBeat(be);
  const st = new at.Settings();
  sc.finish(st);
  const back = at.importer.ScoreLoader.loadScoreFromBytes(new at.exporter.Gp7Exporter().export(sc, st), st);
  const arts = back.tracks[0].percussionArticulations,
    idx = {};
  DRUMS.forEach((d) => {
    let i = arts.findIndex((a) => a.id === d.midi);
    if (i < 0) i = arts.findIndex((a) => a.outputMidiNumber === d.midi);
    idx[d.midi] = i;
  });
  return (drumKit = { arts, idx });
}
export function gpExport(at, song) {
  const M = at.model,
    sc = new M.Score(),
    kit = gpDrumKit(at);
  sc.title = song.title;
  let tempo = null;
  song.bars.forEach((b, i) => {
    const mb = new M.MasterBar();
    mb.timeSignatureNumerator = b.n;
    mb.timeSignatureDenominator = b.d;
    const t = i === 0 ? song.tempo : b.t;
    if (t && t !== tempo) {
      mb.tempoAutomations.push(M.Automation.buildTempoAutomation(false, 0, t, 2));
      tempo = t;
    }
    sc.addMasterBar(mb);
  });
  let ch = 0;
  song.tracks.forEach((tr) => {
    const t = new M.Track(),
      drum = tr.type === 'drums';
    t.name = tr.name;
    t.shortName = tr.name.slice(0, 8);
    t.ensureStaveCount(1);
    const st = t.staves[0],
      pi = t.playbackInfo;
    pi.volume = Math.round(tr.vol * 16);
    pi.balance = Math.round(8 + tr.pan * 8);
    pi.isMute = !!tr.mute;
    pi.isSolo = !!tr.solo;
    if (drum) {
      st.isPercussion = true;
      pi.primaryChannel = pi.secondaryChannel = 9;
      pi.program = 0;
      t.percussionArticulations = kit.arts;
    } else {
      st.stringTuning.tunings = tr.tuning.slice();
      st.showTablature = true;
      pi.program = (TONES[tr.tone] || TONES.highgain).prog;
      if (ch === 8) ch = 10;
      pi.primaryChannel = Math.min(ch, 14);
      pi.secondaryChannel = Math.min(ch + 1, 15);
      ch += 2;
    }
    sc.addTrack(t);
    let ring = null,
      beatNo = 0;
    const last = {}; // ring: notes still sounding; last: latest note object per string
    const rows = drum ? DRUMS.length : tr.tuning.length;
    tr.bars.forEach((cells, bi) => {
      const bar = song.bars[bi],
        stp = stepsOf(bar),
        ab = new M.Bar();
      ab.clef = drum ? M.Clef.Neutral : tr.type === 'bass' ? M.Clef.F4 : M.Clef.G2;
      st.addBar(ab);
      const v = new M.Voice();
      ab.addVoice(v);
      const cols = new Map();
      for (const key in cells) {
        const p = key.split('_'),
          s = +p[0];
        if (s >= stp) continue;
        if (p[1] === 'R') {
          if (!cols.has(s)) cols.set(s, []);
        } else if (+p[1] < rows) {
          if (!cols.get(s) || !cols.get(s).length) cols.set(s, []);
          cols.get(s).push([+p[1], cells[key]]);
        }
      }
      barRhythm(
        bar,
        [...cols.keys()].sort((a, b) => a - b)
      ).forEach((pc) => {
        const be = new M.Beat();
        be.duration = pc.val;
        if (pc.tup) {
          be.tupletNumerator = 3;
          be.tupletDenominator = 2;
        }
        v.addBeat(be);
        beatNo++;
        if (pc.cont) {
          if (ring && !drum)
            ring.forEach(([k, cell]) => {
              const nt = new M.Note();
              nt.string = tr.tuning.length - k;
              nt.fret = cell.f;
              nt.isTieDestination = true;
              if (cell.pm) nt.isPalmMute = true;
              if (tr.ring) nt.isLetRing = true;
              be.addNote(nt);
              last[k] = [nt, beatNo];
            });
          return;
        }
        const notes = cols.get(pc.s);
        if (!notes.length) {
          ring = null;
          return;
        }
        notes.forEach(([k, cell]) => {
          const nt = new M.Note();
          if (drum) {
            if (kit.idx[DRUMS[k].midi] < 0) return;
            nt.percussionArticulation = kit.idx[DRUMS[k].midi];
            if (cell.v === 1) {
              nt.isGhost = true;
              nt.dynamics = M.DynamicValue.P;
            } else if (cell.v === 3) {
              nt.accentuated = M.AccentuationType.Normal;
              nt.dynamics = M.DynamicValue.FF;
            }
            be.addNote(nt);
            return;
          }
          nt.string = tr.tuning.length - k;
          nt.fret = cell.f;
          if (cell.pm) nt.isPalmMute = true;
          if (tr.ring) nt.isLetRing = true;
          if (cell.t === 'x') nt.isDead = true;
          else if (cell.t === 'h') {
            if (last[k] && last[k][1] === beatNo - 1) last[k][0].isHammerPullOrigin = true;
          } else if (cell.t === 's') nt.slideOutType = M.SlideOutType.Shift;
          else if (cell.t === 'b') {
            nt.bendType = M.BendType.Bend;
            nt.addBendPoint(new M.BendPoint(0, 0));
            nt.addBendPoint(new M.BendPoint(30, 4));
            nt.addBendPoint(new M.BendPoint(60, 4));
          } else if (cell.t === 'v') nt.vibrato = M.VibratoType.Slight;
          else if (cell.t === 'ph') {
            nt.harmonicType = M.HarmonicType.Pinch;
            nt.harmonicValue = 12;
          }
          be.addNote(nt);
          last[k] = [nt, beatNo];
        });
        ring = drum ? null : notes.filter((x) => x[1].t !== 'x');
        if (ring && !ring.length) ring = null;
      });
    });
  });
  const settings = new at.Settings();
  sc.finish(settings);
  return new at.exporter.Gp7Exporter().export(sc, settings);
}
export let alphaTabLoading = null;
export function loadAlphaTab() {
  // the Guitar Pro reader is a big script, so it only loads when a file is opened or saved
  return (
    alphaTabLoading ||
    (alphaTabLoading = new Promise((res, rej) => {
      if (window.alphaTab) return res(window.alphaTab);
      const sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/@coderline/alphatab@1.8.4/dist/alphaTab.min.js';
      sc.onload = () => (window.alphaTab ? res(window.alphaTab) : ((alphaTabLoading = null), rej(new Error('load'))));
      sc.onerror = () => {
        alphaTabLoading = null;
        rej(new Error('load'));
      };
      document.head.appendChild(sc);
    }))
  );
}
export async function openGpFile(file) {
  if (!file) return;
  toast('Reading ' + file.name + '…');
  let at;
  try {
    at = await loadAlphaTab();
  } catch (e) {
    toast('Couldn’t load the Guitar Pro reader. Check your connection and try again.');
    return;
  }
  let r;
  try {
    r = gpImport(at, new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    toast('That file couldn’t be read. Guitar Pro 3 to 8 files (.gp3 .gp4 .gp5 .gpx .gp) and MusicXML work.');
    return;
  }
  const s = normalize(r.song);
  if (!s || !s.tracks.length) {
    toast('That file has no tracks to show');
    return;
  }
  library.songs[s.id] = s;
  openSong(s.id);
  saveLocal();
  queuePush(s.id);
  const lines = [
    `${s.tracks.length} ${s.tracks.length === 1 ? 'track' : 'tracks'} and ${s.bars.length} bars came in as “${s.title}”.`
  ].concat(r.warn.map((w) => w[0].toUpperCase() + w.slice(1) + '.'));
  lines.push('Note lengths aren’t stored here: each note rings until the next one or a rest.');
  openSheet('info', { title: 'Tab imported', lines });
}
