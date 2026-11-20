'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeESPN}=require('../providers'),{model}=require('../model');
const league={id:'nba',name:'NBA',sport:'basketball'};
function raw(id,date,h,a,hs,as,status={state:'post',completed:true,name:'STATUS_FINAL'}){
 return {id,date,competitions:[{status:{type:status},competitors:[
 {homeAway:'home',team:{id:h,displayName:h},score:{value:hs,displayValue:String(hs)}},
 {homeAway:'away',team:{id:a,displayName:a},score:{value:as,displayValue:String(as)}}]}]};
}
test('Real ESPN team schedule shape: nested competition status and object score are valid completed matches',()=>{
 const game=normalizeESPN(raw('1','2026-11-18T00:00:00Z','A','B',115,109),league);
 assert.equal(game.status,'final');assert.equal(game.home.score,115);assert.equal(game.away.score,109);
});
test('Nested status and displayValue-only score including zero, scheduled or cancelled records excluded',()=>{
 const r=raw('2','2026-11-18T00:00:00Z','A','B',0,2);r.competitions[0].competitors[0].score={displayValue:'0'};
 assert.equal(normalizeESPN(r,{id:'epl',sport:'soccer'}).home.score,0);
 const future=normalizeESPN(raw('3','2026-11-23T00:00:00Z','A','B',0,0,{state:'pre',completed:false}),league);
 assert.equal(future.status,'scheduled');assert.equal(future.home.score,null);
 const postponed=normalizeESPN(raw('4','2026-11-23T00:00:00Z','A','B',0,0,{state:'post',completed:true,name:'STATUS_POSTPONED'}),league);
 assert.equal(postponed.status,'cancelled');assert.equal(postponed.home.score,null);
});
test('Eight real-format records for either side lead to model output, not analysis withheld',()=>{
 const target=normalizeESPN(raw('target','2026-11-21T00:00:00Z','A','B',0,0,{state:'pre'}),league);
 const history=[];
 for(let n=0;n<8;n++){
  const date=new Date(Date.parse(target.date)-(n+1)*86400000*2).toISOString();
  history.push(normalizeESPN(raw('h'+n,date,'A','R'+n,100,111),league));
  history.push(normalizeESPN(raw('a'+n,date,'S'+n,'B',99,120),league));
 }
 const m=model(target,history);
 assert.equal(m.available,true);assert.equal(m.home.count,8);assert.equal(m.away.count,8);assert.ok(m.probabilities.away>m.probabilities.home);
});
