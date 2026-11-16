import { audioState, applyMix, preview } from '../audio/engine';
import { clampLoop, play, stop } from '../audio/playback';
import { qs, BASS_TUNINGS, GRIDS, GUITAR_TUNINGS, clamp, clone, newId, rowsOf, stepsOf } from '../core/constants';
import { drumPattern, fillFrom } from '../core/notes';
import {
  library,
  appState,
  currentTrack,
  blankSong,
  newTrack,
  normalize,
  strip,
  tempoAt,
  LOCK_KEY
} from '../core/state';
import { asciiTab, buildMidi } from '../io/export';
import { gpExport, loadAlphaTab } from '../io/guitarpro';
import {
  authClient,
  cloudDb,
  sharedWithMe,
  myEmail,
  firebaseSdk,
  myId,
  dirty,
  dropShared,
  isShared,
  latestId,
  linkFor,
  openShared,
  queuePush,
  refFor,
  refreshDir,
  saveFile,
  saveLocal,
  saveShare,
  saveSoon,
  shareOf
} from '../sync/cloud';
import { recorder, fileSlug, recCancel, recStart } from './capture';
import { commit, copyBar, enterFret, insertBar, moveStep, pasteBar, pushUndo, setSig, swapHistory } from './editing';
import {
  openSong,
  placeCursor,
  renderAll,
  renderBar,
  renderPad,
  renderScore,
  renderTop,
  renderTransport,
  toast
} from './render';
import { closeSheet, openSheet, refreshSheet, sheetArg, sheetKind } from './sheets';

