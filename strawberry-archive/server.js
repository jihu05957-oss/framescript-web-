'use strict';
const express=require('express'),multer=require('multer'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {S3Client,PutObjectCommand,GetObjectCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3');
const sharp=require('sharp');
const {ARCHIVE_FREE_CAP_BYTES,formatStorageStatus,hasRoom,archiveCompletion}=require('./archive-core');
const app=express();app.disable('x-powered-by');app.set('trust proxy',1);
app.use(express.json({limit:'120kb'}));
app.use((req,res,next)=>{res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');res.set('X-Frame-Options','DENY');next()});
const PASSWORD=process.env.APP_PASSWORD,SECRET=process.env.COOKIE_SECRET;
if(!PASSWORD||PASSWORD.length<12||!SECRET||SECRET.length<32)throw Error('Set APP_PASSWORD and COOKIE_SECRET');
const persistent=['R2_ENDPOINT','R2_BUCKET','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'].every(k=>!!process.env[k]);
const s3=persistent?new S3Client({endpoint:process.env.R2_ENDPOINT,region:'auto',credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY}}):null;
const bucket=process.env.R2_BUCKET,dir=path.join(__dirname,'data');fs.mkdirSync(dir,{recursive:true});
const initialQueue=()=>Array.from({length:new Date().getFullYear()-2008},(_,i)=>({category:'Category:IU (vocalist) in '+(new Date().getFullYear()-i),year:new Date().getFullYear()-i,token:''}));
const fresh=()=>({items:[],cursor:{queue:initialQueue(),seen:initialQueue().map(x=>x.category),completed:0,lastCycle:null,lastRecentCheck:null},unresolved:{},updated:null});
let state=fresh(),ready=false,storageError='',busy=false,pauseUntil=0;
let status={running:false,message:'영구 저장소 연결 대기',added:0,duplicates:0,skipped:0,failed:0,error:'',time:null};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let saveMediaChain=Promise.resolve();
const safe=(x,n=200)=>String(x??'').replace(/[\x00-\x1f]/g,' ').slice(0,n);
const sig=x=>crypto.createHmac('sha256',SECRET).update(x).digest('hex');
const eq=(a,b)=>{let x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
function auth(req){const m=(req.headers.cookie||'').match(/(?:^|;\s*)sm_session=([^;]+)/);if(!m)return false;const [expiry,mac]=m[1].split('.');return /^\d+$/.test(expiry||'')&&Number(expiry)>Date.now()&&Number(expiry)<Date.now()+31*86400000&&eq(mac,sig(expiry))}
function guard(req,res,next){if(!auth(req))return res.status(401).json({error:'로그인이 필요합니다'});next()}
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const year=y=>{let n=Number(y);return Number.isInteger(n)&&n>=2008&&n<=new Date().getFullYear()+1?n:null};
const ext={ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif','video/mp4':'mp4','video/webm':'webm','video/quicktime':'mov'};
function activity(text){let s=text.toLowerCase();for(const [name,keys] of [['공연',['concert','hereh','tour','콘서트','팬미팅']],['드라마·영화',['drama','movie','폭싹','호텔 델루나','드라마','영화']],['화보',['vogue','elle','잡지','화보','magazine']],['광고',['campaign','brand','광고','gucci']],['음악',['album','palette','앨범','lilac']],['행사',['award','시상식','공항','팬싸','레드카펫']]])if(keys.some(k=>s.includes(k)))return name;return '미분류'}
async function streamString(b){if(b.transformToString)return b.transformToString();let x='';for await(const p of b)x+=p.toString();return x}
async function load(){try{if(!persistent)throw Error('Cloudflare R2 영구 저장소를 연결해야 자동 수집을 시작할 수 있습니다');if(persistent){try{let o=await s3.send(new GetObjectCommand({Bucket:bucket,Key:'state/index.json'}));state=JSON.parse(await streamString(o.Body))}catch(e){if(e.name!=='NoSuchKey'&&e.$metadata?.httpStatusCode!==404)throw e}}else if(fs.existsSync(path.join(dir,'index.json')))state=JSON.parse(fs.readFileSync(path.join(dir,'index.json'),'utf8'));if(!Array.isArray(state.items)||!state.cursor)throw Error('자료 목록 형식 오류');
 if(!state.unresolved||typeof state.unresolved!=='object')state.unresolved={};
 if(!Array.isArray(state.cursor.queue)){
  state.cursor={queue:initialQueue(),seen:initialQueue().map(x=>x.category),completed:0,lastCycle:null};
 }
 // Write/read/delete a small health file. Fail closed if permanent storage cannot round-trip.
 const healthKey='state/storage-check-'+crypto.randomUUID()+'.txt';
 try{
   await s3.send(new PutObjectCommand({Bucket:bucket,Key:healthKey,Body:'ok',ContentType:'text/plain'}));
   const got=await s3.send(new GetObjectCommand({Bucket:bucket,Key:healthKey}));
   if((await streamString(got.Body))!=='ok')throw Error('R2 저장·읽기 결과 불일치');
 }finally{await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:healthKey})).catch(()=>{})}
 ready=true; console.log('R2 storage read/write verification OK');
}catch(e){storageError='저장소 연결 실패: '+e.message;console.error(storageError)}}
let writeQueue=Promise.resolve();
function saveIndex(){writeQueue=writeQueue.catch(()=>{}).then(async()=>{const body=JSON.stringify(state);if(persistent)await s3.send(new PutObjectCommand({Bucket:bucket,Key:'state/index.json',Body:body,ContentType:'application/json'}));else{fs.writeFileSync(path.join(dir,'index.tmp'),body);fs.renameSync(path.join(dir,'index.tmp'),path.join(dir,'index.json'))}});return writeQueue}
async function addMediaInternal(bytes,info){
 if(!ready)throw Error(storageError||'저장소 준비 중');
 if(!hasRoom(state.items,bytes.length)){const e=new Error('R2 무료 저장 공간이 가득 찼습니다. 다른 사진을 삭제하거나 저장소를 확장하세요.');e.code='STORAGE_FULL';throw e}
 let mime=safe(info.mime,100).split(';')[0].toLowerCase();if(!ext[mime]||bytes.length<100||bytes.length>40*1024*1024)throw Error('파일 형식 또는 크기 제한 (최대 40MB)');
 const sha=crypto.createHash('sha256').update(bytes).digest('hex');
 if(state.items.some(x=>x.sha===sha))return 'duplicate';
 {
 let fingerprint=null;
 if(mime.startsWith('image/')){try{
   const out=await sharp(bytes,{limitInputPixels:50000000,animated:false}).greyscale().resize(9,8,{fit:'fill'}).raw().toBuffer({resolveWithObject:true});
   let bits=0n;for(let y=0;y<8;y++)for(let x=0;x<8;x++){bits=(bits<<1n)|BigInt(out.data[y*9+x]>out.data[y*9+x+1]?1:0)}
   const metadata=await sharp(bytes).metadata();
   fingerprint={hash:bits.toString(16).padStart(16,'0'),ratio:Number((metadata.width/metadata.height).toFixed(3))};
 }catch(e){console.warn('Unable to compute visual fingerprint:',e.message)}}
 // Perceptual similarity is advisory: distinct frames can have identical dHash.
 // Byte-identical SHA-256 duplicates are rejected; visual matches get a review label.
 let nearDuplicateOf=null;
 if(fingerprint){for(const item of state.items){if(!item.fingerprint||Math.abs(item.fingerprint.ratio-fingerprint.ratio)>0.015)continue;let xor=BigInt('0x'+item.fingerprint.hash)^BigInt('0x'+fingerprint.hash);let diff=0;while(xor){diff++;xor=xor&(xor-1n)}if(diff<=2){nearDuplicateOf=item.id;break}}}
 let key='media/'+sha+'.'+ext[mime];
 if(persistent)await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:bytes,ContentType:mime}));
 else fs.writeFileSync(path.join(dir,sha+'.'+ext[mime]),bytes);
 let title=safe(info.title||'IU photo',220);
 const row={id:crypto.randomUUID(),sha,fingerprint,nearDuplicateOf,key,title,year:year(info.year),activity:safe(info.activity||activity(title),50),source:safe(info.source||'직접 업로드',120),sourceUrl:safe(info.sourceUrl||'',900),license:safe(info.license||'',120),author:safe(info.author||'',160),type:mime.startsWith('video/')?'video':'image',mime,size:bytes.length,created:Date.now()};
 state.items.unshift(row);
 try{await saveIndex()}catch(e){state.items=state.items.filter(x=>x.id!==row.id);if(persistent)await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:key})).catch(()=>{});throw e}
 return 'added'
 }
}
function addMedia(bytes,info){
  const task=saveMediaChain.catch(()=>{}).then(()=>addMediaInternal(bytes,info));
  saveMediaChain=task.catch(()=>{});return task
}
const plain=x=>safe(String(x||'').replace(/<[^>]+>/g,' ').replace(/&[^; ]+;/g,' '),230);
const USER_AGENT='StrawberryMoonIUArchive/3.0 (https://strawberry-moon-iu-archive.onrender.com; personal archival app)';
function waitMs(resp,retry){
  const raw=resp.headers.get('retry-after'),seconds=raw?Number(raw):NaN;
  const parsed=raw?Date.parse(raw)-Date.now():NaN;
  const ms=Number.isFinite(seconds)?seconds*1000:Number.isFinite(parsed)?parsed:Math.min(15*60000,15000*Math.pow(2,retry));
  return Math.min(3600000,Math.max(15000,ms));
}
async function fetchRetry(url,kind){
  for(let attempt=0;attempt<5;attempt++){
    const r=await fetch(url,{signal:AbortSignal.timeout(kind==='api'?20000:50000),headers:{'User-Agent':USER_AGENT,'Accept':kind==='api'?'application/json':'image/*'}});
    if(r.status===429||r.status===503){
      const delay=waitMs(r,attempt);
      console.warn(kind+' rate limit '+r.status+'; respecting Retry-After: '+Math.round(delay/1000)+' seconds');
      status.message='외부 사이트 요청 제한 · '+Math.ceil(delay/1000)+'초 후 다시 확인';
      if(attempt===4){const error=new Error(kind+' API 제한 ('+r.status+'). 재시도 예정');error.retryable=true;throw error}
      await sleep(delay);continue;
    }
    if(!r.ok)throw new Error(kind+' 요청 HTTP '+r.status);
    return r;
  }
  throw new Error(kind+' 요청 제한');
}
async function commonsPage(task){
  const p=new URLSearchParams({action:'query',generator:'categorymembers',gcmtitle:task.category,gcmtype:'file|subcat',gcmlimit:'20',prop:'imageinfo',iiprop:'url|mime|size|extmetadata|sha1',format:'json',formatversion:'2'});
  if(task.token)p.set('gcmcontinue',task.token);
  const r=await fetchRetry('https://commons.wikimedia.org/w/api.php?'+p,'api');
  const j=await r.json();
  if(j.error)throw new Error(plain(j.error.info));
  return j;
}
async function commonsDownload(link){
  const url=new URL(link);
  if(url.protocol!=='https:'||url.hostname!=='upload.wikimedia.org')throw new Error('허용되지 않은 다운로드 주소');
  const r=await fetchRetry(url,'image');
  const mime=(r.headers.get('content-type')||'').split(';')[0].toLowerCase();
  if(!ext[mime])throw new Error('지원하지 않는 이미지 형식');
  if(Number(r.headers.get('content-length')||0)>40*1024*1024)throw new Error('40MB 초과');
  let buffers=[],size=0;
  for await (const part of r.body){size+=part.length;if(size>40*1024*1024)throw new Error('40MB 초과');buffers.push(part)}
  return {bytes:Buffer.concat(buffers),mime}
}
function initializeCycle(){
  state.cursor={queue:initialQueue(),seen:initialQueue().map(x=>x.category),completed:0,lastCycle:state.cursor?.lastCycle||null};
}
async function continuousScan(){
  if(busy||!ready)return;
  busy=true;status={running:true,message:'2008년부터 전체 공개자료 탐색 중',added:0,duplicates:0,skipped:0,failed:0,error:'',time:new Date().toISOString()};
  try{
    if(!state.cursor.queue.length)initializeCycle();
    // Keep recent-year checks ahead of the historical backlog, but never reset progress.
    const freshYear=new Date().getFullYear();
    const recentCat='Category:IU (vocalist) in '+freshYear;
    const last=Date.parse(state.cursor.lastRecentCheck||'')||0;
    if(Date.now()-last>15*60000 && !state.cursor.queue.some(t=>t.category===recentCat&&t.token==='')){
      state.cursor.queue.unshift({category:recentCat,year:freshYear,token:''});
      state.cursor.lastRecentCheck=new Date().toISOString();
    }
    while(ready&&state.cursor.queue.length){
      const task=state.cursor.queue[0];
      status.message='연도 '+task.year+' · '+task.category+' · 처리 중';
      const page=await commonsPage(task);
      for(const p of (page.query?.pages||[])){
        if(p.ns===14){
          const category=p.title;
          if(!state.cursor.seen.includes(category)&&state.cursor.seen.length<6000){
            state.cursor.seen.push(category);
            state.cursor.queue.push({category,year:task.year,token:''});
          }
          continue;
        }
        const info=p.imageinfo?.[0];
        if(!info||!ext[info.mime]||Number(info.size)>40*1024*1024){status.skipped++;continue}
        const sourceUrl=info.descriptionurl||'https://commons.wikimedia.org/wiki/'+encodeURIComponent(p.title);
        if(state.items.some(x=>x.sourceUrl===sourceUrl)){status.duplicates++;continue}
        try{
          const file=await commonsDownload(info.url);
          const result=await addMedia(file.bytes,{mime:file.mime,title:p.title.replace(/^File:/,''),year:task.year,source:'Wikimedia Commons (팬 촬영 포함)',sourceUrl,author:plain(info.extmetadata?.Artist?.value),license:plain(info.extmetadata?.LicenseShortName?.value)});
          if(result==='added')status.added++;else status.duplicates++;
          delete state.unresolved[sourceUrl];
        }catch(e){
          if(e.retryable||e.code==='STORAGE_FULL')throw e;
          state.unresolved[sourceUrl]={title:safe(p.title,180),year:task.year,error:safe(e.message,160),checkedAt:new Date().toISOString()};
          status.failed++;console.warn('Media not saved; unresolved until a later scan:',p.title,e.message);
        }
        await sleep(1800);
      }
      if(page.continue?.gcmcontinue)task.token=page.continue.gcmcontinue;
      else{state.cursor.queue.shift();state.cursor.completed++}
      state.updated=new Date().toISOString();
      await saveIndex();
      await sleep(1600);
    }
    state.cursor.lastCycle=new Date().toISOString();
    await saveIndex();
    status.message=Object.keys(state.unresolved).length
      ?'등록된 공개 출처 탐색 완료 · 미수집 파일 '+Object.keys(state.unresolved).length+'개, 재확인 필요'
      :'등록된 공개 출처의 이번 탐색 완료 · 새 자료 주기적 확인 중';
  }catch(e){status.error=e.message;status.message='일시 중단: '+e.message;pauseUntil=Date.now()+(e.code==='STORAGE_FULL'?24*3600000:60*60000);console.error('Collector paused:',e.message)}
  finally{busy=false;status.running=false;status.time=new Date().toISOString()}
}
function scheduleNext(){
 if(!ready||busy||Date.now()<pauseUntil)return;
 if(!state.cursor.queue.length&&state.cursor.lastCycle&&Date.now()-new Date(state.cursor.lastCycle).getTime()<15*60000)return;
 continuousScan().catch(e=>console.error('collector failure:',e));
}
const failed=new Map();
app.post('/api/login',(req,res)=>{let ip=req.ip,t=Date.now(),attempts=(failed.get(ip)||[]).filter(x=>t-x<600000);if(attempts.length>=8)return res.status(429).json({error:'10분 후 다시 시도하세요'});if(!eq(req.body.password||'',PASSWORD)){attempts.push(t);failed.set(ip,attempts);return res.status(401).json({error:'비밀번호가 일치하지 않습니다'})}failed.delete(ip);let expire=String(t+14*86400000);res.set('Set-Cookie','sm_session='+expire+'.'+sig(expire)+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1209600');res.json({ok:true})});
app.get('/api/me',(req,res)=>res.json({loggedIn:auth(req),persistent,ready,storageError}));
app.post('/api/logout',guard,(req,res)=>{res.set('Set-Cookie','sm_session=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0');res.json({ok:true})});
app.get('/api/gallery',guard,(req,res)=>{
 let q=safe(req.query.q||'',80).toLowerCase(),filterYear=year(req.query.year),filterType=safe(req.query.type||'',20),filterActivity=safe(req.query.activity||'',30);
 let rows=state.items.filter(x=>(!q||[x.title,x.source,x.activity,x.year].join(' ').toLowerCase().includes(q))&&(!filterYear||filterYear===x.year)&&(!filterType||filterType===x.type)&&(!filterActivity||filterActivity===x.activity));
 let page=Math.max(1,Math.min(99999,Number(req.query.page)||1));
 res.json({total:rows.length,page,imageCount:state.items.filter(x=>x.type==='image').length,videoCount:state.items.filter(x=>x.type==='video').length,items:rows.slice((page-1)*48,page*48).map(({key,...p})=>p),years:[...new Set(state.items.map(x=>x.year).filter(Boolean))].sort((a,b)=>b-a)});
});
app.get('/api/status',guard,(req,res)=>{
 const store=formatStorageStatus(state.items);
 const pending=state.cursor.queue?.length||0;
 const unresolved=Object.keys(state.unresolved||{}).length;
 const completion=archiveCompletion({pendingCategories:pending,unresolved,storageFull:store.full,connected:ready});
 res.json({...status,total:state.items.length,storage:store,unresolved,completion,cursor:{year:state.cursor.queue?.[0]?.year||null,pendingCategories:pending,completedCategories:state.cursor.completed||0,lastCycle:state.cursor.lastCycle||null,lastRecentCheck:state.cursor.lastRecentCheck||null},updated:state.updated,storageError,persistent});
});
app.post('/api/scan',guard,(req,res)=>{if(!ready)return res.status(503).json({error:storageError||'영구 저장소 연결 필요'});pauseUntil=0;scheduleNext();res.json({ok:true,running:busy})});
const uploader=multer({storage:multer.memoryStorage(),limits:{fileSize:40*1024*1024,files:10}});
app.post('/api/upload',guard,uploader.array('files',10),wrap(async(req,res)=>{
 if(!ready)return res.status(503).json({error:storageError||'영구 저장소 연결 필요'});
 let added=0,duplicates=0,rejected=0;
 for(let f of req.files||[]){try{let result=await addMedia(f.buffer,{mime:f.mimetype,title:f.originalname,year:req.body.year,activity:req.body.activity,source:req.body.source,sourceUrl:req.body.sourceUrl});result==='added'?added++:duplicates++}catch(e){rejected++}}
 res.json({added,duplicates,rejected})
}));
app.get('/api/file/:id',guard,wrap(async(req,res)=>{
 let p=state.items.find(x=>x.id===req.params.id);if(!p)return res.status(404).json({error:'자료를 찾지 못했습니다'});
 res.set('Content-Type',p.mime);res.set('Content-Disposition','inline; filename="IU-'+p.id+'.'+ext[p.mime]+'"');res.set('Accept-Ranges','bytes');
 if(persistent){let range=req.headers.range||undefined;let o=await s3.send(new GetObjectCommand({Bucket:bucket,Key:p.key,...(range?{Range:range}:{})}));if(o.ContentRange){res.status(206);res.set('Content-Range',o.ContentRange)}if(o.ContentLength)res.set('Content-Length',String(o.ContentLength));o.Body.pipe(res)}
 else{let f=path.join(dir,path.basename(p.key));if(!fs.existsSync(f))return res.status(404).json({error:'임시 저장 파일이 사라졌습니다'});let size=fs.statSync(f).size;let m=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');if(m){let a=Number(m[1]),b=m[2]?Math.min(size-1,Number(m[2])):size-1;if(a>=size||b<a)return res.status(416).end();res.status(206).set('Content-Range','bytes '+a+'-'+b+'/'+size).set('Content-Length',String(b-a+1));fs.createReadStream(f,{start:a,end:b}).pipe(res)}else{res.set('Content-Length',String(size));fs.createReadStream(f).pipe(res)}}
}));
app.delete('/api/gallery/:id',guard,wrap(async(req,res)=>{let n=state.items.findIndex(x=>x.id===req.params.id);if(n<0)return res.status(404).json({error:'파일 없음'});let [p]=state.items.splice(n,1);await saveIndex();if(persistent)await s3.send(new DeleteObjectCommand({Bucket:bucket,Key:p.key})).catch(()=>{});else fs.rmSync(path.join(dir,path.basename(p.key)),{force:true});res.json({ok:true})}));
app.get('/api/health',(req,res)=>res.json({ok:true,ready,persistent,freeCapBytes:ARCHIVE_FREE_CAP_BYTES}));
app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.use((e,req,res,next)=>{console.error(e);res.status(e.code==='LIMIT_FILE_SIZE'?413:500).json({error:e.code==='LIMIT_FILE_SIZE'?'40MB 이하 파일만 업로드할 수 있어요':safe(e.message,150)})});
load().then(()=>{app.listen(process.env.PORT||10000,'0.0.0.0',()=>console.log('Archive startup | persistent storage '+persistent+' | ready '+ready));if(ready)scheduleNext();setInterval(scheduleNext,60000).unref()});
