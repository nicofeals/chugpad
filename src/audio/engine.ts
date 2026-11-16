import { DRUMS, TONES, clamp } from '../core/constants';
import { appState, currentTrack } from '../core/state';

/* ================= audio =================
   Everything is synthesized, no samples:
   - strings: Karplus-Strong with pick-position excitation, one voice per side when double-tracked
   - guitar amp: pickup -> tight/boost -> 2 clipping stages -> tone stack -> 4x12 cab model
   - bass amp: clean low end blended with a distorted top end (parallel, like a metal bass rig)
   - drums: modelled kick/snare/toms/cymbals with round-robin variants, plus a shared room reverb */
export const audioState: any = {
  ctx: null,
  bus: [],
  ks: new Map(),
  drum: {},
  drumGen: {},
  lastHit: {},
  live: [],
  openHat: null,
  verb: null
};
const WIDTH = 0.85; // stereo spread of double-tracked guitars

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
    audioState.verb = buildVerb(c);
    buildDrums();
  }
  if (audioState.ctx.state !== 'running') audioState.ctx.resume();
  return audioState.ctx;
}

/* ---------- shared room reverb ---------- */
function buildVerb(c) {
  const sr = c.sampleRate,
    len = Math.floor(sr * 1.5),
    pre = Math.floor(sr * 0.01),
    ir = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr,
        a = 0.2 + 0.65 * Math.min(1, t / 1.2); // tail gets darker as it decays
      lp += (1 - a) * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t / 0.3);
    }
    for (let k = 0; k < 14; k++) {
      const i = pre + Math.floor(sr * (0.002 + Math.random() * 0.045));
      if (i < len) d[i] += (Math.random() * 2 - 1) * 0.5 * Math.exp(-k * 0.12);
    }
  }
  const inp = c.createGain(),
    hp = c.createBiquadFilter(),
    cv = c.createConvolver(),
    ret = c.createGain();
  hp.type = 'highpass';
  hp.frequency.value = 280; // keep kick and palm mutes out of the reverb
  cv.buffer = ir;
  ret.gain.value = 0.8;
  inp.connect(hp);
  hp.connect(cv);
  cv.connect(ret);
  ret.connect(audioState.out);
  return inp;
}

