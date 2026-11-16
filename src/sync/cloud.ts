import { demoSong } from '../core/notes';
import { STORAGE_KEY, library, appState, blankSong, normalize } from '../core/state';
import { diffWire, fromWire, slim, toWire } from './wire';
import { recorder } from '../ui/capture';
import { openSong, renderAll, renderPad, renderTop, toast } from '../ui/render';
import { closeSheet, openSheet, refreshSheet, sheetArg, sheetKind } from '../ui/sheets';

// ---- who may do what
export let saveTimer: any = 0,
  firebaseSdk: any = null,
  cloudDb: any = null,
  authClient: any = null,
  myId: string | null = null,
  myEmail = '',
  myName = '',
  lastId: string | null = null,
  unsubscribe: any = null,
  sharedWithMe: any[] = [];
export const uploads: Record<string, any> = {};
try {
  lastId = localStorage.getItem('chugpad.me');
} catch (e) {}
export const FLAGS = ['_synced', '_owner', '_base', '_demo', '_share', '_ownerName'];
export function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 600);
}
export const noShare = () => ({ viewers: [], editors: [], anyone: 'none' });
export const pickShare = (d) => ({
  viewers: Array.isArray(d.viewers) ? d.viewers.slice() : [],
  editors: Array.isArray(d.editors) ? d.editors.slice() : [],
  anyone: d.anyone === 'view' || d.anyone === 'edit' ? d.anyone : 'none'
});
export const shareOf = (s) => s._share || (s._share = noShare());
export const isShared = (s) => {
  const sh = shareOf(s);
  return sh.anyone !== 'none' || sh.viewers.length > 0 || sh.editors.length > 0;
};
export const isMine = (s) => !s._owner || s._owner === (myId || lastId);
export const canEdit = (s = appState.song) => {
  if (!s || isMine(s)) return true;
  const sh = shareOf(s);
  return sh.anyone === 'edit' || (!!myEmail && sh.editors.includes(myEmail));
};
export const refFor = (s) => cloudDb.db.collection('songs').doc(s.id);
export const fullDoc = (s, L) =>
  Object.assign({}, L, pickShare(shareOf(s)), { ownerEmail: myEmail, ownerName: myName });