/* ================= actions ================= */
export let taps = [];
export function armed(el: HTMLElement, label?: string) {
  // destructive buttons need a second tap
  if (el.dataset.armed) return true;
  el.dataset.armed = '1';
  const old = el.textContent;
  el.textContent = label || 'Tap again to confirm';
  setTimeout(() => {
    if (el.isConnected) {
      delete el.dataset.armed;
      el.textContent = old;
    }
  }, 2500);
  return false;
}
export const actionHandlers = {
  play() {
    appState.playing ? stop() : play();
  },
  loop() {
    appState.loop.on = !appState.loop.on;
    if (
      appState.loop.on &&
      (appState.cur.bar < appState.loop.a || appState.cur.bar > appState.loop.b || appState.loop.a === appState.loop.b)
    ) {
      appState.loop.a = appState.loop.b = appState.cur.bar;
    }
    renderScore();
    renderTransport();
  },
  metro() {
    appState.metro = !appState.metro;
    renderTransport();
  },
  pad() {
    appState.pad = !appState.pad;
    renderPad();
    renderTransport();
  },
  lock() {
    appState.locked = !appState.locked;
    try {
      localStorage.setItem(LOCK_KEY, appState.locked ? '1' : '0');
    } catch (e) {}
    renderTop();
    renderPad();
    renderTransport();
    toast(appState.locked ? 'Score locked. Taps only move the cursor.' : 'Editing. Taps write notes.');
  },
  undo() {
    swapHistory(appState.undo, appState.redo);
  },
  redo() {
    swapHistory(appState.redo, appState.undo);
  },
  track(d) {
    appState.ti = +d.i;
    appState.tens = 0;
    appState.cur.str = clamp(appState.cur.str, 0, rowsOf(currentTrack()) - 1);
    renderAll();
  },
  addbar() {
    pushUndo();
    const n = appState.song.bars.length;
    insertBar(n, appState.song.bars[n - 1]);
    appState.cur.bar = n;
    appState.cur.step = 0;
    commit();
    placeCursor();
  },
  fret(d) {
    enterFret(+d.n);
  },
  tens(d) {
    appState.tens = appState.tens === +d.n ? 0 : +d.n;
    renderPad();
  },
  pm() {
    appState.pm = !appState.pm;
    const tr = currentTrack(),
      c = tr.bars[appState.cur.bar];
    let hit = false;
    for (let k = 0; k < tr.tuning.length; k++) {
      const n = c[appState.cur.step + '_' + k];
      if (n) {
        if (!hit) {
          pushUndo();
          hit = true;
        }
        if (appState.pm) n.pm = 1;
        else delete n.pm;
      }
    }
    if (hit) {
      dirty();
      renderBar(appState.cur.bar);
      renderTop();
    }
    renderPad();
  },
  tech(d) {
    const n = currentTrack().bars[appState.cur.bar][appState.cur.step + '_' + appState.cur.str];
    if (!n) {
      toast('Put the cursor on a note first');
      return;
    }
    pushUndo();
    if (n.t === d.t) delete n.t;
    else n.t = d.t;
    preview(n, appState.cur.str);
    commit(appState.cur.bar);
  },
  rest() {
    pushUndo();
    const tr = currentTrack(),
      c = tr.bars[appState.cur.bar],
      s = appState.cur.step;
    for (let k = 0; k < tr.tuning.length; k++) delete c[s + '_' + k];
    c[s + '_R'] = { r: 1 };
    dirty();
    renderBar(appState.cur.bar);
    renderTop();
    if (appState.adv) moveStep(appState.adv, true);
    renderPad();
  },
  del() {
    const c = currentTrack().bars[appState.cur.bar],
      k = appState.cur.step + '_' + appState.cur.str;
    if (c[k]) {
      pushUndo();
      delete c[k];
      commit(appState.cur.bar);
    } else if (c[appState.cur.step + '_R']) {
      pushUndo();
      delete c[appState.cur.step + '_R'];
      commit(appState.cur.bar);
    } else {
      moveStep(-1);
      renderPad();
    }
  },
  mv(d) {
    appState.tens = 0;
    if (d.d === 'l') moveStep(-1);
    else if (d.d === 'r') moveStep(1);
    else {
      appState.cur.str = clamp(appState.cur.str + (d.d === 'u' ? -1 : 1), 0, rowsOf(currentTrack()) - 1);
      placeCursor();
    }
    renderPad();
  },
  chord() {
    appState.chord = (appState.chord + 1) % 3;
    renderPad();
  },
  adv() {
    appState.adv = { 0: 1, 1: 2, 2: 4, 4: 0 }[appState.adv];
    renderPad();
  },
  vel(d) {
    appState.vel = +d.v;
    renderPad();
  },
  close() {
    closeSheet();
  },
  bar(d) {
    appState.cur.bar = +d.i;
    appState.cur.step = clamp(appState.cur.step, 0, stepsOf(appState.song.bars[appState.cur.bar]) - 1);
    placeCursor(false);
    renderPad();
    openSheet('bar', +d.i);
  },
  scope(d) {
    appState.scope = d.s;
    refreshSheet();
  },
  copy() {
    copyBar(sheetArg);
    refreshSheet();
  },
  paste() {
    pushUndo();
    if (pasteBar(sheetArg)) {
      commit();
      closeSheet();
    } else appState.undo.pop();
  },
  pasteafter() {
    pushUndo();
    insertBar(sheetArg + 1, appState.clip.sig);
    if (pasteBar(sheetArg + 1)) {
      appState.cur.bar = sheetArg + 1;
      appState.cur.step = 0;
      commit();
      placeCursor();
      closeSheet();
    } else {
      appState.song.bars.splice(sheetArg + 1, 1);
      appState.song.tracks.forEach((t) => t.bars.splice(sheetArg + 1, 1));
      appState.undo.pop();
    }
  },
  clear() {
    pushUndo();
    if (appState.scope === 'all')
      appState.song.tracks.forEach((t) => {
        t.bars[sheetArg] = {};
      });
    else currentTrack().bars[sheetArg] = {};
    commit(sheetArg);
    closeSheet();
  },
  rep(d) {
    pushUndo();
    const i = sheetArg,
      n = +d.n,
      a = i - n + 1;
    const bars = appState.song.bars.slice(a, i + 1).map((b) => ({ n: b.n, d: b.d, g: b.g }));
    appState.song.bars.splice(i + 1, 0, ...bars);
    appState.song.tracks.forEach((t) => t.bars.splice(i + 1, 0, ...t.bars.slice(a, i + 1).map(clone)));
    appState.cur.bar = i + 1;
    appState.cur.step = 0;
    commit();
    placeCursor();
    closeSheet();
    toast(n === 1 ? 'Bar repeated' : `${n} bars repeated`);
  },
  fill(d) {
    pushUndo();
    fillFrom(appState.song, appState.ti, +d.k, sheetArg);
    commit(sheetArg);
    closeSheet();
  },
  patterns() {
    openSheet('patterns');
  },
  pattern(d) {
    pushUndo();
    currentTrack().bars[appState.cur.bar] = drumPattern(d.p, appState.song.bars[appState.cur.bar]);
    commit(appState.cur.bar);
    closeSheet();
  },
  loopbar() {
    appState.loop = { on: true, a: sheetArg, b: sheetArg };
    renderScore();
    renderTransport();
    closeSheet();
  },
  loopa() {
    appState.loop.on = true;
    appState.loop.a = sheetArg;
    if (appState.loop.b < sheetArg) appState.loop.b = sheetArg;
    renderScore();
    renderTransport();
    closeSheet();
  },
  loopb() {
    appState.loop.on = true;
    appState.loop.b = sheetArg;
    if (appState.loop.a > sheetArg) appState.loop.a = sheetArg;
    renderScore();
    renderTransport();
    closeSheet();
  },
  loopoff() {
    appState.loop.on = false;
    renderScore();
    renderTransport();
    closeSheet();
  },
  sig(d) {
    const n = +qs('#sigN').value,
      dd = +qs('#sigD').value,
      g = +qs('#sigG').value;
    if (!Number.isInteger((n * 4 * g) / dd)) {
      toast(`${GRIDS[g]} don’t divide ${n}/${dd} evenly. Pick another grid.`);
      return;
    }
    pushUndo();
    if (d.all === '1') appState.song.bars.forEach((_, i) => setSig(i, n, dd, g));
    else setSig(sheetArg, n, dd, g);
    appState.cur.step = 0;
    commit();
    closeSheet();
  },
  insert() {
    pushUndo();
    insertBar(sheetArg + 1, appState.song.bars[sheetArg]);
    appState.cur.bar = sheetArg + 1;
    appState.cur.step = 0;
    commit();
    placeCursor();
    closeSheet();
  },
  delbar(d, el) {
    if (!armed(el)) return;
    pushUndo();
    if (appState.song.bars.length === 1)
      appState.song.tracks.forEach((t) => {
        t.bars[0] = {};
      });
    else {
      appState.song.bars.splice(sheetArg, 1);
      appState.song.tracks.forEach((t) => t.bars.splice(sheetArg, 1));
    }
    appState.cur.bar = clamp(sheetArg, 0, appState.song.bars.length - 1);
    appState.cur.step = 0;
    clampLoop();
    commit();
    closeSheet();
  },
  bartempo() {
    const v = Math.round(+qs('#barT').value),
      i = sheetArg;
    if (!(v >= 30 && v <= 320)) {
      toast('Tempo goes from 30 to 320 bpm');
      return;
    }
    pushUndo();
    if (i === 0) appState.song.tempo = v;
    else if (v === tempoAt(appState.song, i - 1)) delete appState.song.bars[i].t;
    else appState.song.bars[i].t = v;
    commit();
    closeSheet();
  },
  bartempooff() {
    pushUndo();
    delete appState.song.bars[sheetArg].t;
    commit();
    closeSheet();
  },
  capture() {
    recorder.msg = '';
    openSheet('capture');
  },
  recmode(d) {
    if (recorder.phase !== 'idle') return;
    recorder.mode = d.m;
    recorder.msg = '';
    refreshSheet();
  },
  recbars(d) {
    if (recorder.phase !== 'idle') return;
    recorder.bars = +d.n;
    refreshSheet();
  },
  recstart() {
    recStart();
  },
  reccancel() {
    recCancel();
    refreshSheet();
  },
  mixer() {
    openSheet('mixer');
  },
  mute(d) {
    const t = appState.song.tracks[+d.i];
    t.mute = !t.mute;
    saveSoon();
    renderTop();
    refreshSheet();
  },
  solo(d) {
    const t = appState.song.tracks[+d.i];
    t.solo = !t.solo;
    saveSoon();
    refreshSheet();
  },
  addtrack(d) {
    pushUndo();
    const ty = d.t,
      n = appState.song.tracks.filter((t) => t.type === ty).length + 1;
    appState.song.tracks.push(
      newTrack(
        ty,
        { guitar: 'Guitar', bass: 'Bass', drums: 'Drums' }[ty] + (n > 1 ? ' ' + n : ''),
        appState.song.bars.length
      )
    );
    appState.ti = appState.song.tracks.length - 1;
    dirty();
    renderAll();
    refreshSheet();
  },
  deltrack(d, el) {
    if (!armed(el)) return;
    pushUndo();
    appState.song.tracks.splice(+d.i, 1);
    audioState.bus.forEach((b) => {
      try {
        b.vol.disconnect();
      } catch (e) {}
    });
    audioState.bus = [];
    appState.ti = 0;
    dirty();
    renderAll();
    refreshSheet();
  },
  song() {
    openSheet('song');
    refreshDir();
  },
  tempo(d) {
    appState.song.tempo = clamp(appState.song.tempo + +d.d, 30, 320);
    dirty();
    renderTop();
    refreshSheet();
  },
  tap() {
    const now = performance.now();
    taps = taps.filter((t) => now - t < 2500);
    taps.push(now);
    if (taps.length >= 3) {
      const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      appState.song.tempo = clamp(Math.round(60000 / iv), 30, 320);
      dirty();
      renderTop();
      const inp = qs('[data-in="tempo"]');
      if (inp) inp.value = appState.song.tempo;
    }
  },
  speed(d) {
    appState.speed = +d.v;
    refreshSheet();
  },
  open(d) {
    if (d.id !== library.currentId) {
      openSong(d.id);
      saveLocal();
    }
    closeSheet();
  },
  newsong() {
    const s = blankSong('New riff');
    library.songs[s.id] = s;
    openSong(s.id);
    saveLocal();
    closeSheet();
    toast('New song. Tap a string, then a fret.');
  },
  dupsong() {
    const s = normalize(JSON.parse(strip(appState.song)));
    s.id = newId();
    s.bars.forEach((b) => {
      delete b.id;
    });
    s.tracks.forEach((t) => {
      delete t.id;
    });
    s.title += ' copy';
    s.updatedAt = Date.now();
    if (myId) s._owner = myId;
    library.songs[s.id] = s;
    openSong(s.id);
    saveLocal();
    queuePush(s.id);
    if (sheetKind) refreshSheet();
    toast('This copy is yours to edit');
  },
  delsong(d, el) {
    if (!armed(el, 'Tap again')) return;
    const s = library.songs[d.id];
    if (!s) return;
    if (cloudDb && s._synced && s._owner === myId) {
      try {
        refFor(s)
          .delete()
          .catch(() => {});
      } catch (e) {}
    }
    delete library.songs[d.id];
    if (d.id === library.currentId) openSong(latestId());
    saveLocal();
    refreshSheet();
  },
  forget(d) {
    dropShared(d.id);
    refreshSheet();
  },
  async openshared(d) {
    const o = sharedWithMe.find((x) => x.id === d.id) || { id: d.id };
    if (await openShared(o)) closeSheet();
  },
  signin() {
    if (!authClient) {
      toast('Sync is still loading. Try again in a moment.');
      return;
    }
    authClient.signInWithPopup(new firebaseSdk.auth.GoogleAuthProvider()).catch((e) => {
      toast(
        e && e.code === 'auth/unauthorized-domain'
          ? 'This web address isn’t authorised in Firebase yet. See the README.'
          : e && e.code === 'auth/popup-blocked'
            ? 'The sign-in window was blocked. Allow pop-ups for this site and try again.'
            : 'Sign-in didn’t finish. Try again.'
      );
    });
  },
  signout() {
    if (authClient) authClient.signOut();
  },
  addperson(d) {
    const inp = qs('#shareEmail'),
      e = (inp.value || '').trim().toLowerCase(),
      sh = shareOf(appState.song);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
      toast('Type their email address first');
      return;
    }
    if (e === myEmail) {
      toast('That’s you: you already own this song');
      return;
    }
    sh.viewers = sh.viewers.filter((x) => x !== e);
    sh.editors = sh.editors.filter((x) => x !== e);
    sh[d.r].push(e);
    saveShare(appState.song);
    refreshSheet();
    toast(d.r === 'editors' ? 'They can now edit this song' : 'They can now view this song');
  },
  role(d) {
    const sh = shareOf(appState.song),
      e = d.e,
      ed = sh.editors.includes(e);
    sh.viewers = sh.viewers.filter((x) => x !== e);
    sh.editors = sh.editors.filter((x) => x !== e);
    sh[ed ? 'viewers' : 'editors'].push(e);
    saveShare(appState.song);
    refreshSheet();
  },
  unshare(d) {
    const sh = shareOf(appState.song);
    sh.viewers = sh.viewers.filter((x) => x !== d.e);
    sh.editors = sh.editors.filter((x) => x !== d.e);
    saveShare(appState.song);
    refreshSheet();
  },
  anyone(d) {
    shareOf(appState.song).anyone = d.v;
    saveShare(appState.song);
    refreshSheet();
  },
  async copylink() {
    const url = linkFor(appState.song);
    if (!appState.song._synced) await saveShare(appState.song);
    try {
      await navigator.clipboard.writeText(url);
      toast(isShared(appState.song) ? 'Link copied' : 'Link copied. It only opens for people you’ve added.');
    } catch (e) {
      openSheet('text', { title: 'Link to this song', text: url });
    }
  },
  showtab() {
    openSheet('text', { title: 'Text tab', text: asciiTab(appState.song) });
  },
  showjson() {
    openSheet('text', { title: 'Project code', text: strip(appState.song) });
  },
  import() {
    openSheet('text', { title: 'Import project code', edit: true });
  },
  doimport() {
    let s = null;
    try {
      s = normalize(JSON.parse(qs('#txt').value));
    } catch (e) {}
    if (!s) {
      toast('That isn’t Chugpad project code');
      return;
    }
    s.id = newId();
    s.updatedAt = Date.now();
    library.songs[s.id] = s;
    openSong(s.id);
    saveLocal();
    queuePush(s.id);
    closeSheet();
    toast('Imported');
  },
  async copytext() {
    const ta = qs('#txt');
    try {
      await navigator.clipboard.writeText(ta.value);
      toast('Copied');
    } catch (e) {
      ta.focus();
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (_) {}
      toast(ok ? 'Copied' : 'Select the text and copy it by hand');
    }
  },
  async dlgp() {
    const s = appState.song;
    toast('Building the file…');
    let at;
    try {
      at = await loadAlphaTab();
    } catch (e) {
      toast('Couldn’t load the Guitar Pro writer. Check your connection and try again.');
      return;
    }
    try {
      saveFile(fileSlug(s) + '.gp', gpExport(at, s));
      toast('Saved');
    } catch (e) {
      toast('That song couldn’t be turned into a Guitar Pro file');
    }
  },
  dlmid() {
    saveFile(fileSlug(appState.song) + '.mid', buildMidi(appState.song), 'audio/midi');
    toast('Saved');
  }
};
export const EDIT_ACTIONS = new Set([
  'undo',
  'redo',
  'addbar',
  'fret',
  'pm',
  'tech',
  'rest',
  'del',
  'paste',
  'pasteafter',
  'clear',
  'rep',
  'fill',
  'pattern',
  'sig',
  'insert',
  'delbar',
  'addtrack',
  'deltrack',
  'tempo',
  'tap',
  'bartempo',
  'bartempooff',
  'capture',
  'recstart'
]);
export const inputHandlers = {
  title(el) {
    appState.song.title = el.value || 'Untitled';
    dirty();
    renderTop();
  },
  tempo(el) {
    const v = +el.value;
    if (v >= 30 && v <= 320) {
      appState.song.tempo = Math.round(v);
      dirty();
      renderTop();
    }
  },
  tname(el) {
    appState.song.tracks[+el.dataset.i].name = el.value || 'Track';
    dirty();
    renderTop();
  },
  vol(el) {
    const i = +el.dataset.i;
    appState.song.tracks[i].vol = el.value / 100;
    applyMix(i);
    dirty();
  },
  pan(el) {
    const i = +el.dataset.i;
    let v = el.value / 100;
    if (Math.abs(v) < 0.06) v = 0;
    appState.song.tracks[i].pan = v;
    applyMix(i);
    dirty();
  },
  tuning(el) {
    const t = appState.song.tracks[+el.dataset.i];
    if (!(t.type === 'bass' ? BASS_TUNINGS : GUITAR_TUNINGS)[el.value]) return;
    pushUndo();
    t.tun = el.value;
    t.tuning = (t.type === 'bass' ? BASS_TUNINGS : GUITAR_TUNINGS)[el.value].slice();
    dirty();
    renderAll();
  },
  tone(el) {
    appState.song.tracks[+el.dataset.i].tone = el.value;
    dirty();
  },
  ring(el) {
    appState.song.tracks[+el.dataset.i].ring = el.checked;
    dirty();
  }
};
