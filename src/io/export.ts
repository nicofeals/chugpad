import { tick } from '../audio/playback';
import { DRUMS, NOTE_NAMES, TONES, clamp, rowsOf, stepsOf } from '../core/constants';
import { noteLen } from '../core/notes';
import { sheetHeader } from '../ui/sheets';

/* ================= export ================= */
export function asciiTab(song) {
  const AG = { h: 'h', s: '/', b: 'b', v: '~', ph: '*' };
  let out = `${song.title}\nTempo ${song.tempo} bpm\n`;
  song.tracks.forEach((tr) => {
    const drum = tr.type === 'drums',
      rows = rowsOf(tr),
      labels = drum ? DRUMS.map((d) => d.label) : tr.tuning.map((m) => NOTE_NAMES[m % 12]);
    out += `\n${tr.name}${drum ? '' : ' (' + (tr.tun || 'custom') + ')'}\n`;
    for (let b = 0; b < song.bars.length; b += 2) {
      const lines = labels.map((l) => l.padEnd(2) + '|');
      let pm = '  |',
        any = false;
      for (let i = b; i < Math.min(b + 2, song.bars.length); i++) {
        const st = stepsOf(song.bars[i]),
          c = tr.bars[i];
        for (let r = 0; r < rows; r++) {
          let s = '';
          for (let x = 0; x < st; x++) {
            const n = c[x + '_' + r];
            s += (
              !n ? '' : drum ? (n.v === 3 ? 'X' : n.v === 1 ? 'o' : 'x') : n.t === 'x' ? 'x' : n.f + (AG[n.t] || '')
            ).padEnd(3, '-');
          }
          lines[r] += s + '|';
        }
        if (!drum) {
          for (let x = 0; x < st; x++) {
            let m = false;
            for (let r = 0; r < rows; r++) {
              const n = c[x + '_' + r];
              if (n && n.pm) m = true;
            }
            if (m) any = true;
            pm += m ? 'M  ' : '   ';
          }
          pm += '|';
        }
      }
      out += lines.join('\n') + '\n' + (any ? pm + '\n' : '') + '\n';
    }
  });
  return out;
}
export function buildMidi(song) {
  const PPQ = 480,
    u32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const vlq = (n) => {
    const b = [n & 127];
    while ((n >>= 7)) b.unshift((n & 127) | 128);
    return b;
  };
  const chunk = (evs) => {
    evs.sort((a, b) => a.tick - b.tick || a.o - b.o);
    const out = [];
    let last = 0;
    for (const e of evs) {
      out.push(...vlq(e.tick - last), ...e.b);
      last = e.tick;
    }
    out.push(0, 255, 47, 0);
    return [77, 84, 114, 107, ...u32(out.length), ...out];
  };
  const barTick = [];
  let t = 0;
  song.bars.forEach((b) => {
    barTick.push(t);
    t += (stepsOf(b) * PPQ) / b.g;
  });
  const us = Math.round(6e7 / song.tempo),
    meta = [{ tick: 0, o: 0, b: [255, 81, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] }];
  song.bars.forEach((b, i) => {
    if (i && b.t) {
      const u2 = Math.round(6e7 / b.t);
      meta.push({ tick: barTick[i], o: 0, b: [255, 81, 3, (u2 >> 16) & 255, (u2 >> 8) & 255, u2 & 255] });
    }
  });
  let ps = '';
  song.bars.forEach((b, i) => {
    const sg = b.n + '/' + b.d;
    if (sg !== ps) {
      meta.push({ tick: barTick[i], o: 1, b: [255, 88, 4, b.n, Math.log2(b.d), 24, 8] });
      ps = sg;
    }
  });
  const chunks = [chunk(meta)];
  let ch = 0;
  const enc = new TextEncoder();
  song.tracks.forEach((tr) => {
    const evs = [],
      nm = [...enc.encode(tr.name)],
      drum = tr.type === 'drums';
    evs.push({ tick: 0, o: 0, b: [255, 3, ...vlq(nm.length), ...nm] });
    let c = 9;
    if (!drum) {
      c = ch++;
      if (c === 9) c = ch++;
      c = Math.min(c, 15);
      evs.push({ tick: 0, o: 0, b: [192 | c, (TONES[tr.tone] || TONES.highgain).prog] });
    }
    tr.bars.forEach((cells, bi) => {
      const bar = song.bars[bi],
        st = stepsOf(bar),
        tk = PPQ / bar.g;
      for (const key in cells) {
        const p = key.split('_'),
          s = +p[0],
          k = +p[1];
        if (p[1] === 'R' || s >= st || k >= rowsOf(tr)) continue;
        const cell = cells[key],
          tick = barTick[bi] + s * tk;
        let note, vel, len;
        if (drum) {
          note = DRUMS[k].midi;
          vel = [0, 45, 100, 127][cell.v || 2];
          len = Math.max(10, tk / 2);
        } else {
          note = clamp(tr.tuning[k] + cell.f, 0, 127);
          len = Math.round(noteLen(song, tr, bi, s, k, 16).q * PPQ);
          vel = cell.t === 'h' ? 86 : 106;
          if (cell.t === 'x') {
            len = Math.min(len, 40);
            vel = 72;
          } else if (cell.pm) {
            len = Math.min(len, 120);
            vel = 98;
          }
        }
        evs.push(
          { tick, o: 2, b: [144 | c, note, vel] },
          { tick: tick + Math.max(1, Math.round(len)), o: 1, b: [128 | c, note, 0] }
        );
      }
    });
    chunks.push(chunk(evs));
  });
  const head = [
    77,
    84,
    104,
    100,
    0,
    0,
    0,
    6,
    0,
    1,
    (chunks.length >> 8) & 255,
    chunks.length & 255,
    (PPQ >> 8) & 255,
    PPQ & 255
  ];
  return new Uint8Array(head.concat(...chunks));
}
