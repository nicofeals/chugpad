import { audioState, ensureAudio, click, playDrum, playNote } from './engine';
import { qs, DRUMS, clamp, stepsOf } from '../core/constants';
import { noteLen } from '../core/notes';
import { appState, tempoAt } from '../core/state';
import { renderTransport, toast } from '../ui/render';

/* ================= playback ================= */
export const player: any = { bar: 0, step: 0, t: 0, timer: 0, queue: [], endAt: 0, shown: null, raf: 0 };
export function play() {
  const c = ensureAudio();
  if (!c) {
    toast('This browser can’t play audio');
    return;
  }
  let b = appState.cur.bar;
  if (appState.loop.on) {
    clampLoop();
    if (b < appState.loop.a || b > appState.loop.b) b = appState.loop.a;
  }
  Object.assign(player, { bar: b, step: 0, t: c.currentTime + 0.09, queue: [], endAt: 0, shown: null });
  appState.playing = true;
  renderTransport();
  tick();
  player.timer = setInterval(tick, 25);
  player.raf = requestAnimationFrame(frame);
}
export function stop() {
  if (!appState.playing) return;
  appState.playing = false;
  clearInterval(player.timer);
  cancelAnimationFrame(player.raf);
  if (audioState.ctx) {
    const now = audioState.ctx.currentTime;
    audioState.live.forEach((l) => {
      try {
        l.src.stop(now + 0.02);
      } catch (e) {}
    });
    audioState.live = [];
  }
  document.querySelectorAll('.playhead').forEach((e) => e.remove());
  renderTransport();
}
export function clampLoop() {
  const n = appState.song.bars.length;
  appState.loop.a = clamp(appState.loop.a, 0, n - 1);
  appState.loop.b = clamp(appState.loop.b, appState.loop.a, n - 1);
}
export function tick() {
  const c = audioState.ctx,
    song = appState.song;
  if (audioState.live.length > 400) audioState.live = audioState.live.filter((l) => l.end > c.currentTime);
  while (!player.endAt && player.t < c.currentTime + 0.15) {
    if (player.bar >= song.bars.length) {
      player.endAt = player.t;
      break;
    }
    const bar = song.bars[player.bar],
      dt = 60 / tempoAt(song, player.bar) / bar.g / appState.speed;
    if (player.step < stepsOf(bar)) scheduleStep(player.bar, player.step, player.t);
    player.t += dt;
    player.step++;
    if (player.step >= stepsOf(bar)) {
      player.step = 0;
      player.bar++;
      if (appState.loop.on) {
        clampLoop();
        if (player.bar > appState.loop.b) player.bar = appState.loop.a;
      }
    }
  }
}
export function scheduleStep(bi, st, t) {
  const song = appState.song,
    bar = song.bars[bi];
  player.queue.push({ t, bi, st });
  if (appState.metro) {
    const u = (bar.g * 4) / bar.d;
    if (st % u === 0) click(t, st === 0);
  }
  const solo = song.tracks.some((x) => x.solo),
    spq = 60 / tempoAt(song, bi) / appState.speed;
  song.tracks.forEach((tr, ti) => {
    if (solo ? !tr.solo : tr.mute) return;
    const c = tr.bars[bi];
    if (!c) return;
    if (tr.type === 'drums') {
      for (let k = 0; k < DRUMS.length; k++) {
        const n = c[st + '_' + k];
        if (n) playDrum(ti, k, t, n.v || 2);
      }
      return;
    }
    for (let k = 0; k < tr.tuning.length; k++) {
      const n = c[st + '_' + k];
      if (!n) continue;
      const L = noteLen(song, tr, bi, st, k, 12);
      playNote(ti, tr.tuning[k] + n.f, t, Math.min(L.q * spq, 2.5), n, L.next ? L.next.f - n.f : 0);
    }
  });
}
export function frame() {
  if (!appState.playing) return;
  const now = audioState.ctx.currentTime;
  let cur = null;
  while (player.queue.length && player.queue[0].t <= now) cur = player.queue.shift();
  if (cur) {
    const grid = qs(`.grid[data-i="${cur.bi}"]`);
    let ph = qs('.playhead');
    if (grid) {
      if (!ph) {
        ph = document.createElement('div');
        ph.className = 'playhead';
      }
      if (ph.parentNode !== grid) {
        grid.appendChild(ph);
        if (player.shown !== cur.bi) {
          player.shown = cur.bi;
          grid.parentNode.parentNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      }
      ph.style.left = (cur.st / stepsOf(appState.song.bars[cur.bi])) * 100 + '%';
    }
    qs('#pos').textContent = `Bar ${cur.bi + 1} of ${appState.song.bars.length}`;
  }
  if (player.endAt && now > player.endAt + 0.05) {
    stop();
    return;
  }
  player.raf = requestAnimationFrame(frame);
}
