'use strict';
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), http=require('node:http'), os=require('node:os'), {execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const dir=path.resolve(__dirname,'../octoplay'), temp=fs.mkdtempSync(path.join(os.tmpdir(),'octoplay-')), sample=path.join(temp,'sample.webm');
execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=160x120:rate=15','-t','3','-c:v','libvpx-vp9','-threads','1','-y',sample]);
const buffer=fs.readFileSync(sample);
const types={'.html':'text/html','.js':'text/javascript','.webmanifest':'application/manifest+json','.png':'image/png'};
const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://localhost').pathname;const f=path.join(dir,p==='/'?'index.html':p);if(!f.startsWith(dir+path.sep)||!fs.existsSync(f)){res.writeHead(404);return res.end()}res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream','Referrer-Policy':'strict-origin-when-cross-origin'});res.end(fs.readFileSync(f))});


const fakeScript="window.YT={Player:class{constructor(frame,opts){this.frame=frame;this.opts=opts;this.m=false;this.state=-1;this.t=0;setTimeout(()=>opts.events.onReady({target:this}),20)}getCurrentTime(){return this.t}getDuration(){return 30}getPlayerState(){return this.state}isMuted(){return this.m}mute(){this.m=true}unMute(){this.m=false}playVideo(){this.state=1;this.opts.events.onStateChange({data:1})}pauseVideo(){this.state=2;this.opts.events.onStateChange({data:2})}seekTo(t){this.t=t}destroy(){this.frame.remove()}}};window.onYouTubeIframeAPIReady();";
async function add(page,links){await page.locator('#add-link').click();await page.locator('#link-input').fill(links);await page.locator('#link-submit').click()}
async function clear(page){page.once('dialog',d=>d.accept());await page.locator('#clear').click();await page.waitForFunction(()=>slots.every(s=>!s.url))}
async function mockRoutes(page){await page.route('https://media.example/**',route=>route.fulfill({status:200,contentType:'video/webm',body:buffer,headers:{'Access-Control-Allow-Origin':'*'}}));await page.route('https://www.youtube.com/embed/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Mock iframe</title><button>Play</button>'}));await page.route('https://www.youtube.com/iframe_api',route=>route.fulfill({status:200,contentType:'text/javascript',body:fakeScript}))}
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const browser=await chromium.launch({headless:true});let failures=[];async function check(name,fn){try{await fn();console.log('PASS '+name)}catch(e){failures.push(name+': '+e.message);console.error('FAIL '+name,e.message)}}
try{
await check('desktop local files, invalid URLs and eight mixed direct streams',async()=>{
 const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});await mockRoutes(page);await page.goto(url);await page.locator('#files').setInputFiles(sample);await page.waitForFunction(()=>slots[0].v.currentTime>0.15);
 await add(page,'javascript:alert(1)\nhttps://www.youtube.com.evil.invalid/watch?v=M7lc1UVf-VE\nhttps://example.org/article');assert.equal(await page.evaluate(()=>slots.filter(s=>s.url).length),1);assert.match(await page.locator('#link-message').innerText(),/HTTPS/);await page.locator('#link-close').click();
 await add(page,Array.from({length:8},(_,i)=>'https://media.example/video'+i+'.webm').join('\n'));await page.waitForFunction(()=>slots.filter(s=>s.url).length===8);assert.equal(await page.locator('#count').inputValue(),'8');assert.match(await page.locator('#link-message').innerText(),/최대 8개/);await page.locator('#link-close').click();
 await page.waitForFunction(()=>slots.every(s=>s.v.readyState>=2&&s.v.currentTime>0.05),{},{timeout:20000});assert.equal(await page.evaluate(()=>slots.every(s=>s.v.loop)),true);
 await page.locator('#pause').click();await page.waitForFunction(()=>slots.every(s=>s.v.paused));await page.locator('#play').click();await page.waitForFunction(()=>slots.every(s=>!s.v.paused));await page.locator('#mute').click();await page.waitForFunction(()=>slots.every(s=>!s.v.muted));await page.locator('#mute').click();assert.equal(await page.evaluate(()=>slots.every(s=>s.v.muted)),true);
 await clear(page);await page.close();
});
await check('mobile direct playback, fullscreen clean mode and triple tap',async()=>{
 const page=await browser.newPage({viewport:{width:384,height:832},isMobile:true,hasTouch:true,deviceScaleFactor:2,serviceWorkers:'block'});await mockRoutes(page);await page.goto(url);await add(page,'https://media.example/video.webm');await page.waitForFunction(()=>slots[0].v.currentTime>0.1);
 await page.locator('#full').click();await page.waitForFunction(()=>document.body.classList.contains('theater'));assert.equal(await page.locator('.tile.loaded .top').isVisible(),false);assert.equal(await page.locator('#exit').isVisible(),false);const rect=await page.locator('.tile.loaded').boundingBox();for(let i=0;i<3;i++){await page.touchscreen.tap(rect.x+30,rect.y+35);await page.waitForTimeout(75)}await page.waitForFunction(()=>!slots[0].v.muted);await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.body.classList.contains('theater'));await page.close();
});
await check('YouTube URL variants, native embed, size limits and manual playback policy',async()=>{
 const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});await mockRoutes(page);await page.goto(url);
 await add(page,'https://youtu.be/M7lc1UVf-VE\nhttps://www.youtube.com/watch?v=M7lc1UVf-VE\nhttps://www.youtube.com/shorts/M7lc1UVf-VE');
 await page.waitForFunction(()=>slots.slice(0,3).every(s=>s.remote?.ready));assert.equal(await page.locator('iframe').count(),3);for(const src of await page.locator('iframe').evaluateAll(a=>a.map(x=>x.src))){const u=new URL(src);assert.equal(u.host,'www.youtube.com');assert.equal(u.searchParams.get('autoplay'),'0');assert.equal(u.searchParams.get('loop'),'1')}
 await page.locator('#play').click();assert.equal(await page.evaluate(()=>slots.slice(0,3).every(s=>s.v.paused)),true);await page.locator('.linkbar').first().getByRole('button',{name:'유튜브 재생 또는 정지'}).click();assert.equal(await page.evaluate(()=>slots[0].v.paused),false);assert.equal(await page.evaluate(()=>slots[1].v.paused),true);await page.locator('#mute').click();assert.equal(await page.evaluate(()=>slots.slice(0,3).every(s=>!s.v.muted)),true);
 await page.locator('#full').click();await page.waitForFunction(()=>document.body.classList.contains('theater'));assert.equal(await page.locator('#embed-controls').isVisible(),true);assert.equal(await page.locator('.linkbar').first().isVisible(),false);await page.locator('#embed-exit').click();await page.waitForFunction(()=>!document.body.classList.contains('theater'));await clear(page);assert.equal(await page.locator('iframe').count(),0);await page.close();
 const mobile=await browser.newPage({viewport:{width:384,height:832},isMobile:true,hasTouch:true,serviceWorkers:'block'});await mockRoutes(mobile);await mobile.goto(url);await add(mobile,'https://www.youtube.com/watch?v=M7lc1UVf-VE');await mobile.waitForFunction(()=>slots[0].remote?.ready);await mobile.locator('#count').selectOption('8');await mobile.waitForFunction(()=>!slots[0].remote.frame);await mobile.locator('.linksmall').first().click();await mobile.waitForFunction(()=>slots[0].remote?.ready);const box=await mobile.locator('iframe').boundingBox();assert.ok(box.width>=200&&box.height>=200);await mobile.close();
});
await check('PWA manifest and updated offline shell',async()=>{
 const page=await browser.newPage();await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);assert.equal(await page.evaluate(async()=>{const m=await fetch('/manifest.webmanifest').then(r=>r.json());return m.display}), 'fullscreen');assert.ok(await page.evaluate(async()=>{const c=await caches.open('octoplay-shell-v5');return !!(await c.match('/links.js'))}));await page.close();
});
await check('real external video playback (authorized CC0 sample)',async()=>{
 const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});await page.goto(url);await add(page,'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4');await page.waitForFunction(()=>slots[0].v.currentTime>0.3,{},{timeout:45000});await page.close();
});
await check('real official YouTube playback after user click',async()=>{
 let results=[];
 for(const id of ['M7lc1UVf-VE','YE7VzlLtp-4']){
  const page=await browser.newPage({viewport:{width:1280,height:900},serviceWorkers:'block'});
  try{
   await page.goto(url);await add(page,'https://www.youtube.com/watch?v='+id);await page.waitForFunction(()=>slots[0].remote?.ready,{},{timeout:20000});
   await page.locator('.linkbar').first().getByRole('button',{name:'유튜브 재생 또는 정지'}).click();
   await page.waitForFunction(()=>slots[0].remote?.player?.getCurrentTime()>0.3&&slots[0].remote?.player?.getPlayerState()===1,{},{timeout:30000});
   console.log('Real YouTube video played: '+id);await page.close();return;
  }catch(e){
   const data=await page.evaluate(()=>{const r=slots[0].remote;return {ready:r?.ready,error:r?.errorCode,state:r?.player?.getPlayerState?.(),time:r?.player?.getCurrentTime?.(),note:r?.note.textContent}}).catch(()=>null);
   const frame=page.frames().find(f=>f.url().includes('youtube.com/embed/'));const visible=frame?await frame.locator('body').innerText({timeout:2000}).catch(()=>'<unavailable>'):'<no iframe>';
   results.push(id+' '+JSON.stringify(data)+' '+visible.slice(0,700));await page.close()
  }
 }
 throw Error(results.join('\n'));
});
}finally{await browser.close();server.close();fs.rmSync(temp,{recursive:true,force:true})}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
