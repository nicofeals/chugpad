import { demoSong } from '../core/notes';
import { KEY, LIB, S, blankSong, normalize } from '../core/state';
import { diffWire, fromWire, slim, toWire } from './wire';
import { REC } from '../ui/capture';
import { openSong, renderAll, renderPad, renderTop, toast } from '../ui/render';
import { closeSheet, openSheet, refreshSheet, sheetArg, sheetKind } from '../ui/sheets';

// ---- who may do what
export let saveT: any=0,FB: any=null,DBX: any=null,AUTH: any=null,ME: string | null=null,EMAIL='',MYNAME='',LASTME: string | null=null,UNSUB: any=null,DIR: any[]=[];export const up: Record<string, any>={};
try{LASTME=localStorage.getItem('chugpad.me')}catch(e){}
export const FLAGS=['_synced','_owner','_base','_demo','_share','_ownerName'];
export function saveSoon(){clearTimeout(saveT);saveT=setTimeout(saveLocal,600)}
export const noShare=()=>({viewers:[],editors:[],anyone:'none'});
export const pickShare=d=>({viewers:Array.isArray(d.viewers)?d.viewers.slice():[],editors:Array.isArray(d.editors)?d.editors.slice():[],anyone:d.anyone==='view'||d.anyone==='edit'?d.anyone:'none'});
export const shareOf=s=>s._share||(s._share=noShare());
export const isShared=s=>{const sh=shareOf(s);return sh.anyone!=='none'||sh.viewers.length>0||sh.editors.length>0};
export const isMine=s=>!s._owner||s._owner===(ME||LASTME);
export const canEdit=(s=S.song)=>{if(!s||isMine(s))return true;const sh=shareOf(s);return sh.anyone==='edit'||(!!EMAIL&&sh.editors.includes(EMAIL))};
export const refFor=s=>DBX.db.collection('songs').doc(s.id);
export const fullDoc=(s,L)=>Object.assign({},L,pickShare(shareOf(s)),{ownerEmail:EMAIL,ownerName:MYNAME});
export function carry(a,b){ // keep sync flags and each person's own mute/solo when a song object is replaced
  FLAGS.forEach(k=>{if(a[k]!==undefined)b[k]=a[k]});
  const m={};a.tracks.forEach(t=>{if(t.id)m[t.id]=t});
  b.tracks.forEach(t=>{const o=m[t.id];if(o){t.mute=o.mute;t.solo=o.solo}});
}
export const typing=()=>/INPUT|TEXTAREA|SELECT/.test((document.activeElement||{}).tagName||'');
export const softSheet=()=>{if(sheetKind==='song'&&!typing())refreshSheet()};
export function adopt(id,n){
  LIB.songs[id]=n;saveSoon();
  if(id!==LIB.currentId)return;
  S.song=n;S.undo=[];S.redo=[];
  if(REC.phase!=='idle')return;
  renderAll();
  if(sheetKind==='bar'&&sheetArg>=n.bars.length)closeSheet();else if(sheetKind&&sheetKind!=='text'&&sheetKind!=='info'&&!typing())refreshSheet();
}
// fold someone else's saved changes into the open song; my own unsent changes win where both touched the same bar
export function mergeRemote(id,R){
  const s=LIB.songs[id];if(!s||!R||R.v!==2)return;
  const sh=pickShare(R),was=JSON.stringify(shareOf(s))+canEdit(s);
  s._share=sh;if(R.owner)s._owner=R.owner;if(R.ownerName)s._ownerName=R.ownerName;
  if(id===LIB.currentId&&was!==JSON.stringify(sh)+canEdit(s)){renderTop();renderPad();softSheet()}
  if(!s._base){
    const r=fromWire(R,id);if(!r)return;
    if((r.updatedAt||0)>(s.updatedAt||0)){carry(s,r);r._synced=true;r._base=slim(R);adopt(id,r)}
    else{s._synced=true;s._base=slim(R);queuePush(id,500)}
    return;
  }
  const B=s._base,L=toWire(s),bc=B.cells||{},rc=R.cells||{},M={v:2,owner:R.owner||L.owner,updatedAt:Math.max(L.updatedAt||0,R.updatedAt||0),cells:{}};
  let took=false,mine=false;
  for(const k of ['title','tempo','bars','tracks']){if(L[k]===B[k]){M[k]=R[k];if(R[k]!==L[k])took=true}else{M[k]=L[k];if(R[k]!==L[k])mine=true}}
  new Set([...Object.keys(L.cells),...Object.keys(rc),...Object.keys(bc)]).forEach(k=>{
    const l=L.cells[k]||'',b=bc[k]||'',r=rc[k]||'',m=l===b?r:l;
    if(m!==l)took=true;if(l!==b&&l!==r)mine=true;if(m)M.cells[k]=m;
  });
  s._base=slim(R);s._synced=true;
  if(took){const n=fromWire(M,id);if(n){carry(s,n);n._base=slim(R);adopt(id,n)}}
  if(mine)queuePush(id,400);
}
export function saveLocal(){try{localStorage.setItem(KEY,JSON.stringify({currentId:LIB.currentId,songs:LIB.songs}))}catch(e){}}
export function dirty(){
  const s=S.song;if(!canEdit(s))return;
  s.updatedAt=Date.now();delete s._demo;
  saveSoon();
  queuePush(s.id,isShared(s)||!isMine(s)?800:2000);
}
export function queuePush(id,ms=1500){
  if(!DBX)return;const u=up[id]||(up[id]={t:0,busy:false,again:false});
  clearTimeout(u.t);u.t=setTimeout(()=>pushSong(id),ms);
}
export async function pushSong(id){
  const u=up[id]||(up[id]={t:0,busy:false,again:false}),s=LIB.songs[id];
  if(!DBX||!s||s._demo||!canEdit(s))return;
  if(u.busy){u.again=true;return}
  u.busy=true;
  try{
    if(!s._owner)s._owner=ME;
    const mine=s._owner===ME,L=toWire(s),ref=refFor(s),B=s._base;
    if(JSON.stringify(L).length>900000)S.sync='big';
    else if(B||mine){
      const patch=B?diffWire(B,L):null;
      if(!B)await ref.set(fullDoc(s,L));
      else if(patch){try{await ref.set(patch,{merge:true})}catch(e){if(mine)await ref.set(fullDoc(s,L));else throw e}}
      if(!B||patch){
        const cur=LIB.songs[id];
        if(cur){const first=!cur._synced;cur._base=slim(L);cur._synced=true;saveSoon();
          if(first&&id===LIB.currentId)subscribeCurrent()}
        S.sync='cloud';
      }
    }
  }catch(e){S.sync='error'}
  u.busy=false;if(u.again){u.again=false;queuePush(id,300)}
}
export async function saveShare(s){ // only the owner's device ever writes the sharing fields
  if(!DBX||!isMine(s))return;
  delete s._demo;s._owner=ME;saveLocal();renderTop();
  try{
    if(!s._synced||!s._base){s.updatedAt=s.updatedAt||Date.now();const L=toWire(s);await refFor(s).set(fullDoc(s,L));s._base=slim(L);s._synced=true;if(s.id===LIB.currentId)subscribeCurrent()}
    else await refFor(s).set(Object.assign(pickShare(shareOf(s)),{ownerEmail:EMAIL,ownerName:MYNAME}),{merge:true});
    saveLocal();
  }catch(e){toast('Couldn’t save who can use this song. Check your connection and try again.')}
}
export function dropShared(id: string,msg?: string){
  delete LIB.songs[id];if(!Object.keys(LIB.songs).length){const d=blankSong('New riff');LIB.songs[d.id]=d}
  if(id===LIB.currentId){closeSheet();openSong(latestId())}
  saveLocal();if(msg)toast(msg);
}
export function subscribeCurrent(){
  if(UNSUB){try{UNSUB()}catch(e){}UNSUB=null}
  const s=S.song;if(!DBX||!s||!s._synced)return;
  const id=s.id;
  UNSUB=refFor(s).onSnapshot(snap=>{
    if(LIB.currentId!==id||(snap.metadata&&snap.metadata.fromCache&&!snap.metadata.hasPendingWrites))return;
    const cur=LIB.songs[id];if(!cur)return;
    if(snap.exists){mergeRemote(id,snap.data());return}
    if(isMine(cur)||(up[id]&&up[id].busy))return;
    dropShared(id,'That song was deleted by its owner');refreshDir();
  },()=>{const cur=LIB.songs[id];if(cur&&!isMine(cur)&&LIB.currentId===id){dropShared(id,'That song is no longer shared with you');refreshDir()}});
}
export async function refreshDir(){ // songs other people shared with my email address
  if(!DBX||!EMAIL)return;const seen=new Set(),out=[];
  for(const f of ['editors','viewers']){
    try{(await DBX.db.collection('songs').where(f,'array-contains',EMAIL).get()).docs.forEach(d=>{
      const w=d.data()||{};if(seen.has(d.id)||w.owner===ME)return;seen.add(d.id);
      out.push({id:d.id,owner:w.owner||'',name:w.ownerName||w.ownerEmail||'',title:w.title||'Untitled',w});
      const loc=LIB.songs[d.id];if(loc&&d.id!==LIB.currentId)mergeRemote(d.id,w);
    })}catch(e){}
  }
  DIR=out;softSheet();
}
export async function openShared(o){
  if(LIB.songs[o.id]){openSong(o.id);return true}
  try{
    let w=o.w;
    if(!w){const snap=await DBX.db.collection('songs').doc(o.id).get();if(!snap.exists){toast('That song is gone');return false}w=snap.data()}
    const s=fromWire(w,o.id);if(!s){toast('That song couldn’t be opened');return false}
    s._synced=true;s._base=slim(w);LIB.songs[o.id]=s;openSong(o.id);saveLocal();return true;
  }catch(e){toast('You don’t have access to that song with this account');return false}
}
export const linkFor=s=>location.origin+location.pathname+'#song='+s.id;
export async function openFromLink(){
  const m=/[#&]song=([\w-]+)/.exec(location.hash||'');if(!m)return;
  if(!AUTH){toast('Shared songs need sync to be set up on this site');return}
  if(!ME){openSheet('song');toast('Sign in to open the shared song');return}
  if(LIB.currentId===m[1])return;
  if(await openShared({id:m[1]}))closeSheet();
}
export async function syncMine(){ // bring my own songs in line with my account
  const snap=await DBX.db.collection('songs').where('owner','==',ME).get(),remote=new Set();let touched=false;
  snap.docs.forEach(doc=>{
    remote.add(doc.id);const w=doc.data(),loc=LIB.songs[doc.id];
    if(loc){mergeRemote(doc.id,w);return}
    const s=fromWire(w,doc.id);if(!s)return;
    s._synced=true;s._base=slim(w);LIB.songs[doc.id]=s;
  });
  for(const id of Object.keys(LIB.songs)){
    const s=LIB.songs[id];if(s._owner!==ME||remote.has(id))continue;
    if(s._synced){if(Object.keys(LIB.songs).length>1){delete LIB.songs[id];if(id===LIB.currentId)touched=true}}
    else if(!s._demo)queuePush(id,500);
  }
  const cur=LIB.songs[LIB.currentId];
  if(!cur||(cur._demo&&remote.size)){
    if(cur&&cur._demo&&Object.keys(LIB.songs).length>1)delete LIB.songs[cur.id];
    LIB.currentId=latestId();touched=true;
  }
  saveLocal();
  if(touched&&!S.playing)openSong(LIB.currentId);else{renderTop();renderPad();subscribeCurrent()}
}
export async function onUser(u,db){
  if(UNSUB){try{UNSUB()}catch(e){}UNSUB=null}
  if(!u){ME=null;EMAIL='';MYNAME='';DBX=null;DIR=[];S.sync='signedout';renderTop();renderPad();softSheet();if(/[#&]song=/.test(location.hash||'')){if(sheetKind!=='song')openSheet('song');toast('Sign in to open the shared song')}return}
  ME=LASTME=u.uid;EMAIL=(u.email||'').toLowerCase();MYNAME=u.displayName||EMAIL;DBX={db};S.sync='cloud';
  try{localStorage.setItem('chugpad.me',ME)}catch(e){}
  Object.values(LIB.songs).forEach(s=>{if(!s._owner)s._owner=ME});
  try{await syncMine()}catch(e){S.sync='error';subscribeCurrent()}
  softSheet();
  await refreshDir();
  openFromLink();
}
export async function connect(){
  const cfg=window.FIREBASE_CONFIG;
  if(!cfg||!cfg.apiKey||/^(YOUR|PASTE)/i.test(cfg.apiKey)){S.sync='local';if(/[#&]song=/.test(location.hash))toast('Shared songs need sync to be set up on this site');return}
  S.sync='signedout';
  try{
    const fb=FB=window.firebase&&window.firebase.firestore?window.firebase:(await import('./firebase')).default; // window.firebase is a test seam
    if(!fb.apps||!fb.apps.length)fb.initializeApp(cfg);
    AUTH=fb.auth();const db=fb.firestore();
    AUTH.onAuthStateChanged(u=>{onUser(u,db)});
  }catch(e){S.sync='offline'}
}
export function loadLocal(){
  try{const j=JSON.parse(localStorage.getItem(KEY));if(j&&j.songs){for(const id in j.songs){const s=normalize(j.songs[id]);if(s)LIB.songs[s.id]=s}LIB.currentId=j.currentId}}catch(e){}
  if(!Object.keys(LIB.songs).length){const d=demoSong();LIB.songs[d.id]=d;LIB.currentId=d.id}
  if(!LIB.songs[LIB.currentId])LIB.currentId=latestId();
}
export const latestId=()=>Object.values(LIB.songs).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))[0].id;
export function saveFile(name: string,data: BlobPart,type?: string){
  const url=URL.createObjectURL(new Blob([data],{type:type||'application/octet-stream'})),a=document.createElement('a');
  a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}
