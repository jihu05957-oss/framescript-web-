'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {LEAGUES}=require('../leagues'),{model}=require('../model'),{server,validDate}=require('../server');
test('22 leagues including Eredivisie and international fixtures with all three sports',()=>{assert.equal(LEAGUES.length,22);assert.ok(LEAGUES.some(l=>l.id==='eredivisie'));assert.ok(LEAGUES.some(l=>l.id==='intl-friendly'));assert.ok(LEAGUES.some(l=>l.id==='intl-uefa-nations'));assert.deepEqual([...new Set(LEAGUES.map(x=>x.sport))].sort(),['baseball','basketball','soccer']);});
test('date validation',()=>{assert.ok(validDate('2026-11-13'));assert.ok(!validDate('2026-02-30'));assert.ok(!validDate('2026-13-01'));});
function testHistory(g){
 const start=new Date(g.date).getTime(),out=[];
 for(let i=0;i<8;i++){
  const date=new Date(start-(i+1)*86400000).toISOString(),score=g.sport==='soccer'?2:g.sport==='baseball'?5:108;
  out.push({date,status:'final',home:{id:g.home.id,name:g.home.name,score},away:{id:'oppH'+i,name:'Opponent',score:score-1}});
  out.push({date,status:'final',home:{id:'oppA'+i,name:'Opponent',score:score-1},away:{id:g.away.id,name:g.away.name,score}});
 }
 return out;
}
for(const sport of ['soccer','baseball','basketball']){
 test('valid probabilities '+sport,()=>{
 const g={id:'test',date:'2026-11-15T08:00:00Z',sport,league:sport==='soccer'?'epl':sport==='baseball'?'mlb':'nba',status:'scheduled',
 home:{id:'a',name:'A'},away:{id:'b',name:'B'}};
 const p=model(g,testHistory(g));
 assert.equal(p.available,true);
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
 const games=await (await fetch(base+'/api/games?date=2026-11-13&demo=1')).json();assert.equal(games.games.length,LEAGUES.length);
 const id=encodeURIComponent(games.games[0].id),detail=await (await fetch(base+'/api/analysis?date=2026-11-13&demo=1&id='+id)).json();
 assert.equal(detail.prediction.topScores.length,5);assert.equal(detail.history.length,16);assert.equal(detail.game.league,games.games[0].league);
 }finally{await new Promise(ok=>server.close(ok));}
});

test('No history means no fabricated home-team preference, including Japan-Brazil and Saudi-Korea',()=>{
 for(const [home,away] of [['Japan','Brazil'],['Saudi Arabia','South Korea']]){
  const g={id:'friendly-test',date:'2026-11-14T10:00:00Z',sport:'soccer',league:'intl-friendly',status:'scheduled',home:{id:'a',name:home},away:{id:'b',name:away}};
  const m=model(g,[]);
  assert.equal(m.available,false);
  assert.equal(m.probabilities.home,null);
  assert.equal(m.probabilities.away,null);
  assert.equal(m.topScores.length,0);
  assert.equal(m.confidence,'분석 보류');
 }
});
test('Away team may be favored when actual scored/conceded evidence supports it',()=>{
 const g={id:'evidence-test',date:'2026-11-14T10:00:00Z',sport:'soccer',league:'intl-friendly',status:'scheduled',home:{id:'a',name:'Japan'},away:{id:'b',name:'Brazil'}};
 const history=[];
 for(let i=1;i<=8;i++){
  const date=new Date(Date.parse(g.date)-i*86400000).toISOString();
  history.push({date,status:'final',home:{id:'a',name:'Japan',score:0},away:{id:'x'+i,name:'Opponent',score:2}});
  history.push({date,status:'final',home:{id:'y'+i,name:'Opponent',score:0},away:{id:'b',name:'Brazil',score:3}});
 }
 const m=model(g,history);
 assert.equal(m.available,true);
 assert.ok(m.probabilities.away>m.probabilities.home);
 assert.ok(m.expected.away>m.expected.home);
});
test('Team data and validation tabs include explicit missing-data handling',async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 try{
  const html=await fetch('http://127.0.0.1:'+server.address().port+'/').then(r=>r.text());
  assert.ok(html.includes('function renderForm('));
  assert.ok(html.includes('function renderSources('));
  assert.ok(html.includes('경기력 자료가 부족해 예측을 보류'));
  assert.ok(html.includes('승부 예측은 자료 부족으로 보류'));
 }finally{await new Promise(ok=>server.close(ok))}
});