/* ---------- amp building blocks ---------- */
const curves = new Map();
function shaperCurve(k, bias = 0) {
  const key = k + '|' + bias;
  let cu = curves.get(key);
  if (cu) return cu;
  const n = 4096,
    off = Math.tanh(k * bias);
  cu = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    cu[i] = Math.tanh(k * (x + bias)) - off;
  }
  const norm = Math.max(Math.abs(cu[0]), Math.abs(cu[n - 1])) || 1;
  for (let i = 0; i < n; i++) cu[i] /= norm;
  curves.set(key, cu);
  return cu;
}
function makeChain(c) {
  const nodes = [];
  const add = (node) => {
    if (nodes.length) nodes[nodes.length - 1].connect(node);
    nodes.push(node);
    return node;
  };
  return {
    filter(type, freq, Q?, gain?) {
      const f = c.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (Q != null) f.Q.value = Q;
      if (gain != null) f.gain.value = gain;
      return add(f);
    },
    shaper(k, bias = 0) {
      const w = c.createWaveShaper();
      w.curve = shaperCurve(k, bias);
      w.oversample = '4x';
      return add(w);
    },
    gain(v) {
      const g = c.createGain();
      g.gain.value = v;
      return add(g);
    },
    get first() {
      return nodes[0];
    },
    get last() {
      return nodes[nodes.length - 1];
    }
  };
}
function guitarAmp(c, tn) {
  const ch = makeChain(c);
  ch.filter('lowpass', 5200, 1.4); // pickup resonance
  ch.filter('highpass', tn.tight, 0.7); // tighten the low end before the gain
  if (tn.boost) ch.filter('peaking', 800, 0.9, tn.boost); // screamer-style mid push
  ch.shaper(tn.drive, 0.12); // stage 1, asymmetric -> even harmonics
  ch.filter('highpass', 30, 0.7); // DC block
  if (tn.hm2) {
    // HM-2 with every knob maxed: huge lows and upper mids
    ch.filter('peaking', 100, 0.9, 12);
    ch.filter('peaking', 1100, 1, 11);
    ch.filter('peaking', 2400, 1.5, 4);
    ch.gain(0.25);
  } else ch.gain(0.6);
  ch.filter('lowpass', 7500, 0.6); // inter-stage fizz control
  ch.shaper(tn.drive2); // stage 2 (power amp)
  // tone stack
  ch.filter('lowshelf', 120, null, tn.bass);
  ch.filter('peaking', 500, 0.7, tn.mid);
  ch.filter('highshelf', 2800, null, tn.treble);
  ch.filter('peaking', 4000, 1, tn.presence);
  // 4x12 closed-back cab with V30-ish speakers, close mic
  ch.filter('highpass', 70, 0.8);
  ch.filter('peaking', 115, 1.3, 3);
  ch.filter('peaking', 1600, 1.4, -2.5);
  ch.filter('peaking', 2600, 1.6, 3.5);
  ch.filter('lowpass', 5200, 0.9);
  ch.filter('lowpass', 6800, 0.6);
  ch.gain(tn.level);
  return ch;
}
function bassAmp(c, tn) {
  const inp = c.createGain(),
    sum = c.createGain();
  // clean low end
  const clean = makeChain(c);
  clean.filter('lowpass', 300, 0.6);
  clean.gain((1 - tn.blend) * 1.2);
  // distorted top end
  const dirty = makeChain(c);
  dirty.filter('highpass', 180, 0.7);
  dirty.filter('peaking', 900, 0.8, 4);
  dirty.shaper(tn.drive, 0.08);
  dirty.filter('highpass', 30, 0.7);
  dirty.filter('lowpass', 3800, 0.7);
  dirty.filter('peaking', 1500, 1, 3); // clank
  dirty.gain(tn.blend * 0.8);
  inp.connect(clean.first);
  inp.connect(dirty.first);
  clean.last.connect(sum);
  dirty.last.connect(sum);
  const out = makeChain(c);
  out.filter('lowshelf', 80, null, 3);
  out.filter('highpass', 32, 0.7);
  out.gain(tn.level);
  sum.connect(out.first);
  return { first: inp, last: out.last };
}

/* ---------- per-track bus ---------- */
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
  const c = audioState.ctx,
    tn = tr.type === 'drums' ? null : TONES[tr.tone] || (tr.type === 'bass' ? TONES.bass : TONES.highgain);
  b = { sig, inputs: [], sum: c.createGain(), vol: c.createGain() };
  if (!tn) {
    b.inputs.push(c.createGain());
    b.inputs[0].connect(b.sum);
  } else {
    const sides = tn.amp === 'guitar' && tn.dbl ? [-WIDTH, WIDTH] : [0];
    for (const p of sides) {
      const inp = c.createGain(),
        amp = tn.amp === 'bass' ? bassAmp(c, tn) : guitarAmp(c, tn);
      inp.gain.value = 0.3;
      inp.connect(amp.first);
      if (p && c.createStereoPanner) {
        const sp = c.createStereoPanner();
        sp.pan.value = p;
        amp.last.connect(sp);
        sp.connect(b.sum);
      } else amp.last.connect(b.sum);
      b.inputs.push(inp);
    }
  }
  b.input = b.inputs[0];
  if (c.createStereoPanner) {
    b.pan = c.createStereoPanner();
    b.sum.connect(b.pan);
    b.pan.connect(b.vol);
  } else b.sum.connect(b.vol);
  b.vol.connect(audioState.out);
  const send = tn ? tn.verb : 0.12;
  if (send && audioState.verb) {
    b.send = c.createGain();
    b.send.gain.value = send;
    b.vol.connect(b.send);
    b.send.connect(audioState.verb);
  }
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

