import type { BarSig, Cell, Track } from '../core/types';
import { normalize } from '../core/state';
import { ME, pickShare } from './cloud';

/* ================= storage, sync and sharing (Firebase) ================= */
// Every synced song is one document in the "songs" collection. The document carries the tab itself plus who may
// use it: owner (account id), viewers and editors (email addresses), and anyone ('none' | 'view' | 'edit') for
// people who open the song's link. firestore.rules enforces all of it on the server.
export const rid=()=>Math.random().toString(36).slice(2,8);
export function ensureIds(s){
  const seen=new Set();
  s.bars.forEach(b=>{if(!b.id||seen.has(b.id))b.id='b'+rid();seen.add(b.id)});
  s.tracks.forEach(t=>{if(!t.id||seen.has(t.id))t.id='t'+rid();seen.add(t.id)});
}
// one bar of one track travels as a short string, so two people editing different bars never overwrite each other
export const TC={x:'x',h:'h',s:'s',b:'b',v:'v',ph:'q'},TD={x:'x',h:'h',s:'s',b:'b',v:'v',q:'ph'};
export function encCells(c,drum){
  const a=[];for(const key in c){const p=key.split('_');a.push([+p[0],p[1]==='R'?-1:+p[1],c[key]])}
  a.sort((x,y)=>x[0]-y[0]||x[1]-y[1]);
  return a.map(([s,k,n])=>k<0?s+'.R':drum?s+'.'+k+'.'+(n.v||2):s+'.'+k+'.'+n.f+(n.pm?'p':'')+(TC[n.t]||'')).join(',');
}
export function decCells(str,drum){
  const c={};if(!str||typeof str!=='string')return c;
  str.split(',').forEach(e=>{
    const p=e.split('.');if(p[1]==='R'){c[p[0]+'_R']={r:1};return}
    if(drum){c[p[0]+'_'+p[1]]={v:+p[2]||2};return}
    const m=/^(\d+)(p?)([xhsbvq]?)$/.exec(p[2]||'');if(!m)return;
    const n: Cell={f:+m[1]};if(m[2])n.pm=1;if(m[3])n.t=TD[m[3]];c[p[0]+'_'+p[1]]=n;
  });
  return c;
}
export function toWire(s){
  ensureIds(s);
  const w={v:2,title:s.title,tempo:s.tempo,updatedAt:s.updatedAt||0,owner:s._owner||ME||'',
    bars:JSON.stringify(s.bars.map(b=>{const o: any={id:b.id,n:b.n,d:b.d,g:b.g};if(b.t)o.t=b.t;return o})),
    tracks:JSON.stringify(s.tracks.map(t=>{const o: any={id:t.id,name:t.name,type:t.type,vol:t.vol,pan:t.pan};if(t.type!=='drums'){o.tun=t.tun||'Custom';o.tuning=t.tuning;o.tone=t.tone;o.ring=!!t.ring}return o})),cells:{}};
  s.tracks.forEach(t=>t.bars.forEach((c,i)=>{const e=encCells(c,t.type==='drums');if(e)w.cells[t.id+'_'+s.bars[i].id]=e}));
  return w;
}
export function fromWire(w,id){
  if(!w||w.v!==2)return null;
  try{
    const bars=JSON.parse(w.bars),tracks=JSON.parse(w.tracks),cells=w.cells||{};
    tracks.forEach(t=>{t.bars=bars.map(b=>decCells(cells[t.id+'_'+b.id],t.type==='drums'))});
    const s=normalize({id,title:w.title,tempo:w.tempo,updatedAt:w.updatedAt,bars,tracks});
    if(s){s._owner=w.owner||'';s._share=pickShare(w);s._ownerName=w.ownerName||''}
    return s;
  }catch(e){return null}
}
export const slim=w=>({v:2,title:w.title,tempo:w.tempo,updatedAt:w.updatedAt||0,owner:w.owner||'',bars:w.bars,tracks:w.tracks,cells:Object.fromEntries(Object.entries(w.cells||{}).filter(e=>e[1]))});
export function diffWire(B,L){
  const p: any={};let any=false;
  for(const k of ['title','tempo','bars','tracks'])if(L[k]!==B[k]){p[k]=L[k];any=true}
  const cells={},bc=B.cells||{};
  for(const k in L.cells)if(L.cells[k]!==bc[k]){cells[k]=L.cells[k];any=true}
  for(const k in bc)if(bc[k]&&!L.cells[k]){cells[k]='';any=true}
  if(!any)return null;
  if(Object.keys(cells).length)p.cells=cells;
  p.updatedAt=L.updatedAt;p.by=ME||'';return p;
}
