// The song model. A song is a list of bars (time signature and grid) and a list of tracks;
// each track holds one cell map per bar, keyed "<step>_<string or drum lane>" ("<step>_R" is a rest).

export interface Cell {
  /** Fret (guitar and bass). */
  f?: number;
  /** Palm mute. */
  pm?: number;
  /** Technique: x dead, h hammer/pull, s slide, b bend, v vibrato, ph pinch harmonic. */
  t?: string;
  /** Drum hit level: 1 ghost, 2 normal, 3 accent. */
  v?: number;
  /** Rest marker. */
  r?: number;
}

export type BarCells = Record<string, Cell>;

export interface BarSig {
  id?: string;
  /** Beats per bar. */
  n: number;
  /** Beat unit: 4, 8 or 16. */
  d: number;
  /** Grid: steps per quarter note. */
  g: number;
  /** Tempo from this bar on, when it changes. */
  t?: number;
}

export interface Track {
  id?: string;
  name: string;
  type: string;
  vol: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  bars: BarCells[];
  /** Tuning name and open-string MIDI pitches, highest string first (not for drums). */
  tun?: string;
  tuning?: number[];
  tone?: string;
  ring?: boolean;
}

export interface Share {
  viewers: string[];
  editors: string[];
  anyone: 'none' | 'view' | 'edit';
}

export interface Song {
  id: string;
  title: string;
  tempo: number;
  updatedAt: number;
  bars: BarSig[];
  tracks: Track[];
  // Local bookkeeping, never part of the saved tab: sync state and who the song belongs to.
  _owner?: string;
  _ownerName?: string;
  _synced?: boolean;
  _demo?: boolean;
  _base?: any;
  _share?: Share;
}

export interface Library {
  songs: Record<string, Song>;
  currentId: string | null;
}

export interface AppState {
  song: Song;
  /** Index of the track being shown. */
  ti: number;
  cur: { bar: number; step: number; str: number };
  pm: boolean;
  chord: number;
  adv: number;
  tens: number;
  vel: number;
  playing: boolean;
  loop: { on: boolean; a: number; b: number };
  metro: boolean;
  speed: number;
  clip: any;
  scope: string;
  pad: boolean;
  /** Score locked: taps only move the cursor, nothing gets written. Remembered across visits. */
  locked: boolean;
  undo: string[];
  redo: string[];
  sync: string;
  last?: any;
}
