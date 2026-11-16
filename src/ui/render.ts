import { A, applyMix } from '../audio/engine';
import { stop } from '../audio/playback';
import { $, DRUMS, GRIDS, NOTE, TG, TRI, clamp, esc, rowsOf, stepsOf } from '../core/constants';
import { LIB, S, T } from '../core/state';
import { canEdit, isMine, isShared, subscribeCurrent } from '../sync/cloud';

/* ================= rendering ================= */
export function barHTML(i){
  const tr=T(),song=S.song,bar=song.bars[i],c=tr.bars[i],st=stepsOf(bar),rows=rowsOf(tr),drum=tr.type==='drums';
  let h='',pm='';const pmSteps=new Set<number>();
  const u=bar.g*4/bar.d*((bar.d===8&&bar.n%3===0&&bar.n>3)?3:1);
  for(let b=0;b*u<st;b++)h+=`<div class="beat${b%2?' alt':''}" style="left:${b*u/st*100}%;width:${Math.min(u,st-b*u)/st*100}%"></div>`;
  for(const key in c){
    const p=key.split('_'),s=+p[0],cell=c[key];if(s>=st)continue;
    const left=s/st*100;
    if(p[1]==='R'){if(!drum)h+=`<div class="rest" style="left:${left}%"></div>`;continue}
    const k=+p[1];if(k>=rows)continue;
    if(drum)h+=`<span class="n d v${cell.v||2}${k<5?' cym':''}" style="left:${left}%;top:calc(${k}*var(--rh))"><b>${k<5?'×':''}</b></span>`;
    else{
      if(cell.pm)pmSteps.add(s);
      h+=`<span class="n${cell.pm?' pm':''}" style="left:${left}%;top:calc(${k}*var(--rh))"><b>${cell.t==='x'?'x':cell.f}</b>${TG[cell.t]?`<i>${TG[cell.t]}</i>`:''}</span>`;
    }
  }
  pmSteps.forEach(s=>{pm+=`<u style="left:${s/st*100}%"></u>`});
  const labels=drum?DRUMS.map(d=>d.label):tr.tuning.map(m=>NOTE[m%12]);
  const prev=song.bars[i-1],sig=(!prev||prev.n!==bar.n||prev.d!==bar.d)?`<span class="sig">${bar.n}/${bar.d}</span>`:'';
  const gl=bar.g!==4?`<span class="gl">${GRIDS[bar.g]}</span>`:'',tp=i>0&&bar.t?`<span class="tp">${bar.t} bpm</span>`:'';
  const lp=S.loop.on&&i>=S.loop.a&&i<=S.loop.b?`<span class="lp">loop</span>`:'';
  return `<div class="bar${i===S.cur.bar?' current':''}${st>32?' wide':''}" data-i="${i}" style="--steps:${st};--rows:${rows}">
<div class="bar-head"><button class="bar-btn" data-act="bar" data-i="${i}" aria-label="Bar ${i+1} options">${i+1}<span>···</span></button>${sig}${gl}${tp}${lp}</div>
<div class="bar-body"><div class="gutter">${labels.map(l=>`<span>${l}</span>`).join('')}</div><div class="grid" data-i="${i}">${h}</div></div>
${drum?'':`<div class="pmrow">${pm?'<em>PM</em>':''}${pm}</div>`}</div>`;
}
export function renderScore(){
  document.documentElement.style.setProperty('--gut',T().type==='drums'?'24px':'20px');
  $('#score').innerHTML=S.song.bars.map((_,i)=>barHTML(i)).join('')+`<button id="addbar" data-act="addbar">Add a bar</button>`;
  placeCursor(false);
}
export function renderBar(i){const el=$(`.bar[data-i="${i}"]`);if(el){el.outerHTML=barHTML(i);placeCursor(false)}}
export function placeCursor(scroll=true){
  document.querySelectorAll('.cursor,.curcol').forEach(e=>e.remove());
  document.querySelectorAll('.bar.current').forEach(e=>e.classList.remove('current'));
  const el=$(`.bar[data-i="${S.cur.bar}"]`);if(!el)return;
  el.classList.add('current');
  if(T().type!=='drums'){
    const grid=$('.grid',el),st=stepsOf(S.song.bars[S.cur.bar]),left=S.cur.step/st*100;
    grid.insertAdjacentHTML('beforeend',`<div class="curcol" style="left:${left}%"></div><div class="cursor" style="left:${left}%;top:calc(${S.cur.str}*var(--rh))"></div>`);
  }
  if(scroll){el.scrollIntoView({block:'nearest'});const cu=$('.cursor',el);if(cu&&el.classList.contains('wide'))cu.scrollIntoView({block:'nearest',inline:'nearest'})}
  if(!S.playing)$('#pos').textContent=`Bar ${S.cur.bar+1} of ${S.song.bars.length}`;
}
export function renderTop(){
  $('#titleB').innerHTML=`${esc(S.song.title)}<small>${S.song.tempo} bpm${S.song.bars.some((b,i)=>i&&b.t)?' +':''}</small>${!canEdit()?'<span class="tag">view only</span>':isShared(S.song)||!isMine(S.song)?'<span class="tag">shared</span>':''}`;
  $('#undoB').disabled=!S.undo.length;$('#redoB').disabled=!S.redo.length;
  $('#tabs').innerHTML=S.song.tracks.map((t,i)=>`<button class="tab${i===S.ti?' on':''}${t.mute?' muted':''}" data-act="track" data-i="${i}" style="--c:var(--t${i%4})">${esc(t.name)}</button>`).join('');
  document.body.style.setProperty('--acc',`var(--t${S.ti%4})`);
}
export function renderTransport(){
  $('#play').innerHTML=S.playing?`<svg viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1.5"/></svg>Stop`:`${TRI('r')}Play`;
  const l=$('#loopB');l.classList.toggle('on',S.loop.on);
  l.textContent=S.loop.on?(S.loop.a===S.loop.b?`Loop ${S.loop.a+1}`:`Loop ${S.loop.a+1}–${S.loop.b+1}`):'Loop';
  $('#metroB').classList.toggle('on',S.metro);
  $('#padB').classList.toggle('on',S.pad);
  if(!S.playing)$('#pos').textContent=`Bar ${S.cur.bar+1} of ${S.song.bars.length}`;
}
export function renderPad(){
  const pad=$('#pad');
  if(!canEdit()){pad.hidden=false;pad.innerHTML=`<div class="ro"><span><b>View only.</b> You can read and play this song, but not change it.</span><button class="b" data-act="dupsong">Make my own copy</button></div>`;return}
  pad.hidden=!S.pad;if(!S.pad)return;
  const tr=T();
  if(tr.type==='drums'){
    pad.innerHTML=`<div class="row">
<button class="k s${S.vel===1?' on':''}" data-act="vel" data-v="1">Ghost</button>
<button class="k s${S.vel===2?' on':''}" data-act="vel" data-v="2">Normal</button>
<button class="k s${S.vel===3?' on':''}" data-act="vel" data-v="3">Accent</button>
<button class="k s" data-act="patterns">Patterns</button></div>`;
    return;
  }
  const cell=tr.bars[S.cur.bar][S.cur.step+'_'+S.cur.str],t=cell&&cell.t;
  const tk=(id,lab,ti)=>`<button class="k s${t===id?' on':''}" data-act="tech" data-t="${id}" aria-label="${ti}">${lab}</button>`;
  const num=n=>`<button class="k num" data-act="fret" data-n="${n}">${S.tens?S.tens*10+n>24?24:S.tens*10+n:n}</button>`;
  pad.innerHTML=`<div class="row">
<button class="k s pmk${S.pm?' on':''}" data-act="pm" aria-label="Palm mute">PM</button>
${tk('x','x','Dead note')}${tk('h','h','Hammer-on or pull-off')}${tk('s','/','Slide')}${tk('b','b','Bend')}${tk('v','~','Vibrato')}${tk('ph','◆','Pinch harmonic')}
<button class="k s" data-act="rest" aria-label="Rest">rest</button></div>
<div class="row">
<button class="k s" data-act="mv" data-d="l" aria-label="Previous step">${TRI('l')}</button>
<button class="k s" data-act="mv" data-d="r" aria-label="Next step">${TRI('r')}</button>
<button class="k s" data-act="mv" data-d="u" aria-label="String up">${TRI('u')}</button>
<button class="k s" data-act="mv" data-d="d" aria-label="String down">${TRI('d')}</button>
<button class="k s${S.chord?' on':''}" data-act="chord" style="grid-column:span 2">${['1 note','Power 5','Power 5+8'][S.chord]}</button>
<button class="k s" data-act="adv" style="grid-column:span 2">${S.adv?'Jump '+S.adv:'Stay put'}</button>
<button class="k s" data-act="del" aria-label="Delete note">⌫</button></div>
<div class="row">${[0,1,2,3,4,5].map(num).join('')}</div>
<div class="row">${[6,7,8,9].map(num).join('')}
<button class="k num${S.tens===1?' on':''}" data-act="tens" data-n="1">1<small>0+</small></button>
<button class="k num${S.tens===2?' on':''}" data-act="tens" data-n="2">2<small>0+</small></button></div>`;
}
export function renderAll(){
  S.ti=clamp(S.ti,0,S.song.tracks.length-1);
  S.cur.bar=clamp(S.cur.bar,0,S.song.bars.length-1);
  S.cur.step=clamp(S.cur.step,0,stepsOf(S.song.bars[S.cur.bar])-1);
  S.cur.str=clamp(S.cur.str,0,rowsOf(T())-1);
  renderTop();renderScore();renderTransport();renderPad();
  S.song.tracks.forEach((_,i)=>applyMix(i));
}
export let toastT: any=0;
export function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2200)}
export function openSong(id){
  stop();LIB.currentId=id;S.song=LIB.songs[id];S.ti=0;S.cur={bar:0,step:0,str:Math.max(0,rowsOf(S.song.tracks[0])-1)};
  S.undo=[];S.redo=[];S.loop={on:false,a:0,b:0};S.tens=0;A.bus.forEach(b=>{try{b.vol.disconnect()}catch(e){}});A.bus=[];
  renderAll();$('#score').scrollTop=0;subscribeCurrent();
}
