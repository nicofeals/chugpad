import { A, audio, click, playDrum, playNote } from './engine';
import { $, DRUMS, clamp, stepsOf } from '../core/constants';
import { noteLen } from '../core/notes';
import { S, tempoAt } from '../core/state';
import { renderTransport, toast } from '../ui/render';

/* ================= playback ================= */
export const P: any={bar:0,step:0,t:0,timer:0,queue:[],endAt:0,shown:null,raf:0};
export function play(){
  const c=audio();if(!c){toast('This browser can’t play audio');return}
  let b=S.cur.bar;
  if(S.loop.on){clampLoop();if(b<S.loop.a||b>S.loop.b)b=S.loop.a}
  Object.assign(P,{bar:b,step:0,t:c.currentTime+.09,queue:[],endAt:0,shown:null});
  S.playing=true;renderTransport();
  tick();P.timer=setInterval(tick,25);P.raf=requestAnimationFrame(frame);
}
export function stop(){
  if(!S.playing)return;S.playing=false;clearInterval(P.timer);cancelAnimationFrame(P.raf);
  if(A.ctx){const now=A.ctx.currentTime;A.live.forEach(l=>{try{l.src.stop(now+.02)}catch(e){}});A.live=[]}
  document.querySelectorAll('.playhead').forEach(e=>e.remove());
  renderTransport();
}
export function clampLoop(){const n=S.song.bars.length;S.loop.a=clamp(S.loop.a,0,n-1);S.loop.b=clamp(S.loop.b,S.loop.a,n-1)}
export function tick(){
  const c=A.ctx,song=S.song;
  if(A.live.length>400)A.live=A.live.filter(l=>l.end>c.currentTime);
  while(!P.endAt&&P.t<c.currentTime+.15){
    if(P.bar>=song.bars.length){P.endAt=P.t;break}
    const bar=song.bars[P.bar],dt=60/tempoAt(song,P.bar)/bar.g/S.speed;
    if(P.step<stepsOf(bar))scheduleStep(P.bar,P.step,P.t);
    P.t+=dt;P.step++;
    if(P.step>=stepsOf(bar)){
      P.step=0;P.bar++;
      if(S.loop.on){clampLoop();if(P.bar>S.loop.b)P.bar=S.loop.a}
    }
  }
}
export function scheduleStep(bi,st,t){
  const song=S.song,bar=song.bars[bi];P.queue.push({t,bi,st});
  if(S.metro){const u=bar.g*4/bar.d;if(st%u===0)click(t,st===0)}
  const solo=song.tracks.some(x=>x.solo),spq=60/tempoAt(song,bi)/S.speed;
  song.tracks.forEach((tr,ti)=>{
    if(solo?!tr.solo:tr.mute)return;
    const c=tr.bars[bi];if(!c)return;
    if(tr.type==='drums'){for(let k=0;k<DRUMS.length;k++){const n=c[st+'_'+k];if(n)playDrum(ti,k,t,n.v||2)}return}
    for(let k=0;k<tr.tuning.length;k++){
      const n=c[st+'_'+k];if(!n)continue;
      const L=noteLen(song,tr,bi,st,k,12);
      playNote(ti,tr.tuning[k]+n.f,t,Math.min(L.q*spq,2.5),n,L.next?L.next.f-n.f:0);
    }
  });
}
export function frame(){
  if(!S.playing)return;const now=A.ctx.currentTime;let cur=null;
  while(P.queue.length&&P.queue[0].t<=now)cur=P.queue.shift();
  if(cur){
    const grid=$(`.grid[data-i="${cur.bi}"]`);let ph=$('.playhead');
    if(grid){
      if(!ph){ph=document.createElement('div');ph.className='playhead'}
      if(ph.parentNode!==grid){grid.appendChild(ph);if(P.shown!==cur.bi){P.shown=cur.bi;grid.parentNode.parentNode.scrollIntoView({block:'nearest',behavior:'smooth'})}}
      ph.style.left=(cur.st/stepsOf(S.song.bars[cur.bi])*100)+'%';
    }
    $('#pos').textContent=`Bar ${cur.bi+1} of ${S.song.bars.length}`;
  }
  if(P.endAt&&now>P.endAt+.05){stop();return}
  P.raf=requestAnimationFrame(frame);
}
