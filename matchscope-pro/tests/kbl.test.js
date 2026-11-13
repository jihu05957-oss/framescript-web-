'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {normalizeKBL,day}=require('../kbl');
const match={gmkey:'S49G01N58',gameDate:'20261113',gameStart:'1900',seasonGrade:1,tcodeH:'16',tcodeA:'06',tnameH:'DB',tnameA:'KT',tnameFH:'원주 DB',tnameFA:'수원 KT',isStarted:0,isEnded:0,scoreH:0,scoreA:0};
test('KBL official row: KST kickoff, correct home/away, no pregame score',()=>{
 const g=normalizeKBL(match);assert.equal(g.date,'2026-11-13T10:00:00.000Z');assert.equal(g.home.name,'원주 DB');assert.equal(g.away.name,'수원 KT');assert.equal(g.home.score,null);assert.equal(g.status,'scheduled');
});
test('KBL official finished row',()=>{
 const g=normalizeKBL({...match,isEnded:1,scoreH:91,scoreA:88});assert.equal(g.home.score,91);assert.equal(g.status,'final');
});
test('KBL official date fetch uses correct parameters',async()=>{
 const original=global.fetch;
 global.fetch=async (url,options)=>{assert.match(String(url),/fromDate=20261113/);assert.match(String(url),/seasonGrade=1/);assert.equal(options.headers.channel,'WEB');return {ok:true,json:async()=>[match]};};
 try{const result=await day('2026-11-13');assert.equal(result.games.length,1);}finally{global.fetch=original;}
});