/* ---------- strings ---------- */
export function stringBuffer(ti, midi, kind, side = 0, bass = false) {
  // plucked-string buffer (Karplus-Strong), cached per pitch / articulation / variant
  const key = (bass ? 'b' : 'g') + ((ti % 2) * 2 + side) + '|' + midi + '|' + kind;
  let e = audioState.ks.get(key);
  if (e) return e;
  if (audioState.ks.size > 200) audioState.ks.clear();
  const c = audioState.ctx,
    sr = c.sampleRate,
    f = 440 * Math.pow(2, (midi - 69) / 12);
  const P = bass
    ? {
        n: { dur: 2.6, tau: midi < 40 ? 4 : 3, bright: 0.75 },
        p: { dur: 0.5, tau: 0.16, bright: 0.35 },
        x: { dur: 0.07, tau: 0.012, bright: 0.3 }
      }[kind]
    : {
        n: { dur: 2.6, tau: midi < 50 ? 3 : 2.2, bright: 0.6 },
        p: { dur: 0.45, tau: 0.1, bright: 0.3 },
        x: { dur: 0.07, tau: 0.012, bright: 0.3 }
      }[kind];
  const s = bass ? 0.5 : 0.45, // loop filter weight: < 0.5 keeps highs ringing longer
    N = Math.max(2, Math.round(sr / f - s)),
    len = Math.floor(sr * P.dur),
    buf = c.createBuffer(1, len, sr),
    out = buf.getChannelData(0),
    ex = new Float32Array(N),
    ring = new Float32Array(N);
  let lp = 0,
    mean = 0;
  for (let i = 0; i < N; i++) {
    lp += P.bright * (Math.random() * 2 - 1 - lp);
    ex[i] = lp;
  }
  // pick position comb: picking near the bridge removes some low harmonics -> brighter, more "pick" in the attack
  const pick = (bass ? 0.18 : 0.12) + side * 0.03,
    D = Math.max(1, Math.round(N * pick));
  for (let i = 0; i < N; i++) {
    ring[i] = ex[i] - 0.85 * ex[(i + D) % N];
    mean += ring[i];
  }
  mean /= N;
  for (let i = 0; i < N; i++) ring[i] -= mean;
  const loss = Math.exp(-(N + s) / (sr * P.tau));
  let idx = 0,
    peak = 0;
  for (let i = 0; i < len; i++) {
    const nx = idx + 1 === N ? 0 : idx + 1,
      y = ring[idx];
    out[i] = y;
    const a = y < 0 ? -y : y;
    if (a > peak) peak = a;
    ring[idx] = loss * ((1 - s) * y + s * ring[nx]);
    idx = nx;
  }
  const k = 0.9 / (peak || 1),
    fade = Math.min(400, len);
  for (let i = 0; i < len; i++) out[i] *= k * (i > len - fade ? (len - i) / fade : 1);
  e = { buf, rate: (f * (N + s)) / sr };
  audioState.ks.set(key, e);
  return e;
}
export function playNote(ti, midi, t, dur, cell, next) {
  const c = audioState.ctx,
    tr = appState.song.tracks[ti],
    bass = tr.type === 'bass',
    kind = cell.t === 'x' ? 'x' : cell.pm ? 'p' : 'n';
  const m = clamp(midi + (cell.t === 'ph' ? 24 : 0), 16, 100),
    bus = busFor(ti),
    peak = cell.t === 'h' ? 0.7 : 1;
  if (kind === 'x') dur = Math.min(dur, 0.07);
  const end0 = Math.max(t + 0.03, t + dur);
  bus.inputs.forEach((inp, side) => {
    // the second take of a double-tracked part is a few ms late and a few cents off, like a real player
    const e = stringBuffer(ti, m, kind, side, bass),
      off = side ? 0.003 + Math.random() * 0.009 : 0,
      ts = t + off,
      end = end0 + off,
      rate = e.rate * (side ? Math.pow(2, (Math.random() * 6 - 3) / 1200) : 1);
    const src = c.createBufferSource(),
      g = c.createGain();
    src.buffer = e.buf;
    src.playbackRate.value = rate;
    g.gain.setValueAtTime(0, ts);
    g.gain.linearRampToValueAtTime(peak, ts + 0.003);
    g.gain.setValueAtTime(peak, Math.max(ts + 0.004, end - 0.012));
    g.gain.linearRampToValueAtTime(0, end);
    if (cell.t === 'b') {
      src.playbackRate.setValueAtTime(rate, ts + 0.02);
      src.playbackRate.linearRampToValueAtTime(rate * Math.pow(2, 2 / 12), ts + 0.02 + Math.min(dur * 0.6, 0.22));
    }
    if (cell.t === 's' && next) {
      src.playbackRate.setValueAtTime(rate, ts + dur * 0.5);
      src.playbackRate.linearRampToValueAtTime(rate * Math.pow(2, next / 12), end);
    }
    if (cell.t === 'v' || cell.t === 'ph') {
      const lfo = c.createOscillator(),
        lg = c.createGain();
      lfo.frequency.value = 5.6 + side * 0.3;
      lg.gain.setValueAtTime(0, ts);
      lg.gain.linearRampToValueAtTime(rate * 0.014, ts + 0.16);
      lfo.connect(lg);
      lg.connect(src.playbackRate);
      lfo.start(ts);
      lfo.stop(end + 0.05);
    }
    let head: any = src;
    if (kind === 'p') {
      // palm mute: the hand kills the upper harmonics before they hit the amp -> chug
      const pm = c.createBiquadFilter();
      pm.type = 'lowpass';
      pm.frequency.value = bass ? 700 : 1100;
      pm.Q.value = 0.6;
      src.connect(pm);
      head = pm;
    }
    head.connect(g);
    g.connect(inp);
    src.start(ts, cell.t === 'h' ? 0.012 : 0);
    src.stop(end + 0.03);
    audioState.live.push({ src, end: end + 0.03 });
  });
}

