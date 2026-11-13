'use strict';
const BASE={
 soccer:{home:1.46,away:1.12,sd:1.1,lines:[1.5,2.5,3.5,4.5]},
 baseball:{home:4.65,away:4.35,sd:2.55,lines:[6.5,7.5,8.5,9.5,10.5]},
 basketball:{home:114,away:111,sd:12.5,lines:[209.5,215.5,221.5,227.5,233.5]}
};
const PRIOR={kbo:[5.1,4.7],npb:[3.7,3.45],mlb:[4.65,4.35],kbl:[79,76],nba:[114,111]};
const clamp=(v,a,b)=>Math.max(a,Math.min(v,b));
const avg=(a)=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
function form(history,id,cutoff){
 const games=(history||[]).filter(g=>g.status==='final'&&g.date&&new Date(g.date)<new Date(cutoff)&&
 (g.home.id===id||g.away.id===id)&&Number.isFinite(g.home.score)&&Number.isFinite(g.away.score))
 .sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,8);
 let w=0,d=0,l=0,homeW=0,homeN=0,awayW=0,awayN=0;const ff=[],aa=[];
 const recent=games.map(g=>{const home=g.home.id===id;
 const gf=home?g.home.score:g.away.score,ga=home?g.away.score:g.home.score, result=gf>ga?'W':gf===ga?'D':'L';
 if(result==='W')w++;if(result==='D')d++;if(result==='L')l++;
 if(home){homeN++;if(result==='W')homeW++}else{awayN++;if(result==='W')awayW++}
 ff.push(gf);aa.push(ga);
 return {date:g.date,opponent:home?g.away.name:g.home.name,home,for:gf,against:ga,result};});
 return {count:games.length,w,d,l,scored:avg(ff),conceded:avg(aa),homeW,homeN,awayW,awayN,recent};
}
function poisson(k,v){let p=Math.exp(-v);for(let i=1;i<=k;i++)p*=v/i;return p;}
function erf(x){const s=Math.sign(x);x=Math.abs(x);const t=1/(1+.3275911*x);
 return s*(1-(((((1.061405429*t-1.453152027)*t)+1.421413741)*t-.284496736)*t+.254829592)*t*Math.exp(-x*x));}
