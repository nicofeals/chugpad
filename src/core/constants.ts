/* ================= helpers & constants ================= */
export const $=(s,r=document)=>r.querySelector(s);
export const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const clone=o=>JSON.parse(JSON.stringify(o));
export const newId=()=>'s'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
export const NOTE=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const GTR={
  'E standard':[64,59,55,50,45,40],'Eb standard':[63,58,54,49,44,39],'D standard':[62,57,53,48,43,38],
  'Drop D':[64,59,55,50,45,38],'Drop C#':[63,58,54,49,44,37],'Drop C':[62,57,53,48,43,36],
  'C standard':[60,55,51,46,41,36],'Drop B':[61,56,52,47,42,35],'B standard':[59,54,50,45,40,35],'Drop A':[59,54,50,45,40,33],
  '7-string B standard':[64,59,55,50,45,40,35],'7-string Drop A':[64,59,55,50,45,40,33],'7-string Drop G':[62,57,53,48,43,38,31],
  '8-string F# standard':[64,59,55,50,45,40,35,30],'8-string Drop E':[64,59,55,50,45,40,35,28]};
export const BASS={
  'E standard':[43,38,33,28],'Drop D':[43,38,33,26],'D standard':[41,36,31,26],'Drop C':[41,36,31,24],
  'C standard':[39,34,29,24],'Drop B':[40,35,30,23],'5-string B standard':[43,38,33,28,23],'5-string Drop A':[43,38,33,28,21]};
export const TONES={
  highgain:{label:'High gain',hp:130,drive:28,lp:4600,level:.2,prog:30},
  crunch:{label:'Crunch',hp:90,drive:5,lp:5200,level:.3,prog:29},
  clean:{label:'Clean',hp:60,drive:.9,lp:6500,level:.9,prog:27},
  bass:{label:'Clean bass',hp:30,drive:2.2,lp:2200,level:.5,prog:34},
  bassdrive:{label:'Dirty bass',hp:40,drive:9,lp:3000,level:.3,prog:34}};
export const TONES_FOR={guitar:['highgain','crunch','clean'],bass:['bass','bassdrive']};
export const DRUMS=[
  {id:'cr',label:'CR',name:'Crash',midi:49,lv:.5},{id:'ch',label:'CH',name:'China',midi:52,lv:.5},
  {id:'rd',label:'RD',name:'Ride',midi:51,lv:.45},{id:'ho',label:'HO',name:'Open hat',midi:46,lv:.4},
  {id:'hh',label:'HH',name:'Closed hat',midi:42,lv:.4},{id:'t1',label:'T1',name:'High tom',midi:48,lv:.85},
  {id:'t2',label:'T2',name:'Mid tom',midi:45,lv:.85},{id:'ft',label:'FT',name:'Floor tom',midi:41,lv:.9},
  {id:'sn',label:'SN',name:'Snare',midi:38,lv:.9},{id:'kk',label:'KK',name:'Kick',midi:36,lv:1}];
export const LANE=id=>DRUMS.findIndex(d=>d.id===id);
export const GRIDS={2:'8ths',4:'16ths',8:'32nds',3:'8th triplets',6:'16th triplets',12:'16ths + triplets'};
export const TG={h:'h',s:'/',b:'b',v:'~',ph:'◆'};
export const stepsOf=b=>b.n*4*b.g/b.d;
export const rowsOf=tr=>tr.type==='drums'?DRUMS.length:tr.tuning.length;
export const TRI=d=>`<svg viewBox="0 0 12 12" aria-hidden="true"><path d="${{l:'M9.5 1v10L2 6z',r:'M2.5 1v10L10 6z',u:'M1 9.5h10L6 2z',d:'M1 2.5h10L6 10z'}[d]}"/></svg>`;
