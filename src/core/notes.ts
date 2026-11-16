import type { Cell } from './types';
import { audioState } from '../audio/engine';
import { drumLane, clone, stepsOf } from './constants';
import { blankSong } from './state';

/* ================= note logic ================= */
export function hasNotes(tr, c, st) {
  for (let k = 0; k < tr.tuning.length; k++) if (c[st + '_' + k]) return true;
  return false;
}
// how long a note lasts, in quarter notes: until the next note (or rest) cuts it
export function noteLen(song, tr, bi, st, str, maxQ) {
  let q = 0,
    b = bi,
    s = st;
  for (;;) {
    const bar = song.bars[b];
    q += 1 / bar.g;
    s++;
    if (s >= stepsOf(bar)) {
      s = 0;
      b++;
      if (b >= song.bars.length) return { q, next: null };
    }
    const c = tr.bars[b];
    if (c[s + '_R']) return { q, next: null };
    const same = c[s + '_' + str];
    if (same) return { q, next: same };
    if (!tr.ring && hasNotes(tr, c, s)) return { q, next: null };
    if (q >= maxQ) return { q, next: null };
  }
}
export function fretFor(tr, pitch) {
  // lowest string that can play this pitch
  for (let k = tr.tuning.length - 1; k >= 0; k--) {
    const f = pitch - tr.tuning[k];
    if (f >= 0 && f <= 24) return { k, f };
  }
  return null;
}
export function fillFrom(song, dstTi, srcTi, bi) {
  const dst = song.tracks[dstTi],
    src = song.tracks[srcTi];
  if (src.type === 'drums') return false;
  const sc = src.bars[bi],
    st = stepsOf(song.bars[bi]);
  if (dst.type === 'drums') {
    const kk = drumLane('kk'),
      c = dst.bars[bi];
    for (const key in c) if (key.endsWith('_' + kk)) delete c[key];
    for (let s = 0; s < st; s++) if (hasNotes(src, sc, s)) c[s + '_' + kk] = { v: 2 };
    return true;
  }
  const out = {};
  const same = dst.type === src.type && dst.tuning.join() === src.tuning.join();
  for (let s = 0; s < st; s++) {
    if (sc[s + '_R']) {
      out[s + '_R'] = { r: 1 };
      continue;
    }
    if (same) {
      for (let k = 0; k < src.tuning.length; k++) if (sc[s + '_' + k]) out[s + '_' + k] = clone(sc[s + '_' + k]);
      continue;
    }
    if (dst.type === src.type) {
      // same instrument, other tuning: keep the pitch on the same string where possible
      for (let k = 0; k < src.tuning.length; k++) {
        const n = sc[s + '_' + k];
        if (!n || k >= dst.tuning.length) continue;
        const f = src.tuning[k] + n.f - dst.tuning[k];
        if (f >= 0 && f <= 24) out[s + '_' + k] = Object.assign(clone(n), { f });
      }
      continue;
    }
    let low = null,
      cell = null;
    for (let k = 0; k < src.tuning.length; k++) {
      const n = sc[s + '_' + k];
      if (n) {
        const p = src.tuning[k] + n.f;
        if (low === null || p < low) {
          low = p;
          cell = n;
        }
      }
    }
    if (low === null) continue;
    let p = low + (dst.type === 'bass' ? -12 : 12),
      pos = fretFor(dst, p);
    if (!pos) pos = fretFor(dst, p + 12) || fretFor(dst, p - 12);
    if (pos) {
      const n: Cell = { f: pos.f };
      if (cell.pm) n.pm = 1;
      if (cell.t === 'x') n.t = 'x';
      out[s + '_' + pos.k] = n;
    }
  }
  dst.bars[bi] = out;
  return true;
}
export function drumPattern(name, bar) {
  const st = stepsOf(bar),
    g = bar.g,
    out = {};
  const put = (s, id, v = 2) => {
    if (Number.isInteger(s) && s >= 0 && s < st) out[s + '_' + drumLane(id)] = { v };
  };
  const trip = g % 3 === 0;
  const fast = trip ? Math.max(1, g / 3) : Math.max(1, g / 4),
    mid = trip ? g : g >= 2 ? g / 2 : g,
    q = g;
  const each = (u, fn) => {
    for (let i = 0; i * u < st; i++) fn(i * u, i);
  };
  if (name === 'groove') {
    each(mid, (s) => put(s, 'hh'));
    each(q, (s, i) => {
      if (i % 2) put(s, 'sn', 3);
    });
    put(0, 'kk');
    put(2 * q, 'kk');
    put(2.5 * q, 'kk');
  }
  if (name === 'double') {
    each(fast, (s) => put(s, 'kk'));
    each(q, (s, i) => {
      if (i % 2) put(s, 'sn', 3);
    });
    each(mid, (s) => put(s, 'hh'));
    put(0, 'cr', 3);
  }
  if (name === 'thrash') {
    each(mid, (s, i) => {
      put(s, i % 2 ? 'sn' : 'kk', i % 2 ? 3 : 2);
      put(s, 'hh');
    });
  }
  if (name === 'blast') {
    each(fast, (s, i) => {
      if (i % 2) put(s, 'sn');
      else {
        put(s, 'kk');
        put(s, 'hh');
      }
    });
  }
  if (name === 'gallop') {
    each(fast, (s, i) => {
      if (trip || i % 4 !== 1) put(s, 'kk');
    });
    each(q, (s, i) => {
      if (i % 2) put(s, 'sn', 3);
    });
    each(mid, (s) => put(s, 'hh'));
  }
  if (name === 'half') {
    put(0, 'kk');
    put(1.5 * q, 'kk');
    put(3.5 * q, 'kk');
    put(2 * q, 'sn', 3);
    each(q, (s) => put(s, 'ch'));
    put(0, 'cr', 3);
  }
  if (name === 'fill') {
    const n = Math.ceil(st / fast);
    each(fast, (s, i) => put(s, ['sn', 't1', 't2', 'ft'][Math.min(3, Math.floor((i * 4) / n))], i % 2 ? 2 : 3));
    put(0, 'kk');
  }
  return out;
}
export function demoSong() {
  const s = blankSong('Gallop sketch');
  s.tempo = 168;
  s._demo = true;
  const g = s.tracks[0],
    L = 5;
  const chug = (c, ...ss) => ss.forEach((st) => (c[st + '_' + L] = { f: 0, pm: 1 }));
  const pc = (c, st, f) => {
    for (let k = 0; k < 3; k++) c[st + '_' + (L - k)] = { f };
  };
  const A = () => {
    const c = {};
    chug(c, 0, 2, 3, 4, 6, 7, 10, 11, 14, 15);
    pc(c, 8, 3);
    pc(c, 12, 5);
    return c;
  };
  g.bars[0] = A();
  {
    const c = {};
    chug(c, 0, 2, 3, 4, 6, 7, 10, 11);
    pc(c, 8, 6);
    pc(c, 12, 5);
    pc(c, 14, 3);
    g.bars[1] = c;
  }
  g.bars[2] = A();
  {
    const c = {};
    pc(c, 0, 8);
    pc(c, 3, 8);
    pc(c, 6, 7);
    chug(c, 8, 9);
    pc(c, 10, 5);
    c['12_' + L] = { f: 3 };
    c['13_' + L] = { f: 5, t: 'h' };
    c['14_' + L] = { f: 6 };
    c['15_' + L] = { f: 5, t: 'v' };
    g.bars[3] = c;
  }
  const hh = drumLane('hh'),
    sn = drumLane('sn');
  for (let b = 0; b < 4; b++) {
    fillFrom(s, 1, 0, b);
    fillFrom(s, 2, 0, b);
    fillFrom(s, 3, 0, b);
    const d = s.tracks[3].bars[b];
    for (let st = 0; st < 16; st += 2) d[st + '_' + hh] = { v: 2 };
    d['4_' + sn] = { v: 3 };
    d['12_' + sn] = { v: 3 };
  }
  s.tracks[3].bars[0]['0_' + drumLane('cr')] = { v: 3 };
  delete s.tracks[3].bars[0]['0_' + hh];
  const d3 = s.tracks[3].bars[3];
  ['12_' + hh, '14_' + hh].forEach((k) => delete d3[k]);
  d3['13_' + sn] = { v: 2 };
  d3['14_' + drumLane('t2')] = { v: 3 };
  d3['15_' + drumLane('ft')] = { v: 3 };
  d3['0_' + drumLane('ch')] = { v: 3 };
  return s;
}