export function carry(a, b) {
  // keep sync flags and each person's own mute/solo when a song object is replaced
  FLAGS.forEach((k) => {
    if (a[k] !== undefined) b[k] = a[k];
  });
  const m = {};
  a.tracks.forEach((t) => {
    if (t.id) m[t.id] = t;
  });
  b.tracks.forEach((t) => {
    const o = m[t.id];
    if (o) {
      t.mute = o.mute;
      t.solo = o.solo;
    }
  });
}
export const typing = () => /INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '');
export const softSheet = () => {
  if (sheetKind === 'song' && !typing()) refreshSheet();
};
export function adopt(id, n) {
  library.songs[id] = n;
  saveSoon();
  if (id !== library.currentId) return;
  appState.song = n;
  appState.undo = [];
  appState.redo = [];
  if (recorder.phase !== 'idle') return;
  renderAll();
  if (sheetKind === 'bar' && sheetArg >= n.bars.length) closeSheet();
  else if (sheetKind && sheetKind !== 'text' && sheetKind !== 'info' && !typing()) refreshSheet();
}
// fold someone else's saved changes into the open song; my own unsent changes win where both touched the same bar
export function mergeRemote(id, R) {
  const s = library.songs[id];
  if (!s || !R || R.v !== 2) return;
  const sh = pickShare(R),
    was = JSON.stringify(shareOf(s)) + canEdit(s);
  s._share = sh;
  if (R.owner) s._owner = R.owner;
  if (R.ownerName) s._ownerName = R.ownerName;
  if (id === library.currentId && was !== JSON.stringify(sh) + canEdit(s)) {
    renderTop();
    renderPad();
    softSheet();
  }
  if (!s._base) {
    const r = fromWire(R, id);
    if (!r) return;
    if ((r.updatedAt || 0) > (s.updatedAt || 0)) {
      carry(s, r);
      r._synced = true;
      r._base = slim(R);
      adopt(id, r);
    } else {
      s._synced = true;
      s._base = slim(R);
      queuePush(id, 500);
    }
    return;
  }
  const B = s._base,
    L = toWire(s),
    bc = B.cells || {},
    rc = R.cells || {},
    M = { v: 2, owner: R.owner || L.owner, updatedAt: Math.max(L.updatedAt || 0, R.updatedAt || 0), cells: {} };
  let took = false,
    mine = false;
  for (const k of ['title', 'tempo', 'bars', 'tracks']) {
    if (L[k] === B[k]) {
      M[k] = R[k];
      if (R[k] !== L[k]) took = true;
    } else {
      M[k] = L[k];
      if (R[k] !== L[k]) mine = true;
    }
  }
  new Set([...Object.keys(L.cells), ...Object.keys(rc), ...Object.keys(bc)]).forEach((k) => {
    const l = L.cells[k] || '',
      b = bc[k] || '',
      r = rc[k] || '',
      m = l === b ? r : l;
    if (m !== l) took = true;
    if (l !== b && l !== r) mine = true;
    if (m) M.cells[k] = m;
  });
  s._base = slim(R);
  s._synced = true;
  if (took) {
    const n = fromWire(M, id);
    if (n) {
      carry(s, n);
      n._base = slim(R);
      adopt(id, n);
    }
  }
  if (mine) queuePush(id, 400);
}
export function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ currentId: library.currentId, songs: library.songs }));
  } catch (e) {}
}
export function dirty() {
  const s = appState.song;
  if (!canEdit(s)) return;
  s.updatedAt = Date.now();
  delete s._demo;
  saveSoon();
  queuePush(s.id, isShared(s) || !isMine(s) ? 800 : 2000);
}
export function queuePush(id, ms = 1500) {
  if (!cloudDb) return;
  const u = uploads[id] || (uploads[id] = { t: 0, busy: false, again: false });
  clearTimeout(u.t);
  u.t = setTimeout(() => pushSong(id), ms);
}
export async function pushSong(id) {
  const u = uploads[id] || (uploads[id] = { t: 0, busy: false, again: false }),
    s = library.songs[id];
  if (!cloudDb || !s || s._demo || !canEdit(s)) return;
  if (u.busy) {
    u.again = true;
    return;
  }
  u.busy = true;
  try {
    if (!s._owner) s._owner = myId;
    const mine = s._owner === myId,
      L = toWire(s),
      ref = refFor(s),
      B = s._base;
    if (JSON.stringify(L).length > 900000) appState.sync = 'big';
    else if (B || mine) {
      const patch = B ? diffWire(B, L) : null;
      if (!B) await ref.set(fullDoc(s, L));
      else if (patch) {
        try {
          await ref.set(patch, { merge: true });
        } catch (e) {
          if (mine) await ref.set(fullDoc(s, L));
          else throw e;
        }
      }
      if (!B || patch) {
        const cur = library.songs[id];
        if (cur) {
          const first = !cur._synced;
          cur._base = slim(L);
          cur._synced = true;
          saveSoon();
          if (first && id === library.currentId) subscribeCurrent();
        }
        appState.sync = 'cloud';
      }
    }
  } catch (e) {
    appState.sync = 'error';
  }
  u.busy = false;
  if (u.again) {
    u.again = false;
    queuePush(id, 300);
  }
}
export async function saveShare(s) {
  // only the owner's device ever writes the sharing fields
  if (!cloudDb || !isMine(s)) return;
  delete s._demo;
  s._owner = myId;
  saveLocal();
  renderTop();
  try {
    if (!s._synced || !s._base) {
      s.updatedAt = s.updatedAt || Date.now();
      const L = toWire(s);
      await refFor(s).set(fullDoc(s, L));
      s._base = slim(L);
      s._synced = true;
      if (s.id === library.currentId) subscribeCurrent();
    } else
      await refFor(s).set(Object.assign(pickShare(shareOf(s)), { ownerEmail: myEmail, ownerName: myName }), {
        merge: true
      });
    saveLocal();
  } catch (e) {
    toast('Couldn’t save who can use this song. Check your connection and try again.');
  }
}
export function dropShared(id: string, msg?: string) {
  delete library.songs[id];
  if (!Object.keys(library.songs).length) {
    const d = blankSong('New riff');
    library.songs[d.id] = d;
  }
  if (id === library.currentId) {
    closeSheet();
    openSong(latestId());
  }
  saveLocal();
  if (msg) toast(msg);
}
export function subscribeCurrent() {
  if (unsubscribe) {
    try {
      unsubscribe();
    } catch (e) {}
    unsubscribe = null;
  }
  const s = appState.song;
  if (!cloudDb || !s || !s._synced) return;
  const id = s.id;
  unsubscribe = refFor(s).onSnapshot(
    (snap) => {
      if (library.currentId !== id || (snap.metadata && snap.metadata.fromCache && !snap.metadata.hasPendingWrites))
        return;
      const cur = library.songs[id];
      if (!cur) return;
      if (snap.exists) {
        mergeRemote(id, snap.data());
        return;
      }
      if (isMine(cur) || (uploads[id] && uploads[id].busy)) return;
      dropShared(id, 'That song was deleted by its owner');
      refreshDir();
    },
    () => {
      const cur = library.songs[id];
      if (cur && !isMine(cur) && library.currentId === id) {
        dropShared(id, 'That song is no longer shared with you');
        refreshDir();
      }
    }
  );
}
export async function refreshDir() {
  // songs other people shared with my email address
  if (!cloudDb || !myEmail) return;
  const seen = new Set(),
    out = [];
  for (const f of ['editors', 'viewers']) {
    try {
      (await cloudDb.db.collection('songs').where(f, 'array-contains', myEmail).get()).docs.forEach((d) => {
        const w = d.data() || {};
        if (seen.has(d.id) || w.owner === myId) return;
        seen.add(d.id);
        out.push({
          id: d.id,
          owner: w.owner || '',
          name: w.ownerName || w.ownerEmail || '',
          title: w.title || 'Untitled',
          w
        });
        const loc = library.songs[d.id];
        if (loc && d.id !== library.currentId) mergeRemote(d.id, w);
      });
    } catch (e) {}
  }
  sharedWithMe = out;
  softSheet();
}
export async function openShared(o) {
  if (library.songs[o.id]) {
    openSong(o.id);
    return true;
  }
  try {
    let w = o.w;
    if (!w) {
      const snap = await cloudDb.db.collection('songs').doc(o.id).get();
      if (!snap.exists) {
        toast('That song is gone');
        return false;
      }
      w = snap.data();
    }
    const s = fromWire(w, o.id);
    if (!s) {
      toast('That song couldn’t be opened');
      return false;
    }
    s._synced = true;
    s._base = slim(w);
    library.songs[o.id] = s;
    openSong(o.id);
    saveLocal();
    return true;
  } catch (e) {
    toast('You don’t have access to that song with this account');
    return false;
  }
}
export const linkFor = (s) => location.origin + location.pathname + '#song=' + s.id;
export async function openFromLink() {
  const m = /[#&]song=([\w-]+)/.exec(location.hash || '');
  if (!m) return;
  if (!authClient) {
    toast('Shared songs need sync to be set up on this site');
    return;
  }
  if (!myId) {
    openSheet('song');
    toast('Sign in to open the shared song');
    return;
  }
  if (library.currentId === m[1]) return;
  if (await openShared({ id: m[1] })) closeSheet();
}
export async function syncMine() {
  // bring my own songs in line with my account
  const snap = await cloudDb.db.collection('songs').where('owner', '==', myId).get(),
    remote = new Set();
  let touched = false;
  snap.docs.forEach((doc) => {
    remote.add(doc.id);
    const w = doc.data(),
      loc = library.songs[doc.id];
    if (loc) {
      mergeRemote(doc.id, w);
      return;
    }
    const s = fromWire(w, doc.id);
    if (!s) return;
    s._synced = true;
    s._base = slim(w);
    library.songs[doc.id] = s;
  });
  for (const id of Object.keys(library.songs)) {
    const s = library.songs[id];
    if (s._owner !== myId || remote.has(id)) continue;
    if (s._synced) {
      if (Object.keys(library.songs).length > 1) {
        delete library.songs[id];
        if (id === library.currentId) touched = true;
      }
    } else if (!s._demo) queuePush(id, 500);
  }
  const cur = library.songs[library.currentId];
  if (!cur || (cur._demo && remote.size)) {
    if (cur && cur._demo && Object.keys(library.songs).length > 1) delete library.songs[cur.id];
    library.currentId = latestId();
    touched = true;
  }
  saveLocal();
  if (touched && !appState.playing) openSong(library.currentId);
  else {
    renderTop();
    renderPad();
    subscribeCurrent();
  }
}
export async function onUser(u, db) {
  if (unsubscribe) {
    try {
      unsubscribe();
    } catch (e) {}
    unsubscribe = null;
  }
  if (!u) {
    myId = null;
    myEmail = '';
    myName = '';
    cloudDb = null;
    sharedWithMe = [];
    appState.sync = 'signedout';
    renderTop();
    renderPad();
    softSheet();
    if (/[#&]song=/.test(location.hash || '')) {
      if (sheetKind !== 'song') openSheet('song');
      toast('Sign in to open the shared song');
    }
    return;
  }
  myId = lastId = u.uid;
  myEmail = (u.email || '').toLowerCase();
  myName = u.displayName || myEmail;
  cloudDb = { db };
  appState.sync = 'cloud';
  try {
    localStorage.setItem('chugpad.me', myId);
  } catch (e) {}
  Object.values(library.songs).forEach((s) => {
    if (!s._owner) s._owner = myId;
  });
  try {
    await syncMine();
  } catch (e) {
    appState.sync = 'error';
    subscribeCurrent();
  }
  softSheet();
  await refreshDir();
  openFromLink();
}
export async function connect() {
  const cfg = window.FIREBASE_CONFIG;
  if (!cfg || !cfg.apiKey || /^(YOUR|PASTE)/i.test(cfg.apiKey)) {
    appState.sync = 'local';
    if (/[#&]song=/.test(location.hash)) toast('Shared songs need sync to be set up on this site');
    return;
  }
  appState.sync = 'signedout';
  try {
    const fb = (firebaseSdk =
      window.firebase && window.firebase.firestore ? window.firebase : (await import('./firebase')).default); // window.firebase is a test seam
    if (!fb.apps || !fb.apps.length) fb.initializeApp(cfg);
    authClient = fb.auth();
    const db = fb.firestore();
    authClient.onAuthStateChanged((u) => {
      onUser(u, db);
    });
  } catch (e) {
    appState.sync = 'offline';
  }
}
export function loadLocal() {
  try {
    const j = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (j && j.songs) {
      for (const id in j.songs) {
        const s = normalize(j.songs[id]);
        if (s) library.songs[s.id] = s;
      }
      library.currentId = j.currentId;
    }
  } catch (e) {}
  if (!Object.keys(library.songs).length) {
    const d = demoSong();
    library.songs[d.id] = d;
    library.currentId = d.id;
  }
  if (!library.songs[library.currentId]) library.currentId = latestId();
}
export const latestId = () =>
  Object.values(library.songs).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0].id;
export function saveFile(name: string, data: BlobPart, type?: string) {
  const url = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
