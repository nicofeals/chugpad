import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepsOfBar } from './helpers';
import { demoSong } from '../src/core/notes';
import { asciiTab, buildMidi } from '../src/io/export';
import { barRhythm } from '../src/io/guitarpro';

test('MIDI export has a header and one track per instrument plus tempo', () => {
  const song = demoSong();
  const midi = buildMidi(song);
  assert.equal(String.fromCharCode(...midi.slice(0, 4)), 'MThd');
  assert.equal((midi[10] << 8) | midi[11], song.tracks.length + 1);
});

test('text tab lists every track', () => {
  const tab = asciiTab(demoSong());
  for (const name of ['Guitar 1', 'Guitar 2', 'Bass', 'Drums']) assert.ok(tab.includes(name));
});

test('any rhythm on the grid can be written as note values that fill the bar exactly', () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const bars = [
    { n: 4, d: 4, g: 4 },
    { n: 7, d: 8, g: 4 },
    { n: 7, d: 16, g: 4 },
    { n: 5, d: 4, g: 3 },
    { n: 6, d: 8, g: 6 },
    { n: 7, d: 8, g: 12 },
    { n: 3, d: 4, g: 8 },
    { n: 5, d: 8, g: 2 }
  ];
  for (const bar of bars) {
    for (let run = 0; run < 200; run++) {
      const steps = stepsOfBar(bar);
      const starts: number[] = [];
      for (let i = 0; i < steps; i++) if (random() < 0.3) starts.push(i);
      let pos = 0;
      for (const piece of barRhythm(bar, starts)) {
        assert.equal(piece.s, pos);
        const quarters = piece.tup ? ((4 / piece.val) * 2) / 3 : 4 / piece.val;
        assert.ok(Math.abs(quarters * bar.g - piece.len) < 1e-9);
        pos += piece.len;
      }
      assert.equal(pos, steps);
    }
  }
});