function cdf(x,m,s){return .5*(1+erf((x-m)/(s*Math.SQRT2)));}
function distribution(mh,ma,sport,sd){
 const arr=[];if(sport!=='basketball'){
 const max=sport==='soccer'?12:32;
 for(let h=0;h<=max;h++)for(let a=0;a<=max;a++){const p=poisson(h,mh)*poisson(a,ma);if(p>1e-14)arr.push({h,a,p});}
 }else{
 const h0=Math.max(0,Math.floor(mh-4.5*sd)),h1=Math.ceil(mh+4.5*sd);
 const a0=Math.max(0,Math.floor(ma-4.5*sd)),a1=Math.ceil(ma+4.5*sd);
 for(let h=h0;h<=h1;h++){const p1=cdf(h+.5,mh,sd)-cdf(h-.5,mh,sd);
 for(let a=a0;a<=a1;a++){const p=p1*(cdf(a+.5,ma,sd)-cdf(a-.5,ma,sd));if(p>1e-10)arr.push({h,a,p});}}
 }
 const sum=arr.reduce((s,x)=>s+x.p,0);return arr.map(x=>({...x,p:x.p/sum}));
}
function model(game,history=[],context={}){
 const sport=game.sport,base=BASE[sport];if(!base)throw Error('지원되지 않는 종목');
 const h=form(history,game.home.id,game.date),a=form(history,game.away.id,game.date);
 const international=game.sport==='soccer'&&String(game.league||'').startsWith('intl-');
 const required=international?4:3;
 const strength=context?.strength;
 const hasElo=!!(strength&&Number.isFinite(strength.homeRating)&&Number.isFinite(strength.awayRating)
  &&strength.allTimeHomeGames>=8&&strength.allTimeAwayGames>=8);
 const covered=h.count>=required&&a.count>=required&&(!international||hasElo);
 if(!covered){
  const why='양 팀 각각 최근 완료 경기 '+required+'건 이상 필요 · 확보한 기록: 홈 '+h.count+'건, 원정 '+a.count+'건.'
   +(international&&!hasElo?' 국가대표 상대 전력 지표가 확인되지 않았습니다.':'');
  return {
   sport,league:game.league,gameId:game.id,home:h,away:a,strength:hasElo?strength:null,available:false,
   expected:{home:null,away:null,total:null},
   probabilities:{home:null,draw:null,away:null,btts:null},
   lines:[],topScores:[],rank:[],choices:[],defaultLine:null,confidence:'분석 보류',
   dataQuality:{usedCompletedGames:h.count+a.count,homeGames:h.count,awayGames:a.count,requiredPerTeam:required,
    level:'자료 부족',source:'공개 경기 결과',note:why},
   explanation:[why,'자료가 부족한 상태에서 리그 평균과 홈 이점만으로 승자를 예측하면 일본–브라질 등 전력 차이가 있는 경기에서 근거 없이 홈팀이 유리해지는 오류가 발생합니다.',
    '현재는 신뢰할 수 있는 양 팀의 실전 전적이 확보되지 않아 승무패·예상 득점·언더오버 수치 공개를 보류합니다.',
    '부상·선발·상대 전력 차이·국가대표팀 랭킹을 검증 가능한 자료로 확인한 뒤 반영해야 합니다.'],
   isFinished:game.status==='final',modelVersion:'1.2.0'
  };
 }
 const prior=international?[1.3,1.3]:(PRIOR[game.league]||[base.home,base.away]),neutral=(prior[0]+prior[1])/2;
 const hw=h.count/(h.count+6),aw=a.count/(a.count+6);
 const hOff=neutral*(1-hw)+(h.scored??neutral)*hw;
 const hDef=neutral*(1-hw)+(h.conceded??neutral)*hw;
 const aOff=neutral*(1-aw)+(a.scored??neutral)*aw;
 const aDef=neutral*(1-aw)+(a.conceded??neutral)*aw;
 let expH=clamp(prior[0]*(hOff+aDef)/(2*neutral),prior[0]*.5,prior[0]*1.7);
 let expA=clamp(prior[1]*(aOff+hDef)/(2*neutral),prior[1]*.5,prior[1]*1.7);
 if(international&&hasElo){
  // Home designation is not evidence of home venue; apply no extra venue boost.
  const ratingDifference=clamp((strength.homeRating-strength.awayRating)/550,-0.55,0.55);
  expH*=Math.exp(ratingDifference);expA*=Math.exp(-ratingDifference);
 }
 const dist=distribution(expH,expA,sport,base.sd);
 let home=0,draw=0,away=0,btts=0;
 for(const x of dist){if(x.h>x.a)home+=x.p;else if(x.h<x.a)away+=x.p;else draw+=x.p;
 if(x.h>0&&x.a>0)btts+=x.p;}
 if(sport!=='soccer'){home+=draw/2;away+=draw/2;}
 const lines=base.lines.map(line=>{let over=0;for(const x of dist)if(x.h+x.a>line)over+=x.p;return {line,over,under:1-over};});
 const defaultLine=sport==='soccer'?2.5:sport==='baseball'?8.5:221.5;
 const target=lines.find(x=>x.line===defaultLine)||lines[0];
 const rank=[{id:'home',label:game.home.name+' 승',prob:home},...(sport==='soccer'?[{id:'draw',label:'무승부',prob:draw}]:[]),{id:'away',label:game.away.name+' 승',prob:away}].sort((x,y)=>y.prob-x.prob);
 const choices=[...rank,{id:'under',label:target.line+' 언더',prob:target.under},{id:'over',label:target.line+' 오버',prob:target.over}].sort((x,y)=>y.prob-x.prob);
 const sample=h.count+a.count,confidence=sample>=12?'보통':sample>=6?'낮음':'매우 낮음';
 const explanation=sample?[
  game.home.name+' 최근 '+h.count+'경기 '+h.w+'승 '+h.d+'무 '+h.l+'패, 평균 득점 '+(h.scored??0).toFixed(1)+' / 실점 '+(h.conceded??0).toFixed(1)+'입니다.',
  game.away.name+' 최근 '+a.count+'경기 '+a.w+'승 '+a.d+'무 '+a.l+'패, 평균 득점 '+(a.scored??0).toFixed(1)+' / 실점 '+(a.conceded??0).toFixed(1)+'입니다.'
 ]:['최근 전적을 확보하지 못해 리그 평균 득점과 기본 홈 어드밴티지에 따른 추정치입니다.'];
 if(international&&hasElo)explanation.push('경기 정보의 홈·원정 표기만으로 실제 홈구장 이점을 단정하지 않아, 국가대표 친선경기에는 기본 홈 가산점을 적용하지 않았습니다.');
 if(international&&hasElo)explanation.push('최근 공개 A매치 결과로 계산한 자체 Elo 지표: '+game.home.name+' '+strength.homeRating+'점, '+game.away.name+' '+strength.awayRating+'점입니다. 이는 공식 FIFA 랭킹이 아니며 실력을 완벽하게 나타내지 않습니다.');
 explanation.push('추정 기대 득점은 홈 '+expH.toFixed(2)+', 원정 '+expA.toFixed(2)+'입니다. '+(sport==='basketball'?'정규분포 근사':'포아송 분포')+'로 점수 분포를 계산했습니다.');
 explanation.push('가장 높은 모델 확률은 '+choices[0].label+' '+(choices[0].prob*100).toFixed(1)+'%입니다. 수익을 보장하거나 특정 베팅을 권유하는 수치는 아닙니다.');
 if(sport!=='soccer')explanation.push('동점 확률은 승패 양쪽에 절반씩 배분했으며 실제 연장전/무승부 규정은 별도로 반영하지 않았습니다.');
 explanation.push('현재 예측은 양 팀 최근 실제 결과의 득·실점만 반영한 간이 모델입니다. 상대 팀 전력 수준·FIFA/클럽 Elo·부상·선발 등은 검증된 데이터 없이는 반영하지 않으므로 예측 확률을 확정적인 실력 비교로 해석하면 안 됩니다.');
 return {sport,league:game.league,gameId:game.id,home:h,away:a,strength:hasElo?strength:null,available:true,expected:{home:expH,away:expA,total:expH+expA},
 probabilities:{home,draw:sport==='soccer'?draw:null,away,btts:sport==='soccer'?btts:null},
 lines,topScores:dist.sort((x,y)=>y.p-x.p).slice(0,5),rank,choices,defaultLine,confidence,
 dataQuality:{usedCompletedGames:sample,homeGames:h.count,awayGames:a.count,level:confidence,source:'실제 최근 경기 기반 수축평균 + 확률분포',note:international?'최근 24개월 A매치 기록과 자체 Elo를 결합한 검증 전 추정치 · 데이터 마지막 경기 '+(strength.sourceLastMatch||'미확인'):sample<12?'경기 표본이 적어 불확실성이 큽니다.':'선발·부상·상대 전력 등 변수는 미반영'},
 explanation,isFinished:game.status==='final',modelVersion:'1.2.0'};
}
module.exports={BASE,model,poisson,form};
