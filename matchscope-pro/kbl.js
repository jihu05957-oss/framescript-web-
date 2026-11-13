'use strict';
// KBL public schedule endpoint; unofficial integration without an SLA.
const ENDPOINT='https://api.kbl.or.kr/match/list';
const HEADERS={accept:'application/json, text/plain, */*','accept-language':'ko-KR,ko;q=0.9','user-agent':'MatchScope-Pro/1.1','x-requested-with':'XMLHttpRequest',channel:'WEB',teamcode:'XX',lang:'ko'};
const CACHE=new Map();
function shift(d,amount){const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+amount);return x.toISOString().slice(0,10)}
function kst(v){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v))}
function clock(v){const m=String(v??'').match(/^(\d{2}):?(\d{2})/);return m?m[1]+':'+m[2]:'00:00'}
function score(v,started){if(!started||v==null||v==='')return null;const n=Number(v);return Number.isFinite(n)?n:null}
function normalizeKBL(row){
 if(!row||typeof row!=='object'||!/^\d{8}$/.test(String(row.gameDate||''))||!row.tnameH||!row.tnameA)return null;
 const d=String(row.gameDate),date=d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8);
 const dateTime=new Date(date+'T'+clock(row.gameStart)+':00+09:00');if(!Number.isFinite(dateTime.getTime()))return null;
 const finished=Number(row.isEnded)===1,started=finished||Number(row.isStarted)===1;
 const team=side=>({id:String(row['tcode'+side]||''),name:String(row['tnameF'+side]||row['tname'+side]),short:String(row['tname'+side]),logo:null,score:score(row['score'+side],started),record:null,rank:null});
 return {id:'kbl:kbl:'+(row.gmkey||[row.gameDate,row.tcodeH,row.tcodeA,row.gameNo].join(':')),source:'KBL 공식 홈페이지 공개 경기 데이터',sourceType:'kbl',
 externalId:String(row.gmkey||''),league:'kbl',leagueName:'KBL',sport:'basketball',date:dateTime.toISOString(),
 status:finished?'final':started?'live':'scheduled',statusText:finished?'종료':started?'진행 중':'예정',
 home:team('H'),away:team('A'),venue:row.stadiumnameF||row.stadiumname||null,detail:row.seasonName1||null,odds:null};
}
async function fetchRange(from,to){
 const key=from+':'+to,old=CACHE.get(key),now=Date.now();
 if(old?.rows&&now-old.time<300000)return old.rows;
 if(old?.pending)return old.pending;
 const pending=(async()=>{
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),9500);
 try{
 const p=new URLSearchParams({fromDate:from.replace(/-/g,''),toDate:to.replace(/-/g,''),tcodeList:'all',seasonGrade:'1'});
 const response=await fetch(ENDPOINT+'?'+p.toString(),{headers:HEADERS,signal:abort.signal});
 if(!response.ok)throw new Error('KBL HTTP '+response.status);
 const rows=await response.json();
 if(!Array.isArray(rows))throw new Error('KBL 데이터 형식 오류');
 CACHE.set(key,{rows,time:Date.now()});return rows;
 }finally{clearTimeout(timer)}
 })();
 CACHE.set(key,{pending,time:now});
 try{return await pending}catch(e){CACHE.delete(key);throw e}
}
async function day(date){
 const rows=await fetchRange(date,date);return {ok:true,games:rows.map(normalizeKBL).filter(Boolean).filter(g=>kst(g.date)===date)};
}
async function recent(game){
 const date=kst(game.date),rows=await fetchRange(shift(date,-55),shift(date,-1));
 const ids=new Set([game.home.id,game.away.id]);
 return rows.map(normalizeKBL).filter(Boolean).filter(g=>g.status==='final'&&(ids.has(g.home.id)||ids.has(g.away.id)))
 .sort((a,b)=>b.date.localeCompare(a.date)).slice(0,60);
}
module.exports={day,recent,normalizeKBL,fetchRange};
