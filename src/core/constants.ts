/* ================= helpers & constants ================= */
export const qs = (s, r = document) => r.querySelector(s);
export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const clone = (o) => JSON.parse(JSON.stringify(o));
export const newId = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const GUITAR_TUNINGS = {
  'E standard': [64, 59, 55, 50, 45, 40],
  'Eb standard': [63, 58, 54, 49, 44, 39],
  'D standard': [62, 57, 53, 48, 43, 38],
  'Drop D': [64, 59, 55, 50, 45, 38],
  'Drop C#': [63, 58, 54, 49, 44, 37],
  'Drop C': [62, 57, 53, 48, 43, 36],
  'C standard': [60, 55, 51, 46, 41, 36],
  'Drop B': [61, 56, 52, 47, 42, 35],
  'B standard': [59, 54, 50, 45, 40, 35],
  'Drop A': [59, 54, 50, 45, 40, 33],
  '7-string B standard': [64, 59, 55, 50, 45, 40, 35],
  '7-string Drop A': [64, 59, 55, 50, 45, 40, 33],
  '7-string Drop G': [62, 57, 53, 48, 43, 38, 31],
  '8-string F# standard': [64, 59, 55, 50, 45, 40, 35, 30],
  '8-string Drop E': [64, 59, 55, 50, 45, 40, 35, 28]
};
export const BASS_TUNINGS = {
  'E standard': [43, 38, 33, 28],
  'Drop D': [43, 38, 33, 26],
  'D standard': [41, 36, 31, 26],
  'Drop C': [41, 36, 31, 24],
  'C standard': [39, 34, 29, 24],
  'Drop B': [40, 35, 30, 23],
  '5-string B standard': [43, 38, 33, 28, 23],
  '5-string Drop A': [43, 38, 33, 28, 21]
};
/* Amp models (see audio/engine.ts).
   guitar: tight = pre-drive highpass (Hz), boost = screamer-style mid push before the amp (dB),
           drive/drive2 = gain of the two clipping stages, bass/mid/treble/presence = tone stack (dB),
           hm2 = Boss HM-2 "Swedish chainsaw" EQ after the first stage, dbl = double-tracked L/R,
           verb = reverb send, level = output trim.
   bass:   drive = grind stage gain, blend = share of the distorted path vs the clean low end. */
export const TONES = {
  highgain: {
    label: 'High gain',
    amp: 'guitar',
    prog: 30,
    tight: 140,
    boost: 7,
    drive: 30,
    drive2: 3,
    bass: 3,
    mid: -3,
    treble: 2,
    presence: 3,
    level: 0.17,
    dbl: 1,
    verb: 0.05
  },
  djent: {
    label: 'Tight / djent',
    amp: 'guitar',
    prog: 30,
    tight: 210,
    boost: 9,
    drive: 26,
    drive2: 2.5,
    bass: 4,
    mid: -6,
    treble: 4,
    presence: 5,
    level: 0.17,
    dbl: 1,
    verb: 0.04
  },
  chainsaw: {
    label: 'Chainsaw (HM-2)',
    amp: 'guitar',
    prog: 30,
    tight: 70,
    boost: 0,
    hm2: 1,
    drive: 40,
    drive2: 4,
    bass: 1,
    mid: 1,
    treble: 1,
    presence: 2,
    level: 0.13,
    dbl: 1,
    verb: 0.05
  },
  crunch: {
    label: 'Crunch',
    amp: 'guitar',
    prog: 29,
    tight: 90,
    boost: 3,
    drive: 6,
    drive2: 1.5,
    bass: 1,
    mid: 0,
    treble: 1,
    presence: 1,
    level: 0.26,
    dbl: 1,
    verb: 0.1
  },
  clean: {
    label: 'Clean',
    amp: 'guitar',
    prog: 27,
    tight: 60,
    boost: 0,
    drive: 1,
    drive2: 1,
    bass: 0,
    mid: 0,
    treble: 2,
    presence: 0,
    level: 0.55,
    dbl: 0,
    verb: 0.28
  },
  bass: { label: 'Clean bass', amp: 'bass', prog: 34, drive: 3, blend: 0.25, level: 0.55, verb: 0 },
  bassdrive: { label: 'Dirty bass', amp: 'bass', prog: 34, drive: 24, blend: 0.65, level: 0.45, verb: 0 }
};
export const TONES_BY_TYPE = {
  guitar: ['highgain', 'djent', 'chainsaw', 'crunch', 'clean'],
  bass: ['bass', 'bassdrive']
};
export const DRUMS = [
  { id: 'cr', label: 'CR', name: 'Crash', midi: 49, lv: 0.5 },
  { id: 'ch', label: 'CH', name: 'China', midi: 52, lv: 0.5 },
  { id: 'rd', label: 'RD', name: 'Ride', midi: 51, lv: 0.45 },
  { id: 'ho', label: 'HO', name: 'Open hat', midi: 46, lv: 0.4 },
  { id: 'hh', label: 'HH', name: 'Closed hat', midi: 42, lv: 0.4 },
  { id: 't1', label: 'T1', name: 'High tom', midi: 48, lv: 0.85 },
  { id: 't2', label: 'T2', name: 'Mid tom', midi: 45, lv: 0.85 },
  { id: 'ft', label: 'FT', name: 'Floor tom', midi: 41, lv: 0.9 },
  { id: 'sn', label: 'SN', name: 'Snare', midi: 38, lv: 0.9 },
  { id: 'kk', label: 'KK', name: 'Kick', midi: 36, lv: 1 }
];
export const drumLane = (id) => DRUMS.findIndex((d) => d.id === id);
export const GRIDS = {
  2: '8ths',
  4: '16ths',
  8: '32nds',
  3: '8th triplets',
  6: '16th triplets',
  12: '16ths + triplets'
};
export const TECH_GLYPHS = { h: 'h', s: '/', b: 'b', v: '~', ph: '◆' };
export const stepsOf = (b) => (b.n * 4 * b.g) / b.d;
export const rowsOf = (tr) => (tr.type === 'drums' ? DRUMS.length : tr.tuning.length);
export const triangleIcon = (d) =>
  `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="${{ l: 'M9.5 1v10L2 6z', r: 'M2.5 1v10L10 6z', u: 'M1 9.5h10L6 2z', d: 'M1 2.5h10L6 10z' }[d]}"/></svg>`;
