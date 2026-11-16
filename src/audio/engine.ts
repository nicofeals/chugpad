import { DRUMS, TONES, clamp } from '../core/constants';
import { appState, currentTrack } from '../core/state';

/* ================= audio ================= */
export const audioState: any = { ctx: null, bus: [], ks: new Map(), drum: {}, live: [], openHat: null };
export function ensureAudio() {
  if (!audioState.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {}
    const c = (audioState.ctx = new AC({ latencyHint: 'interactive' }));
    audioState.out = c.createGain();
    audioState.out.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 6;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    audioState.out.connect(comp);
    comp.connect(c.destination);
    buildDrums();
  }
  if (audioState.ctx.state !== 'running') audioState.ctx.resume();
  return audioState.ctx;
}
export function busFor(ti) {
  const tr = appState.song.tracks[ti],
    sig = tr.type + '|' + (tr.tone || '');
  let b = audioState.bus[ti];
  if (b && b.sig === sig) return b;
  if (b) {
    try {
      b.vol.disconnect();
    } catch (e) {}
  }
  const c = audioState.ctx;
  b = { sig, input: c.createGain(), vol: c.createGain() };
  let node = b.input;
  if (tr.type !== 'drums') {
    const tn = TONES[tr.tone] || TONES.highgain;
    b.input.gain.value = 0.3;
    const hp = c.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = tn.hp;
    const ws = c.createWaveShaper(),
      n = 2048,
      cu = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      cu[i] = Math.tanh(tn.drive * x);
    }
    ws.curve = cu;
    ws.oversample = '4x';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = tn.lp;
    lp.Q.value = 0.8;
    const lp2 = c.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = tn.lp * 1.25;
    lp2.Q.value = 0.5;
    const lv = c.createGain();
    lv.gain.value = tn.level;
    node.connect(hp);
    hp.connect(ws);
    ws.connect(lp);
    lp.connect(lp2);
    lp2.connect(lv);
    node = lv;
  }
  if (c.createStereoPanner) {
    b.pan = c.createStereoPanner();
    node.connect(b.pan);
    b.pan.connect(b.vol);
  } else node.connect(b.vol);
  b.vol.connect(audioState.out);
  audioState.bus[ti] = b;
  applyMix(ti);
  return b;
}
export function applyMix(ti) {
  const b = audioState.bus[ti],
    tr = appState.song.tracks[ti];
  if (!b || !tr) return;
  b.vol.gain.value = tr.vol;
  if (b.pan) b.pan.pan.value = tr.pan;
}
export function stringBuffer(ti, midi, kind) {
  // plucked-string buffer (Karplus-Strong), cached per pitch
  const key = (ti % 2) + '|' + midi + '|' + kind;
  let e = audioState.ks.get(key);
  if (e) return e;
  if (audioState.ks.size > 180) audioState.ks.clear();
  const c = audioState.ctx,
    sr = c.sampleRate,
    f = 440 * Math.pow(2, (midi - 69) / 12),
    N = Math.max(2, Math.round(sr / f - 0.5));
  const dur = kind === 'n' ? 2.6 : kind === 'p' ? 0.45 : 0.07,
    tau = kind === 'n' ? (midi < 50 ? 3 : 2.2) : kind === 'p' ? 0.09 : 0.012,
    bright = kind === 'n' ? 0.55 : kind === 'p' ? 0.26 : 0.3;
  const len = Math.floor(sr * dur),
    buf = c.createBuffer(1, len, sr),
    out = buf.getChannelData(0),
    ring = new Float32Array(N);
  let lp = 0,
    mean = 0;
  for (let i = 0; i < N; i++) {
    lp += bright * (Math.random() * 2 - 1 - lp);
    ring[i] = lp;
    mean += lp;
  }
  mean /= N;
  for (let i = 0; i < N; i++) ring[i] -= mean;
  const loss = Math.exp(-(N + 0.5) / (sr * tau));
  let idx = 0,
    peak = 0;
  for (let i = 0; i < len; i++) {
    const nx = idx + 1 === N ? 0 : idx + 1,
      y = ring[idx];
    out[i] = y;
    const a = y < 0 ? -y : y;
    if (a > peak) peak = a;
    ring[idx] = loss * 0.5 * (y + ring[nx]);
    idx = nx;
  }
  const k = 0.9 / (peak || 1),
    fade = Math.min(400, len);
  for (let i = 0; i < len; i++) out[i] *= k * (i > len - fade ? (len - i) / fade : 1);
  e = { buf, rate: (f * (N + 0.5)) / sr };
  audioState.ks.set(key, e);
  return e;
}
export function playNote(ti, midi, t, dur, cell, next) {
  const c = audioState.ctx,
    tr = appState.song.tracks[ti],
    kind = cell.t === 'x' ? 'x' : cell.pm ? 'p' : 'n';
  const m = clamp(midi + (cell.t === 'ph' ? 24 : 0), 16, 100),
    e = stringBuffer(ti, m, kind),
    bus = busFor(ti);
  const src = c.createBufferSource();
  src.buffer = e.buf;
  src.playbackRate.value = e.rate;
  const g = c.createGain(),
    peak = cell.t === 'h' ? 0.7 : 1;
  if (kind === 'x') dur = Math.min(dur, 0.07);
  const end = Math.max(t + 0.03, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.003);
  g.gain.setValueAtTime(peak, Math.max(t + 0.004, end - 0.012));
  g.gain.linearRampToValueAtTime(0, end);
  if (cell.t === 'b') {
    src.playbackRate.setValueAtTime(e.rate, t + 0.02);
    src.playbackRate.linearRampToValueAtTime(e.rate * Math.pow(2, 2 / 12), t + 0.02 + Math.min(dur * 0.6, 0.22));
  }
  if (cell.t === 's' && next) {
    src.playbackRate.setValueAtTime(e.rate, t + dur * 0.5);
    src.playbackRate.linearRampToValueAtTime(e.rate * Math.pow(2, next / 12), end);
  }
  if (cell.t === 'v' || cell.t === 'ph') {
    const lfo = c.createOscillator(),
      lg = c.createGain();
    lfo.frequency.value = 5.6;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(e.rate * 0.014, t + 0.16);
    lfo.connect(lg);
    lg.connect(src.playbackRate);
    lfo.start(t);
    lfo.stop(end + 0.05);
  }
  src.connect(g);
  g.connect(bus.input);
  src.start(t, cell.t === 'h' ? 0.012 : 0);
  src.stop(end + 0.03);
  audioState.live.push({ src, end: end + 0.03 });
}
export function buildDrums() {
  const c = audioState.ctx,
    sr = c.sampleRate,
    TAU = Math.PI * 2;
  const mk = (sec, fn) => {
    const len = Math.floor(sr * sec),
      b = c.createBuffer(1, len, sr),
      d = b.getChannelData(0);
    fn(d, len);
    let p = 0;
    for (let i = 0; i < len; i++) {
      const a = Math.abs(d[i]);
      if (a > p) p = a;
    }
    const k = 0.95 / (p || 1),
      f = Math.min(300, len);
    for (let i = 0; i < len; i++) d[i] *= k * (i > len - f ? (len - i) / f : 1);
    return b;
  };
  const hp = (d, fc) => {
    const a = Math.exp((-TAU * fc) / sr);
    let l = 0;
    for (let i = 0; i < d.length; i++) {
      l = (1 - a) * d[i] + a * l;
      d[i] -= l;
    }
  };
  const lpf = (d, fc) => {
    const a = Math.exp((-TAU * fc) / sr);
    let l = 0;
    for (let i = 0; i < d.length; i++) {
      l = (1 - a) * d[i] + a * l;
      d[i] = l;
    }
  };
  const rnd = () => Math.random() * 2 - 1;
  audioState.drum.kk = mk(0.34, (d, n) => {
    let ph = 0;
    const cl = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      ph += (TAU * (46 + 120 * Math.exp(-t / 0.016))) / sr;
      d[i] = Math.sin(ph) * Math.exp(-t / 0.1);
      cl[i] = (rnd() * 0.5 + Math.sin(TAU * 3300 * t) * 0.5) * Math.exp(-t / 0.0035);
    }
    hp(cl, 1800);
    for (let i = 0; i < n; i++) d[i] += cl[i] * 0.55;
  });
  audioState.drum.sn = mk(0.3, (d, n) => {
    const nz = new Float32Array(n);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      nz[i] = rnd() * Math.exp(-t / 0.085);
      ph += (TAU * (182 + 70 * Math.exp(-t / 0.012))) / sr;
      d[i] = Math.sin(ph) * Math.exp(-t / 0.06) * 0.6;
    }
    hp(nz, 1100);
    lpf(nz, 9000);
    for (let i = 0; i < n; i++) d[i] += nz[i] * 0.9;
  });
  const metal = (d, n, base, noise, dec, hpc, drive?) => {
    const R = [1, 1.342, 1.2312, 1.6532, 1.9523, 2.1523, 2.84];
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = 0;
      for (let k = 0; k < R.length; k++) v += Math.sin(TAU * base * R[k] * t) > 0 ? 1 : -1;
      v = (v / R.length) * (1 - noise) + rnd() * noise;
      d[i] = v;
    }
    hp(d, hpc);
    hp(d, hpc);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let v = d[i] * (Math.exp(-t / dec) * 0.8 + Math.exp(-t / (dec * 0.15)) * 0.5);
      d[i] = drive ? Math.tanh(v * drive) : v;
    }
  };
  audioState.drum.hh = mk(0.09, (d, n) => metal(d, n, 540, 0.45, 0.02, 7000));
  audioState.drum.ho = mk(0.55, (d, n) => metal(d, n, 540, 0.45, 0.17, 6500));
  audioState.drum.cr = mk(1.7, (d, n) => metal(d, n, 410, 0.7, 0.5, 4200));
  audioState.drum.ch = mk(1.1, (d, n) => metal(d, n, 330, 0.6, 0.3, 2600, 3));
  audioState.drum.rd = mk(1.3, (d, n) => {
    metal(d, n, 620, 0.25, 0.55, 5200);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      d[i] = d[i] * 0.7 + Math.sin(TAU * 4750 * t) * Math.exp(-t / 0.09) * 0.12;
    }
  });
  const tom = (f0, dec) =>
    mk(dec * 3.2, (d, n) => {
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += (TAU * f0 * (1 + 0.55 * Math.exp(-t / 0.035))) / sr;
        d[i] = Math.sin(ph) * Math.exp(-t / dec) + rnd() * Math.exp(-t / 0.004) * 0.35;
      }
    });
  audioState.drum.t1 = tom(168, 0.13);
  audioState.drum.t2 = tom(126, 0.16);
  audioState.drum.ft = tom(86, 0.22);
}
export function playDrum(ti, lane, t, v) {
  const c = audioState.ctx,
    d = DRUMS[lane],
    buf = audioState.drum[d.id];
  if (!buf) return;
  const src = c.createBufferSource(),
    g = c.createGain();
  src.buffer = buf;
  g.gain.value = [0, 0.3, 0.78, 1][v] * d.lv;
  if ((d.id === 'hh' || d.id === 'ho') && audioState.openHat) {
    try {
      audioState.openHat.gain.cancelScheduledValues(t);
      audioState.openHat.gain.setTargetAtTime(0, t, 0.008);
    } catch (e) {}
    audioState.openHat = null;
  }
  if (d.id === 'ho') audioState.openHat = g;
  src.connect(g);
  g.connect(busFor(ti).input);
  src.start(t);
  audioState.live.push({ src, end: t + buf.duration });
}
export function click(t, accent) {
  const c = audioState.ctx,
    o = c.createOscillator(),
    g = c.createGain();
  o.frequency.value = accent ? 1900 : 1300;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, t + 0.001);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  o.connect(g);
  g.connect(audioState.out);
  o.start(t);
  o.stop(t + 0.05);
  return o;
}
export function preview(cell, str) {
  if (appState.playing || !ensureAudio()) return;
  const tr = currentTrack();
  playNote(appState.ti, tr.tuning[str] + cell.f, audioState.ctx.currentTime + 0.01, cell.pm ? 0.22 : 0.55, cell, null);
}
