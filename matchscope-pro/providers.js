'use strict';
const {LEAGUES,leagueById,espnPath}=require('./leagues');
const {day:kblOfficialDay,recent:kblOfficialRecent}=require('./kbl');
const ESPN='https://site.api.espn.com/apis/site/v2/sports';
const TSDB='https://www.thesportsdb.com/api/v1/json/123';
const CACHE=new Map(),SOURCE_HEALTH=new Map();
let active=0;const queue=[];
function gate(){return new Promise(resolve=>{const run=()=>{active++;resolve(()=>{active--;if(queue.length)queue.shift()();})};if(active<6)run();else queue.push(run);});}
async function getJson(url,ttl=300000){
 const old=CACHE.get(url),now=Date.now();
 if(old?.data&&now-old.at<ttl)return old.data;
 if(old?.pending)return old.pending;
 const pending=(async()=>{const release=await gate();const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),9500);
 try{const response=await fetch(url,{headers:{accept:'application/json','user-agent':'MatchScope-Pro/1.0'},signal:controller.signal});
 if(!response.ok)throw Error('HTTP '+response.status);
 const data=await response.json();CACHE.set(url,{at:Date.now(),data});return data;}
 finally{clearTimeout(timeout);release();}})();
 CACHE.set(url,{pending,at:now});
 try{return await pending}catch(e){if(old?.data){CACHE.set(url,old);return old.data;}CACHE.delete(url);throw e;}
}
function kst(d){const v=new Date(d);return Number.isFinite(v.getTime())?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(v):null;}
function iso(d){const x=new Date(d);return Number.isFinite(x.getTime())?x.toISOString():null;}
function shift(day,offset){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
function normalizeESPN(e,l){
 const c=e.competitions?.[0]||{},teams=c.competitors||[];
 const x=teams.find(t=>t.homeAway==='home'),y=teams.find(t=>t.homeAway==='away');
 if(!x||!y)return null;
 const team=t=>({id:String(t.team?.id||''),name:t.team?.displayName||t.team?.name||'미확인',short:t.team?.shortDisplayName||t.team?.abbreviation||'',logo:t.team?.logo||t.team?.logos?.[0]?.href||null,score:t.score==null?null:Number(t.score),record:t.records?.[0]?.summary||null,rank:t.curatedRank?.current||null});
 return {id:'espn:'+l.id+':'+e.id,source:'ESPN 공개 데이터',sourceType:'espn',externalId:String(e.id),league:l.id,leagueName:l.name,sport:l.sport,
 date:iso(e.date||c.date),status:e.status?.type?.state==='post'?'final':e.status?.type?.state==='in'?'live':'scheduled',
 statusText:e.status?.type?.shortDetail||e.status?.type?.description||'',home:team(x),away:team(y),venue:c.venue?.fullName||null,detail:null,odds:null};
}
function normalizeTSDB(e,l){
 if(!e.idEvent||!e.strHomeTeam||!e.strAwayTeam)return null;
 const day=e.dateEvent,tm=e.strTime,ts=iso(e.strTimestamp||((day&&tm&&/^\d\d:\d\d/.test(tm))?day+'T'+tm.slice(0,8)+'Z':day?day+'T12:00:00Z':null));
 const v=x=>(x===null||x===undefined||x==='')?null:Number(x),hs=v(e.intHomeScore),as=v(e.intAwayScore);
 const done=Number.isFinite(hs)&&Number.isFinite(as),live=!done&&/live|progress|half|quarter|inning/i.test(e.strStatus||'');
 return {id:'tsdb:'+l.id+':'+e.idEvent,source:'TheSportsDB 무료 API',sourceType:'tsdb',externalId:String(e.idEvent),league:l.id,leagueName:l.name,sport:l.sport,date:ts,
 status:done?'final':live?'live':'scheduled',statusText:e.strStatus||'',home:{id:String(e.idHomeTeam||e.strHomeTeam),name:e.strHomeTeam,short:e.strHomeTeam,logo:e.strHomeTeamBadge||null,score:Number.isFinite(hs)?hs:null,record:null},
 away:{id:String(e.idAwayTeam||e.strAwayTeam),name:e.strAwayTeam,short:e.strAwayTeam,logo:e.strAwayTeamBadge||null,score:Number.isFinite(as)?as:null,record:null},
 venue:e.strVenue||null,detail:null,odds:null};
}
async function espnSchedule(l,date){
 if(!l.espn)return {games:[],ok:false};
 const ds=[date,shift(date,-1)];const results=await Promise.allSettled(ds.map(d=>getJson(ESPN+'/'+espnPath(l.sport)+'/'+l.espn+'/scoreboard?dates='+d.replace(/-/g,'')+'&limit=300',240000)));
 const games=results.flatMap(r=>r.status==='fulfilled'?(r.value.events||[]).map(e=>normalizeESPN(e,l)).filter(Boolean):[]);
 return {ok:results.some(r=>r.status==='fulfilled'),games:games.filter(g=>kst(g.date)===date)};
}
async function tsdbSchedule(l,date){
 if(!l.tsdb)return {games:[],ok:false};
 const dates=[date,shift(date,-1)];let ok=false;const games=[];
 for(const d of dates){try{const data=await getJson(TSDB+'/eventsday.php?d='+d+'&l='+l.tsdb,720000);ok=true;
 for(const e of data.events||[])if(String(e.idLeague)===String(l.tsdb)){
 const game=normalizeTSDB(e,l);if(game&&(kst(game.date)===date||(!e.strTimestamp&&e.dateEvent===date)))games.push(game);
 }}catch(e){}}
 return {ok,games};
}
function comparableName(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
 .replace(/\b(football club|fc|cf|afc|sc|club|national team)\b/g,'').replace(/[^a-z0-9가-힣]+/g,'').trim();}
function namesEqual(a,b){const x=comparableName(a),y=comparableName(b);return x===y||(x.length>=4&&y.length>=4&&(x.includes(y)||y.includes(x)));}
function unique(games){
 const out=[];
 for(const g of games){if(!g?.date||!g.home||!g.away)continue;
 const i=out.findIndex(v=>v.league===g.league&&kst(v.date)===kst(g.date)
  &&Math.abs(new Date(v.date)-new Date(g.date))<10800000
  &&namesEqual(v.home.name,g.home.name)&&namesEqual(v.away.name,g.away.name));
 if(i<0)out.push(g);
 else if(g.sourceType==='espn'||g.sourceType==='kbl')out[i]=g;
 }
 return out;
}
async function oneDay(l,date){
 if(l.id==='kbl'){
  let official={ok:false,games:[]},fallback={ok:false,games:[]},error=null;
  try{official=await kblOfficialDay(date)}catch(e){error=String(e.message||e).slice(0,120)}
  if(!official.games.length)try{fallback=await tsdbSchedule(l,date)}catch(e){}
  const games=unique([...official.games,...fallback.games]);
  const status={id:l.id,league:l.name,count:games.length,official:official.ok,tsdb:fallback.ok,status:official.ok||fallback.ok?'ok':'unavailable',coverage:'미보장',error};
  SOURCE_HEALTH.set(l.id,{...status,checkedAt:new Date().toISOString()});return {games,status};
 }

 let a={games:[],ok:false},b={games:[],ok:false};
 try{a=await espnSchedule(l,date);}catch(e){}
 try{b=await tsdbSchedule(l,date);}catch(e){}
 const games=unique([...a.games,...b.games]);
 const status={id:l.id,league:l.name,count:games.length,espn:a.ok,tsdb:b.ok,status:a.ok||b.ok?'ok':'unavailable',coverage:'미보장'};
 SOURCE_HEALTH.set(l.id,{...status,checkedAt:new Date().toISOString()});return {games,status};
}
async function listDay(date){
 const results=await Promise.allSettled(LEAGUES.map(l=>oneDay(l,date)));
 const games=unique(results.flatMap(r=>r.status==='fulfilled'?r.value.games:[])).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
 const statuses=LEAGUES.map((l,i)=>results[i].status==='fulfilled'?results[i].value.status:{id:l.id,league:l.name,count:0,status:'unavailable',coverage:'미보장'});
 return {date,timezone:'Asia/Seoul',games,statuses,generatedAt:new Date().toISOString(),complete:false,
 warning:'무료 제공처 데이터는 리그별 커버리지가 달라 전체 경기의 누락 여부를 보장할 수 없습니다.'};
}
async function espnRecent(g,l){
 const ids=[g.home.id,g.away.id].filter(Boolean),year=Number((g.date||'').slice(0,4))||new Date().getFullYear(),out=[];
 const urls=ids.flatMap(id=>[year,year-1].map(y=>ESPN+'/'+espnPath(l.sport)+'/'+l.espn+'/teams/'+encodeURIComponent(id)+'/schedule?season='+y+'&limit=100'));
 const responses=await Promise.allSettled(urls.map(u=>getJson(u,1200000)));
 for(const r of responses)if(r.status==='fulfilled')for(const e of r.value.events||[]){const v=normalizeESPN(e,l);if(v)out.push(v);}
 return [...new Map(out.map(x=>[x.externalId,x])).values()];
}
async function tsdbRecent(g,l){
 const ids=[g.home.id,g.away.id],all=[];
 const responses=await Promise.allSettled(ids.map(id=>getJson(TSDB+'/eventslast.php?id='+encodeURIComponent(id),900000)));
 for(const r of responses)if(r.status==='fulfilled')for(const e of r.value.results||[]){const v=normalizeTSDB(e,l);if(v)all.push(v);}
 return [...new Map(all.map(x=>[x.externalId,x])).values()];
}
async function espnSupplement(g,l){
 const extra={injuries:[],lineups:[],odds:[],news:[],h2h:[],available:[]},root=ESPN+'/'+espnPath(l.sport)+'/'+l.espn;
 try{const d=await getJson(root+'/summary?event='+encodeURIComponent(g.externalId),900000);
 for(const p of d.pickcenter||[])if(p.details||p.overUnder)extra.odds.push({provider:p.provider?.name||'ESPN',spread:p.details||null,total:p.overUnder||null});
 for(const t of d.header?.competitions?.[0]?.competitors||[])if(t.records?.length)extra.available.push((t.team?.displayName||'')+': '+t.records.map(r=>r.summary).join(', '));
 for(const r of d.rosters||[]){const players=(r.roster||[]).filter(p=>p.starter===true).map(p=>p.athlete?.displayName).filter(Boolean);if(players.length)extra.lineups.push({team:r.team?.displayName||'',players});}
 }catch(e){}
 const responses=await Promise.allSettled([g.home.id,g.away.id].map(id=>getJson(root+'/teams/'+encodeURIComponent(id)+'/injuries',600000)));
 for(let i=0;i<responses.length;i++){const r=responses[i];if(r.status!=='fulfilled')continue;
 for(const entry of (r.value.injuries||r.value.items||[]).slice(0,18)){const name=entry.athlete?.displayName||entry.name;if(name)extra.injuries.push({team:i===0?g.home.name:g.away.name,name,status:String(entry.status||entry.type?.description||'확인 중').slice(0,100)});}}
 return extra;
}
async function detail(g){
 const l=leagueById(g.league);if(!l)throw Error('리그를 찾지 못했습니다.');
 const promises=[g.sourceType==='kbl'?kblOfficialRecent(g):g.sourceType==='espn'&&l.espn?espnRecent(g,l):tsdbRecent(g,l),g.sourceType==='espn'&&l.espn?espnSupplement(g,l):Promise.resolve({injuries:[],lineups:[],odds:[],news:[],h2h:[],available:[]})];
 const results=await Promise.allSettled(promises);
 return {history:results[0].status==='fulfilled'?results[0].value:[],extra:results[1].status==='fulfilled'?results[1].value:{injuries:[],lineups:[],odds:[],news:[],h2h:[],available:[]},
 errors:results.filter(r=>r.status==='rejected').map(r=>r.reason?.message||'데이터 조회 실패')};
}
module.exports={LEAGUES,listDay,detail,getJson,SOURCE_HEALTH,normalizeESPN,normalizeTSDB,kst};
