/* ── the mark ──────────────────────────────────────────────────────
   Frozen from the logo lab: n5 · w7 · gap4 · corner 95% · tallest 40
   · shortest 6 · V apex 60% · counters 45% · stepped falloff.        */
const LOGO={n:5,w:7,gap:4,r:95,hMax:40,hMin:6,vee:60,counter:45};
const lgNoise=(i,k)=>{const s=Math.sin((i+1)*12.9898+k*78.233)*43758.5453;return s-Math.floor(s)};
const lgStep=t=>1-(0.55*t+0.45*(Math.round(t*2)/2));
function lgFraction(beat,i,k){const t=i/(LOGO.n-1);
  if(beat==='play')return(LOGO.hMin+(LOGO.hMax-LOGO.hMin)*lgStep(t))/LOGO.hMax;
  if(beat==='eq')return(LOGO.hMin+(LOGO.hMax-LOGO.hMin)*lgNoise(i,k))/LOGO.hMax;
  const mid=(LOGO.n-1)/2;if(i===0||i===LOGO.n-1)return 1;
  const d=Math.min(i,LOGO.n-1-i),ramp=mid>1?(d-1)/(mid-1):1;
  return(LOGO.counter+(LOGO.vee-LOGO.counter)*ramp)/100;}
function lgGeom(beat,i,k){const h=+(lgFraction(beat,i,k)*LOGO.hMax).toFixed(2);
  return{h,y:+(beat==='m'?32-LOGO.hMax/2:32-h/2).toFixed(2)}}
