'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {LEAGUES}=require('../leagues'),{model}=require('../model'),{server,validDate}=require('../server');
test('13 leagues and all three sports',()=>{assert.equal(LEAGUES.length,13);assert.deepEqual([...new Set(LEAGUES.map(x=>x.sport))].sort(),['baseball','basketball','soccer']);});
test('date validation',()=>{assert.ok(validDate('2026-11-13'));assert.ok(!validDate('2026-02-30'));assert.ok(!validDate('2026-13-01'));});
for(const sport of ['soccer','baseball','basketball']){
 test('valid probabilities '+sport,()=>{
 const g={id:'test',date:'2026-11-15T08:00:00Z',sport,league:sport==='soccer'?'epl':sport==='baseball'?'mlb':'nba',status:'scheduled',
 home:{id:'a',name:'A'},away:{id:'b',name:'B'}};
 const p=model(g,[]);
 assert.ok(Math.abs(p.probabilities.home+p.probabilities.away+(p.probabilities.draw||0)-1)<.00001);
 assert.equal(p.topScores.length,5);assert.ok(p.lines.length>=4);
 for(const l of p.lines)assert.ok(Math.abs(l.over+l.under-1)<.00001);
 });
}
test('HTTP homepage and simulated full analysis',async ()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const base='http://127.0.0.1:'+server.address().port;
 try{
 const html=await fetch(base+'/');assert.equal(html.status,200);const s=await html.text();assert.match(s,/MATCHSCOPE/);assert.ok(!s.includes('PREVIEW_SCHEDULE'));
 const invalid=await fetch(base+'/api/games?date=2026-02-30');assert.equal(invalid.status,400);
 const games=await (await fetch(base+'/api/games?date=2026-11-13&demo=1')).json();assert.equal(games.games.length,13);
 const id=encodeURIComponent(games.games[0].id),detail=await (await fetch(base+'/api/analysis?date=2026-11-13&demo=1&id='+id)).json();
 assert.equal(detail.prediction.topScores.length,5);assert.equal(detail.history.length,16);assert.equal(detail.game.league,games.games[0].league);
 }finally{await new Promise(ok=>server.close(ok));}
});
