import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankSong, stepsOfBar } from './helpers';
import { drumPattern, fillFrom, noteLen } from '../src/core/notes';
import { drumLane } from '../src/core/constants';

test('a note rings until the next note or a rest', () => {
  const song = blankSong();
  const guitar = song.tracks[0];
  guitar.bars[0] = { '0_5': { f: 0 }, '4_5': { f: 3 }, '6_R': { r: 1 } };
  guitar.bars[1] = { '2_3': { f: 5 } };
  assert.equal(noteLen(song, guitar, 0, 0, 5, 16).q, 1);
  assert.equal(noteLen(song, guitar, 0, 4, 5, 16).q, 0.5);
});

test('bass follows the lowest guitar note an octave down', () => {
  const song = blankSong();
  song.tracks[0].bars[0] = { '0_5': { f: 0, pm: 1 }, '4_5': { f: 3 }, '4_4': { f: 3 }, '4_3': { f: 3 } };
  fillFrom(song, 2, 0, 0);
  assert.deepEqual(song.tracks[2].bars[0], { '0_3': { f: 0, pm: 1 }, '4_3': { f: 3 } });
});

test('drums can put a kick under every guitar note', () => {
  const song = blankSong();
  song.tracks[0].bars[0] = { '0_5': { f: 0 }, '3_5': { f: 0 }, '10_4': { f: 2 } };
  fillFrom(song, 3, 0, 0);
  const kick = drumLane('kk');
  assert.deepEqual(Object.keys(song.tracks[3].bars[0]).sort(), ['0_' + kick, '10_' + kick, '3_' + kick].sort());
});

test('drum patterns stay inside the bar in any time signature', () => {
  for (const bar of [
    { n: 4, d: 4, g: 4 },
    { n: 7, d: 8, g: 4 },
    { n: 4, d: 4, g: 3 },
    { n: 5, d: 4, g: 6 }
  ]) {
    for (const name of ['groove', 'double', 'thrash', 'blast', 'gallop', 'half', 'fill']) {
      const cells = drumPattern(name, bar);
      assert.ok(Object.keys(cells).length > 0, name);
      for (const key of Object.keys(cells)) assert.ok(+key.split('_')[0] < stepsOfBar(bar), name + ' ' + key);
    }
  }
});
