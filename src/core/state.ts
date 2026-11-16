import type { AppState, Library, Song, Track } from './types';
import { BASS_TUNINGS, GRIDS, GUITAR_TUNINGS, TONES, clamp, newId, stepsOf } from './constants';

/* ================= state ================= */
export const STORAGE_KEY = 'chugpad.v1';
export const library: Library = { songs: {}, currentId: null };
export const appState: AppState = {
  song: null,
  ti: 0,
  cur: { bar: 0, step: 0, str: 0 },
  pm: false,
  chord: 0,
  adv: 1,
  tens: 0,
  vel: 2,
  playing: false,
  loop: { on: false, a: 0, b: 0 },
  metro: false,
  speed: 1,
  clip: null,
  scope: 'all',
  pad: true,
  undo: [],
  redo: [],
  sync: 'local'
};
export const currentTrack = () => appState.song.tracks[appState.ti];

export function newTrack(type: string, name: string, nb: number): Track {
  const t: Track = { name, type, vol: 0.8, pan: 0, mute: false, solo: false, bars: [] };
  if (type === 'guitar') {
    t.tun = 'Drop D';
    t.tuning = GUITAR_TUNINGS[t.tun].slice();
    t.tone = 'highgain';
    t.ring = false;
  }
  if (type === 'bass') {
    t.tun = 'Drop D';
    t.tuning = BASS_TUNINGS[t.tun].slice();
    t.tone = 'bass';
    t.ring = false;
  }
  if (type === 'drums') t.vol = 0.9;
  for (let i = 0; i < nb; i++) t.bars.push({});
  return t;
}
export function blankSong(title: string, nb = 4): Song {
  const s: Song = { id: newId(), title, tempo: 160, updatedAt: Date.now(), bars: [], tracks: [] };
  for (let i = 0; i < nb; i++) s.bars.push({ n: 4, d: 4, g: 4 });
  s.tracks.push(
    newTrack('guitar', 'Guitar 1', nb),
    newTrack('guitar', 'Guitar 2', nb),
    newTrack('bass', 'Bass', nb),
    newTrack('drums', 'Drums', nb)
  );
  s.tracks[0].pan = -0.6;
  s.tracks[1].pan = 0.6;
  return s;
}
export function normalize(s: any): Song | null {
  if (!s || !Array.isArray(s.bars) || !Array.isArray(s.tracks) || !s.bars.length || !s.tracks.length) return null;
  s.id = s.id || newId();
  s.title = String(s.title || 'Untitled');
  s.tempo = clamp(+s.tempo || 160, 30, 320);
  s.bars.forEach((b) => {
    b.n = clamp(+b.n | 0 || 4, 1, 32);
    if (b.t != null) {
      const tv = Math.round(+b.t);
      if (tv >= 30 && tv <= 320) b.t = tv;
      else delete b.t;
    }
    b.d = [4, 8, 16].includes(+b.d) ? +b.d : 4;
    b.g = GRIDS[b.g] ? +b.g : 4;
    if (!Number.isInteger(stepsOf(b))) {
      b.g = 4;
      if (!Number.isInteger(stepsOf(b))) b.d = 4;
    }
  });
  s.tracks.forEach((t, i) => {
    if (!['guitar', 'bass', 'drums'].includes(t.type)) t.type = 'guitar';
    t.name = String(t.name || 'Track ' + (i + 1));
    t.vol = clamp(+t.vol || 0, 0, 1);
    t.pan = clamp(+t.pan || 0, -1, 1);
    if (t.type !== 'drums') {
      if (!Array.isArray(t.tuning) || !t.tuning.length)
        t.tuning = (t.type === 'bass' ? BASS_TUNINGS : GUITAR_TUNINGS)['Drop D'].slice();
      if (!TONES[t.tone]) t.tone = t.type === 'bass' ? 'bass' : 'highgain';
    }
    if (!Array.isArray(t.bars)) t.bars = [];
    while (t.bars.length < s.bars.length) t.bars.push({});
    t.bars.length = s.bars.length;
    t.bars = t.bars.map((c) => (c && typeof c === 'object' ? c : {}));
  });
  return s;
}
export const tempoAt = (song, bi) => {
  for (let i = Math.min(bi, song.bars.length - 1); i > 0; i--) if (song.bars[i].t) return song.bars[i].t;
  return song.tempo;
};
export const strip = (s) => JSON.stringify(s, (k, v) => (k[0] === '_' ? undefined : v));