/* ---------- drums ---------- */
function drumVariants(id) {
  let v = audioState.drum[id];
  if (!v && audioState.drumGen[id]) v = audioState.drum[id] = audioState.drumGen[id]();
  return v;
}
export function buildDrums() {
  const c = audioState.ctx,
    sr = c.sampleRate,
    TAU = Math.PI * 2;
  const rnd = () => Math.random() * 2 - 1;
  const peakNorm = (d, to = 1) => {
    let p = 0;
    for (let i = 0; i < d.length; i++) {
      const a = Math.abs(d[i]);
      if (a > p) p = a;
    }
    const k = to / (p || 1);
    for (let i = 0; i < d.length; i++) d[i] *= k;
    return d;
  };
  const mk = (sec, fn) => {
    const len = Math.floor(sr * sec),
      b = c.createBuffer(1, len, sr),
      d = b.getChannelData(0);
    fn(d, len);
    peakNorm(d, 0.95);
    const f = Math.min(300, len);
    for (let i = len - f; i < len; i++) d[i] *= (len - i) / f;
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
  // decaying sine via a recursive rotation (much cheaper than Math.sin per sample)
  const partial = (d, n, f, amp, dec, phase = Math.random() * TAU) => {
    if (f >= sr * 0.45) return;
    const w = (TAU * f) / sr,
      cw = Math.cos(w),
      sw = Math.sin(w),
      r = Math.exp(-1 / (dec * sr)),
      lim = Math.min(n, Math.ceil(dec * sr * Math.log(Math.abs(amp) * 1e5 + 1)));
    let x = Math.cos(phase) * amp,
      y = Math.sin(phase) * amp;
    for (let i = 0; i < lim; i++) {
      d[i] += y;
      const nx = (x * cw - y * sw) * r;
      y = (x * sw + y * cw) * r;
      x = nx;
    }
  };
  // cymbal: many inharmonic modes + filtered noise wash
  const cymbal = (d, n, o) => {
    const tone = new Float32Array(n),
      nz = new Float32Array(n);
    for (let k = 0; k < o.count; k++) {
      const f = o.lo * Math.pow(o.hi / o.lo, Math.random()),
        dk = o.dec * (0.5 + Math.random()) * Math.pow(o.lo / f, 0.2);
      partial(tone, n, f, 0.5 + Math.random() * 0.5, dk);
    }
    peakNorm(tone);
    for (let i = 0; i < n; i++) nz[i] = rnd() * Math.exp(-i / sr / (o.dec * 0.5));
    hp(nz, o.nhp);
    hp(nz, o.nhp);
    peakNorm(nz);
    for (let i = 0; i < n; i++) {
      const t = i / sr,
        env = o.bloom ? 1 - 0.6 * Math.exp(-t / o.bloom) : 1,
        v = (tone[i] * (1 - o.noise) + nz[i] * o.noise) * env + rnd() * Math.exp(-t / 0.0015) * 0.4;
      d[i] = o.trash ? Math.tanh(v * o.trash) : v;
    }
    hp(d, o.lo * 0.8);
  };
  // metal kick: tight low thump + clicky beater (trigger-style)
  const kick = () =>
    mk(0.5, (d, n) => {
      const f0 = 50 + Math.random() * 2,
        cl = new Float32Array(n),
        cn = Math.min(n, Math.floor(sr * 0.03));
      for (let i = 0; i < cn; i++) cl[i] = rnd() * Math.exp(-i / sr / 0.0025);
      hp(cl, 3000);
      hp(cl, 1500);
      peakNorm(cl);
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += (TAU * (f0 + 140 * Math.exp(-t / 0.009) + 35 * Math.exp(-t / 0.05))) / sr;
        const body = Math.sin(ph) * (1 - Math.exp(-t / 0.0005)) * Math.exp(-t / 0.2);
        d[i] = Math.tanh(1.8 * (body + cl[i] * 0.75));
      }
    });
  const snare = () =>
    mk(0.45, (d, n) => {
      const nz = new Float32Array(n),
        ck = new Float32Array(n),
        f0 = 185 + Math.random() * 6;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        nz[i] = rnd() * (Math.exp(-t / 0.17) * 0.6 + Math.exp(-t / 0.035) * 0.7); // wires
        ck[i] = rnd() * Math.exp(-t / 0.0025); // stick crack
      }
      hp(nz, 1400);
      lpf(nz, 11000);
      peakNorm(nz);
      hp(ck, 600);
      peakNorm(ck);
      let p1 = 0,
        p2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr,
          sw = 1 + 0.3 * Math.exp(-t / 0.006);
        p1 += (TAU * f0 * sw) / sr;
        p2 += (TAU * f0 * 1.78 * sw) / sr;
        const body = Math.sin(p1) * Math.exp(-t / 0.11) + 0.45 * Math.sin(p2) * Math.exp(-t / 0.05);
        d[i] = Math.tanh(1.5 * (body * 0.75 + nz[i] * 0.8 + ck[i] * 0.45));
      }
    });
  const tom = (f0, dec) => () =>
    mk(dec * 4.5, (d, n) => {
      const ff = f0 * (1 + rnd() * 0.01),
        st = new Float32Array(n);
      for (let i = 0; i < n; i++) st[i] = rnd() * Math.exp(-i / sr / 0.003);
      hp(st, 800);
      peakNorm(st);
      let p1 = 0,
        p2 = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr,
          sw = 1 + 0.32 * Math.exp(-t / 0.06);
        p1 += (TAU * ff * sw) / sr;
        p2 += (TAU * ff * 1.5 * sw) / sr;
        d[i] = Math.tanh(
          1.6 *
            (Math.sin(p1) * Math.exp(-t / dec) * (1 - Math.exp(-t / 0.0008)) +
              0.3 * Math.sin(p2) * Math.exp(-t / (dec * 0.45)) +
              st[i] * 0.35)
        );
      }
    });
  const ride = () =>
    mk(1.8, (d, n) => {
      cymbal(d, n, { lo: 450, hi: 9500, count: 70, dec: 1.4, noise: 0.18, nhp: 4000 });
      peakNorm(d);
      const ping = new Float32Array(n);
      partial(ping, n, 3150, 0.5, 0.35);
      partial(ping, n, 4720, 0.35, 0.22);
      partial(ping, n, 6900, 0.2, 0.12);
      for (let i = 0; i < n; i++) d[i] = d[i] * 0.55 + ping[i] + rnd() * Math.exp(-i / sr / 0.0012) * 0.3;
    });
  // each generator returns several takes; playDrum rotates through them
  const takes = (count, one) => () => Array.from({ length: count }, () => one());
  audioState.drumGen = {
    kk: takes(4, kick),
    sn: takes(4, snare),
    hh: takes(4, () =>
      mk(0.15, (d, n) => cymbal(d, n, { lo: 3200, hi: 15000, count: 45, dec: 0.04, noise: 0.55, nhp: 6500 }))
    ),
    ho: takes(2, () =>
      mk(0.8, (d, n) => cymbal(d, n, { lo: 3000, hi: 15000, count: 60, dec: 0.32, noise: 0.5, nhp: 5500 }))
    ),
    t1: takes(3, tom(165, 0.17)),
    t2: takes(3, tom(122, 0.21)),
    ft: takes(3, tom(84, 0.28)),
    rd: takes(3, ride),
    cr: takes(2, () =>
      mk(2.2, (d, n) =>
        cymbal(d, n, { lo: 350, hi: 13000, count: 110, dec: 1.1, noise: 0.45, nhp: 3500, bloom: 0.015 })
      )
    ),
    ch: takes(2, () =>
      mk(1.6, (d, n) =>
        cymbal(d, n, { lo: 300, hi: 9000, count: 110, dec: 0.7, noise: 0.5, nhp: 2500, bloom: 0.008, trash: 2.5 })
      )
    )
  };
  audioState.drum = {};
  // render in the background, one kit piece at a time, so the first tap stays responsive.
  // a piece hit before it is ready gets rendered on the spot by drumVariants().
  const ids = Object.keys(audioState.drumGen);
  let k = 0;
  const step = () => {
    if (k >= ids.length) return;
    drumVariants(ids[k++]);
    setTimeout(step, 20);
  };
  setTimeout(step, 30);
}
export function playDrum(ti, lane, t, v) {
  const c = audioState.ctx,
    d = DRUMS[lane],
    takes = drumVariants(d.id);
  if (!takes || !takes.length) return;
  let k = Math.floor(Math.random() * takes.length);
  if (takes.length > 1 && k === audioState.lastHit[d.id]) k = (k + 1) % takes.length;
  audioState.lastHit[d.id] = k;
  const buf = takes[k],
    src = c.createBufferSource(),
    g = c.createGain();
  src.buffer = buf;
  src.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.006 - (v === 1 ? 0.01 : 0);
  g.gain.value = [0, 0.3, 0.78, 1][v] * d.lv * (0.96 + Math.random() * 0.06);
  if ((d.id === 'hh' || d.id === 'ho') && audioState.openHat) {
    try {
      audioState.openHat.gain.cancelScheduledValues(t);
      audioState.openHat.gain.setTargetAtTime(0, t, 0.008);
    } catch (e) {}
    audioState.openHat = null;
  }
  if (d.id === 'ho') audioState.openHat = g;
  let head: any = src;
  if (v === 1) {
    // ghost notes are played softer, so they are darker too
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4000;
    src.connect(lp);
    head = lp;
  }
  head.connect(g);
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
