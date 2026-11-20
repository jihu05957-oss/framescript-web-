'use strict';
(function(){
  const oldUnload=unload,oldStart=start,oldLayout=layout,oldFocus=focus;
  const linkInput=$('link-input'),panel=$('link-panel'),message=$('link-message');
  const ytHosts=new Set(['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtube-nocookie.com','www.youtube-nocookie.com','youtu.be','www.youtu.be']);
  function parseLink(text){
    let u;try{u=new URL(text.trim())}catch(_){throw Error('주소 형식이 올바르지 않습니다.')}
    if(u.protocol!=='https:'||u.username||u.password)throw Error('HTTPS 영상 주소를 입력하세요.');
    const host=u.hostname.toLowerCase(),p=u.pathname.split('/').filter(Boolean);
    if(ytHosts.has(host)){
      const id=host==='youtu.be'||host==='www.youtu.be'?p[0]:p[0]==='watch'?u.searchParams.get('v'):['shorts','live','embed','v'].includes(p[0])?p[1]:null;
      if(u.port||!id||!/^[A-Za-z0-9_-]{11}$/.test(id))throw Error('유튜브 개별 영상 주소를 입력하세요.');
      return {kind:'youtube',id,url:'https://www.youtube.com/watch?v='+id};
    }
    if(!/\.(mp4|m4v|webm|mov|ogv|ogg)$/i.test(u.pathname))throw Error('일반 웹페이지가 아닌 MP4·WebM 등의 직접 영상 주소가 필요합니다.');
    return {kind:'direct',url:u.href};
  }
  const native=new Map(slots.map(s=>[s,s.v]));let apiPromise=null;
  let cropMode=true;
  const cropButton=document.createElement('button');cropButton.id='yt-crop';cropButton.className='active';cropButton.textContent='유튜브 크롭 ON';cropButton.setAttribute('aria-pressed','true');$('fit').after(cropButton);
  const css=document.createElement('style');css.textContent='.linkpane{overflow:hidden}.linkbar select{min-height:25px;padding:2px;font-size:11px;max-width:80px}.linkpane iframe{max-width:none;max-height:none}';document.head.append(css);
  function sizeFrame(r){if(!r.frame)return;const b=r.pane.getBoundingClientRect();if(!b.width||!b.height)return;const f=r.frame;const use=cropMode&&stage.classList.contains('cover')&&r.crop>0; if(!use){Object.assign(f.style,{width:'100%',height:'100%',left:'0',top:'0',transform:'none'});return}const ratio=r.crop;const h=Math.max(b.height,b.width/ratio),w=h*16/9;const baseH=Math.max(200,h),baseW=baseH*16/9;Object.assign(f.style,{width:baseW+'px',height:baseH+'px',left:'50%',top:'50%',transform:'translate(-50%,-50%) scale('+h/baseH+')'});}
  cropButton.onclick=()=>{cropMode=!cropMode;cropButton.textContent='유튜브 크롭 '+(cropMode?'ON':'OFF');cropButton.classList.toggle('active',cropMode);cropButton.setAttribute('aria-pressed',String(cropMode));layout();slots.forEach(s=>{if(s.remote)resizeRemote(s.remote)})};
  $('fit').addEventListener('click',()=>slots.forEach(s=>{if(s.remote)resizeRemote(s.remote)}));
  function api(){
    if(window.YT&&typeof YT.Player==='function')return Promise.resolve(YT);
    if(apiPromise)return apiPromise;
    apiPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';script.async=true;
      const timer=setTimeout(()=>reject(Error('유튜브 API 연결 시간 초과')),15000);
      script.onerror=()=>{clearTimeout(timer);reject(Error('유튜브 API 연결 실패'))};
      window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve(YT)};
      document.head.append(script);
    }).catch(e=>{apiPromise=null;throw e});return apiPromise;
  }
  function call(r,method,fallback,...args){try{return r.player&&r.ready&&typeof r.player[method]==='function'?r.player[method](...args):fallback}catch(_){return fallback}}
  function refresh(){
    const has=slots.slice(0,count).some((s,i)=>s.remote&&(solo<0||solo===i));
    if(has&&solo<0&&!cropMode){
      const w=stage.clientWidth||innerWidth,h=stage.clientHeight||innerHeight;
      const extra=document.body.classList.contains('theater')?0:32;
      let best=null;
      for(let cols=1;cols<=count;cols++){
        const rows=Math.ceil(count/cols),tw=w/cols,th=h/rows-extra;
        if(tw<200||th<200)continue;
        const score=Math.abs(Math.log(tw/th/(9/16)))+0.12*(cols*rows-count);
        if(!best||score<best.score)best={cols,rows,score};
      }
      if(best){stage.style.setProperty('--cols',best.cols);stage.style.setProperty('--rows',best.rows)}
    }
    document.body.classList.toggle('has-youtube',has);
    if(has&&solo<0&&innerWidth<400&&count<=3){stage.style.setProperty('--cols',1);stage.style.setProperty('--rows',count)}
  }
  function release(r){r.generation++;r.playBtn.disabled=true;r.playBtn.textContent='▶';if(r.ready){r.at=call(r,'getCurrentTime',r.at);r.muted=call(r,'isMuted',r.muted)}r.ready=false;try{r.player?.destroy()}catch(_){}r.player=null;r.frame?.remove();r.frame=null}
  function resizeRemote(r){
    if(r.closed)return;const box=r.pane.getBoundingClientRect();
    if(!box.width||!box.height||((!cropMode||!stage.classList.contains('cover')||!r.crop)&&(box.width<200||box.height<200))){if(r.frame)release(r);r.small.hidden=false;return}
    r.small.hidden=true;if(r.frame){sizeFrame(r);return;}
    const generation=++r.generation,iframe=document.createElement('iframe');
    const query=new URLSearchParams({enablejsapi:'1',origin:location.origin,playsinline:'1',controls:'1',autoplay:'0',loop:'1',playlist:r.spec.id,rel:'0'});
    if(r.at>0)query.set('start',String(Math.floor(r.at)));
    iframe.src='https://www.youtube.com/embed/'+r.spec.id+'?'+query.toString();iframe.title='YouTube 동영상';iframe.allow='autoplay; encrypted-media; fullscreen; picture-in-picture';iframe.allowFullscreen=true;iframe.referrerPolicy='strict-origin-when-cross-origin';r.frame=iframe;r.pane.append(iframe);sizeFrame(r);
    api().then(Y=>{if(r.closed||r.generation!==generation||!iframe.isConnected)return;r.player=new Y.Player(iframe,{events:{onReady:ev=>{if(r.closed||r.generation!==generation)return;r.player=ev.target;r.frame=ev.target.getIframe?.()||r.frame;sizeFrame(r);r.ready=true;r.playBtn.disabled=false;call(r,r.muted?'mute':'unMute',null);r.note.textContent='YouTube';sync()},onStateChange:ev=>{if(!r.closed&&r.generation===generation){r.playBtn.textContent=ev.data===1?'Ⅱ':'▶';sync()}},onError:ev=>{if(!r.closed&&r.generation===generation){r.errorCode=ev.data;r.note.textContent='외부 재생 오류 ('+ev.data+')';sync()}}}})}).catch(()=>{if(!r.closed&&r.generation===generation)r.note.textContent='YouTube · 자체 조작 사용'});
  }
  function destroy(s){const r=s.remote;if(!r)return;r.closed=true;r.observer.disconnect();release(r);r.bar.remove();r.pane.remove();s.remote=null;s.v=native.get(s);s.tile.classList.remove('link-youtube');s.v.hidden=false}
  unload=function(s){destroy(s);oldUnload(s);oldLayout();refresh()};
  start=async function(s,quiet=false){if(s.remote){if(!quiet&&!s.tile.hidden){s.remote.note.textContent='플레이어에서 ▶를 눌러 주세요';}return}return oldStart(s,quiet)};
  layout=function(){oldLayout();refresh()};
  focus=function(i){oldFocus(i);layout()};
  function youtube(s,spec){
    unload(s);const i=slots.indexOf(s);const bar=document.createElement('div');bar.className='linkbar';const note=document.createElement('span');note.textContent='YouTube';bar.append(note);
    const playBtn=action(bar,'▶','유튜브 재생 또는 정지',()=>{if(!r.ready)return;if(call(r,'getPlayerState',-1)===1)call(r,'pauseVideo',null);else call(r,'playVideo',null)});playBtn.disabled=true;
    action(bar,'⛶','이 영상 확대 또는 복귀',()=>focus(i));action(bar,'×','이 영상 제거',()=>{unload(s);if(solo===i)focus(-1)});
    const preset=document.createElement('select');preset.setAttribute('aria-label','유튜브 영상 영역 비율');for(const [v,label] of [['0','원본'],['0.5625','9:16'],['0.75','3:4'],['1','1:1'],['1.333333','4:3'],['1.777778','16:9']]){const o=document.createElement('option');o.value=v;o.textContent=label;preset.append(o)}preset.value='0.5625';bar.append(preset);preset.onchange=()=>{r.crop=Number(preset.value);resizeRemote(r)};
    const pane=document.createElement('div');pane.className='linkpane';const small=document.createElement('button');small.className='linksmall';small.textContent='YouTube · 화면을 확대해 재생';small.onclick=()=>{if(solo!==i)focus(i)};pane.append(small);s.tile.append(bar,pane);
    const r={spec,bar,note,pane,small,playBtn,crop:0.5625,errorCode:null,closed:false,ready:false,player:null,frame:null,generation:0,muted:true,at:0};s.remote=r;s.url=spec.url;s.name.textContent='YouTube';s.tile.classList.add('loaded','link-youtube');native.get(s).hidden=true;
    s.v={get muted(){return call(r,'isMuted',r.muted)},set muted(v){r.muted=!!v;call(r,r.muted?'mute':'unMute',null)},get paused(){return call(r,'getPlayerState',-1)!==1},get duration(){return call(r,'getDuration',0)},get currentTime(){return call(r,'getCurrentTime',r.at)},set currentTime(v){r.at=v;call(r,'seekTo',null,v,true)},pause(){call(r,'pauseVideo',null)},play(){return Promise.resolve()}};
    r.observer=new ResizeObserver(()=>resizeRemote(r));r.observer.observe(pane);layout();sync();
  }
  function direct(s,spec){unload(s);s.url=spec.url;s.name.textContent=new URL(spec.url).hostname;s.name.title=s.name.textContent;s.tile.classList.add('loaded');s.v.muted=true;s.v.loop=true;s.v.src=spec.url;s.v.load();auto=true;start(s,true);sync()}
  function addLinks(){
    const lines=linkInput.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);let n=0,errors=[];const before=slots.filter(s=>s.url).length;
    for(const line of lines){let spec;try{spec=parseLink(line)}catch(e){errors.push(e.message);continue}const i=slots.findIndex(s=>!s.url);if(i<0){errors.push('최대 30개까지 추가할 수 있습니다.');break}changeCount(Math.max(count,i+1));if(spec.kind==='youtube')youtube(slots[i],spec);else direct(slots[i],spec);n++}
    if(before===0&&n>0&&n<4&&slots.some(s=>s.remote))changeCount(n);
    message.textContent=(n?n+'개 추가. ':'')+errors.join(' ');if(n&&!errors.length){linkInput.value='';panel.hidden=true}if(!lines.length)message.textContent='영상 주소를 입력하세요.';layout();
  }
  $('add-link').onclick=()=>{panel.hidden=!panel.hidden;if(!panel.hidden)linkInput.focus()};$('link-submit').onclick=addLinks;$('link-close').onclick=()=>{panel.hidden=true};
  $('embed-exit').onclick=()=>exitFull();$('embed-mute').onclick=()=>toggleAllAudio();$('embed-pause').onclick=()=>$('pause').click();
  // Poll official player state for the existing global audio/pause indicators.
  window.addEventListener('resize',layout);setInterval(()=>{if(slots.some(s=>s.remote))sync()},1000);
})();