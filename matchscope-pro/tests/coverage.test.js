'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {listDay}=require('../providers');
const {LEAGUES}=require('../leagues');
const date='2027-05-12';
const espnGame=(id,date,home,away)=>({id,date,status:{type:{state:'pre'}},competitions:[{competitors:[
 {homeAway:'home',team:{id:'home-'+id,displayName:home}},
 {homeAway:'away',team:{id:'away-'+id,displayName:away}}
 ]}]});
test('international friendlies and two complementary league games are all included',async()=>{
 const original=global.fetch,requested=[];
 global.fetch=async (url)=>{
  const u=String(url);requested.push(u);
  if(u.includes('api.kbl.or.kr/match/list'))return {ok:true,json:async()=>[]};
  if(u.includes('/soccer/eng.1/scoreboard'))return {ok:true,json:async()=>({events:[espnGame('E1','2027-05-12T13:00:00Z','Manchester City','Chelsea')]})};
  if(u.includes('/soccer/fifa.friendly/scoreboard'))return {ok:true,json:async()=>({events:[espnGame('INT1','2027-05-12T09:00:00Z','South Korea','Japan')]})};
  if(u.includes('eventsday.php')){
   const league=new URL(u).searchParams.get('l');
   return {ok:true,json:async()=>({events:league==='4328'?[{idLeague:'4328',idEvent:'TS2',strHomeTeam:'Liverpool',strAwayTeam:'Arsenal',dateEvent:date,strTimestamp:'2027-05-12T14:00:00Z'}]:[]})};
  }
  return {ok:true,json:async()=>({events:[]})};
 };
 try{
  const d=await listDay(date);
  assert.equal(d.date,date);
  assert.equal(d.statuses.length,LEAGUES.length);
  assert.equal(d.games.filter(g=>g.league==='epl').length,2,'Partial ESPN league must be supplemented');
  assert.equal(d.games.filter(g=>g.league==='intl-friendly').length,1,'National-team fixture must appear');
  assert.ok(requested.some(u=>u.includes('/soccer/uefa.nations/scoreboard')),'Nations League queried');
  assert.ok(requested.some(u=>u.includes('/soccer/ned.1/scoreboard')),'Eredivisie queried');
  assert.ok(requested.some(u=>u.includes('eventsday.php')&&u.includes('l=4328')),'Secondary source queried even when ESPN found a match');
 }finally{global.fetch=original}
});
