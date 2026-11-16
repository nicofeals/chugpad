import { audioState, applyMix } from '../audio/engine';
import { stop } from '../audio/playback';
import {
  qs,
  DRUMS,
  GRIDS,
  NOTE_NAMES,
  TECH_GLYPHS,
  triangleIcon,
  clamp,
  escapeHtml,
  rowsOf,
  stepsOf
} from '../core/constants';
import { library, appState, currentTrack } from '../core/state';
import { canEdit, isMine, isShared, subscribeCurrent } from '../sync/cloud';

/* ================= rendering ================= */
export function barHTML(i) {
  const tr = currentTrack(),
    song = appState.song,
    bar = song.bars[i],
    c = tr.bars[i],
    st = stepsOf(bar),
    rows = rowsOf(tr),
    drum = tr.type === 'drums';
  let h = '',
    pm = '';
  const pmSteps = new Set<number>();
  const u = ((bar.g * 4) / bar.d) * (bar.d === 8 && bar.n % 3 === 0 && bar.n > 3 ? 3 : 1);
  for (let b = 0; b * u < st; b++)
    h += `<div class="beat${b % 2 ? ' alt' : ''}" style="left:${((b * u) / st) * 100}%;width:${(Math.min(u, st - b * u) / st) * 100}%"></div>`;
  for (const key in c) {
    const p = key.split('_'),
      s = +p[0],
      cell = c[key];
    if (s >= st) continue;
    const left = (s / st) * 100;
    if (p[1] === 'R') {
      if (!drum) h += `<div class="rest" style="left:${left}%"></div>`;
      continue;
    }
    const k = +p[1];
    if (k >= rows) continue;
    if (drum)
      h += `<span class="n d v${cell.v || 2}${k < 5 ? ' cym' : ''}" style="left:${left}%;top:calc(${k}*var(--rh))"><b>${k < 5 ? '×' : ''}</b></span>`;
    else {
      if (cell.pm) pmSteps.add(s);
      h += `<span class="n${cell.pm ? ' pm' : ''}" style="left:${left}%;top:calc(${k}*var(--rh))"><b>${cell.t === 'x' ? 'x' : cell.f}</b>${TECH_GLYPHS[cell.t] ? `<i>${TECH_GLYPHS[cell.t]}</i>` : ''}</span>`;
    }
  }
  pmSteps.forEach((s) => {
    pm += `<u style="left:${(s / st) * 100}%"></u>`;
  });
  const labels = drum ? DRUMS.map((d) => d.label) : tr.tuning.map((m) => NOTE_NAMES[m % 12]);
  const prev = song.bars[i - 1],
    sig = !prev || prev.n !== bar.n || prev.d !== bar.d ? `<span class="sig">${bar.n}/${bar.d}</span>` : '';
  const gl = bar.g !== 4 ? `<span class="gl">${GRIDS[bar.g]}</span>` : '',
    tp = i > 0 && bar.t ? `<span class="tp">${bar.t} bpm</span>` : '';
  const lp = appState.loop.on && i >= appState.loop.a && i <= appState.loop.b ? `<span class="lp">loop</span>` : '';
  return `<div class="bar${i === appState.cur.bar ? ' current' : ''}${st > 32 ? ' wide' : ''}" data-i="${i}" style="--steps:${st};--rows:${rows}">
<div class="bar-head"><button class="bar-btn" data-act="bar" data-i="${i}" aria-label="Bar ${i + 1} options">${i + 1}<span>···</span></button>${sig}${gl}${tp}${lp}</div>
<div class="bar-body"><div class="gutter">${labels.map((l) => `<span>${l}</span>`).join('')}</div><div class="grid" data-i="${i}">${h}</div></div>
${drum ? '' : `<div class="pmrow">${pm ? '<em>PM</em>' : ''}${pm}</div>`}</div>`;
}
export function renderScore() {
  document.documentElement.style.setProperty('--gut', currentTrack().type === 'drums' ? '24px' : '20px');
  qs('#score').innerHTML =
    appState.song.bars.map((_, i) => barHTML(i)).join('') + `<button id="addbar" data-act="addbar">Add a bar</button>`;
  placeCursor(false);
}
export function renderBar(i) {
  const el = qs(`.bar[data-i="${i}"]`);
  if (el) {
    el.outerHTML = barHTML(i);
    placeCursor(false);
  }
}
export function placeCursor(scroll = true) {
  document.querySelectorAll('.cursor,.curcol').forEach((e) => e.remove());
  document.querySelectorAll('.bar.current').forEach((e) => e.classList.remove('current'));
  const el = qs(`.bar[data-i="${appState.cur.bar}"]`);
  if (!el) return;
  el.classList.add('current');
  if (currentTrack().type !== 'drums') {
    const grid = qs('.grid', el),
      st = stepsOf(appState.song.bars[appState.cur.bar]),
      left = (appState.cur.step / st) * 100;
    grid.insertAdjacentHTML(
      'beforeend',
      `<div class="curcol" style="left:${left}%"></div><div class="cursor" style="left:${left}%;top:calc(${appState.cur.str}*var(--rh))"></div>`
    );
  }
  if (scroll) {
    el.scrollIntoView({ block: 'nearest' });
    const cu = qs('.cursor', el);
    if (cu && el.classList.contains('wide')) cu.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  if (!appState.playing) qs('#pos').textContent = `Bar ${appState.cur.bar + 1} of ${appState.song.bars.length}`;
}
export function renderTop() {
  qs('#titleB').innerHTML =
    `${escapeHtml(appState.song.title)}<small>${appState.song.tempo} bpm${appState.song.bars.some((b, i) => i && b.t) ? ' +' : ''}</small>${!canEdit() ? '<span class="tag">view only</span>' : isShared(appState.song) || !isMine(appState.song) ? '<span class="tag">shared</span>' : ''}`;
  const lock = qs('#lockB'),
    locked = appState.locked && canEdit();
  lock.hidden = !canEdit();
  lock.classList.toggle('on', locked);
  lock.setAttribute('aria-pressed', String(locked));
  lock.title = locked ? 'Score locked: tap to edit' : 'Editing: tap to lock the score';
  lock.innerHTML = locked
    ? `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 5V3.5a3 3 0 0 1 6 0V5h.5a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1.5 0h3V3.5a1.5 1.5 0 0 0-3 0z"/></svg><span>Locked</span>`
    : `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M8.6 1.2l2.2 2.2-6.9 6.9-2.9.7.7-2.9z"/></svg><span>Edit</span>`;
  document.body.classList.toggle('locked', locked);
  qs('#undoB').disabled = !appState.undo.length;
  qs('#redoB').disabled = !appState.redo.length;
  qs('#tabs').innerHTML = appState.song.tracks
    .map(
      (t, i) =>
        `<button class="tab${i === appState.ti ? ' on' : ''}${t.mute ? ' muted' : ''}" data-act="track" data-i="${i}" style="--c:var(--t${i % 4})">${escapeHtml(t.name)}</button>`
    )
    .join('');
  document.body.style.setProperty('--acc', `var(--t${appState.ti % 4})`);
}
export function renderTransport() {
  qs('#play').innerHTML = appState.playing
    ? `<svg viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1.5"/></svg>Stop`
    : `${triangleIcon('r')}Play`;
  const l = qs('#loopB');
  l.classList.toggle('on', appState.loop.on);
  l.textContent = appState.loop.on
    ? appState.loop.a === appState.loop.b
      ? `Loop ${appState.loop.a + 1}`
      : `Loop ${appState.loop.a + 1}–${appState.loop.b + 1}`
    : 'Loop';
  qs('#metroB').classList.toggle('on', appState.metro);
  qs('#padB').classList.toggle('on', appState.pad && !appState.locked);
  qs('#padB').disabled = appState.locked && canEdit();
  if (!appState.playing) qs('#pos').textContent = `Bar ${appState.cur.bar + 1} of ${appState.song.bars.length}`;
}
export function renderPad() {
  const pad = qs('#pad');
  if (!canEdit()) {
    pad.hidden = false;
    pad.innerHTML = `<div class="ro"><span><b>View only.</b> You can read and play this song, but not change it.</span><button class="b" data-act="dupsong">Make my own copy</button></div>`;
    return;
  }
  // locked: hide the keypad, more room to read the score
  pad.hidden = !appState.pad || appState.locked;
  if (pad.hidden) return;
  const tr = currentTrack();
  if (tr.type === 'drums') {
    pad.innerHTML = `<div class="row">
<button class="k s${appState.vel === 1 ? ' on' : ''}" data-act="vel" data-v="1">Ghost</button>
<button class="k s${appState.vel === 2 ? ' on' : ''}" data-act="vel" data-v="2">Normal</button>
<button class="k s${appState.vel === 3 ? ' on' : ''}" data-act="vel" data-v="3">Accent</button>
<button class="k s" data-act="patterns">Patterns</button></div>`;
    return;
  }
  const cell = tr.bars[appState.cur.bar][appState.cur.step + '_' + appState.cur.str],
    t = cell && cell.t;
  const tk = (id, lab, ti) =>
    `<button class="k s${t === id ? ' on' : ''}" data-act="tech" data-t="${id}" aria-label="${ti}">${lab}</button>`;
  const num = (n) =>
    `<button class="k num" data-act="fret" data-n="${n}">${appState.tens ? (appState.tens * 10 + n > 24 ? 24 : appState.tens * 10 + n) : n}</button>`;
  pad.innerHTML = `<div class="row">
<button class="k s pmk${appState.pm ? ' on' : ''}" data-act="pm" aria-label="Palm mute">PM</button>
${tk('x', 'x', 'Dead note')}${tk('h', 'h', 'Hammer-on or pull-off')}${tk('s', '/', 'Slide')}${tk('b', 'b', 'Bend')}${tk('v', '~', 'Vibrato')}${tk('ph', '◆', 'Pinch harmonic')}
<button class="k s" data-act="rest" aria-label="Rest">rest</button></div>
<div class="row">
<button class="k s" data-act="mv" data-d="l" aria-label="Previous step">${triangleIcon('l')}</button>
<button class="k s" data-act="mv" data-d="r" aria-label="Next step">${triangleIcon('r')}</button>
<button class="k s" data-act="mv" data-d="u" aria-label="String up">${triangleIcon('u')}</button>
<button class="k s" data-act="mv" data-d="d" aria-label="String down">${triangleIcon('d')}</button>
<button class="k s${appState.chord ? ' on' : ''}" data-act="chord" style="grid-column:span 2">${['1 note', 'Power 5', 'Power 5+8'][appState.chord]}</button>
<button class="k s" data-act="adv" style="grid-column:span 2">${appState.adv ? 'Jump ' + appState.adv : 'Stay put'}</button>
<button class="k s" data-act="del" aria-label="Delete note">⌫</button></div>
<div class="row">${[0, 1, 2, 3, 4, 5].map(num).join('')}</div>
<div class="row">${[6, 7, 8, 9].map(num).join('')}
<button class="k num${appState.tens === 1 ? ' on' : ''}" data-act="tens" data-n="1">1<small>0+</small></button>
<button class="k num${appState.tens === 2 ? ' on' : ''}" data-act="tens" data-n="2">2<small>0+</small></button></div>`;
}
export function renderAll() {
  appState.ti = clamp(appState.ti, 0, appState.song.tracks.length - 1);
  appState.cur.bar = clamp(appState.cur.bar, 0, appState.song.bars.length - 1);
  appState.cur.step = clamp(appState.cur.step, 0, stepsOf(appState.song.bars[appState.cur.bar]) - 1);
  appState.cur.str = clamp(appState.cur.str, 0, rowsOf(currentTrack()) - 1);
  renderTop();
  renderScore();
  renderTransport();
  renderPad();
  appState.song.tracks.forEach((_, i) => applyMix(i));
}
export let toastTimer: any = 0;
export function toast(msg) {
  const t = qs('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}
export function openSong(id) {
  stop();
  library.currentId = id;
  appState.song = library.songs[id];
  appState.ti = 0;
  appState.cur = { bar: 0, step: 0, str: Math.max(0, rowsOf(appState.song.tracks[0]) - 1) };
  appState.undo = [];
  appState.redo = [];
  appState.loop = { on: false, a: 0, b: 0 };
  appState.tens = 0;
  audioState.bus.forEach((b) => {
    try {
      b.vol.disconnect();
    } catch (e) {}
  });
  audioState.bus = [];
  renderAll();
  qs('#score').scrollTop = 0;
  subscribeCurrent();
}
