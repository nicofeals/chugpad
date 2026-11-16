import { stepsOf } from '../src/core/constants';
import { blankSong as makeSong } from '../src/core/state';
import type { BarSig, Song } from '../src/core/types';

export const blankSong = (): Song => makeSong('Test');
export const stepsOfBar = (bar: BarSig): number => stepsOf(bar);
