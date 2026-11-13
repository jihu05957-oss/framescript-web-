'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {build,around,impact,statusRank,storyMatch}=require('../insights');
function fixture(){
 return {id:'espn:epl:100',league:'epl',sport:'soccer',sourceType:'espn',source:'ESPN',
 date:'2026-11-14T12:00:00Z',home:{id:'100',name:'Manchester City'},away:{id:'200',name:'Arsenal'}};
}
function entry(date,status,hid,aid){
 return {date,status,home:{id:hid,name:hid==='100'?'Manchester City':'Opponent',score:status==='final'?2:null},
 away:{id:aid,name:aid==='200'?'Arsenal':'Opponent',score:status==='final'?1:null}};
}
test('Actual fixture rest and next-fixture gaps based on timestamps, never imagined motivation',()=>{
 const g=fixture(),history=[
  entry('2026-11-12T12:00:00Z','final','100','x'),
  entry('2026-11-19T12:00:00Z','scheduled','100','x'),
  entry('2026-11-09T12:00:00Z','final','x','200')
 ];
 const h=around(g,history,'100'),a=around(g,history,'200');
 assert.equal(h.restHours,48);assert.equal(h.nextHours,120);assert.equal(a.restHours,120);
 assert.equal(a.nextHours,null);
});
test('Injured players are weighted only by identified team contribution, never injury count',()=>{
 const injuries=[{team:'Manchester City',name:'Star',status:'OUT'}, {team:'Manchester City',name:'Reserve',status:'OUT'}];
 const x=impact(injuries,[{team:'Manchester City',name:'Star',categories:['GOALS','ASSISTS']}]);
 assert.equal(x[0].availability,'결장');assert.equal(x[0].importanceVerified,true);
 assert.equal(x[1].importanceVerified,false);
 assert.match(x[1].impact,/미확인/);
 assert.equal(statusRank('Questionable'),'출전 불확실');assert.equal(statusRank('결장'),'결장');
});
test('Deep report includes concrete injury/schedule and visibly flags unknown media and rotation motive',()=>{
 const g=fixture(),h=[entry('2026-11-12T12:00:00Z','final','100','x')];
 const report=build(g,h,{injuries:[{team:'Manchester City',name:'Star',status:'Out'}],leaders:[{team:'Manchester City',name:'Star',categories:['Goals']}],
  news:[{title:'Manchester City coach discusses Arsenal game lineups',url:'https://www.espn.com/soccer/story/abc',source:'ESPN'}]});
 assert.equal(report.coverage.injuryItems,1);
 assert.equal(report.coverage.confirmedImportance,1);
 assert.ok(report.risks.some(x=>x.title.includes('짧은 회복')));
 assert.ok(report.missing.some(x=>x.includes('다음 경기')));
 assert.ok(report.sources.some(x=>x.url?.includes('espn.com/soccer')));
 assert.ok(report.sections.find(x=>x.id==='media').level==='verified');
 assert.ok(report.sections.find(x=>x.id==='schedule').body.includes('단정하지'));
});
test('Report must not call unknown injury info an empty injury report',()=>{
 const g=fixture(),report=build(g,[],{injuries:[],news:[],leaders:[]});
 assert.ok(report.missing.includes('양 팀 부상자·징계 실시간 확인'));
 assert.equal(report.sections.find(x=>x.id==='injuries').level,'unknown');
 assert.equal(report.sections.find(x=>x.id==='media').level,'unknown');
 assert.ok(!storyMatch(g,{title:'Red Sox bullpen injury news'}));
});
