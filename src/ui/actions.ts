import { A, applyMix, preview } from '../audio/engine';
import { clampLoop, play, stop } from '../audio/playback';
import { $, BASS, GRIDS, GTR, clamp, clone, newId, rowsOf, stepsOf } from '../core/constants';
import { drumPattern, fillFrom } from '../core/notes';
import { LIB, S, T, blankSong, newTrack, normalize, strip, tempoAt } from '../core/state';
import { asciiTab, buildMidi } from '../io/export';
import { gpExport, loadAT } from '../io/guitarpro';
import { AUTH, DBX, DIR, EMAIL, FB, ME, dirty, dropShared, isShared, latestId, linkFor, openShared, queuePush, refFor, refreshDir, saveFile, saveLocal, saveShare, saveSoon, shareOf } from '../sync/cloud';
import { REC, fileSlug, recCancel, recStart } from './capture';
import { commit, copyBar, enterFret, insertBar, moveStep, pasteBar, pushUndo, setSig, swapHistory } from './editing';
import { openSong, placeCursor, renderAll, renderBar, renderPad, renderScore, renderTop, renderTransport, toast } from './render';
import { closeSheet, openSheet, refreshSheet, sheetArg, sheetKind } from './sheets';

/* ================= actions ================= */
export let taps=[];
export function armed(el: HTMLElement,label?: string){ // destructive buttons need a second tap
  if(el.dataset.armed)return true;
  el.dataset.armed='1';const old=el.textContent;el.textContent=label||'Tap again to confirm';
  setTimeout(()=>{if(el.isConnected){delete el.dataset.armed;el.textContent=old}},2500);return false;
}
export const ACT={
  play(){S.playing?stop():play()},
  loop(){S.loop.on=!S.loop.on;if(S.loop.on&&(S.cur.bar<S.loop.a||S.cur.bar>S.loop.b||S.loop.a===S.loop.b)){S.loop.a=S.loop.b=S.cur.bar}renderScore();renderTransport()},
  metro(){S.metro=!S.metro;renderTransport()},
  pad(){S.pad=!S.pad;renderPad();renderTransport()},
  undo(){swapHistory(S.undo,S.redo)},
  redo(){swapHistory(S.redo,S.undo)},
  track(d){S.ti=+d.i;S.tens=0;S.cur.str=clamp(S.cur.str,0,rowsOf(T())-1);renderAll()},
  addbar(){pushUndo();const n=S.song.bars.length;insertBar(n,S.song.bars[n-1]);S.cur.bar=n;S.cur.step=0;commit();placeCursor()},
  fret(d){enterFret(+d.n)},
  tens(d){S.tens=S.tens===+d.n?0:+d.n;renderPad()},
  pm(){
    S.pm=!S.pm;const tr=T(),c=tr.bars[S.cur.bar];let hit=false;
    for(let k=0;k<tr.tuning.length;k++){const n=c[S.cur.step+'_'+k];if(n){if(!hit){pushUndo();hit=true}if(S.pm)n.pm=1;else delete n.pm}}
    if(hit){dirty();renderBar(S.cur.bar);renderTop()}
    renderPad();
  },
  tech(d){
    const n=T().bars[S.cur.bar][S.cur.step+'_'+S.cur.str];
    if(!n){toast('Put the cursor on a note first');return}
    pushUndo();if(n.t===d.t)delete n.t;else n.t=d.t;
    preview(n,S.cur.str);commit(S.cur.bar);
  },
  rest(){
    pushUndo();const tr=T(),c=tr.bars[S.cur.bar],s=S.cur.step;
    for(let k=0;k<tr.tuning.length;k++)delete c[s+'_'+k];
    c[s+'_R']={r:1};dirty();renderBar(S.cur.bar);renderTop();
    if(S.adv)moveStep(S.adv,true);renderPad();
  },
  del(){
    const c=T().bars[S.cur.bar],k=S.cur.step+'_'+S.cur.str;
    if(c[k]){pushUndo();delete c[k];commit(S.cur.bar)}
    else if(c[S.cur.step+'_R']){pushUndo();delete c[S.cur.step+'_R'];commit(S.cur.bar)}
    else{moveStep(-1);renderPad()}
  },
  mv(d){
    S.tens=0;
    if(d.d==='l')moveStep(-1);else if(d.d==='r')moveStep(1);
    else{S.cur.str=clamp(S.cur.str+(d.d==='u'?-1:1),0,rowsOf(T())-1);placeCursor()}
    renderPad();
  },
  chord(){S.chord=(S.chord+1)%3;renderPad()},
  adv(){S.adv={0:1,1:2,2:4,4:0}[S.adv];renderPad()},
  vel(d){S.vel=+d.v;renderPad()},
  close(){closeSheet()},
  bar(d){S.cur.bar=+d.i;S.cur.step=clamp(S.cur.step,0,stepsOf(S.song.bars[S.cur.bar])-1);placeCursor(false);renderPad();openSheet('bar',+d.i)},
  scope(d){S.scope=d.s;refreshSheet()},
  copy(){copyBar(sheetArg);refreshSheet()},
  paste(){pushUndo();if(pasteBar(sheetArg)){commit();closeSheet()}else S.undo.pop()},
  pasteafter(){pushUndo();insertBar(sheetArg+1,S.clip.sig);if(pasteBar(sheetArg+1)){S.cur.bar=sheetArg+1;S.cur.step=0;commit();placeCursor();closeSheet()}else{S.song.bars.splice(sheetArg+1,1);S.song.tracks.forEach(t=>t.bars.splice(sheetArg+1,1));S.undo.pop()}},
  clear(){pushUndo();if(S.scope==='all')S.song.tracks.forEach(t=>{t.bars[sheetArg]={}});else T().bars[sheetArg]={};commit(sheetArg);closeSheet()},
  rep(d){
    pushUndo();const i=sheetArg,n=+d.n,a=i-n+1;
    const bars=S.song.bars.slice(a,i+1).map(b=>({n:b.n,d:b.d,g:b.g}));S.song.bars.splice(i+1,0,...bars);
    S.song.tracks.forEach(t=>t.bars.splice(i+1,0,...t.bars.slice(a,i+1).map(clone)));
    S.cur.bar=i+1;S.cur.step=0;commit();placeCursor();closeSheet();toast(n===1?'Bar repeated':`${n} bars repeated`);
  },
  fill(d){pushUndo();fillFrom(S.song,S.ti,+d.k,sheetArg);commit(sheetArg);closeSheet()},
  patterns(){openSheet('patterns')},
  pattern(d){pushUndo();T().bars[S.cur.bar]=drumPattern(d.p,S.song.bars[S.cur.bar]);commit(S.cur.bar);closeSheet()},
  loopbar(){S.loop={on:true,a:sheetArg,b:sheetArg};renderScore();renderTransport();closeSheet()},
  loopa(){S.loop.on=true;S.loop.a=sheetArg;if(S.loop.b<sheetArg)S.loop.b=sheetArg;renderScore();renderTransport();closeSheet()},
  loopb(){S.loop.on=true;S.loop.b=sheetArg;if(S.loop.a>sheetArg)S.loop.a=sheetArg;renderScore();renderTransport();closeSheet()},
  loopoff(){S.loop.on=false;renderScore();renderTransport();closeSheet()},
  sig(d){
    const n=+$('#sigN').value,dd=+$('#sigD').value,g=+$('#sigG').value;
    if(!Number.isInteger(n*4*g/dd)){toast(`${GRIDS[g]} don’t divide ${n}/${dd} evenly. Pick another grid.`);return}
    pushUndo();
    if(d.all==='1')S.song.bars.forEach((_,i)=>setSig(i,n,dd,g));else setSig(sheetArg,n,dd,g);
    S.cur.step=0;commit();closeSheet();
  },
  insert(){pushUndo();insertBar(sheetArg+1,S.song.bars[sheetArg]);S.cur.bar=sheetArg+1;S.cur.step=0;commit();placeCursor();closeSheet()},
  delbar(d,el){
    if(!armed(el))return;pushUndo();
    if(S.song.bars.length===1)S.song.tracks.forEach(t=>{t.bars[0]={}});
    else{S.song.bars.splice(sheetArg,1);S.song.tracks.forEach(t=>t.bars.splice(sheetArg,1))}
    S.cur.bar=clamp(sheetArg,0,S.song.bars.length-1);S.cur.step=0;clampLoop();commit();closeSheet();
  },
  bartempo(){
    const v=Math.round(+$('#barT').value),i=sheetArg;if(!(v>=30&&v<=320)){toast('Tempo goes from 30 to 320 bpm');return}
    pushUndo();if(i===0)S.song.tempo=v;else if(v===tempoAt(S.song,i-1))delete S.song.bars[i].t;else S.song.bars[i].t=v;
    commit();closeSheet();
  },
  bartempooff(){pushUndo();delete S.song.bars[sheetArg].t;commit();closeSheet()},
  capture(){REC.msg='';openSheet('capture')},
  recmode(d){if(REC.phase!=='idle')return;REC.mode=d.m;REC.msg='';refreshSheet()},
  recbars(d){if(REC.phase!=='idle')return;REC.bars=+d.n;refreshSheet()},
  recstart(){recStart()},
  reccancel(){recCancel();refreshSheet()},
  mixer(){openSheet('mixer')},
  mute(d){const t=S.song.tracks[+d.i];t.mute=!t.mute;saveSoon();renderTop();refreshSheet()},
  solo(d){const t=S.song.tracks[+d.i];t.solo=!t.solo;saveSoon();refreshSheet()},
  addtrack(d){
    pushUndo();const ty=d.t,n=S.song.tracks.filter(t=>t.type===ty).length+1;
    S.song.tracks.push(newTrack(ty,({guitar:'Guitar',bass:'Bass',drums:'Drums'})[ty]+(n>1?' '+n:''),S.song.bars.length));
    S.ti=S.song.tracks.length-1;dirty();renderAll();refreshSheet();
  },
  deltrack(d,el){if(!armed(el))return;pushUndo();S.song.tracks.splice(+d.i,1);A.bus.forEach(b=>{try{b.vol.disconnect()}catch(e){}});A.bus=[];S.ti=0;dirty();renderAll();refreshSheet()},
  song(){openSheet('song');refreshDir()},
  tempo(d){S.song.tempo=clamp(S.song.tempo+(+d.d),30,320);dirty();renderTop();refreshSheet()},
  tap(){
    const now=performance.now();taps=taps.filter(t=>now-t<2500);taps.push(now);
    if(taps.length>=3){const iv=(taps[taps.length-1]-taps[0])/(taps.length-1);S.song.tempo=clamp(Math.round(60000/iv),30,320);dirty();renderTop();const inp=$('[data-in="tempo"]');if(inp)inp.value=S.song.tempo}
  },
  speed(d){S.speed=+d.v;refreshSheet()},
  open(d){if(d.id!==LIB.currentId){openSong(d.id);saveLocal()}closeSheet()},
  newsong(){const s=blankSong('New riff');LIB.songs[s.id]=s;openSong(s.id);saveLocal();closeSheet();toast('New song. Tap a string, then a fret.')},
  dupsong(){const s=normalize(JSON.parse(strip(S.song)));s.id=newId();s.bars.forEach(b=>{delete b.id});s.tracks.forEach(t=>{delete t.id});s.title+=' copy';s.updatedAt=Date.now();if(ME)s._owner=ME;LIB.songs[s.id]=s;openSong(s.id);saveLocal();queuePush(s.id);if(sheetKind)refreshSheet();toast('This copy is yours to edit')},
  delsong(d,el){
    if(!armed(el,'Tap again'))return;
    const s=LIB.songs[d.id];if(!s)return;
    if(DBX&&s._synced&&s._owner===ME){try{refFor(s).delete().catch(()=>{})}catch(e){}}
    delete LIB.songs[d.id];
    if(d.id===LIB.currentId)openSong(latestId());saveLocal();refreshSheet();
  },
  forget(d){dropShared(d.id);refreshSheet()},
  async openshared(d){const o=DIR.find(x=>x.id===d.id)||{id:d.id};if(await openShared(o))closeSheet()},
  signin(){
    if(!AUTH){toast('Sync is still loading. Try again in a moment.');return}
    AUTH.signInWithPopup(new FB.auth.GoogleAuthProvider()).catch(e=>{toast(e&&e.code==='auth/unauthorized-domain'?'This web address isn’t authorised in Firebase yet. See the README.':e&&e.code==='auth/popup-blocked'?'The sign-in window was blocked. Allow pop-ups for this site and try again.':'Sign-in didn’t finish. Try again.')});
  },
  signout(){if(AUTH)AUTH.signOut()},
  addperson(d){
    const inp=$('#shareEmail'),e=(inp.value||'').trim().toLowerCase(),sh=shareOf(S.song);
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)){toast('Type their email address first');return}
    if(e===EMAIL){toast('That’s you: you already own this song');return}
    sh.viewers=sh.viewers.filter(x=>x!==e);sh.editors=sh.editors.filter(x=>x!==e);sh[d.r].push(e);
    saveShare(S.song);refreshSheet();toast(d.r==='editors'?'They can now edit this song':'They can now view this song');
  },
  role(d){const sh=shareOf(S.song),e=d.e,ed=sh.editors.includes(e);sh.viewers=sh.viewers.filter(x=>x!==e);sh.editors=sh.editors.filter(x=>x!==e);sh[ed?'viewers':'editors'].push(e);saveShare(S.song);refreshSheet()},
  unshare(d){const sh=shareOf(S.song);sh.viewers=sh.viewers.filter(x=>x!==d.e);sh.editors=sh.editors.filter(x=>x!==d.e);saveShare(S.song);refreshSheet()},
  anyone(d){shareOf(S.song).anyone=d.v;saveShare(S.song);refreshSheet()},
  async copylink(){
    const url=linkFor(S.song);if(!S.song._synced)await saveShare(S.song);
    try{await navigator.clipboard.writeText(url);toast(isShared(S.song)?'Link copied':'Link copied. It only opens for people you’ve added.')}catch(e){openSheet('text',{title:'Link to this song',text:url})}
  },
  showtab(){openSheet('text',{title:'Text tab',text:asciiTab(S.song)})},
  showjson(){openSheet('text',{title:'Project code',text:strip(S.song)})},
  import(){openSheet('text',{title:'Import project code',edit:true})},
  doimport(){
    let s=null;try{s=normalize(JSON.parse($('#txt').value))}catch(e){}
    if(!s){toast('That isn’t Chugpad project code');return}
    s.id=newId();s.updatedAt=Date.now();LIB.songs[s.id]=s;openSong(s.id);saveLocal();queuePush(s.id);closeSheet();toast('Imported');
  },
  async copytext(){
    const ta=$('#txt');
    try{await navigator.clipboard.writeText(ta.value);toast('Copied')}
    catch(e){ta.focus();ta.select();let ok=false;try{ok=document.execCommand('copy')}catch(_){}toast(ok?'Copied':'Select the text and copy it by hand')}
  },
  async dlgp(){
    const s=S.song;toast('Building the file…');
    let at;try{at=await loadAT()}catch(e){toast('Couldn’t load the Guitar Pro writer. Check your connection and try again.');return}
    try{saveFile(fileSlug(s)+'.gp',gpExport(at,s));toast('Saved')}catch(e){toast('That song couldn’t be turned into a Guitar Pro file')}
  },
  dlmid(){saveFile(fileSlug(S.song)+'.mid',buildMidi(S.song),'audio/midi');toast('Saved')}
};
export const EDITS=new Set(['undo','redo','addbar','fret','pm','tech','rest','del','paste','pasteafter','clear','rep','fill','pattern','sig','insert','delbar','addtrack','deltrack','tempo','tap','bartempo','bartempooff','capture','recstart']);
export const INPUT={
  title(el){S.song.title=el.value||'Untitled';dirty();renderTop()},
  tempo(el){const v=+el.value;if(v>=30&&v<=320){S.song.tempo=Math.round(v);dirty();renderTop()}},
  tname(el){S.song.tracks[+el.dataset.i].name=el.value||'Track';dirty();renderTop()},
  vol(el){const i=+el.dataset.i;S.song.tracks[i].vol=el.value/100;applyMix(i);dirty()},
  pan(el){const i=+el.dataset.i;let v=el.value/100;if(Math.abs(v)<.06)v=0;S.song.tracks[i].pan=v;applyMix(i);dirty()},
  tuning(el){const t=S.song.tracks[+el.dataset.i];if(!(t.type==='bass'?BASS:GTR)[el.value])return;pushUndo();t.tun=el.value;t.tuning=(t.type==='bass'?BASS:GTR)[el.value].slice();dirty();renderAll()},
  tone(el){S.song.tracks[+el.dataset.i].tone=el.value;dirty()},
  ring(el){S.song.tracks[+el.dataset.i].ring=el.checked;dirty()}
};
