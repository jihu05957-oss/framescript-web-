const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 10000);
const ROOT = __dirname;
const MAX_BYTES = 22 * 1024 * 1024;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const hasAI = () => Boolean((process.env.OPENAI_API_KEY || '').trim());
const hasPassword = () => Boolean((process.env.APP_PASSWORD || '').trim());

function respond(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function safeError(err) {
  return err && err.message ? String(err.message).slice(0,300) : '알 수 없는 오류';
}
async function getBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES) { const e = new Error('분석 프레임 크기가 너무 큽니다.');e.status=413;throw e; }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function normalizeResult(s) {
  return {
    title:String(s.title || '영상 재현 프롬프트'),
    summary:String(s.summary || ''),
    prompt_ko:String(s.prompt_ko || ''),
    prompt_en:String(s.prompt_en || ''),
    negative_prompt:String(s.negative_prompt || ''),
    timeline:Array.isArray(s.timeline)?s.timeline.slice(0,24):[],
    subject:String(s.subject || ''),
    camera:String(s.camera || ''),
    scene:String(s.scene || ''),
    action:String(s.action || ''),
    lighting:String(s.lighting || ''),
    uncertainties:Array.isArray(s.uncertainties)?s.uncertainties.slice(0,8):[]
  };
}
async function analyze(req, res) {
  if (!hasAI()) return respond(res,503,{error:'현재 서버에는 AI API 키가 연결되지 않았습니다. 무료 기본 모드를 사용해 주세요.'});
  if (!hasPassword()) return respond(res,503,{error:'AI 키 보호를 위한 서버 비밀번호(APP_PASSWORD)를 먼저 설정해야 합니다.'});
  const header = String(req.headers['x-app-password'] || '');
  if (header.length !== process.env.APP_PASSWORD.length || !require('node:crypto').timingSafeEqual(Buffer.from(header), Buffer.from(process.env.APP_PASSWORD))) {
    return respond(res,401,{error:'분석 비밀번호가 올바르지 않습니다.'});
  }
  const body = await getBody(req);
  if (!body || !Array.isArray(body.frames) || body.frames.length < 2 || body.frames.length > 12) return respond(res,400,{error:'분석 프레임은 2~12장이 필요합니다.'});
  const valid = body.frames.every(f => typeof f.time==='number' && typeof f.image==='string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f.image) && f.image.length < 1200000);
  if (!valid) return respond(res,400,{error:'프레임 데이터가 유효하지 않습니다.'});
  const system = [
    '당신은 영상을 정지 프레임으로 분석해 AI 영상 생성용 재현 프롬프트를 쓰는 전문가다.',
    '보이는 사실을 상세하게 기술하되 인물 실명, 카메라 움직임, 오디오, 프레임 사이 동작은 추측하지 마라.',
    '시각적 연속성과 인물의 옷, 배경, 구도, 조명, 액션의 시간순 변화를 정리하라.',
    '출력은 반드시 JSON 객체만 작성한다. 필드: title, summary, prompt_ko, prompt_en, negative_prompt, subject, scene, action, camera, lighting, timeline, uncertainties.',
    'timeline은 [{"time":"00:01","visual":"...","movement":"..."}] 형태의 배열로 작성하라.',
    'prompt_ko는 한국어, prompt_en은 자연스러운 영어로 구체적이고 독립적으로 재현 가능한 완성 프롬프트여야 한다.',
    '근거 없는 대사나 소리는 지어내지 마라. 프레임만 있으므로 자세한 소리나 동작이 확인되지 않는다는 점을 uncertainties에 기록하라.'
  ].join('\n');
  const intro = '대상 영상 AI: '+String(body.target||'범용').slice(0,40)+'\n영상 길이: '+Number(body.duration||0).toFixed(1)+'초\n스타일: '+String(body.style||'원본 재현').slice(0,40)+'\n사용자 추가 요청: '+String(body.notes||'없음').slice(0,1500)+'\n다음 이미지는 시간 순서대로 추출한 스틸 프레임이다.';
  const images = body.frames.flatMap(f => [
    {type:'text',text:'타임스탬프 '+Number(f.time).toFixed(2)+'초'},
    {type:'image_url',image_url:{url:f.image,detail:'low'}}
  ]);
  const controller = new AbortController();
  const timer = setTimeout(()=>controller.abort(),115000);
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',signal:controller.signal,
      headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:MODEL,
        messages:[{role:'system',content:system},{role:'user',content:[{type:'text',text:intro},...images]}],
        response_format:{type:'json_object'},
        temperature:0.3,max_tokens:2400
      })
    });
    const json = await upstream.json().catch(()=>({}));
    if (!upstream.ok) {
      const e = json && typeof json.error === 'object' ? json.error : {};
      const code = String(e.code || e.type || '').slice(0,80);
      console.warn('OpenAI API error status=%s code=%s type=%s', upstream.status, String(e.code || '').slice(0,80), String(e.type || '').slice(0,80));
      let problem = 'AI 요청이 실패했습니다 (' + upstream.status + '). Render 서버 설정을 확인해 주세요.';
      if (upstream.status === 429) {
        const quota = /insufficient_quota|credit_balance_exhausted|spend_limit_exceeded|usage_limit_exceeded/i.test(code+' '+String(e.type||''));
        if (quota) problem = 'API 크레딧 또는 사용·지출 한도가 부족합니다 (429). OpenAI Platform → Billing에서 잔액과 한도를 확인해 주세요. ChatGPT Plus와 API 결제는 별개입니다.';
        else problem = 'API 요청 속도·토큰 한도를 초과했습니다 (429). 잠시 후 다시 시도하고 OpenAI Platform → Limits에서 한도를 확인해 주세요.';
      } else if (upstream.status === 401) {
        problem = 'OpenAI API 키 인증에 실패했습니다 (401). Render의 OPENAI_API_KEY를 확인해 주세요.';
      } else if (upstream.status === 403) {
        problem = 'OpenAI API 접근 권한이 없습니다 (403). 프로젝트·모델 사용 권한을 확인해 주세요.';
      } else if (upstream.status === 400) {
        problem = 'AI 요청 설정 오류 (400). 모델과 분석 프레임 설정을 확인해 주세요.';
      }
      return respond(res,upstream.status===429?429:502,{error:problem,code});
    }
    const content = json.choices?.[0]?.message?.content;
    if (!content) return respond(res,502,{error:'AI 분석 응답이 비어 있습니다.'});
    let result;
    try { result = JSON.parse(content); }
    catch {return respond(res,502,{error:'AI 분석 결과를 읽지 못했습니다. 다시 시도해 주세요.'});}
    return respond(res,200,{result:normalizeResult(result),model:MODEL});
  } finally {clearTimeout(timer);}
}
const server = http.createServer(async (req,res)=>{
  try {
    const pathname = new URL(req.url,'http://localhost').pathname;
    if (req.method==='GET' && pathname==='/api/health') return respond(res,200,{ai_available:hasAI()&&hasPassword(),key_configured:hasAI(),password_required:hasPassword(),model:MODEL});
    if (req.method==='POST' && pathname==='/api/analyze') return await analyze(req,res);
    if (req.method==='GET' && (pathname==='/'||pathname==='/index.html')) {
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'});
      return fs.createReadStream(path.join(ROOT,'index.html')).pipe(res);
    }
    return respond(res,404,{error:'Not found'});
  } catch(err) {
    return respond(res,err.status||500,{error:err instanceof SyntaxError?'요청 데이터를 읽지 못했습니다.':safeError(err)});
  }
});
server.listen(PORT,'0.0.0.0',()=>console.log('FrameScript web listening on '+PORT));
