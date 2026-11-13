'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {server}=require('../server');
const {LEAGUES}=require('../leagues');
function espnEvent(){
 return {id:'fixture-100',date:'2027-04-10T12:00:00Z',status:{type:{state:'pre'}},competitions:[{competitors:[
  {homeAway:'home',team:{id:'54321',displayName:'Home Football Club'}},
  {homeAway:'away',team:{id:'54322',displayName:'Away Football Club'}}
 ]}]};
}
test('A real fixture analysis reuses the discovered match without re-fetching all 22 leagues',async()=>{
 const original=global.fetch,dates='2027-04-10',called=[];
 global.fetch=(url,options)=>{
  const u=String(url);
  if(u.startsWith('http://127.0.0.1:'))return original(url,options);
  called.push(u);
  if(u.includes('api.kbl.or.kr/match/list'))return Promise.resolve({ok:true,json:async()=>[]});
  if(u.includes('/scoreboard?'))return Promise.resolve({ok:true,json:async()=>({events:u.includes('/eng.1/')&&u.includes('20270410')?[espnEvent()]:[]})});
  if(u.includes('eventsday.php'))return Promise.resolve({ok:true,json:async()=>({events:[]})});
  if(u.includes('/schedule?'))return Promise.resolve({ok:true,json:async()=>({events:[]})});
  return Promise.resolve({ok:true,json:async()=>({})});
 };
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await original(base+'/api/games?date='+dates);assert.equal(response.status,200);
  const first=await response.json(),game=first.games.find(g=>g.league==='epl');
  assert.ok(game,'EPL fixture should be listed');assert.equal(first.statuses.length,LEAGUES.length);
  const initialScheduleCalls=called.filter(x=>x.includes('scoreboard?')||x.includes('eventsday.php')).length;
  const detail=await original(base+'/api/analysis?date='+dates+'&id='+encodeURIComponent(game.id));
  assert.equal(detail.status,200);
  const data=await detail.json();
  assert.equal(data.game.id,game.id);
  assert.equal(data.prediction.topScores.length,0);assert.equal(data.prediction.available,false);assert.equal(data.prediction.confidence,'분석 보류');
  assert.equal(data.prediction.dataQuality.usedCompletedGames,0);
  assert.ok(data.prediction.explanation.some(v=>v.includes('최근 완료 경기')));
  assert.equal(called.filter(x=>x.includes('scoreboard?')||x.includes('eventsday.php')).length,initialScheduleCalls,
   'Analysis must not repeat all fixture requests');
 }finally{global.fetch=original;await new Promise(resolve=>server.close(resolve));}
});
