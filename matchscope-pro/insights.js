'use strict';
// Evidence first: this module reports observable information, not hidden coach intentions.
// No injury number or news sentiment is converted to a calibrated win percentage.
function validTime(value){const t=Date.parse(value||'');return Number.isFinite(t)?t:null;}
function matchTeam(e,id){return e?.home?.id===id||e?.away?.id===id;}
function opponent(e,id){return e?.home?.id===id?e.away?.name:e?.away?.id===id?e.home?.name:null;}
function around(game,history,id){
 const kickoff=validTime(game.date);if(kickoff===null)return {last:null,next:null,restHours:null,nextHours:null,past7:null};
 const games=(history||[]).filter(e=>matchTeam(e,id)&&e.date&&e.id!==game.id)
  .map(e=>({...e,_at:validTime(e.date)})).filter(e=>e._at!==null);
 const past=games.filter(e=>e._at<kickoff&&e.status==='final').sort((a,b)=>b._at-a._at);
 const future=games.filter(e=>e._at>kickoff&&e.status!=='final').sort((a,b)=>a._at-b._at);
 const last=past[0],next=future[0];
 const hr=e=>Math.round(Math.abs(e._at-kickoff)/3600000*10)/10;
 return {last:last?{date:last.date,opponent:opponent(last,id),hours:hr(last)}:null,
 next:next?{date:next.date,opponent:opponent(next,id),hours:hr(next)}:null,
 restHours:last?hr(last):null,nextHours:next?hr(next):null,
 past7:past.filter(e=>kickoff-e._at<=7*86400000).length};
}
function statusRank(s){
 const v=String(s||'').toLowerCase();
 if(/\b(out|injured|suspended|inactive|ruled out)\b|결장|출전 정지/.test(v))return '결장';
 if(/\b(doubtful|questionable|gtd|day.to.day|game.time decision)\b|불확실|출전 미정/.test(v))return '출전 불확실';
 if(/\b(probable|available|active)\b|출전 가능/.test(v))return '출전 가능 예상';
 return '상태 미확인';
}
function impact(injuries,leaders){
 return (injuries||[]).map(i=>{
  const name=String(i.name||'').trim();
  const leader=(leaders||[]).find(l=>l.team===i.team&&l.name?.toLowerCase()===name.toLowerCase());
  const categories=leader?.categories||[];
  return {...i,availability:statusRank(i.status),
   impact:categories.length>=2?'복수 부문 주요 기여 선수':categories.length===1?'팀 기록 상위권 선수':'주전·백업 중요도 미확인',
   importanceEvidence:categories,importanceVerified:categories.length>0};
 });
}
function hoursText(h){return Number.isFinite(h)?(h<48?Math.round(h)+'시간':(h/24).toFixed(1)+'일'):'미확인';}
function factsForTeam(g,history,side,injuries){
 const team=g[side],s=around(g,history,team.id);
 const listed=injuries.filter(i=>i.team===team.name);
 const confirmed=listed.filter(i=>i.availability==='결장');
 const top=confirmed.filter(i=>i.importanceVerified);
 const uncertain=listed.filter(i=>i.availability==='출전 불확실');
 const signals=[];
 if(s.restHours!==null&&s.restHours<=72)signals.push('짧은 휴식('+hoursText(s.restHours)+')');
 if(s.nextHours!==null&&s.nextHours<=96)signals.push('다음 경기까지 '+hoursText(s.nextHours));
 if(s.past7!==null&&s.past7>=3)signals.push('최근 7일 3경기 이상');
 if(top.length)signals.push('주요 기여 선수 결장 '+top.length+'명');
 if(uncertain.length)signals.push('출전 불확실 선수 '+uncertain.length+'명');
 return {name:team.name,side,rest:s,injuries:listed,signals,
  knownAbsent:confirmed.length,knownImportantAbsent:top.length,questionable:uncertain.length};
}
function storyMatch(game,article){
 const title=String(article?.title||article?.headline||'').toLowerCase();
 if(title.length<15)return false;
 const names=[game.home.name,game.away.name].map(n=>String(n||'').toLowerCase())
  .flatMap(n=>[n,n.split(/\s+/).filter(w=>w.length>=5).slice(-2).join(' ')])
  .filter(n=>n.length>=5);
 return names.some(n=>title.includes(n));
}
function build(game,history,extra={},strength=null,issues=[]){
 const injuries=impact(extra.injuries||[],extra.leaders||[]);
 const home=factsForTeam(game,history,'home',injuries),away=factsForTeam(game,history,'away',injuries);
 const headlines=(extra.news||[]).filter(n=>storyMatch(game,n)).slice(0,5);
 const sections=[],missing=[],risk=[],references=[];
 const add=(id,title,level,body,items=[])=>sections.push({id,title,level,body,items});
 const timelineText=t=>(t.rest.last?'직전 경기 '+String(t.rest.last.date).slice(0,10)+' · '+(t.rest.last.opponent||'상대 미확인')+' · 경기 간격 '+hoursText(t.rest.restHours):'직전 경기 일정 확인되지 않음')+
  ' / '+(t.rest.next?'다음 경기 '+String(t.rest.next.date).slice(0,10)+' · '+(t.rest.next.opponent||'상대 미확인')+' · 경기 간격 '+hoursText(t.rest.nextHours):'이후 경기 일정 확인되지 않음');
 add('schedule','일정·회복·로테이션',[home,away].some(t=>t.rest.last||t.rest.next)?'verified':'unknown',
  '확보된 경기 일정으로 휴식 간격과 다음 경기까지 남은 시간을 계산했습니다. 경기의 중요도나 감독의 로테이션 의도를 일정만으로 단정하지 않습니다.',
  [home.name+': '+timelineText(home),away.name+': '+timelineText(away)]);
 for(const team of [home,away]){
  if(team.rest.restHours===null)missing.push(team.name+' 최근 경기 간격');
  if(team.rest.nextHours===null)missing.push(team.name+' 다음 경기 일정');
  if(team.rest.restHours!==null&&team.rest.restHours<=72)risk.push({level:'주의',title:team.name+' 짧은 회복 시간',detail:'확인된 직전 경기로부터 '+hoursText(team.rest.restHours)+' 뒤에 킥오프합니다. 실제 체력 저하는 미측정입니다.',basis:'경기 일정'});
  if(team.rest.nextHours!==null&&team.rest.nextHours<=96)risk.push({level:'관찰',title:team.name+' 빠른 다음 경기',detail:'이번 경기 종료 후 '+hoursText(team.rest.nextHours)+' 내에 다른 경기가 있습니다. 로테이션은 공식 발표가 필요합니다.',basis:'경기 일정'});
 }
 if(injuries.length){
  add('injuries','부상·결장·선수 영향력','verified',
   '숫자보다 부상자 개별 상태와 실제 기여 기록을 구분했습니다. 명단에 없다는 사실만으로 건강하다고 판단하지 않습니다.',
   injuries.slice(0,30).map(i=>i.team+' · '+i.name+' · '+i.availability+' · '+i.impact+(i.importanceEvidence.length?' ('+i.importanceEvidence.join(', ')+')':'')));
  for(const i of injuries.filter(x=>x.availability==='결장'&&x.importanceVerified))risk.push({level:'주의',title:i.team+' 주요 선수 결장 가능성',detail:i.name+' · '+i.impact+' · '+i.status,basis:'부상 명단 + 시즌 팀 리더'});
  for(const i of injuries.filter(x=>!x.importanceVerified))missing.push(i.name+' 주전 비중·출전시간');
 }else{
  missing.push('양 팀 부상자·징계 실시간 확인');
  add('injuries','부상·결장·선수 영향력','unknown','신뢰할 수 있는 현재 부상 명단을 확보하지 못했습니다. 부상자가 0명이라는 의미가 아닙니다.');
 }
 const starters=(extra.lineups||[]);
 if(starters.length)add('lineups','선발·라인업','verified','소스에 포함된 선발 명단입니다. 예상 선발인지 확정 명단인지 별도 발표 여부 확인이 필요합니다.',starters.map(r=>r.team+': '+r.players.join(', ')));
 else {missing.push('예상·공식 선발 라인업');add('lineups','선발·라인업','unknown','현재 경기의 신뢰할 수 있는 선발 명단을 확보하지 못했습니다.');}
 if(headlines.length){
  add('media','해외 언론·현지 뉴스','verified','경기 참가 팀을 제목에서 확인할 수 있는 기사만 표시합니다. 기사 자체가 승부 전망을 의미하지 않으며 원문 검토 전에는 긍정·부정 평가를 단정하지 않습니다.',
   headlines.map(a=>a.title+(a.publishedAt?' · '+String(a.publishedAt).slice(0,10):'')));
 }else{missing.push('관련 현지 분석 기사 교차 검증');add('media','해외 언론·현지 뉴스','unknown','공개 데이터에서 확인 가능한 관련 기사 제목을 찾지 못했습니다. 해외 전문가의 예상 승부 의견을 수집했다고 주장하지 않습니다.');}
 if(extra.odds?.length)add('market','시장 정보','verified','일부 데이터 제공처에 표시된 기준점입니다. 베팅사 전체 합의·배당 흐름·확정 배당을 의미하지 않습니다.',extra.odds.slice(0,5).map(o=>[o.provider,o.spread,o.total].filter(v=>v!==null&&v!==undefined).join(' / ')));
 else {missing.push('실시간 시장 배당·변동 추이');add('market','시장 정보','unknown','검증 가능한 시장 배당이나 기준점 데이터를 확보하지 못했습니다.');}
 if(strength)add('strength','국가대표 상대 전력','estimated',
  '공개 A매치 기록으로 자체 계산한 Elo입니다. 공식 FIFA 랭킹이 아니며 예측 정확도가 검증된 확률로 해석하면 안 됩니다.',
  [home.name+': '+(strength.homeRating??'미확인'),away.name+': '+(strength.awayRating??'미확인'),'원본 최근 경기: '+(strength.sourceLastMatch||'미확인')]);
 const conclusion=risk.length?risk.map(x=>x.title+' — '+x.detail):['확인된 강력한 이변 변수는 없습니다. 다만 미확인 데이터가 있으므로 이변 위험이 없다고 단정할 수는 없습니다.'];
 add('upset','정배·역배·무승부 위험 점검',risk.length?'estimated':'unknown',
  '아래 신호는 검증 가능한 일정·결장 자료에서만 추렸습니다. 홈팀·정배팀의 실제 승리 확률에 미치는 영향은 별도 검증 없이는 임의의 %로 바꾸지 않습니다.',conclusion);
 if(game.source)references.push({label:'경기 일정',provider:game.source,url:null});
 if(game.sourceType==='espn')references.push({label:'일정·팀·부상 조회',provider:'ESPN 공개 데이터',url:'https://www.espn.com/'});
 if(strength?.sourceUrl)references.push({label:'국가대표 역사 기록',provider:'CC0 A매치',url:strength.sourceUrl});
 for(const n of headlines)if(/^https:\/\/[^ ]+/.test(n.url||''))references.push({label:n.title,provider:n.source||'ESPN',url:n.url});
 for(const check of extra.sourceChecks||[])if(!check.ok)missing.push('소스 응답 미확인: '+String(check.label||'기타 데이터'));
 for(const a of issues||[])missing.push('데이터 수집 오류: '+String(a).slice(0,130));
 const checked=sections.filter(s=>s.level!=='unknown').length;
 return {version:'2.0',generatedAt:new Date().toISOString(),
  teams:{home,away},sections,risks:risk,missing:[...new Set(missing)],
  coverage:{verifiedSections:checked,totalSections:sections.length,injuryItems:injuries.length,confirmedImportance:injuries.filter(i=>i.importanceVerified).length,headlines:headlines.length},
  sources:references};
}
module.exports={around,impact,build,statusRank,storyMatch};
