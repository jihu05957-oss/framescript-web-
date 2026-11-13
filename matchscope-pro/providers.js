'use strict';
const {LEAGUES,leagueById,espnPath}=require('./leagues');
const {day:kblOfficialDay,recent:kblOfficialRecent}=require('./kbl');
const national=require('./national');
const ESPN='https://site.api.espn.com/apis/site/v2/sports';
const TSDB='https://www.thesportsdb.com/api/v1/json/123';
const CACHE=new Map(),SOURCE_HEALTH=new Map(),GAME_INDEX=new Map();
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
 const now=Date.now();
 for(const game of games)GAME_INDEX.set(date+'|'+game.id,{game,at:now});
 if(GAME_INDEX.size>6000){for(const [key,val] of GAME_INDEX)if(now-val.at>1800000)GAME_INDEX.delete(key);}
 return {date,timezone:'Asia/Seoul',games,statuses,generatedAt:new Date().toISOString(),complete:false,
 warning:'무료 제공처 데이터는 리그별 커버리지가 달라 전체 경기의 누락 여부를 보장할 수 없습니다.'};
}
async function findGame(date,id){
 const cache=GAME_INDEX.get(date+'|'+id);
 if(cache&&Date.now()-cache.at<1800000)return cache.game;
 const bits=String(id).split(':');
 if(bits.length<3||!['espn','tsdb','kbl'].includes(bits[0]))return null;
 const league=leagueById(bits[1]);
 if(!league)return null;
 const result=await oneDay(league,date);
 for(const game of result.games)GAME_INDEX.set(date+'|'+game.id,{game,at:Date.now()});
 return result.games.find(game=>game.id===id)||null;
}
async function espnRecent(g,l){
 const ids=[g.home.id,g.away.id].filter(Boolean),year=Number((g.date||'').slice(0,4))||new Date().getFullYear(),out=[];
 const seasons=l.id==='nba'?[year+1,year,year-1]:[year,year-1];
 const urls=ids.flatMap(id=>seasons.map(y=>ESPN+'/'+espnPath(l.sport)+'/'+l.espn+'/teams/'+encodeURIComponent(id)+'/schedule?season='+y+'&limit=100'));
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
function readableStatus(s){
 if(typeof s==='string')return s;
 if(!s||typeof s!=='object')return '';
 return s.description||s.displayName||s.name||s.abbreviation||s.type?.description||'';
}
function parseInjuryRows(data,team,url){
 const rows=Array.isArray(data?.injuries)?data.injuries:Array.isArray(data?.items)?data.items:[];
 const output=[];
 for(const entry of rows){
  const athlete=entry.athlete||entry.player||entry;
  const name=athlete.displayName||athlete.fullName||entry.name;
  if(!name)continue;
  const sub=Array.isArray(entry.injuries)?entry.injuries:[entry];
  for(const item of sub.slice(0,3)){
   const text=[readableStatus(item.status),readableStatus(item.type),readableStatus(item.details?.type),readableStatus(item.details?.detail)].filter(Boolean).join(' / ');
   const status=text||'상태 미확인';
   output.push({team,name,status,source:'ESPN 선수 상태',sourceUrl:url,checkedAt:new Date().toISOString(),updatedAt:item.date||item.updated||null});
  }
 }
 return [...new Map(output.map(r=>[r.team+'|'+r.name+'|'+r.status,r])).values()];
}
function parseLeaderRows(data,team,url){
 const sections=[...(Array.isArray(data?.leaders)?data.leaders:[]),...(Array.isArray(data?.teamLeaders)?data.teamLeaders:[])];
 const rows=new Map();
 for(const group of sections){
  const name=String(group.displayName||group.name||group.category?.displayName||group.category||'주요 기록').slice(0,35);
  const athletes=Array.isArray(group.leaders)?group.leaders:Array.isArray(group.athletes)?group.athletes:[];
  for(const item of athletes.slice(0,3)){
   const nameValue=item.athlete?.displayName||item.athlete?.fullName||item.displayName||item.name;
   if(!nameValue)continue;
   const key=String(nameValue).toLowerCase(),prev=rows.get(key)||{team,name:nameValue,categories:[],sourceUrl:url};
   if(!prev.categories.includes(name))prev.categories.push(name);rows.set(key,prev);
  }
 }
 return [...rows.values()];
}
async function espnSupplement(g,l){
 const extra={injuries:[],lineups:[],odds:[],news:[],leaders:[],h2h:[],available:[]};
 const root=ESPN+'/'+espnPath(l.sport)+'/'+l.espn,ids=[g.home.id,g.away.id];
 const eventUrl=root+'/summary?event='+encodeURIComponent(g.externalId);
 try{
  const d=await getJson(eventUrl,900000);
  for(const p of d.pickcenter||[])if(p.details||p.overUnder)extra.odds.push({provider:p.provider?.name||'ESPN',spread:p.details||null,total:p.overUnder||null,sourceUrl:eventUrl});
  for(const t of d.header?.competitions?.[0]?.competitors||[])if(t.records?.length)extra.available.push((t.team?.displayName||'')+': '+t.records.map(r=>r.summary).join(', '));
  // ESPN "rosters" frequently refer to previous-game starters; they are NOT verified future lineups.
  if(g.status==='live'||g.status==='final')for(const r of d.rosters||[]){
   const players=(r.roster||[]).filter(p=>p.starter===true).map(p=>p.athlete?.displayName).filter(Boolean);
   if(players.length)extra.lineups.push({team:r.team?.displayName||'',players,kind:'해당 경기 출전/선발 명단',sourceUrl:eventUrl});
  }
 }catch(e){}
 const injuryUrls=ids.map(id=>root+'/teams/'+encodeURIComponent(id)+'/injuries');
 const injuryResults=await Promise.allSettled(injuryUrls.map(u=>getJson(u,600000)));
 for(let i=0;i<injuryResults.length;i++){
  const r=injuryResults[i];if(r.status!=='fulfilled')continue;
  extra.injuries.push(...parseInjuryRows(r.value,i===0?g.home.name:g.away.name,injuryUrls[i]));
 }
 // Season leaders are evidence of importance; not a substitute for minutes or confirmed starter status.
 if(extra.injuries.length){
  const leaderUrls=ids.map(id=>root+'/teams/'+encodeURIComponent(id)+'/leaders');
  const leaders=await Promise.allSettled(leaderUrls.map(u=>getJson(u,1200000)));
  for(let i=0;i<leaders.length;i++)if(leaders[i].status==='fulfilled')extra.leaders.push(...parseLeaderRows(leaders[i].value,i===0?g.home.name:g.away.name,leaderUrls[i]));
 }
 // News endpoint can be unavailable for some leagues. Headlines are not "expert predictions."
 const newsUrl=root+'/news?limit=80';
 try{
  const data=await getJson(newsUrl,900000);
  for(const a of (data.articles||[]).slice(0,80)){
   const title=a.headline||a.title,url=a.links?.web?.href||a.links?.mobile?.href;
   if(title&&typeof url==='string'&&url.startsWith('https://'))extra.news.push({title:String(title).slice(0,180),url,source:'ESPN 기사',publishedAt:a.published||a.lastModified||null});
  }
 }catch(e){}
 return extra;
}

async function detail(g){
 const l=leagueById(g.league);if(!l)throw Error('리그를 찾지 못했습니다.');
 const international=l.id.startsWith('intl-');
 const emptyExtra=()=>({injuries:[],lineups:[],odds:[],news:[],leaders:[],h2h:[],available:[]});
 const promises=[
  g.sourceType==='kbl'?kblOfficialRecent(g):g.sourceType==='espn'&&l.espn?espnRecent(g,l):tsdbRecent(g,l),
  g.sourceType==='espn'&&l.espn?espnSupplement(g,l):Promise.resolve(emptyExtra()),
  international?national.load().then(dataset=>national.matchFacts(g,dataset)):Promise.resolve(null)
 ];
 const results=await Promise.allSettled(promises);
 const extra=results[1].status==='fulfilled'?results[1].value:emptyExtra();
 const match=results[2].status==='fulfilled'?results[2].value:null;
 const raw=results[0].status==='fulfilled'?results[0].value:[];
 const history=match&&match.history.length?match.history:raw;
 const errors=results.filter(r=>r.status==='rejected').map(r=>String(r.reason?.message||r.reason||'자료 수집 실패').slice(0,200));
 if(match?.strength){
  const s=match.strength;
  extra.available.push('국가대표 Elo(자체 계산) '+g.home.name+' '+(s.homeRating??'미확인')+', '+g.away.name+' '+(s.awayRating??'미확인'));
  extra.available.push('국가대표 완료 경기 기록 '+s.homeGames+' / '+s.awayGames+'경기 (최근 24개월)');
  extra.available.push('A매치 원본 자료 마지막 경기 '+s.sourceLastMatch);
 }
 return {history,extra,errors,strength:match?.strength||null};
}

module.exports={LEAGUES,listDay,findGame,detail,getJson,SOURCE_HEALTH,normalizeESPN,normalizeTSDB,kst,parseInjuryRows,parseLeaderRows};
