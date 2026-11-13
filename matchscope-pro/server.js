'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {LEAGUES}=require('./leagues'),{listDay,detail,SOURCE_HEALTH,getJson}=require('./providers'),{model}=require('./model');
const PORT=process.env.PORT||3000,ROOT=path.resolve(__dirname,'public');
function send(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','access-control-allow-origin':'same-origin'});res.end(JSON.stringify(payload));}
function validDate(day){if(!/^\d{4}-\d{2}-\d{2}$/.test(day||''))return false;const d=new Date(day+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day&&Number(day.slice(0,4))>=2020&&Number(day.slice(0,4))<=2035;}
function demoGames(day){const t=new Date(day+'T08:00:00Z').getTime(),sports={soccer:1,baseball:1,basketball:1};
 return LEAGUES.map((l,i)=>{const homes=['서울','울산','아스널','레알 마드리드','바이에른 뮌헨','인터 밀란','파리 생제르맹','가시마','LG','LA 다저스','요미우리','서울 SK','LA 레이커스'];
 const aways=['전북','포항','리버풀','바르셀로나','도르트문트','유벤투스','마르세유','우라와','두산','뉴욕 양키스','한신','창원 LG','보스턴'];
 const date=new Date(t+(i%7)*3600000).toISOString();
 return {id:'demo:'+l.id+':0',source:'가상 샘플 데이터',sourceType:'demo',externalId:'demo-'+i,league:l.id,leagueName:l.name,sport:l.sport,date,status:'scheduled',statusText:'DEMO',
 home:{id:'demo-home-'+l.id,name:homes[i],short:homes[i],score:null,logo:null,record:null},
 away:{id:'demo-away-'+l.id,name:aways[i],short:aways[i],score:null,logo:null,record:null},venue:null,detail:null,odds:null,demo:true};});}
function demoHistory(game){
 const out=[],date=new Date(game.date).getTime();
 for(const side of ['home','away'])for(let i=0;i<8;i++){
 const team=game[side],opponent={id:'demo-opponent-'+side+'-'+i,name:'샘플 상대 '+(i+1)},isHome=i%2===0;
 const v=game.sport==='soccer'?1:game.sport==='baseball'?4:90;
 const points=(i*17+game.league.length)%3-1;
 const gs=v+points*(game.sport==='basketball'?6:1),as=v-points*(game.sport==='basketball'?4:1);
 out.push({date:new Date(date-(i+1)*86400000*3).toISOString(),status:'final',
 home:{...isHome?team:opponent,score:isHome?gs:as},away:{...isHome?opponent:team,score:isHome?as:gs}});
 }return out;
}
async function handler(req,res){
 const url=new URL(req.url,'http://localhost'),route=url.pathname;
 if(req.method!=='GET')return send(res,405,{error:'GET만 허용됩니다.'});
 if(route==='/api/health')return send(res,200,{ok:true,app:'MatchScope Pro',time:new Date().toISOString(),providers:[...SOURCE_HEALTH.values()]});
 if(route==='/api/leagues')return send(res,200,{leagues:LEAGUES});
 if(route==='/api/games'||route==='/api/analysis'){
 const date=url.searchParams.get('date');
 if(!validDate(date))return send(res,400,{error:'YYYY-MM-DD 형식의 유효한 날짜를 입력하세요.'});
 const demo=url.searchParams.get('demo')==='1';
 try{
 if(route==='/api/games'){
 if(demo){const games=demoGames(date);return send(res,200,{date,timezone:'Asia/Seoul',games,statuses:LEAGUES.map(l=>({id:l.id,league:l.name,count:games.filter(g=>g.league===l.id).length,status:'demo',coverage:'가상'})),demo:true,complete:false,generatedAt:new Date().toISOString(),warning:'가상 경기이며 실제 경기나 예측 결과가 아닙니다.'});}
 return send(res,200,await listDay(date));
 }
 const id=url.searchParams.get('id');
 if(!id||id.length>120)return send(res,400,{error:'경기 ID를 확인하세요.'});
 const scheduled=demo?{games:demoGames(date)}:await listDay(date);
 const game=scheduled.games.find(g=>g.id===id);
 if(!game)return send(res,404,{error:'선택한 날짜에서 해당 경기를 찾지 못했습니다. 다시 검색해 주세요.'});
 const facts=demo?{history:demoHistory(game),extra:{injuries:[],lineups:[],odds:[],news:[],h2h:[],available:[]},errors:[]}:await detail(game);
 return send(res,200,{game,history:facts.history,extra:facts.extra,errors:facts.errors,prediction:model(game,facts.history),generatedAt:new Date().toISOString(),
 limitations:['공개 자료로 확인되지 않은 부상·선발·배당 등은 제공되지 않습니다.','통계 예측은 경기 결과나 수익을 보장하지 않습니다.','리그별 무료 소스 데이터가 누락될 수 있습니다.']});
 }catch(e){console.error(route,e?.message);return send(res,502,{error:'공개 경기 데이터를 가져오지 못했습니다.',detail:String(e?.message||e).slice(0,250)});}
 }
 if(route.startsWith('/api/'))return send(res,404,{error:'지원하지 않는 API'});
 let filename=route==='/'?'/index.html':route;try{filename=decodeURIComponent(filename);}catch{return send(res,400,{error:'잘못된 경로'});}
 const full=path.resolve(ROOT,'.'+filename);
 if(!full.startsWith(ROOT+path.sep))return send(res,403,{error:'접근 불가'});
 fs.readFile(full,(e,data)=>{if(e){res.writeHead(404);return res.end('Not found');}
 const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
 res.writeHead(200,{'content-type':mime[path.extname(full)]||'application/octet-stream','x-content-type-options':'nosniff','cache-control':path.extname(full)==='.html'?'no-cache':'public,max-age=3600'});res.end(data);});
}
const server=http.createServer((req,res)=>Promise.resolve(handler(req,res)).catch(e=>{if(!res.headersSent)send(res,500,{error:'예상하지 못한 서버 오류'});}));
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>{
 console.log('MatchScope Pro listening on '+PORT);
 const checks=[
  ['ESPN','https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard?dates=20261113&limit=10'],
  ['TheSportsDB','https://www.thesportsdb.com/api/v1/json/123/eventsday.php?d=2026-11-13&l=4328']
 ];
 Promise.allSettled(checks.map(async ([name,url])=>{
  try{const data=await getJson(url,60000);console.log('External provider check:',name,'connected',Array.isArray(data.events)?data.events.length:'n/a');}
  catch(error){console.warn('External provider check:',name,'unavailable:',String(error.message||error));}
 }));
});
module.exports={server,handler,validDate};
