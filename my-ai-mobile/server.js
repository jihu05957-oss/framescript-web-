'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.APP_PASSWORD || '';
const API_KEY = process.env.OPENAI_API_KEY || '';
const SECRET = process.env.SESSION_SECRET || '';
const ROOT = path.join(__dirname, 'public');
const MODELS = new Set(['gpt-6-luna', 'gpt-6.1-sol', 'gpt-6-astra']);
const tries = new Map();
const respond = (res, code, obj) => {
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(obj));
};
const safeEqual = (a,b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(),crypto.createHash('sha256').update(String(b)).digest());
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('hex');
function auth(req) {
  if (!PASSWORD || !SECRET) return false;
  const value = (req.headers.cookie || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('ai_auth='))?.slice(8);
  if (!value) return false;
  const arr = value.split('.');
  if (arr.length !== 3 || !/^\d+$/.test(arr[0])) return false;
  const age = Date.now()-Number(arr[0]);
  return age>=-60000 && age<604800000 && safeEqual(arr[2],sign(arr[0]+'.'+arr[1]));
}
async function readJSON(req) {
  let size=0; const chunks=[];
  for await (const chunk of req) { size+=chunk.length; if (size>180000) throw Error('메시지가 너무 깁니다.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function allowOrigin(req) {
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === (req.headers['x-forwarded-host'] || req.headers.host); } catch {return false;}
}
function urlSafe(value) {
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) ? url.href : ''; } catch {return '';}
}
function collect(result) {
  const output = Array.isArray(result.output) ? result.output : [];
  const searched = output.some(x=>x.type==='web_search_call' && (x.action?.type==='search' || x.action?.queries?.length || x.action?.query));
  const seen = new Set(); const sources=[];
  const add=(url,title)=>{
    const link=urlSafe(url);
    if (link && !seen.has(link)) { seen.add(link); sources.push({url:link,title:String(title||new URL(link).hostname).slice(0,180)}); }
  };
  const texts=[];
  for (const item of output) {
    if (item.type==='message') for (const section of item.content||[]) if (section.type==='output_text') {
      texts.push(section.text||'');
      for (const a of section.annotations||[]) if (a.type==='url_citation') add(a.url,a.title);
    }
    if (item.type==='web_search_call') for (const s of item.action?.sources||[]) {
      if (typeof s==='string') add(s); else if (s) add(s.url||s.uri,s.title);
    }
  }
  return {searched:Boolean(searched),answer:texts.join('\n').trim(),sources};
}
function serve(res, pathname) {
  const files = {'/':'index.html','/index.html':'index.html','/manifest.webmanifest':'manifest.webmanifest','/favicon.svg':'favicon.svg'};
  const name=files[pathname];
  if(!name) return respond(res,404,{error:'Not found'});
  const file=path.join(ROOT,name);
  fs.readFile(file,(err,data)=>{
    if(err) return respond(res,404,{error:'Not found'});
    const type=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.svg')?'image/svg+xml': 'application/manifest+json';
    res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"});
    res.end(data);
  });
}
async function chat(req,res) {
  if(!auth(req)) return respond(res,401,{error:'비밀번호로 로그인해 주세요.'});
  if(!API_KEY) return respond(res,503,{error:'API 키가 아직 연결되지 않았습니다. Render 환경변수 OPENAI_API_KEY를 등록해 주세요.'});
  let body;
  try {body=await readJSON(req);}catch{return respond(res,400,{error:'질문 데이터가 올바르지 않습니다.'});}
  const messages=body.messages, model=body.model||'gpt-6-luna';
  if(!Array.isArray(messages)||!messages.length||messages.length>35||!MODELS.has(model)||
    messages.some(x=>!['user','assistant'].includes(x.role)||typeof x.content!=='string'||!x.content.trim()||x.content.length>12000)||
    messages.at(-1).role!=='user') return respond(res,400,{error:'질문 형식을 확인해 주세요.'});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),170000);
  try {
    const upstream=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+API_KEY},
      body:JSON.stringify({
        model,
        instructions:'너는 한국어 개인 웹 리서치 AI다. 모든 질문마다 검색을 실제로 실행하라. 국내외 공개 웹에서 공식 자료와 최신 자료를 우선 조사하고 중요 주장을 교차 검증하라. 질문에 충실하고 자세히 대답하되 비공개·차단·미확인 정보를 찾았다고 주장하지 마라. 중요한 사실의 근거를 인용하고 정확한 날짜를 표시하라. 사용자의 질문이 한국어면 한국어로 답하라.',
        input:messages,
        tools:[{type:'web_search',search_context_size:'high'}],
        tool_choice:'required',
        include:['web_search_call.action.sources'],
        store:false,
        max_output_tokens:6000
      }),signal:controller.signal
    });
    if(!upstream.ok) {
      const e=await upstream.json().catch(()=>({}));
      return respond(res,upstream.status===429?429:502,{error:String(e?.error?.message||'검색 API 응답 오류 ('+upstream.status+')').slice(0,350)});
    }
    const raw=await upstream.json();
    const data=collect(raw);
    if(!data.searched) return respond(res,502,{error:'실제 웹 검색 수행을 확인할 수 없어 답변을 표시하지 않았습니다.'});
    if(!data.answer) return respond(res,502,{error:'검색했지만 답변이 비어 있습니다.'});
    return respond(res,200,{...data,model});
  } catch(e) {
    return respond(res,502,{error:e.name==='AbortError'?'검색 제한 시간에 도달했습니다. 다시 시도해 주세요.':'AI 서버에 연결하지 못했습니다.'});
  } finally {clearTimeout(timer);}
}
const app = http.createServer(async(req,res)=>{
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method==='GET' && req.url==='/api/status') return respond(res,200,{configured:Boolean(API_KEY),loginEnabled:Boolean(PASSWORD&&SECRET),authenticated:auth(req),webSearch:true});
  if(req.method==='GET') return serve(res,new URL(req.url,'http://localhost').pathname);
  if(req.method!=='POST' || !allowOrigin(req)) return respond(res,403,{error:'허용되지 않는 요청'});
  if(req.url==='/api/login') {
    const ip=req.headers['x-forwarded-for']?.split(',')[0]?.trim()||req.socket.remoteAddress||'unknown';
    const now=Date.now();const t=tries.get(ip)||{n:0,until:now+600000};
    if(t.until<now){t.n=0;t.until=now+600000;}
    if(t.n>=10) return respond(res,429,{error:'로그인 시도가 많습니다. 10분 뒤 다시 시도해 주세요.'});
    let b;try{b=await readJSON(req);}catch{return respond(res,400,{error:'비밀번호를 입력해 주세요.'});}
    if(!PASSWORD||!SECRET||!safeEqual(b.password||'',PASSWORD)) {t.n++;tries.set(ip,t);return respond(res,401,{error:'비밀번호가 맞지 않습니다.'});}
    tries.delete(ip);
    const id=String(now)+'.'+crypto.randomBytes(12).toString('hex');
    res.setHeader('Set-Cookie','ai_auth='+id+'.'+sign(id)+'; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=604800');
    return respond(res,200,{ok:true});
  }
  if(req.url==='/api/logout') {res.setHeader('Set-Cookie','ai_auth=; HttpOnly; SameSite=Strict; Secure; Path=/; Max-Age=0');return respond(res,200,{ok:true});}
  if(req.url==='/api/chat') return chat(req,res);
  return respond(res,404,{error:'Not found'});
});
app.listen(PORT,'0.0.0.0',()=>console.log('My AI mobile service listening on '+PORT));
