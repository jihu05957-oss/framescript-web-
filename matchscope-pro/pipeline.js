'use strict';
const {listDay,findGame,detail}=require('./providers');
const {model}=require('./model');
const {build}=require('./insights');
const ANALYSES=new Map(),JOBS=new Map();
const TTL=20*60*1000,MAX=1200,MAX_JOBS=2,MAX_GAMES=220,CONCURRENCY=2;
function emptyExtra(){return {injuries:[],lineups:[],odds:[],news:[],leaders:[],h2h:[],available:[],sourceChecks:[]};}
function key(date,id){return date+'|'+id;}
function outOfDate(){const n=Date.now();for(const [k,v] of ANALYSES)if(n-v.at>TTL&&v.status==='ready')ANALYSES.delete(k);
 if(ANALYSES.size>MAX){const keys=[...ANALYSES.keys()];for(let i=0;i<keys.length-MAX;i++)ANALYSES.delete(keys[i]);}
 for(const [k,v] of JOBS)if(n-v.at>3600000&&v.done)JOBS.delete(k);
}
async function researchOne(date,id,{demo=false}={}){
 if(demo)throw Error('Demo data is supported by the legacy test route.');
 const cacheKey=key(date,id),old=ANALYSES.get(cacheKey);
 if(old?.status==='ready'&&Date.now()-old.at<TTL)return old.data;
 if(old?.status==='pending')return old.promise;
 const promise=(async()=>{
  const t=Date.now();
  const game=await findGame(date,id);
  if(!game)throw Error('선택한 날짜에서 경기를 찾을 수 없습니다. 날짜별 경기 목록을 다시 갱신해 주세요.');
  let timer;
  let facts;
  try{
   facts=await Promise.race([
    detail(game),
    new Promise(resolve=>{timer=setTimeout(()=>resolve({history:[],extra:emptyExtra(),strength:null,errors:['상세 자료 수집 제한시간 12초 초과: 미확인 항목은 추정하지 않습니다.']}),12000);})
   ]);
  }finally{if(timer)clearTimeout(timer);}
  const prediction=model(game,facts.history,{strength:facts.strength||null});
  const insights=build(game,facts.history,facts.extra||emptyExtra(),facts.strength||null,facts.errors||[]);
  const result={game,history:facts.history,extra:facts.extra||emptyExtra(),errors:facts.errors||[],
   prediction,insights,strength:facts.strength||null,generatedAt:new Date().toISOString(),
   analysisMode:!prediction.available?'insufficient':facts.errors.length?'limited':'standard',
   limitations:['선수 중요도는 확보된 기록에서 확인된 기여만 구분합니다. 기록이 없으면 주전·서브 여부를 추측하지 않습니다.',
    '로테이션 의도·현지 여론·부상 상황·시장 배당은 확인된 원문 없이는 확정할 수 없습니다.',
    '확률은 장기간 외부 검증되지 않은 간이 모델의 추정이며 경기 결과나 수익을 보장하지 않습니다.']};
  console.info('MatchScope research',JSON.stringify({league:game.league,ms:Date.now()-t,mode:result.analysisMode,history:result.history.length,injuries:result.extra.injuries?.length||0,sections:insights.sections.length}));
  return result;
 })();
 ANALYSES.set(cacheKey,{status:'pending',at:Date.now(),promise});
 try{
  const result=await promise;
  ANALYSES.set(cacheKey,{status:'ready',at:Date.now(),data:result});
  outOfDate();return result;
 }catch(error){ANALYSES.delete(cacheKey);throw error;}
}
function dateInRange(date){
 if(!/^\d{4}-\d\d-\d\d$/.test(date||''))return false;
 const d=Date.parse(date+'T12:00:00Z');if(!Number.isFinite(d))return false;
 const now=Date.now();return Math.abs(d-now)<32*86400000;
}
function status(date){
 const job=JOBS.get(date);
 if(!job)return {date,state:'not-started',total:0,done:0,complete:0,insufficient:0,errors:0,generatedAt:null};
 const {ids,index,ready,insufficient,errors,done}=job;
 return {date,state:done?'finished':'running',total:ids.length,done:index,complete:ready,insufficient,errors,
  generatedAt:new Date(job.at).toISOString(),lastUpdate:job.updatedAt?new Date(job.updatedAt).toISOString():null,
  notice:'분석 작업은 서버 인스턴스가 실행 중인 동안만 유지됩니다. 무료 서버 중단 시 재시작이 필요합니다.'};
}
async function start(date){
 if(!dateInRange(date))throw Error('전 경기 자동 분석은 현재 날짜 기준 ±31일 범위에서만 시작할 수 있습니다.');
 const existing=JOBS.get(date);
 if(existing&&!existing.done)return status(date);
 if(existing?.done&&Date.now()-existing.at<TTL)return status(date);
 if([...JOBS.values()].filter(j=>!j.done).length>=MAX_JOBS)throw Error('다른 날짜의 전 경기 분석이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
 const day=await listDay(date),ids=day.games.slice(0,MAX_GAMES).map(g=>g.id);
 const job={ids,index:0,ready:0,insufficient:0,errors:0,done:false,at:Date.now(),updatedAt:Date.now()};
 JOBS.set(date,job);
 let cursor=0;
 const work=async()=>{
  while(cursor<ids.length){
   const id=ids[cursor++];
   try{
    const data=await researchOne(date,id);
    if(data.prediction.available)job.ready++;else job.insufficient++;
   }catch(e){job.errors++;console.warn('Batch research failed',JSON.stringify({date,id,reason:String(e.message||e).slice(0,100)}));}
   job.index++;job.updatedAt=Date.now();
  }
 };
 // Fire-and-forget only while Node server runs. Never claim durable scheduling.
 Promise.all(Array.from({length:Math.min(CONCURRENCY,ids.length)},()=>work())).then(()=>{job.done=true;job.updatedAt=Date.now();}).catch(e=>{job.done=true;console.warn('Batch worker failed',String(e.message||e));});
 if(!ids.length){job.done=true;}
 outOfDate();
 return status(date);
}
module.exports={researchOne,start,status,dateInRange};
