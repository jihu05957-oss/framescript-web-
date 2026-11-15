'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PORT = Number(process.env.PORT || 3000);
const PASSWORD = process.env.APP_PASSWORD || '';
const API_KEY = process.env.GEMINI_API_KEY || '';
const SECRET = process.env.SESSION_SECRET || '';
const ROOT = path.join(__dirname, 'public');
const MODELS = new Set(['gemini-2.5-flash', 'gemini-2.5-flash-lite']);
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
  const candidate = result && Array.isArray(result.candidates) ? result.candidates[0] : null;
  const parts = candidate?.content?.parts || [];
  const answer = parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('\n').trim();
  const grounding = candidate?.groundingMetadata || {};
  const queries = Array.isArray(grounding.webSearchQueries) ? grounding.webSearchQueries.filter(Boolean) : [];
  const chunks = Array.isArray(grounding.groundingChunks) ? grounding.groundingChunks : [];
  const seen = new Set();
  const sources = [];
  for (const c of chunks) {
    const uri = urlSafe(c?.web?.uri);
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      sources.push({url:uri,title:String(c.web.title || new URL(uri).hostname).slice(0,180)});
    }
  }
  const searched = queries.length > 0 || chunks.some(c => c.web?.uri);
  return {searched:Boolean(searched),answer,sources,queries:queries.slice(0,8)};
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
  if(!API_KEY) return respond(res,503,{error:'무료 Gemini API 키를 연결해야 합니다. Google AI Studio에서 무료 등급 키를 만든 뒤 Render 환경변수 GEMINI_API_KEY로 등록하세요.'});
  let body;
  try {body=await readJSON(req);}catch{return respond(res,400,{error:'질문 데이터가 올바르지 않습니다.'});}
  const messages=body.messages, model=body.model||'gemini-2.5-flash';
  if(!Array.isArray(messages)||!messages.length||messages.length>35||!MODELS.has(model)||
    messages.some(x=>!['user','assistant'].includes(x.role)||typeof x.content!=='string'||!x.content.trim()||x.content.length>12000)||
    messages.at(-1).role!=='user') return respond(res,400,{error:'질문 형식을 확인해 주세요.'});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),110000);
  req.on('aborted',()=>controller.abort());
  try {
    const upstream=await fetch('https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-goog-api-key':API_KEY},
      body:JSON.stringify({
        contents:messages.map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),
        systemInstruction:{parts:[{text:'너는 한국어 개인 웹 리서치 AI다. 사용자가 무엇을 질문하든 Google Search 검색 도구로 실제 공개 웹 자료를 조사해 한국어로 답해라. 검색 결과는 공식 출처와 최신 자료를 우선하여 확인하고, 여러 자료의 차이가 있으면 구분해 설명하라. 출처 없는 중요한 사실을 단정하지 말고, 검색하지 않은 정보를 검색했다고 주장하지 마라. 인터넷 전체 자료에 접근할 수 있다고 주장하지 마라. 정확한 날짜와 근거를 제시하라.'}]},
        tools:[{google_search:{}}],
        generationConfig:{maxOutputTokens:8192,temperature:0.45}
      }),signal:controller.signal
    });
    if(!upstream.ok) {
      const e=await upstream.json().catch(()=>({}));
      if(upstream.status===429) return respond(res,429,{error:'Gemini 무료 사용 한도에 도달했습니다. 무료 할당량이 갱신된 후 다시 질문해 주세요.'});
      if(upstream.status===400 && /api key|api_key|key not valid/i.test(String(e?.error?.message||''))) return respond(res,400,{error:'Gemini API 키가 유효하지 않습니다. Google AI Studio의 무료 키를 확인해 주세요.'});
      return respond(res,502,{error:String(e?.error?.message||'Gemini 검색 연결 오류 ('+upstream.status+')').slice(0,350)});
    }
    const raw=await upstream.json();
    const data=collect(raw);
    if(!data.searched) return respond(res,502,{error:'Google 검색 결과가 확인되지 않아 답변을 표시하지 않았습니다. 질문을 조금 더 구체적으로 바꿔 다시 시도해 주세요.'});
    if(!data.answer) return respond(res,502,{error:'검색은 진행됐지만 AI 답변이 비어 있습니다. 다시 시도해 주세요.'});
    return respond(res,200,{...data,model});
  } catch(e) {
    return respond(res,502,{error:e.name==='AbortError'?'검색 시간 제한에 도달했습니다. 다시 시도해 주세요.':'Gemini 무료 API 서버에 연결하지 못했습니다.'});
  } finally {clearTimeout(timer);}
}
const app = http.createServer(async(req,res)=>{
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  if(req.method==='GET' && req.url==='/api/status') return respond(res,200,{configured:Boolean(API_KEY),loginEnabled:Boolean(PASSWORD&&SECRET),authenticated:auth(req),webSearch:true,provider:'Gemini Free',freeModel:true});
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
