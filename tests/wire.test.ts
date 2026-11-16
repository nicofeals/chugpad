import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSong } from '../src/core/notes';
import { decCells, diffWire, encCells, fromWire, toWire } from '../src/sync/wire';

test('a bar survives being packed into a string and back', () => {
  const guitar = { '0_5': { f: 0, pm: 1 }, '3_4': { f: 12, t: 'ph' }, '6_R': { r: 1 }, '8_5': { f: 7, pm: 1, t: 'h' } };
  assert.equal(encCells(guitar, false), '0.5.0p,3.4.12q,6.R,8.5.7ph');
  assert.deepEqual(decCells(encCells(guitar, false), false), guitar);
  const drums = { '0_9': { v: 2 }, '4_8': { v: 3 }, '6_4': { v: 1 } };
  assert.deepEqual(decCells(encCells(drums, true), true), drums);
});

test('a whole song survives the trip to the saved format and back', () => {
  const song = demoSong();
  song.bars[2].t = 140;
  const back = fromWire(toWire(song), song.id);
  assert.equal(back.title, song.title);
  assert.equal(back.bars[2].t, 140);
  song.tracks.forEach((track, ti) => track.bars.forEach((cells, bi) => {
    assert.equal(encCells(back.tracks[ti].bars[bi], track.type === 'drums'), encCells(cells, track.type === 'drums'));
  }));
});

test('changing one bar sends only that bar', () => {
  const song = demoSong();
  const before = toWire(song);
  assert.equal(diffWire(before, toWire(song)), null);
  song.tracks[0].bars[1]['15_0'] = { f: 9 };
  const patch = diffWire(before, toWire(song));
  assert.deepEqual(Object.keys(patch.cells), [song.tracks[0].id + '_' + song.bars[1].id]);
  assert.equal(patch.bars, undefined);
  song.tracks[0].bars[1] = {};
  assert.equal(diffWire(before, toWire(song)).cells[song.tracks[0].id + '_' + song.bars[1].id], '');
});