const lgX=i=>+((64-(LOGO.n*LOGO.w+(LOGO.n-1)*LOGO.gap))/2+i*(LOGO.w+LOGO.gap)).toFixed(2);
function logoSvg(size,beat='m'){const rx=+(LOGO.w/2*LOGO.r/100).toFixed(2);
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="minitify">`+
    Array.from({length:LOGO.n},(_,i)=>{const g=lgGeom(beat,i,0);
      return `<rect x="${lgX(i)}" y="${g.y}" width="${LOGO.w}" height="${g.h}" rx="${rx}" data-i="${i}"/>`}).join('')+'</svg>';}

/* EQ → PLAY → EQ → M, the timing agreed in the lab */
const LG_SCRIPT=[{b:'eq',k:0,at:0,e:'ease-in-out'},{b:'eq',k:1,at:.07,e:'ease-in-out'},
  {b:'eq',k:2,at:.14,e:'ease-in-out'},{b:'eq',k:3,at:.21,e:'cubic-bezier(.5,0,.2,1)'},
  {b:'play',k:0,at:.36,e:'linear'},{b:'play',k:0,at:.46,e:'cubic-bezier(.55,0,.25,1)'},
  {b:'eq',k:5,at:.58,e:'ease-in-out'},{b:'eq',k:6,at:.65,e:'ease-in-out'},
  {b:'eq',k:7,at:.73,e:'cubic-bezier(.4,0,.18,1)'},{b:'m',k:0,at:.91,e:'cubic-bezier(.2,1.22,.4,1)'},
  {b:'m',k:0,at:1}];
function playLogo(svg,loop){if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;
  svg.querySelectorAll('rect').forEach(el=>{el.getAnimations().forEach(a=>a.cancel());
    const i=Number(el.dataset.i);
    el.animate(LG_SCRIPT.map(s=>{const g=lgGeom(s.b,i,s.k);
      return{height:`${g.h}px`,y:`${g.y}px`,offset:s.at,...(s.e?{easing:s.e}:{})}}),
      {duration:3600,fill:'both',iterations:loop?Infinity:1});});}

/* ── launch ────────────────────────────────────────────────────────
   The same four beats, looping, while the player wakes up.          */
const LAUNCH_STEPS=['Connecting to Spotify','Waking the player','Fetching your library','Ready'];
function launchCard(theme){return `<div class="launch ${theme==='light'?'light':''}">
  ${logoSvg(76)}<div class="launch-status"><b></b><span class="launch-track"></span></div></div>`;}

/* ── terminal ──────────────────────────────────────────────────────
   One line, redrawn in place: the bars settle into the play shape.
   The banner is the M, four rows of blocks, printed once.           */
const BLOCKS=' ▁▂▃▄▅▆▇█';
const lgCell=f=>BLOCKS[Math.min(8,Math.max(1,Math.round(f*8)))];
const lgLine=(beat,k)=>Array.from({length:LOGO.n},(_,i)=>lgCell(lgFraction(beat,i,k))).join(' ');
function lgBanner(){const rows=4;
  return Array.from({length:rows},(_,r)=>Array.from({length:LOGO.n},(_,i)=>
    lgFraction('m',i,0)>r/rows?'█':' ').join(' ')).join('\n');}
const tracks=[{title:'Instant Crush',artist:'Daft Punk',duration:337},{title:'Lose Yourself to Dance',artist:'Daft Punk',duration:353},{title:'Giorgio by Moroder',artist:'Daft Punk',duration:544},{title:'Give Life Back to Music',artist:'Daft Punk',duration:274},{title:'Within',artist:'Daft Punk',duration:228},{title:'Motherboard',artist:'Daft Punk',duration:341}];
const state={index:0,playing:true,liked:new Set([0,2,4]),volume:65,device:'This Mac',elapsed:84};
const time=n=>`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;
const icon=name=>`<span class="icon" style="--symbol:url('assets/${name}.png')" aria-hidden="true"></span>`;
const button=(name,action,label,cls='')=>`<button type="button" class="btn ${cls}" data-action="${action}" aria-label="${label}" title="${label}">${icon(name)}</button>`;
const art=()=>'<img class="art" src="assets/album.svg" width="640" height="640" alt="Random Access Memories album artwork">';
const metadata=(t=tracks[state.index])=>`<div class="metadata" title="${t.title} — ${t.artist}"><span class="track-title">${t.title}</span><span class="artist">${t.artist}</span></div>`;
const transport=(playing,rich=false)=>`<div class="transport ${rich?'rich-transport':''}">${button('backward.fill','prev','Previous track')}${button(playing?'pause.fill':'play.fill','play',playing?'Pause':'Play',rich?'round':'primary')}${button('forward.fill','next','Next track')}</div>`;
let serial=0;
function shell(mode='normal',theme='dark',playing=true,side='right'){const id=++serial;return `<div class="shell ${theme==='dark'?'dark-shell':''}" data-mode="${mode}" data-theme="${theme}" data-playing="${playing}" data-side="${side}" data-vertical="${theme==='light'?'top':'bottom'}" data-id="${id}"><div class="panel-slot">${panel(mode,theme,playing)}</div><button type="button" class="mode-tab" data-action="mode" aria-label="Change player mode" title="Change mode: Mini → Normal → Extended">${icon(mode==='extended'?'arrow.down.right.and.arrow.up.left':'arrow.up.left.and.arrow.down.right')}</button><div class="window-actions">${button('books.vertical','library','Open library','window-orb')}${button('xmark','close','Hide overlay — keep music playing','window-orb')}</div></div>`;}
function panel(mode,theme,playing){if(mode==='mini')return `<div class="panel mini-panel ${theme==='light'?'light':''}">${art()}${metadata()}${transport(playing)}</div>`;
return `<div class="panel ${theme==='light'?'light':''} ${mode==='extended'?'extended-panel':''}"><div class="track-info">${art()}<div class="track-details">${metadata()}<div class="seek"><span class="elapsed">${time(state.elapsed)}</span><input type="range" min="0" max="${tracks[state.index].duration}" value="${state.elapsed}" data-range="seek" aria-label="Seek in current track"><span class="total">${time(tracks[state.index].duration)}</span></div></div></div><div class="bottom-strip">${transport(playing,true)}<div class="playback-modes">${button('shuffle','shuffle','Shuffle off','small')}${button('repeat','repeat','Repeat off','small')}</div><div class="extras">${button(state.liked.has(state.index)?'heart.fill':'heart','like','Like current track','small '+(state.liked.has(state.index)?'active':''))}${button('hifispeaker','device','Choose playback device','small')}<label class="volume" title="Volume">${icon('speaker.wave.2.fill')}<input type="range" min="0" max="100" value="${state.volume}" data-range="volume" aria-label="Playback volume"></label></div></div>${mode==='extended'?queue():''}<div class="popover" hidden><strong>Play on a device</strong>${['This Mac','Living room'].map(d=>`<button class="device-option" data-device="${d}">${icon('hifispeaker')}<span>${d}</span></button>`).join('')}</div></div>`;}
function queue(){return `<div class="queue"><div class="queue-heading"><b>Up next</b><span>From Random Access Memories</span></div>${[1,2,3,4].map(i=>`<button class="queue-row" data-track="${i}"><img src="assets/album.svg" width="640" height="640" alt="Random Access Memories">${metadata(tracks[i])}<span class="duration">${time(tracks[i].duration)}</span></button>`).join('')}</div>`;}
function scene(content,theme,cls=''){return `<div class="scene ${theme==='dark'?'night':''} ${cls}"><div class="desktop-menu"><span>Finder　 File　 Edit　 View</span><span>Mon 9:41</span></div><div class="desktop-terminal"><b>~/projects — zsh</b>❯ minitify play<br>Connected to Spotify.<br>Now playing · Daft Punk<br>❯ _</div>${content}</div>`;}
function frame(content,theme,label,detail,cls=''){return `<figure class="frame">${scene(content,theme,cls)}<figcaption class="caption"><strong>${label}</strong><span>${detail}</span></figcaption></figure>`;}
document.querySelector('#mini-frames').innerHTML=frame(shell('mini','light'),'light','Mini · playing','LIGHT / 320 × 60','small')+frame(shell('mini','dark'),'dark','Mini · playing','DARK / 320 × 60','small');
document.querySelector('#normal-frames').innerHTML=frame(shell('normal','dark',true),'dark','Normal · playing','DARK / 440 × 188')+frame(shell('normal','light',false),'light','Normal · paused','LIGHT / 440 × 188');
document.querySelector('#extended-frames').innerHTML=frame(shell('extended','light').replace('class="shell ', 'class="shell mode-preview '),'light','Extended · queue revealed · hover preview','LIGHT / 440 × 412','tall')+frame(shell('extended','dark'),'dark','Extended · queue revealed','DARK / 440 × 412','tall');
document.querySelector('#edge-frames').innerHTML=frame((shell('mini','dark',true,'right')+shell('mini','dark',true,'left')).replaceAll('class="shell ', 'class="shell mode-preview '),'dark','Panel on left → tab on right. Panel on right → tab on left.','HOVER PREVIEW / TRANSPARENT GUTTERS','edge-demo');
const libraryLists={'Evening rotation':{ids:[0,1,4],note:'For the quieter hours'},'Deep focus':{ids:[2,4,5],note:'Room to settle in'},'On repeat':{ids:[0,1,2,3,4,5],note:'The ones you come back to'}};
function listIds(name){return name==='Liked Songs'?[...state.liked]:libraryLists[name].ids;}
function libraryCover(liked,cls=''){return liked?`<div class="liked-cover ${cls}" role="img" aria-label="Liked Songs collection">${icon('heart.fill')}</div>`:`<img class="collection-cover ${cls}" src="assets/album.svg" width="640" height="640" alt="Random Access Memories collection artwork">`;}
function equaliser(){return '<span class="equaliser" role="img" aria-label="Currently playing"><i></i><i></i><i></i></span>';}
function library(theme='dark',dialog=false){return `<div class="library ${theme==='light'?'light':''}" data-list="Liked Songs" data-selected="${state.index}"><div class="library-top"><div class="library-brand">${logoSvg(22)}<em>mini<i>tify</i></em></div><label class="search">${icon('magnifyingglass')}<input type="search" aria-label="Search tracks" placeholder="Search tracks or artists"></label>${dialog?button('xmark','close-library','Close library','dismiss'):''}</div><div class="library-body"><aside class="sidebar"><button data-list="Liked Songs" class="selected">${libraryCover(true,'sidebar-cover')}<span class="sidebar-label"><b>Liked Songs</b><small class="saved-count"></small></span></button><div class="playlist-divider"></div><h3>YOUR PLAYLISTS</h3>${Object.keys(libraryLists).map(t=>`<button data-list="${t}">${libraryCover(false,'sidebar-cover')}<span class="sidebar-label"><b>${t}</b><small>${libraryLists[t].ids.length} tracks</small></span></button>`).join('')}<div class="sidebar-foot">Your music.<br>Always a little closer.</div></aside><div class="tracks-pane"><div class="collection-header"><div class="header-art"></div><div class="collection-info"><span class="collection-kicker">YOUR COLLECTION</span><h3 class="collection-title"></h3><p class="collection-facts"></p></div></div><div class="table-head"><span></span><span>Title</span><span>Artist</span><span>Time</span><span class="heart-heading" title="Liked">${icon('heart')}</span></div><div class="library-scroll"><div class="track-list"></div><p class="list-end"></p></div><div class="library-now-playing"></div></div></div></div>`;}
document.querySelector('#library-frames').innerHTML=frame(library('dark'),'dark','Library · Liked Songs','DARK / 800 × 500','wide')+frame(library('light'),'light','Library · Liked Songs','LIGHT / 800 × 500','wide');
function renderList(lib){const selection=lib.dataset.list,q=lib.querySelector('input[type=search]').value.toLowerCase(),all=listIds(selection),ids=all.filter(i=>(tracks[i].title+' '+tracks[i].artist).toLowerCase().includes(q));const liked=selection==='Liked Songs';lib.querySelector('.header-art').innerHTML=libraryCover(liked);lib.querySelector('.collection-title').textContent=selection;const duration=all.reduce((sum,i)=>sum+tracks[i].duration,0);lib.querySelector('.collection-facts').textContent=`${all.length} tracks · ${Math.floor(duration/60)} min ${String(duration%60).padStart(2,'0')} sec`;lib.querySelector('.collection-kicker').textContent=liked?'SAVED BY YOU':'YOUR PLAYLIST';lib.style.setProperty('--library-wash',liked?'rgba(74,104,84,.10)':'rgba(42,42,42,.10)');lib.querySelector('.saved-count').textContent=`${state.liked.size} saved tracks`;lib.querySelector('.track-list').innerHTML=ids.length?ids.map(i=>{const t=tracks[i],on=state.liked.has(i),playing=i===state.index;return `<div class="library-track ${playing?'playing':''} ${Number(lib.dataset.selected)===i?'row-selected':''}" data-track="${i}" role="row" aria-selected="${Number(lib.dataset.selected)===i}"><button class="track-play" data-track="${i}" aria-label="Play ${t.title}${playing?', currently playing':''}"><span class="row-art"><img src="assets/album.svg" width="640" height="640" alt="Random Access Memories">${playing?equaliser():''}</span><span class="row-title" title="${t.title}">${t.title}</span></button><span class="artist">${t.artist}</span><span class="duration">${time(t.duration)}</span><button type="button" class="btn row-heart ${on?'active':''}" data-library-like="${i}" aria-pressed="${on}" aria-label="${on?'Remove '+t.title+' from':'Add '+t.title+' to'} Liked Songs" title="${on?'Remove from':'Add to'} Liked Songs">${icon(on?'heart.fill':'heart')}</button></div>`}).join(''):`<div class="library-empty">${icon(liked?'heart':'magnifyingglass')}<strong>${q?'No matching tracks':liked?'Your favourites start here':'This playlist is empty'}</strong><p>${q?'Try another title or artist, or clear your search.':liked?'Choose a playlist and tap a heart to save a track here.':'Add music to this playlist to make it your own.'}</p></div>`;lib.querySelector('.list-end').textContent=ids.length?(q?`${ids.length} matching tracks`:`All ${ids.length} tracks shown · ${liked?'Hearts keep this collection yours.':libraryLists[selection].note}`):'';const t=tracks[state.index];lib.querySelector('.library-now-playing').innerHTML=`<img src="assets/album.svg" width="640" height="640" alt="Random Access Memories"><div><span>${state.playing?'NOW PLAYING':'PAUSED'}</span><strong>${t.title} <small>· ${t.artist}</small></strong></div>${equaliser()}`;lib.querySelector('.library-now-playing .equaliser').classList.toggle('paused',!state.playing);}
function refreshLibraries(){document.querySelectorAll('.library').forEach(renderList)}refreshLibraries();
function setPlaying(sh,playing){sh.dataset.playing=String(playing);const b=sh.querySelector('[data-action=play]');b.innerHTML=icon(playing?'pause.fill':'play.fill');b.setAttribute('aria-label',playing?'Pause':'Play');b.title=playing?'Pause':'Play';}
function selectTrack(i){state.index=i;state.elapsed=0;state.playing=true;document.querySelectorAll('.shell').forEach(sh=>{sh.querySelector('.panel-slot').innerHTML=panel(sh.dataset.mode,sh.dataset.theme,true);sh.dataset.playing='true'});refreshLibraries();}
document.addEventListener('click',e=>{const heart=e.target.closest('[data-library-like]');if(heart){const id=Number(heart.dataset.libraryLike);state.liked.has(id)?state.liked.delete(id):state.liked.add(id);document.querySelectorAll('.shell [data-action=like]').forEach(el=>{const on=state.liked.has(state.index);el.innerHTML=icon(on?'heart.fill':'heart');el.classList.toggle('active',on);el.setAttribute('aria-pressed',String(on))});refreshLibraries();return;}const track=e.target.closest('[data-track]');if(track){const lib=track.closest('.library');if(lib)lib.dataset.selected=track.dataset.track;selectTrack(Number(track.dataset.track));return;}const list=e.target.closest('button[data-list]');if(list){const lib=list.closest('.library');lib.dataset.list=list.dataset.list;lib.querySelectorAll('.sidebar button').forEach(b=>b.classList.toggle('selected',b===list));renderList(lib);return}const device=e.target.closest('[data-device]');if(device){state.device=device.dataset.device;device.closest('.popover').hidden=true;const b=device.closest('.shell').querySelector('[data-action=device]');b.title='Playing on '+state.device;b.setAttribute('aria-label',b.title);return}const b=e.target.closest('[data-action]');if(!b)return;const sh=b.closest('.shell');switch(b.dataset.action){case 'mode':{const modes=['mini','normal','extended'];sh.dataset.mode=modes[(modes.indexOf(sh.dataset.mode)+1)%3];sh.querySelector('.panel-slot').innerHTML=panel(sh.dataset.mode,sh.dataset.theme,sh.dataset.playing==='true');const tab=sh.querySelector('.mode-tab');tab.innerHTML=icon(sh.dataset.mode==='extended'?'arrow.down.right.and.arrow.up.left':'arrow.up.left.and.arrow.down.right');tab.title=sh.dataset.mode==='extended'?'Collapse to Mini':sh.dataset.mode==='mini'?'Expand to Normal':'Expand to Extended';tab.setAttribute('aria-label',tab.title);clampShell(sh);break}case 'play':state.playing=sh.dataset.playing!=='true';setPlaying(sh,state.playing);refreshLibraries();break;case 'prev':selectTrack((state.index+tracks.length-1)%tracks.length);break;case 'next':selectTrack((state.index+1)%tracks.length);break;case 'shuffle':{const active=b.classList.toggle('active');b.setAttribute('aria-pressed',String(active));b.title=active?'Shuffle on':'Shuffle off';break}case 'repeat':{const vals=['off','context','track'];const next=vals[(vals.indexOf(b.dataset.repeat||'off')+1)%3];b.dataset.repeat=next;b.classList.toggle('active',next!=='off');b.innerHTML=icon(next==='track'?'repeat.1':'repeat');b.title='Repeat: '+({off:'off',context:'all',track:'one'}[next]);b.setAttribute('aria-label',b.title);break}case 'like':state.liked.has(state.index)?state.liked.delete(state.index):state.liked.add(state.index);document.querySelectorAll('[data-action=like]').forEach(el=>{const on=state.liked.has(state.index);el.innerHTML=icon(on?'heart.fill':'heart');el.classList.toggle('active',on);el.setAttribute('aria-pressed',String(on))});refreshLibraries();break;case 'device':{const pop=sh.querySelector('.popover');pop.hidden=!pop.hidden;break}case 'close':sh.hidden=true;break;case 'library':{const d=document.querySelector('#library-dialog');d.innerHTML=library(sh.dataset.theme,true);refreshLibraries();d.showModal();break}case 'close-library':document.querySelector('#library-dialog').close();break;}});
document.addEventListener('input',e=>{if(e.target.matches('.search input')){renderList(e.target.closest('.library'));return}if(e.target.dataset.range==='seek'){state.elapsed=Number(e.target.value);e.target.closest('.seek').querySelector('.elapsed').textContent=time(state.elapsed)}if(e.target.dataset.range==='volume'){state.volume=Number(e.target.value);document.querySelectorAll('[data-range=volume]').forEach(v=>v.value=state.volume)}});
// The transparent shell is wider than its material body. Drag its body only.
function clampShell(sh){const scene=sh.closest('.scene'),r=sh.getBoundingClientRect(),s=scene.getBoundingClientRect();let x=Number(sh.dataset.x||0),y=Number(sh.dataset.y||0);if(r.left<s.left+4)x+=s.left+4-r.left;if(r.right>s.right-4)x-=r.right-s.right+4;if(r.top<s.top+28)y+=s.top+28-r.top;if(r.bottom>s.bottom-4)y-=r.bottom-s.bottom+4;sh.dataset.x=x;sh.dataset.y=y;sh.style.transform=`translate(${x}px,${y}px)`;const b=sh.querySelector('.panel').getBoundingClientRect();sh.dataset.side=(b.left+b.width/2)<(s.left+s.width/2)?'right':'left';sh.dataset.vertical=(b.top+b.height/2)<(s.top+s.height/2)?'bottom':'top';}
let drag=null;document.addEventListener('pointerdown',e=>{const p=e.target.closest('.panel');if(!p||e.target.closest('button,input,label,.queue,.popover'))return;const sh=p.closest('.shell');drag={sh,x:e.clientX,y:e.clientY,ox:Number(sh.dataset.x||0),oy:Number(sh.dataset.y||0)};sh.setPointerCapture(e.pointerId)});document.addEventListener('pointermove',e=>{if(!drag)return;let {sh,x,y,ox,oy}=drag;sh.dataset.x=ox+e.clientX-x;sh.dataset.y=oy+e.clientY-y;sh.style.transform=`translate(${sh.dataset.x}px,${sh.dataset.y}px)`;clampShell(sh)});document.addEventListener('pointerup',()=>drag=null);document.addEventListener('pointercancel',()=>drag=null);


/* ── launch frames ─────────────────────────────────────────────── */
function terminalShot(){return `<div class="term"><div class="term-bar"><i></i><i></i><i></i>
  <span>~/projects — zsh</span></div><pre class="term-body"><span class="term-cmd">❯ minitify play</span>
<span class="term-banner">${lgBanner()}</span><span class="term-word">minitify</span>
<span class="term-load"><b class="term-eq"></b> <span class="term-step"></span></span></pre></div>`;}

document.querySelector('#launch-frames').innerHTML =
  frame(launchCard('dark'),'dark','Launch · floating','DARK / 240 × 196','small') +
  `<figure class="frame"><div class="term-wrap">${terminalShot()}</div>
   <figcaption class="caption"><strong>Launch · terminal</strong><span>80 COLUMNS</span></figcaption></figure>`;

/* both surfaces run the same four beats on the same 3.6 s clock */
(function runLaunch(){
  const cards = [...document.querySelectorAll('.launch .logo')];
  cards.forEach(svg => playLogo(svg, true));

  const step = document.querySelector('.term-step');
  const eq   = document.querySelector('.term-eq');
  const label= document.querySelector('.launch-status b');
  const track= document.querySelector('.launch-track');
  const FRAMES = [...Array(8).keys()].map(k => lgLine('eq', k));
  const SETTLED = lgLine('play', 0);
  const LAST = LAUNCH_STEPS.length - 1;
  const END = LAST * 18;                           // the tick "Ready" lands on
  const paint = tick => {
    const line = tick < 30 ? FRAMES[tick % 8] : SETTLED;
    if (eq) eq.textContent = line;
    const i = Math.min(LAST, Math.floor(tick / 18));
    const done = i === LAST;
    if (step)  step.textContent = LAUNCH_STEPS[i] + (done ? '' : '…');
    if (label) label.textContent = LAUNCH_STEPS[i];
    if (track) track.textContent = done ? 'Instant Crush · Daft Punk' : '';
  };

  // Reduce Motion gets the settled line and the final label straight away —
  // a loading line cycling forever is exactly what the setting is for.
  if (matchMedia('(prefers-reduced-motion:reduce)').matches) {
    paint(END);
  } else {
    let tick = 0;
    const timer = setInterval(() => {
      paint(tick);
      // Stop once "Ready" is up: the line settles instead of cycling back
      // through the meter frames behind a label that has stopped changing.
      if (tick >= END) clearInterval(timer);
      tick++;
    }, 100);
  }
})();
