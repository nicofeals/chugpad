import type { BarSig, Cell, Track } from '../core/types';
import { audioState, ensureAudio, click, playDrum, playNote } from '../audio/engine';
import { stop } from '../audio/playback';
import { qs, drumLane, clamp, stepsOf } from '../core/constants';
import { appState, currentTrack, tempoAt } from '../core/state';
import { placePitch } from '../io/guitarpro';
import { commit, insertBar, pushUndo, putChord } from './editing';
import { placeCursor, toast } from './render';
import { closeSheet, refreshSheet } from './sheets';

/* ================= capture: tap or hum a riff ================= */
export const recorder: any = {
  mode: 'tap',
  bars: 2,
  phase: 'idle',
  events: [],
  frames: [],
  stream: null,
  src: null,
  an: null,
  buf: null,
  timer: 0,
  raf: 0,
  plan: null,
  oscs: [],
  msg: '',
  perf0: 0,
  ctx0: 0,
  lat: 0
};
export function pitchOf(buf, sr) {
  // YIN pitch detector on a half-rate copy of the mic window
  const n = buf.length >> 1,
    x = new Float32Array(n);
  let e = 0;
  for (let i = 0; i < n; i++) {
    x[i] = (buf[2 * i] + buf[2 * i + 1]) * 0.5;
    e += x[i] * x[i];
  }
  const rms = Math.sqrt(e / n);
  if (rms < 0.008) return { f: 0, rms };
  const s = sr / 2,
    lo = Math.max(2, Math.floor(s / 520)),
    hi = Math.min(Math.floor(s / 65), (n >> 1) - 1),
    W = n - hi,
    d = new Float32Array(hi + 2);
  let run = 0,
    best = -1;
  for (let tau = 1; tau <= hi + 1; tau++) {
    let sum = 0;
    for (let i = 0; i < W - 1; i++) {
      const v = x[i] - x[i + tau];
      sum += v * v;
    }
    run += sum;
    d[tau] = (sum * tau) / (run || 1);
  }
  for (let tau = lo; tau < hi; tau++) {
    if (d[tau] < 0.15) {
      while (tau + 1 < hi && d[tau + 1] < d[tau]) tau++;
      best = tau;
      break;
    }
  }
  if (best < 0) return { f: 0, rms };
  const a = d[best - 1],
    b = d[best],
    c = d[best + 1],
    den = a - 2 * b + c,
    sh = den ? (a - c) / (2 * den) : 0;
  return { f: s / (best + clamp(sh, -1, 1)), rms };
}
export function segmentHum(fr) {
  // pitch frames -> notes: a new note on silence, on a pitch change, or when the same pitch is struck again
  const notes = [];
  let cur = null,
    gap = 0,
    pend = [];
  const med = (a) => {
    const s = a.slice().sort((p, q) => p - q);
    return s[s.length >> 1];
  };
  const close = () => {
    if (cur && cur.ms.length >= 3) notes.push({ t: cur.t, m: Math.round(med(cur.ms)) });
    cur = null;
    pend = [];
  };
  for (const x of fr) {
    if (!x.f) {
      if (++gap >= 3) close();
      continue;
    }
    gap = 0;
    const m = 69 + 12 * Math.log2(x.f / 440);
    if (!cur) {
      cur = { t: x.t, ms: [m], peak: x.rms, dip: x.rms };
      continue;
    }
    if (Math.abs(m - med(cur.ms)) > 0.8) {
      pend.push({ t: x.t, m });
      const l = pend.slice(-3);
      if (l.length === 3 && Math.abs(l[0].m - l[2].m) < 1 && Math.abs(l[0].m - l[1].m) < 1) {
        close();
        cur = { t: l[0].t, ms: l.map((p) => p.m), peak: x.rms, dip: x.rms };
      }
      continue;
    }
    pend = [];
    cur.ms.push(m);
    if (x.rms > cur.peak) {
      cur.peak = x.rms;
      cur.dip = x.rms;
    } else if (x.rms < cur.dip) cur.dip = x.rms;
    if (cur.ms.length >= 4 && cur.dip < cur.peak * 0.5 && x.rms > cur.dip * 1.8) {
      close();
      cur = { t: x.t, ms: [m], peak: x.rms, dip: x.rms };
    }
  }
  close();
  return notes;
}
export function recPlan(c) {
  // clock times for the count-in bar and every step of the bars being recorded
  const song = appState.song,
    first = appState.cur.bar,
    steps = [],
    clicks = [];
  let t = c.currentTime + 0.25;
  const sig = (i) => song.bars[Math.min(i, song.bars.length - 1)],
    tp = (i) => tempoAt(song, Math.min(i, song.bars.length - 1));
  const b0 = sig(first),
    dt0 = 60 / tp(first) / b0.g,
    u0 = (b0.g * 4) / b0.d;
  for (let s = 0; s < stepsOf(b0); s++) {
    if (s % u0 === 0) clicks.push({ t, acc: s === 0, pre: true, n: Math.round((stepsOf(b0) - s) / u0) });
    t += dt0;
  }
  const start = t;
  for (let k = 0; k < recorder.bars; k++) {
    const b = sig(first + k),
      dt = 60 / tp(first + k) / b.g,
      u = (b.g * 4) / b.d;
    for (let s = 0; s < stepsOf(b); s++) {
      steps.push({ k, s, t });
      if (s % u === 0) clicks.push({ t, acc: s === 0, pre: false, k });
      t += dt;
    }
  }
  return { first, steps, clicks, start, end: t };
}
export function recCleanup() {
  clearInterval(recorder.timer);
  cancelAnimationFrame(recorder.raf);
  recorder.oscs.forEach((o) => {
    try {
      o.stop();
    } catch (e) {}
  });
  recorder.oscs = [];
  if (recorder.stream) {
    recorder.stream.getTracks().forEach((t) => t.stop());
    recorder.stream = null;
  }
  if (recorder.src) {
    try {
      recorder.src.disconnect();
    } catch (e) {}
    recorder.src = null;
  }
  try {
    if (navigator.audioSession && recorder.mode === 'hum') navigator.audioSession.type = 'playback';
  } catch (e) {}
}
export function recCancel() {
  recCleanup();
  recorder.phase = 'idle';
}
export async function recStart() {
  const c = ensureAudio();
  if (!c) {
    toast('This browser can’t play audio');
    return;
  }
  stop();
  recorder.events = [];
  recorder.frames = [];
  recorder.msg = '';
  if (recorder.mode === 'hum') {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('no mic');
      try {
        if (navigator.audioSession) navigator.audioSession.type = 'play-and-record';
      } catch (e) {}
      recorder.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      recorder.src = c.createMediaStreamSource(recorder.stream);
      recorder.an = c.createAnalyser();
      recorder.an.fftSize = 2048;
      recorder.src.connect(recorder.an);
      recorder.buf = new Float32Array(2048);
      if (c.state !== 'running') await c.resume();
    } catch (e) {
      recCleanup();
      recorder.mode = 'tap';
      recorder.msg =
        'The microphone isn’t available: permission was refused, or this browser blocks it. Tap the rhythm instead, then set the frets.';
      refreshSheet();
      return;
    }
  }
  const p = (recorder.plan = recPlan(c));
  recorder.perf0 = performance.now();
  recorder.ctx0 = c.currentTime;
  recorder.lat = c.outputLatency || c.baseLatency || 0;
  p.clicks.forEach((k) => {
    if (k.pre || recorder.mode === 'tap') recorder.oscs.push(click(k.t, k.acc));
  });
  recorder.phase = 'count';
  refreshSheet();
  if (recorder.mode === 'hum')
    recorder.timer = setInterval(() => {
      if (c.currentTime < p.start - 0.3) return;
      recorder.an.getFloatTimeDomainData(recorder.buf);
      const r = pitchOf(recorder.buf, c.sampleRate);
      recorder.frames.push({ t: c.currentTime, f: r.f, rms: r.rms });
    }, 20);
  recorder.raf = requestAnimationFrame(recTick);
}
export function recTick() {
  if (recorder.phase === 'idle') return;
  const p = recorder.plan,
    now = audioState.ctx.currentTime;
  if (now >= p.end + 0.12) {
    recFinish();
    return;
  }
  if (recorder.phase === 'count' && now >= p.start - 0.02) recorder.phase = 'rec';
  let last = null;
  for (const k of p.clicks) {
    if (k.t <= now + 0.02) last = k;
    else break;
  }
  const box = qs('#recbox'),
    msg = qs('#recmsg');
  if (box && msg) {
    box.className = recorder.phase + (last && now - last.t < 0.1 ? ' flash' : '');
    msg.textContent = !last
      ? 'Get ready'
      : last.pre
        ? String(last.n)
        : `Recording bar ${last.k + 1} of ${recorder.bars}`;
  }
  recorder.raf = requestAnimationFrame(recTick);
}
export function recTap(kind, e) {
  const c = ensureAudio();
  if (!c) return;
  const tr = currentTrack(),
    now = c.currentTime + 0.005;
  if (tr.type === 'drums') playDrum(appState.ti, drumLane(kind ? 'sn' : 'kk'), now, kind ? 3 : 2);
  else {
    const low = tr.tuning.length - 1;
    playNote(appState.ti, tr.tuning[low], now, kind ? 0.4 : 0.2, kind ? { f: 0 } : { f: 0, pm: 1 }, 0);
  }
  if (recorder.phase === 'idle') return;
  let ts = e.timeStamp;
  if (!(Math.abs(ts - performance.now()) < 1000)) ts = performance.now();
  recorder.events.push({ t: recorder.ctx0 + (ts - recorder.perf0) / 1000 - recorder.lat, kind });
}
export function recFinish() {
  const p = recorder.plan,
    mode = recorder.mode,
    tr = currentTrack(),
    drum = tr.type === 'drums';
  recCleanup();
  recorder.phase = 'idle';
  const half = (p.steps[1].t - p.steps[0].t) / 2;
  const nearest = (t) => {
    if (t < p.start - half) return -1;
    let best = -1,
      bd = 1e9;
    for (let i = 0; i < p.steps.length; i++) {
      const d = Math.abs(p.steps[i].t - t);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return Math.abs(p.end - t) < bd ? -1 : best;
  };
  const hits = [];
  if (mode === 'tap')
    recorder.events.forEach((ev) => {
      const i = nearest(ev.t);
      if (i >= 0) hits.push({ i, kind: ev.kind });
    });
  else {
    const notes = segmentHum(recorder.frames);
    if (notes.length) {
      const base = Math.min(...notes.map((n) => n.m));
      notes.forEach((n) => {
        const i = nearest(n.t - 0.06);
        if (i >= 0) hits.push({ i, semi: clamp(n.m - base, 0, 24) });
      });
    }
  }
  if (!hits.length) {
    recorder.msg =
      mode === 'hum'
        ? 'No notes came through. Hum louder, close to the phone, with a “da” on each note.'
        : 'No taps were recorded. Tap the pads in time with the click.';
    refreshSheet();
    return;
  }
  pushUndo();
  const song = appState.song;
  while (song.bars.length < p.first + recorder.bars) insertBar(song.bars.length, song.bars[song.bars.length - 1]);
  for (let k = 0; k < recorder.bars; k++) tr.bars[p.first + k] = {};
  const seen = new Set();
  hits.forEach((h) => {
    const id = h.i + '_' + (drum ? h.kind : 0);
    if (seen.has(id)) return;
    seen.add(id);
    const stp = p.steps[h.i],
      c = tr.bars[p.first + stp.k];
    if (drum) {
      c[stp.s + '_' + drumLane(h.kind ? 'sn' : 'kk')] = { v: h.kind ? 3 : 2 };
      return;
    }
    const low = tr.tuning.length - 1;
    if (mode === 'tap') {
      if (h.kind) putChord(tr, c, stp.s, low, 0, false, appState.chord);
      else c[stp.s + '_' + low] = { f: 0, pm: 1 };
    } else {
      const pos = placePitch(tr.tuning, tr.tuning[low] + h.semi) || { k: low, f: 0 },
        cell: Cell = { f: pos.f };
      if (appState.pm) cell.pm = 1;
      c[stp.s + '_' + pos.k] = cell;
    }
  });
  appState.cur.bar = p.first;
  appState.cur.step = 0;
  closeSheet();
  commit();
  placeCursor();
  toast(`${seen.size} ${seen.size === 1 ? 'note' : 'notes'} captured. Undo if it’s off.`);
}
export const fileSlug = (s) =>
  (
    s.title
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-') || 'song'
  ).slice(0, 40);
