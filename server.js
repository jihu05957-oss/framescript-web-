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
    '역할: 참조 영상의 외모가 아닌 행동과 연출을 다른 인물 사진에 이식하기 위한 영상 모션 디렉터 겸 장면 분석가.',
    '사용자는 재현 영상에 사용할 인물 사진을 이미 보유한다. 원본 영상 속 인물의 얼굴형, 나이, 체형, 피부색, 머리 모양, 의상 색상, 액세서리 등 정체성/외형은 옮겨 적지 마라. 단, 등장 역할을 구분하기 위해 영상에서 분명히 드러나는 남성/여성 구분은 허용한다.',
    '주체를 인물 A, 인물 B라는 기계적 번호로 표현하지 말고, 화면에서 명확히 구분되는 경우 한국어 프롬프트와 타임라인에는 남성, 여성, 영어 프롬프트에는 man, woman으로 자연스럽게 지칭한다. 동일한 성별이 여러 명이면 왼쪽 남성/오른쪽 남성 등 위치나 행동으로 구분하며, 영상만으로 불확실한 경우에는 성별을 억지로 추측하지 말고 사람 또는 인물로 지칭한다. 화면 좌측/우측, 카메라와의 상대 위치, 동작 주체, 시선·손·몸의 상호작용 관계를 설명한다.',
    '각 구간마다 움직임, 동작 순서, 속도, 멈춤/가속/감속, 보폭·팔/손/손가락/손목/고개/어깨/상체/다리 움직임, 자세 변화와 무게중심 이동, 두 인물 사이 거리 및 접촉 타이밍을 면밀히 관찰해 구체적으로 설명한다.',
    '원본 영상에서 확인되는 동작은 임의로 무해하거나 추상적인 표현으로 순화하지 말고, 일상적인 직접 표현으로 정확히 적는다. 예를 들어 포옹, 손잡기, 뺨에 입맞춤, 키스, 어깨나 허리에 손을 얹는 행동, 몸을 밀착하거나 물러나는 동작은 실제 보이는 경우 주체·접촉 부위·순서·강도·자세·반응을 명확히 서술한다. 장면의 감정이나 분위기가 로맨틱하거나 긴장된 경우에도 과장하거나 생략하지 않는다.',
    '시각적으로 관찰 가능한 사실을 빼먹거나 모호한 표현(서로 교감한다, 다양한 행동을 한다 등)으로 뭉뚱그리지 않는다. 각각의 손과 발 위치, 움직임 방향, 접근·후퇴 거리, 시선 전환, 고개 각도, 반응 간격을 재현 가능한 동사와 시간적 순서로 표현한다.',
    '단, 관찰할 수 없는 접촉, 감정, 대사나 프레임 사이의 짧은 행동은 사실처럼 꾸미지 않는다. 보이는 증거가 부족한 경우 추정임을 명시한다.',
    '눈에 보이는 눈썹, 눈꺼풀, 시선 방향, 입 주변 표정, 미소, 놀람, 망설임 등 표정 변화와 상호 반응을 시간에 따라 기술한다. 감정의 내적 이유는 단정하지 않고 시각적 인상으로 표현한다.',
    '카메라의 구도(전신/허리 위/클로즈업/2인샷 등), 피사체 위치, 샷 크기, 관찰 가능한 앵글/높이, 컷 전환, 관찰 가능한 카메라 움직임, 촬영 시점, 화면 방향과 공간 동선을 기재하라.',
    '움직임의 실사감과 자연스러움을 재현하도록 관성, 발의 접지와 체중 이동, 호흡에 따른 미세한 몸 움직임, 자연스러운 시선 전환 및 반응의 선후관계, 손이 사물에 닿는 방식, 물리적 일관성을 강조하되 원본에서 관찰 가능한 요소가 우선이다.',
    '영상의 조명·배경·분위기 설명은 재현해야 할 행동과 공간의 관계를 이해시키는 데 필요한 범위로만 간결하게 기재하라. 원본 인물 외형을 따라 하게 만드는 내용은 넣지 마라.',
    '각 구간은 독립 사용 가능한 영상 생성 프롬프트로 작성하라. 시작부터 끝까지 어떤 순서로 행동하고 카메라가 무엇을 보여주는지 명확하게 적되, 인물 정체성은 사용자의 참조 사진을 그대로 따른다고 선언하라.',
    '각 구간에서 인물 A/B 등 문자 레이블은 사용하지 않는다. 남성·여성처럼 역할이 바로 이해되게 표현하며, 서로 접촉하는 경우 누가 먼저 어떤 손으로 어디를 접촉하는지 관찰된 범위 내에서 적고, 불확실하면 불확실하다고 표시하라.',
    '프레임 사이의 동작, 실제 카메라 이동, 발화, 소리, 짧은 미세 표정은 정지 프레임만으로 확정할 수 없다. 관찰된 사실과 추정은 명시적으로 구분하고 실제 원본 영상 전체를 본 것처럼 말하지 마라.',
    '출력은 반드시 유효한 JSON 객체. 필드: title, summary, prompt_ko, prompt_en, negative_prompt, subject, scene, action, camera, lighting, timeline, uncertainties.',
    'subject에는 인물 외형이 아니라 남성·여성 등 구별 가능한 주체의 화면상 위치, 시작 자세, 상호작용 역할만 담는다. action은 동작 순서·속도·표정/시선 변화·몸의 역학을 구체적으로 쓴다.',
    'timeline은 [{"time":"00:01","visual":"관찰된 자세·표정·구도","movement":"프레임상 확인되는 변화, 추정은 추정 표시"}] 형태로 시간 순서대로 최대 12개 작성한다. JSON이 출력 한도 내에서 반드시 닫히게 요약과 설명의 불필요한 반복을 줄인다.',
    'prompt_ko는 한국어에서 주체를 남성/여성으로, prompt_en은 man/woman으로 지칭하며 풍부한 장면 지시문을 작성한다. 시작에는 이 구간의 시간 범위를 명시한다. 두 언어 모두 원본 인물의 외모는 제외하고 참조 사진의 얼굴/의상/정체성을 유지하라는 요구를 담는다. 구분 불가능한 인물의 성별을 지어내지 마라.',
    'negative_prompt에는 얼굴·의상 변형, 신체 왜곡, 부자연스러운 팔다리·손·접촉, 무게중심 오류, 갑작스러운 포즈 점프, 원본에 없는 행동·대사와 불필요한 카메라 전환 방지를 기술한다.',
    '앞 구간 정보는 동작 연속성 참고용이다. 현재 구간 프레임이 더 우선이며 외모 묘사를 다시 도입하지 않는다.'
  ].join('\n');
  const stamp = sec => {const n=Math.max(0,Math.round(sec));return String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0')};
  const sectionStart = Number(body.sectionStart ?? 0);
  const sectionEnd = Number(body.sectionEnd ?? body.duration ?? 0);
  if (!Number.isFinite(sectionStart) || !Number.isFinite(sectionEnd) || sectionStart < 0 || sectionEnd <= sectionStart) return respond(res,400,{error:'분석 구간이 잘못 지정됐습니다.'});
  const intro = '대상 영상 AI: '+String(body.target||'범용').slice(0,40)+'\n이 구간의 절대 시간: '+stamp(sectionStart)+' ~ '+stamp(sectionEnd)+' ('+Number(body.duration||0).toFixed(1)+'초)\n스타일: '+String(body.style||'원본 재현').slice(0,40)+'\n사용자 추가 요청: '+String(body.notes||'없음').slice(0,1500)+'\n직전 구간 컨텍스트: '+String(body.previousContext||'없음').slice(0,1500)+'\n다음 이미지는 이 구간에서 추출한 스틸 프레임이다. 오직 이 구간에 해당하는 프롬프트를 작성하라.';
  const images = body.frames.flatMap(f => [
    {type:'text',text:'타임스탬프 '+Number(f.time).toFixed(2)+'초'},
    {type:'image_url',image_url:{url:f.image,detail:'high'}}
  ]);
  const requestMessages = [{role:'system',content:system},{role:'user',content:[{type:'text',text:intro},...images]}];
  for(let attempt=0;attempt<2;attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),115000);
    let upstream, json;
    try {
      const messages = attempt===0 ? requestMessages : [...requestMessages,{
        role:'user',content:'앞선 응답이 비었거나 JSON이 불완전했습니다. 이 구간을 실제 프레임에 근거하여 다시 분석하세요. 반드시 완결된 유효한 JSON 객체만 출력하세요. 필수 11개 필드를 모두 포함하고, timeline은 최대 12개 항목으로 간결하게 작성하세요. 특히 prompt_ko와 prompt_en의 행동·표정·카메라 묘사는 충실히 유지하고 같은 내용을 불필요하게 반복하지 마세요.'
      }];
      upstream=await fetch('https://api.openai.com/v1/chat/completions',{
        method:'POST',signal:controller.signal,
        headers:{'Authorization':'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},
        body:JSON.stringify({model:MODEL,messages,response_format:{type:'json_object'},temperature:0.2,max_tokens:attempt===0?4500:5500})
      });
      json=await upstream.json().catch(()=>({}));
    } finally { clearTimeout(timer); }
    if (!upstream.ok) {
      const e = json && typeof json.error === 'object' ? json.error : {};
      const code = String(e.code || e.type || '').slice(0,80);
      console.warn('OpenAI API error status=%s code=%s type=%s', upstream.status, String(e.code || '').slice(0,80), String(e.type || '').slice(0,80));
      let problem = 'AI 요청이 실패했습니다 (' + upstream.status + '). Render 서버 설정을 확인해 주세요.';
      if (upstream.status === 429) {
        const billingInactive = /billing_not_active/i.test(code+' '+String(e.type||''));
        const quota = /insufficient_quota|credit_balance_exhausted|spend_limit_exceeded|usage_limit_exceeded/i.test(code+' '+String(e.type||''));
        if (billingInactive) problem = 'API 결제 미활성화 (429 / billing_not_active). 사이트에 설정된 API 키가 속한 OpenAI 조직·프로젝트의 결제 상태를 확인하세요. 충전한 조직에서 새 프로젝트 키를 발급해 Render의 OPENAI_API_KEY를 교체할 수 있습니다. 현재 잔액이 있다면 추가 충전하지 마세요.';
        else if (quota) problem = 'API 크레딧 또는 사용·지출 한도가 부족합니다 (429). OpenAI Platform → Billing에서 잔액과 한도를 확인해 주세요. ChatGPT Plus와 API 결제는 별개입니다.';
        else problem = 'API 요청 속도·토큰 한도를 초과했습니다 (429). OpenAI Platform → Limits에서 요청·토큰 한도를 확인해 주세요.';
      } else if (upstream.status === 401) {
        problem = 'OpenAI API 키 인증에 실패했습니다 (401). Render의 OPENAI_API_KEY를 확인해 주세요.';
      } else if (upstream.status === 403) {
        problem = 'OpenAI API 접근 권한이 없습니다 (403). 프로젝트·모델 사용 권한을 확인해 주세요.';
      } else if (upstream.status === 400) {
        problem = 'AI 요청 설정 오류 (400). 모델과 분석 프레임 설정을 확인해 주세요.';
      }
      return respond(res,upstream.status===429?429:502,{error:problem,code});
    }
    const choice = json.choices?.[0] || {};
    const finish = String(choice.finish_reason || 'unknown');
    const refusal = Boolean(choice.message?.refusal);
    const content = choice.message?.content;
    if(refusal || finish === 'content_filter') {
      console.warn('OpenAI completion filtered finish=%s refusal=%s attempt=%s',finish,refusal,attempt+1);
      return respond(res,422,{error:'이 구간의 AI 분석이 콘텐츠 필터에 의해 제한됐습니다. 결제나 토큰 한도 문제가 아닙니다. 해당 구간의 원본 내용을 확인하거나 다른 구간을 분석해 주세요.',code:'content_filtered'});
    }
    if(typeof content!=='string' || !content.trim()) {
      console.warn('OpenAI completion empty finish=%s attempt=%s output_tokens=%s choices=%s',finish,attempt+1,json.usage?.completion_tokens??'unknown',json.choices?.length??0);
      if(attempt===0)continue;
      return respond(res,502,{error:'AI가 빈 응답을 두 번 반환했습니다 (종료 이유: '+finish+'). 다시 요청해도 반복된다면 이 구간의 장면이 콘텐츠 필터에 걸리는지 확인하거나 구간 길이를 줄여 주세요.',code:'empty_completion',finish_reason:finish});
    }
    let result;
    try { result=JSON.parse(content); }
    catch {
      console.warn('OpenAI completion invalid JSON finish=%s attempt=%s output_tokens=%s',finish,attempt+1,json.usage?.completion_tokens??'unknown');
      if(attempt===0)continue;
      return respond(res,502,{error:finish==='length'?'AI 출력 토큰 길이 제한으로 JSON을 완성하지 못했습니다. 구간 길이나 프레임 수를 줄여 주세요.':'AI 분석 응답의 JSON 형식을 두 번 확인했지만 올바르지 않았습니다. 다시 시도해 주세요.',code:'invalid_json',finish_reason:finish});
    }
    if(!result || typeof result!=='object' || !String(result.prompt_ko||'').trim()) {
      console.warn('OpenAI completion missing prompt finish=%s attempt=%s',finish,attempt+1);
      if(attempt===0)continue;
      return respond(res,502,{error:'AI가 필수 한국어 프롬프트를 생성하지 않았습니다. 다른 구간을 시도해 주세요.',code:'missing_prompt'});
    }
    return respond(res,200,{result:normalizeResult(result),model:MODEL});
  }
  return respond(res,502,{error:'AI 응답이 완성되지 않았습니다. 해당 구간을 다시 분석해 주세요.',code:'incomplete_result'});
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
