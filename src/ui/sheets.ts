import { P } from '../audio/playback';
import { $, BASS, GRIDS, GTR, TONES, TONES_FOR, esc } from '../core/constants';
import { LIB, S, T, tempoAt } from '../core/state';
import { DIR, EMAIL, ME, canEdit, isMine, isShared, shareOf } from '../sync/cloud';
import { REC, recCancel } from './capture';

/* ================= sheets ================= */
export let sheetKind=null,sheetArg=null;
export function openSheet(kind: string,arg?: any){$('#toast').classList.remove('show');sheetKind=kind;sheetArg=arg;$('#card').innerHTML=SHEETS[kind](arg);$('#sheet').hidden=false}
export function refreshSheet(){if(sheetKind){const c=$('#card'),y=c.scrollTop;c.innerHTML=SHEETS[sheetKind](sheetArg);c.scrollTop=y}}
export function closeSheet(){if(REC.phase!=='idle')recCancel();$('#sheet').hidden=true;sheetKind=null}
export const head=t=>`<h2>${t}<button data-act="close">Done</button></h2>`;
export const SHEETS={
  bar(i){
    const bar=S.song.bars[i],tr=T(),others=S.song.tracks.map((t,k)=>({t,k})).filter(o=>o.k!==S.ti&&o.t.type!=='drums');
    const verb=tr.type==='drums'?'Put a kick under every note of':tr.type==='bass'?'Follow':'Copy';
    const ns=Array.from({length:16},(_,k)=>k+1);
    return head(`Bar ${i+1}`)+`
<div class="btns"><button class="b${S.scope==='all'?' on':''}" data-act="scope" data-s="all">All tracks</button><button class="b${S.scope==='track'?' on':''}" data-act="scope" data-s="track">Only ${esc(tr.name)}</button></div>
<div class="btns" style="margin-top:6px"><button class="b" data-act="copy">Copy</button>${S.clip?`<button class="b" data-act="paste">Paste here</button><button class="b" data-act="pasteafter">Paste after</button>`:''}<button class="b" data-act="clear">Clear</button></div>
<h3>Repeat, inserted right after this bar</h3>
<div class="btns"><button class="b" data-act="rep" data-n="1">This bar</button>${i>=1?`<button class="b" data-act="rep" data-n="2">Bars ${i}–${i+1}</button>`:''}${i>=3?`<button class="b" data-act="rep" data-n="4">Bars ${i-2}–${i+1}</button>`:''}</div>
${others.length?`<h3>Fill ${esc(tr.name)} from another track</h3><div class="btns">${others.map(o=>`<button class="b" data-act="fill" data-k="${o.k}">${verb} ${esc(o.t.name)}</button>`).join('')}</div>`:''}
${tr.type==='drums'?`<div class="btns" style="margin-top:6px"><button class="b" data-act="patterns">Drum patterns</button></div>`:''}
<h3>Loop</h3>
<div class="btns"><button class="b" data-act="loopbar">Loop this bar</button><button class="b" data-act="loopa">Loop starts here</button><button class="b" data-act="loopb">Loop ends here</button>${S.loop.on?`<button class="b" data-act="loopoff">Loop off</button>`:''}</div>
<h3>Time signature and grid</h3>
<div class="fld"><select id="sigN" aria-label="Beats">${ns.map(n=>`<option${n===bar.n?' selected':''}>${n}</option>`).join('')}</select>
<select id="sigD" aria-label="Beat unit">${[4,8,16].map(d=>`<option${d===bar.d?' selected':''}>${d}</option>`).join('')}</select>
<select id="sigG" aria-label="Grid">${Object.keys(GRIDS).map(g=>`<option value="${g}"${+g===bar.g?' selected':''}>${GRIDS[g]}</option>`).join('')}</select></div>
<div class="btns"><button class="b" data-act="sig" data-all="0">Apply to this bar</button><button class="b" data-act="sig" data-all="1">Apply to every bar</button></div>
<h3>Tempo from this bar on</h3>
<div class="fld"><input type="number" inputmode="numeric" id="barT" min="30" max="320" value="${tempoAt(S.song,i)}" aria-label="Tempo in bpm"><button class="b" data-act="bartempo">Set tempo here</button>${i>0&&bar.t?`<button class="b" data-act="bartempooff">Remove change</button>`:''}</div>
<h3>Structure</h3>
<div class="btns"><button class="b" data-act="insert">Add empty bar after</button><button class="b warn" data-act="delbar">Delete bar</button></div>`;
  },
  patterns(){
    const P=[['groove','Straight groove','Kick on 1 and 3, snare on 2 and 4'],['double','Double kick','Kick on every 16th, snare on 2 and 4'],['gallop','Gallop','Kicks in the classic gallop rhythm'],['thrash','Thrash beat','Kick and snare trading 8ths'],['blast','Blast beat','Kick and snare trading 16ths'],['half','Half-time breakdown','China on the beat, snare on 3'],['fill','Tom fill','Snare down to floor tom across the bar']];
    return head(`Drum patterns for bar ${S.cur.bar+1}`)+`<div class="btns">${P.map(p=>`<button class="b wide" data-act="pattern" data-p="${p[0]}">${p[1]}<small>${p[2]}</small></button>`).join('')}</div><p class="note">A pattern replaces the drums in this bar. Use Repeat in the bar menu to spread it.</p>`;
  },
  mixer(){
    return head('Tracks &amp; sound')+S.song.tracks.map((t,i)=>{
      const tun=t.type==='bass'?BASS:GTR;
      return `<div class="trk" style="--c:var(--t${i%4})">
<div class="fld"><input type="text" value="${esc(t.name)}" data-in="tname" data-i="${i}" aria-label="Track name" maxlength="24">
<button class="b${t.mute?' on':''}" data-act="mute" data-i="${i}">Mute</button><button class="b${t.solo?' on':''}" data-act="solo" data-i="${i}">Solo</button></div>
<label class="fld"><span>Volume</span><input type="range" min="0" max="100" value="${Math.round(t.vol*100)}" data-in="vol" data-i="${i}"></label>
<label class="fld"><span>Left / right</span><input type="range" min="-100" max="100" value="${Math.round(t.pan*100)}" data-in="pan" data-i="${i}"></label>
${t.type==='drums'?'':`<label class="fld"><span>Tuning</span><select data-in="tuning" data-i="${i}">${tun[t.tun]?'':`<option selected>${esc(t.tun||'Custom')}</option>`}${Object.keys(tun).map(n=>`<option${n===t.tun?' selected':''}>${n}</option>`).join('')}</select></label>
<label class="fld"><span>Sound</span><select data-in="tone" data-i="${i}">${TONES_FOR[t.type].map(k=>`<option value="${k}"${k===t.tone?' selected':''}>${TONES[k].label}</option>`).join('')}</select></label>
<label class="chk"><input type="checkbox" data-in="ring" data-i="${i}"${t.ring?' checked':''}>Let notes ring across strings (for clean arpeggios)</label>`}
${S.song.tracks.length>1?`<button class="b warn" data-act="deltrack" data-i="${i}">Remove track</button>`:''}</div>`}).join('')+
`<h3>Add a track</h3><div class="btns"><button class="b" data-act="addtrack" data-t="guitar">Guitar</button><button class="b" data-act="addtrack" data-t="bass">Bass</button><button class="b" data-act="addtrack" data-t="drums">Drums</button></div>`;
  },
  song(){
    const cur=S.song,ro=!canEdit(cur),mineCur=isMine(cur),dis=ro?' disabled':'',sh=shareOf(cur);
    const byDate=(a,b)=>(b.updatedAt||0)-(a.updatedAt||0);
    const local=Object.values(LIB.songs).sort(byDate),mine=local.filter(isMine),inDir=new Set(DIR.map(o=>o.id));
    const others=DIR.concat(local.filter(s=>!isMine(s)&&!inDir.has(s.id)).map(s=>({id:s.id,name:s._ownerName||'',title:s.title})));
    const st={cloud:'Your songs sync to your account, so they follow you from phone to computer.',local:'Songs are saved in this browser on this device. Sync and sharing aren’t set up on this site yet: see the README.',signedout:'Songs are saved in this browser on this device until you sign in.',offline:'Sync couldn’t load. Songs are safe on this device.',error:'Couldn’t reach your account just now. Songs are safe on this device and will upload on the next change.',big:'This song is too long to sync, so it stays on this device only.'}[S.sync];
    const people=sh.editors.map(e=>[e,'editor']).concat(sh.viewers.map(e=>[e,'viewer']));
    let share='';
    if(S.sync==='local'||S.sync==='offline')share='';
    else if(!ME)share=`<h3>Sync and sharing</h3><div class="btns"><button class="b on" data-act="signin">Sign in with Google</button></div><p class="note">Sign in to sync your songs across devices and share them with other people.</p>`;
    else if(!mineCur)share=`<h3>Who can use this song</h3><p class="note" style="margin-top:0">Shared by ${esc(cur._ownerName||'someone')}. ${ro?'You can read and play it.':'You can edit it, and your changes show up for everyone.'}</p><div class="btns"><button class="b" data-act="dupsong">Make my own copy</button></div>`;
    else share=`<h3>Who can use this song</h3>
${people.map(p=>`<div class="who"><span>${esc(p[0])}</span><button class="b" data-act="role" data-e="${esc(p[0])}">${p[1]==='editor'?'Can edit':'Can view'}</button><button class="b warn" data-act="unshare" data-e="${esc(p[0])}">Remove</button></div>`).join('')}
<div class="fld"><input type="email" id="shareEmail" placeholder="Their Google email" autocomplete="off" autocapitalize="off"></div>
<div class="btns"><button class="b" data-act="addperson" data-r="viewers">Add as viewer</button><button class="b" data-act="addperson" data-r="editors">Add as editor</button></div>
<div class="fld" style="margin-top:12px"><span>Anyone with the link</span>${[['none','No'],['view','Can view'],['edit','Can edit']].map(o=>`<button class="b${sh.anyone===o[0]?' on':''}" data-act="anyone" data-v="${o[0]}">${o[1]}</button>`).join('')}</div>
<div class="btns"><button class="b" data-act="copylink">Copy link to this song</button></div>
<p class="note">People you add find the song in their Song menu after signing in with that Google account. Link access also needs a sign-in.</p>`;
    return head('Song')+`
<label class="fld"><span>Title</span><input type="text" value="${esc(cur.title)}" data-in="title" maxlength="60"${dis}></label>
<div class="fld"><span>${cur.bars.some((b,i)=>i&&b.t)?'Start tempo':'Tempo'}</span><button class="b" data-act="tempo" data-d="-5">−5</button><input type="number" inputmode="numeric" min="30" max="320" value="${cur.tempo}" data-in="tempo" aria-label="Tempo in bpm"${dis}><button class="b" data-act="tempo" data-d="5">+5</button><button class="b" data-act="tap">Tap</button></div>
<div class="fld"><span>Play at</span>${[.5,.75,1].map(v=>`<button class="b${S.speed===v?' on':''}" data-act="speed" data-v="${v}">${v*100}%</button>`).join('')}</div>
${share}
<h3>Your songs</h3>
${mine.map(s=>`<div class="songrow"><button class="b${s.id===LIB.currentId?' on':''}" data-act="open" data-id="${s.id}">${esc(s.title)}<small>${s.bars.length} bars, ${s.tempo} bpm${isShared(s)?', shared':''}</small></button>${local.length>1?`<button class="b warn" data-act="delsong" data-id="${s.id}">Delete</button>`:''}</div>`).join('')}
<div class="btns"><button class="b" data-act="newsong">New song</button><button class="b" data-act="dupsong">Duplicate this song</button></div>
${others.length?`<h3>Shared with you</h3>${others.map(o=>{const c=LIB.songs[o.id],ed=o.w?(o.w.anyone==='edit'||(o.w.editors||[]).includes(EMAIL)):c?canEdit(c):false;return `<div class="songrow"><button class="b${o.id===LIB.currentId?' on':''}" data-act="openshared" data-id="${o.id}">${esc(o.title)}<small>From ${esc(o.name||'someone')}, ${ed?'you can edit':'view only'}</small></button>${c&&!inDir.has(o.id)?`<button class="b warn" data-act="forget" data-id="${o.id}">Remove</button>`:''}</div>`}).join('')}`:''}
<p class="note">${st}${ME?` Signed in as ${esc(EMAIL)}.`:''}</p>
${ME?`<div class="btns"><button class="b" data-act="signout">Sign out</button></div>`:''}
<h3>Guitar Pro and other apps</h3>
<div class="btns"><label class="b wide">Open a Guitar Pro file<input type="file" id="gpfile" hidden></label>
<button class="b" data-act="dlgp">Download .gp<small>Guitar Pro 7 and 8</small></button><button class="b" data-act="dlmid">Download MIDI<small>Any DAW</small></button>
<button class="b" data-act="showtab">Show text tab</button><button class="b" data-act="showjson">Show project code</button><button class="b" data-act="import">Import project code</button></div>
<p class="note kbd">Keyboard: digits enter frets (type 1 then 2 quickly for 12), arrows move, Space plays, P palm mute, X H / B V for effects, R rest, Tab next track, Ctrl or ⌘ Z undo.</p>`;
  },
  info(a){return head(a.title)+a.lines.map(l=>`<p class="note" style="color:var(--ink);font-size:15px">${esc(l)}</p>`).join('')},
  capture(){
    const tr=T(),drum=tr.type==='drums',busy=REC.phase!=='idle';
    if(drum&&REC.mode==='hum')REC.mode='tap';
    const pads=drum?[['Kick',''],['Snare','']]:[['Chug','Muted open low string'],['Open',['One note','Power chord','Power chord + octave'][S.chord]]];
    const idle=REC.msg||(REC.mode==='tap'?'Try the pads, then start. You tap along to a click.':'Start, wait for the count-in, then hum the riff with a “da” on each note.');
    return head('Capture a riff')+`
<div class="btns"><button class="b${REC.mode==='tap'?' on':''}" data-act="recmode" data-m="tap">Tap the rhythm</button>${drum?'':`<button class="b${REC.mode==='hum'?' on':''}" data-act="recmode" data-m="hum">Hum it</button>`}</div>
<div class="fld" style="margin-top:8px"><span>Length</span>${[1,2,4].map(n=>`<button class="b${REC.bars===n?' on':''}" data-act="recbars" data-n="${n}">${n} bar${n>1?'s':''}</button>`).join('')}</div>
<div id="recbox" class="${REC.phase}"><div id="recmsg">${busy?'Get ready':esc(idle)}</div>
${REC.mode==='tap'?`<div class="pads">${pads.map((p,k)=>`<button class="padb" data-pad="${k}">${p[0]}<small>${p[1]}</small></button>`).join('')}</div>`:''}</div>
<div class="btns"><button class="b wide${busy?' warn':' on'}" data-act="${busy?'reccancel':'recstart'}">${busy?'Cancel':'Start with a one-bar count-in'}</button></div>
<p class="note">Lands on ${esc(tr.name)} from bar ${S.cur.bar+1} at ${tempoAt(S.song,S.cur.bar)} bpm and replaces what’s in those bars. ${REC.mode==='hum'?'Your lowest note becomes the open low string and the other notes follow by interval. Turn PM on first if you want them palm-muted.':'Notes snap to the grid of each bar.'}</p>`;
  },
  text(a){
    return head(a.title)+`<textarea id="txt" ${a.edit?'placeholder="Paste project code here"':'readonly'}>${esc(a.text||'')}</textarea>
<div class="btns" style="margin-top:8px">${a.edit?`<button class="b" data-act="doimport">Import as a new song</button>`:`<button class="b" data-act="copytext">Copy</button>`}<button class="b" data-act="song">Back</button></div>`;
  }
};
