'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {server}=require('../server');
function ev(id,dt,status='pre',names=['Manchester City','Arsenal'],ids=['100','200'],scores=[null,null]){
 return {id,date:dt,status:{type:{state:status}},competitions:[{competitors:[
  {homeAway:'home',team:{id:ids[0],displayName:names[0]},score:scores[0]},
  {homeAway:'away',team:{id:ids[1],displayName:names[1]},score:scores[1]}]}]};
}
test('All matches batch attempts each game and exposes evidence-based deep report with player importance',async()=>{
 const original=global.fetch;
 const date=new Date().toISOString().slice(0,10);
 const gameDate=date+'T12:00:00Z',event=ev('GAME-1',gameDate),base=null;
 const past=new Date(Date.parse(gameDate)-3*86400000).toISOString();
 const future=new Date(Date.parse(gameDate)+3*86400000).toISOString();
 global.fetch=async (url,options)=>{
  const u=String(url);
  if(u.startsWith('http://127.0.0.1:'))return original(url,options);
  if(u.includes('api.kbl.or.kr/match/list'))return {ok:true,json:async()=>[]};
  if(u.includes('eventsday.php'))return {ok:true,json:async()=>({events:[]})};
  if(u.includes('/scoreboard?'))return {ok:true,json:async()=>({events:u.includes('/eng.1/')?[event]:[]})};
  if(u.includes('/schedule?'))return {ok:true,json:async()=>({events:[ev('PREV',past,'post',['Manchester City','Arsenal'],['100','200'],[2,1]),ev('NEXT',future)]})};
  if(u.includes('/injuries'))return {ok:true,json:async()=>({injuries:[{athlete:{displayName:'Star Player'},status:'Out'}]})};
  if(u.includes('/leaders'))return {ok:true,json:async()=>({leaders:[{name:'Goals',leaders:[{athlete:{displayName:'Star Player'}}]}]})};
  if(u.includes('/summary?'))return {ok:true,json:async()=>({pickcenter:[{provider:{name:'Provider'},details:'Home -1.5',overUnder:2.5}]})};
  if(u.includes('/news?'))return {ok:true,json:async()=>({articles:[{headline:'Manchester City prepares for Arsenal clash',links:{web:{href:'https://www.espn.com/soccer/story/test'}}}]})};
  return {ok:true,json:async()=>({events:[]})};
 };
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const url='http://127.0.0.1:'+server.address().port;
 try{
  const games=await (await original(url+'/api/games?date='+date)).json();
  const fixture=games.games.find(g=>g.league==='epl');assert.ok(fixture);
  const start=await original(url+'/api/batch/start?date='+date);assert.equal(start.status,200);
  let state=await start.json();assert.equal(state.total,1);
  for(let i=0;i<80&&state.state!=='finished';i++){
   await new Promise(ok=>setTimeout(ok,40));
   state=await (await original(url+'/api/batch/status?date='+date)).json();
  }
  assert.equal(state.state,'finished');assert.equal(state.done,1);
  const result=await original(url+'/api/analysis?date='+date+'&id='+encodeURIComponent(fixture.id));
  assert.equal(result.status,200);
  const d=await result.json();
  assert.ok(d.insights);
  assert.equal(d.insights.coverage.confirmedImportance,2,'two injury lists, both with documented top contribution');
  assert.ok(d.insights.sections.some(x=>x.id==='upset'));
  assert.ok(d.insights.sections.some(x=>x.id==='schedule'));
  assert.ok(d.insights.sections.some(x=>x.id==='injuries'));
  assert.ok(d.insights.sources.some(x=>x.url?.includes('espn.com/soccer')));
  assert.ok(d.extra.sourceChecks?.every(x=>x.ok));
  assert.equal(d.prediction.available,false,'two historical scores alone cannot justify full prediction');
 }finally{global.fetch=original;await new Promise(ok=>server.close(ok));}
});
