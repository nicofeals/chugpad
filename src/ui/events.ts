import { preview } from '../audio/engine';
import { clamp, rowsOf, stepsOf } from '../core/constants';
import { appState, currentTrack } from '../core/state';
import { openGpFile } from '../io/guitarpro';
import { canEdit, openFromLink, saveLocal, saveTimer } from '../sync/cloud';
import { actionHandlers, EDIT_ACTIONS, inputHandlers } from './actions';
import { recTap } from './capture';
import { enterFret, toggleDrum } from './editing';
import { placeCursor, renderPad, renderTop, toast } from './render';
import { closeSheet, refreshSheet, sheetKind } from './sheets';

/* ================= events ================= */
document.addEventListener('click', (e: any) => {
  const b = e.target.closest('[data-act]');
  if (b) {
    if (b.disabled) return;
    const a = b.dataset.act,
      f = actionHandlers[a];
    if (EDIT_ACTIONS.has(a) && !canEdit()) {
      toast('View only. Make your own copy to change it.');
      return;
    }
    if (f) f(b.dataset, b);
    return;
  }
  if (e.target.id === 'sheet') {
    closeSheet();
    return;
  }
  const g = e.target.closest('.grid');
  if (!g) return;
  const i = +g.dataset.i,
    r = g.getBoundingClientRect(),
    tr = currentTrack(),
    st = stepsOf(appState.song.bars[i]),
    rows = rowsOf(tr);
  const step = clamp(Math.floor(((e.clientX - r.left) / r.width) * st), 0, st - 1),
    row = clamp(Math.floor(((e.clientY - r.top) / r.height) * rows), 0, rows - 1);
  if (tr.type === 'drums') {
    toggleDrum(i, step, row);
    return;
  }
  appState.cur = { bar: i, step, str: row };
  appState.tens = 0;
  placeCursor(false);
  renderPad();
  const n = tr.bars[i][step + '_' + row];
  if (n) preview(n, row);
});
document.addEventListener('input', (e: any) => {
  const k = e.target.dataset && e.target.dataset.in;
  if (k && !canEdit()) return;
  if (k && inputHandlers[k] && e.target.tagName !== 'SELECT' && e.target.type !== 'checkbox')
    inputHandlers[k](e.target);
});
document.addEventListener('pointerdown', (e: any) => {
  const p = e.target.closest && e.target.closest('[data-pad]');
  if (p) {
    e.preventDefault();
    recTap(+p.dataset.pad, e);
  }
});
document.addEventListener('change', (e: any) => {
  if (e.target.id === 'gpfile') {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    openGpFile(f);
    return;
  }
  if (e.target.dataset && e.target.dataset.in && !canEdit()) {
    toast('View only. Make your own copy to change it.');
    refreshSheet();
    return;
  }
  const k = e.target.dataset && e.target.dataset.in;
  if (k && inputHandlers[k] && (e.target.tagName === 'SELECT' || e.target.type === 'checkbox'))
    inputHandlers[k](e.target);
});
document.addEventListener('keydown', (e: any) => {
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.key === 'Escape' && sheetKind) {
    closeSheet();
    return;
  }
  if (sheetKind) return;
  const k = e.key,
    lk = k.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && lk === 'z') {
    e.preventDefault();
    if (canEdit()) e.shiftKey ? actionHandlers.redo() : actionHandlers.undo();
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (k === ' ') {
    e.preventDefault();
    actionHandlers.play();
    return;
  }
  if (k === 'Tab') {
    e.preventDefault();
    actionHandlers.track({
      i: (appState.ti + (e.shiftKey ? appState.song.tracks.length - 1 : 1)) % appState.song.tracks.length
    });
    return;
  }
  if (currentTrack().type === 'drums') return;
  const mv = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd' }[k];
  if (mv) {
    e.preventDefault();
    actionHandlers.mv({ d: mv });
    return;
  }
  if (!canEdit()) return;
  if (/^[0-9]$/.test(k)) {
    // a quick 1 or 2 followed by another digit makes a two-digit fret
    const now = performance.now(),
      le = appState.last,
      n = +k;
    if (le && now - le.time < 600 && (le.f === 1 || le.f === 2) && le.f * 10 + n <= 24) {
      appState.cur = { bar: le.bar, step: le.step, str: le.str };
      appState.tens = le.f;
      enterFret(n);
      appState.undo.pop();
      appState.last = null;
      renderTop();
    } else {
      const pos = Object.assign({}, appState.cur);
      enterFret(n);
      appState.last = Object.assign(pos, { f: n, time: now });
    }
    return;
  }
  if (k === 'Backspace' || k === 'Delete') {
    e.preventDefault();
    actionHandlers.del();
    return;
  }
  const tk = { x: 'x', h: 'h', '/': 's', b: 'b', v: 'v' }[lk];
  if (tk) {
    actionHandlers.tech({ t: tk });
    return;
  }
  if (lk === 'r') {
    actionHandlers.rest();
    return;
  }
  if (lk === 'p') actionHandlers.pm();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(saveTimer);
    saveLocal();
  }
});
window.addEventListener('pagehide', saveLocal);
window.addEventListener('hashchange', openFromLink);
