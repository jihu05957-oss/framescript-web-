'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseResults,matchFacts,canon}=require('../national');
const {model}=require('../model');
function csv(){
 const rows=['date,home_team,away_team,home_score,away_score,tournament,city,country,neutral'];
 for(let i=0;i<16;i++){
  const date='2026-0'+(i%8+1)+'-'+String(Math.floor(i/8)+10).padStart(2,'0');
  rows.push([date,'Japan','Brazil',0,3,'Friendly','Tokyo','Japan','TRUE'].join(','));
  rows.push([date,'Saudi Arabia','South Korea',0,2,'Friendly','Riyadh','Saudi Arabia','TRUE'].join(','));
 }
 rows.push('2026-12-03,Japan,Brazil,9,0,Friendly,Tokyo,Japan,FALSE');
 return rows.join('\n');
}
const game=(home,away)=>({id:'int-test',date:'2026-11-14T10:00:00Z',sport:'soccer',league:'intl-friendly',status:'scheduled',home:{id:'a',name:home},away:{id:'b',name:away}});
test('Parse public-domain international result file with dates and no future leakage',()=>{
 const d=parseResults(csv());assert.equal(d.rows.length,33);assert.equal(d.latest,'2026-12-03');assert.equal(canon('Korea Republic'),'South Korea');
});
test('Historical Elo corrects Japan-Brazil and Saudi Arabia-South Korea home bias on evidence',()=>{
 const d=parseResults(csv());
 for(const [home,away] of [['Japan','Brazil'],['Saudi Arabia','South Korea']]){
  const g=game(home,away),n=matchFacts(g,d);
  assert.equal(n.history.length,32,'Only pre-fixture matches must be included');
  assert.ok(n.strength.homeGames>=8&&n.strength.awayGames>=8);
  assert.ok(n.strength.awayRating>n.strength.homeRating);
  const m=model(g,n.history,{strength:n.strength});
  assert.equal(m.available,true);assert.equal(m.home.count,8);assert.equal(m.away.count,8);
  assert.ok(m.probabilities.away>m.probabilities.home,'Evidence should allow away team to lead');
  assert.ok(m.explanation.some(x=>x.includes('Elo')));
 }
});
test('International model abstains if opponent-strength rating unavailable',()=>{
 const g=game('Japan','Brazil'),h=matchFacts(g,parseResults(csv()));
 const m=model(g,h.history);
 assert.equal(m.available,false);assert.match(m.dataQuality.note,/전력 지표/);
});
