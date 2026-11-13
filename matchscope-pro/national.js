'use strict';
// Public-domain historical men's national-team results, not a live FIFA ratings service.
// https://github.com/martj42/international_results (CC0-1.0)
// Date-only match records are excluded on and after the fixture's calendar day.
const SOURCE='https://raw.githubusercontent.com/martj42/international_results/master/results.csv';
let cache=null,pending=null,fetchIssue=null;
const ALIASES={
 'korea republic':'South Korea','republic of korea':'South Korea','korea, republic of':'South Korea','korea rep':'South Korea',
 'korea republic of':'South Korea','s korea':'South Korea','south korea':'South Korea',
 'ksa':'Saudi Arabia','saudi':'Saudi Arabia','saudi arabia':'Saudi Arabia',
 'brasil':'Brazil','jpn':'Japan','bra':'Brazil','kor':'South Korea',
 'ir iran':'Iran','iran islamic republic':'Iran','iran ir':'Iran',
 'united states of america':'United States','usa':'United States','united states':'United States',
 'cote divoire':'Ivory Coast',"côte d'ivoire":'Ivory Coast','czechia':'Czech Republic',
 'turkiye':'Turkey','türkiye':'Turkey','viet nam':'Vietnam',
 'england national team':'England','germany national team':'Germany',
 'netherlands national team':'Netherlands','south korea national team':'South Korea',
 'brazil national team':'Brazil','japan national team':'Japan'
};
function clean(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()
 .replace(/^[\s.]+|[\s.]+$/g,'').replace(/\s+/g,' ').replace(/ (men'?s )?(national|football|soccer) team$/,'')}
function canon(v){const name=clean(v);return ALIASES[name]||name}
function csvColumns(line){
 const cols=[];let value='',quoted=false;
 for(let i=0;i<line.length;i++){const c=line[i];
  if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){cols.push(value);value='';}
  else value+=c;
 }
 cols.push(value);return cols;
}
function parseResults(csv){
 const lines=String(csv||'').replace(/^\uFEFF/,'').split(/\r?\n/);
 if(lines.length<2||!lines[0].startsWith('date,home_team,away_team,home_score,away_score'))throw Error('국가대표 데이터 형식 불일치');
 const rows=[];let latest='';
 for(let i=1;i<lines.length;i++){
  const c=csvColumns(lines[i]);if(c.length<5||!/^\d{4}-\d\d-\d\d$/.test(c[0]))continue;
  const h=Number(c[3]),a=Number(c[4]);
  if(c[3]===''||c[4]===''||!Number.isInteger(h)||!Number.isInteger(a)||h<0||a<0)continue;
  rows.push({date:c[0],home:c[1],away:c[2],hn:canon(c[1]),an:canon(c[2]),hs:h,as:a,
   tournament:c[5]||'',neutral:String(c[8]||'').toUpperCase()==='TRUE'});
  if(c[0]>latest)latest=c[0];
 }
 if(rows.length<10)throw Error('국가대표 데이터 행이 부족합니다');
 rows.sort((a,b)=>a.date.localeCompare(b.date));
 return {rows,latest};
}
async function load(){
 if(cache&&Date.now()-cache.at<12*3600*1000)return cache;
 if(pending)return pending;
 pending=(async()=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await fetch(SOURCE,{signal:controller.signal,headers:{accept:'text/csv'}});
   if(!response.ok)throw Error('공개 A매치 데이터 HTTP '+response.status);
   const body=await response.text();if(body.length>9000000)throw Error('공개 경기 기록이 너무 큽니다');
   const parsed=parseResults(body);
   cache={...parsed,at:Date.now(),fetchedAt:new Date().toISOString(),url:SOURCE};
   fetchIssue=null;return cache;
  }catch(err){fetchIssue=String(err.message||err);if(cache)return cache;throw err;}
  finally{clearTimeout(timer);pending=null}
 })();
 return pending;
}
function ratingsAsOf(rows,cutoff){
 const ratings=new Map(),counts=new Map();
 for(const r of rows){
  if(r.date>=cutoff)break;
  const x=ratings.get(r.hn)??1500,y=ratings.get(r.an)??1500;
  const pred=1/(1+10**((y-x-(r.neutral?0:40))/400));
  const actual=r.hs>r.as?1:r.hs===r.as?0.5:0;
  const margin=1+Math.min(0.6,Math.max(0,Math.abs(r.hs-r.as)-1)*0.18);
  const k=(/friendly/i.test(r.tournament)?15:24)*margin;
  ratings.set(r.hn,x+k*(actual-pred));ratings.set(r.an,y-k*(actual-pred));
  counts.set(r.hn,(counts.get(r.hn)||0)+1);counts.set(r.an,(counts.get(r.an)||0)+1);
 }
 return {ratings,counts};
}
function matchFacts(game,src){
 const cutoff=String(game.date||'').slice(0,10);
 if(!/^\d{4}-\d\d-\d\d$/.test(cutoff))throw Error('경기 날짜가 유효하지 않습니다');
 const own=canon(game.home.name),other=canon(game.away.name);
 const data=src||cache;if(!data)throw Error('A매치 원본 자료 미수신');
 const cutoffMs=Date.parse(cutoff+'T00:00:00Z'),since=new Date(cutoffMs-730*86400000).toISOString().slice(0,10);
 const {ratings,counts}=ratingsAsOf(data.rows,cutoff);
 const recent=data.rows.filter(r=>r.date<cutoff&&r.date>=since&&[own,other].some(n=>r.hn===n||r.an===n))
   .sort((a,b)=>b.date.localeCompare(a.date)).slice(0,80);
 const ids=new Map([[own,game.home.id],[other,game.away.id]]);
 const idFor=v=>String(ids.get(v)||'intl:'+v.replace(/[^a-z0-9]/g,'-'));
 const history=recent.map(r=>({
  date:r.date+'T12:00:00Z',status:'final',source:'A매치 공개 역사 기록(CC0)',externalId:[r.date,r.hn,r.an].join(':'),
  home:{id:idFor(r.hn),name:r.home,score:r.hs},
  away:{id:idFor(r.an),name:r.away,score:r.as}
 }));
 const teamCount=(name)=>recent.filter(r=>r.hn===name||r.an===name).length;
 const homeRating=ratings.get(own),awayRating=ratings.get(other);
 const lastSeen=(n)=>recent.find(r=>r.hn===n||r.an===n)?.date||null;
 return {history,strength:{
  source:'Mart Jürisoo 국제 A매치 결과 · 자체 Elo 추정 · CC0',sourceUrl:SOURCE,
  homeRating:Number.isFinite(homeRating)?Math.round(homeRating):null,awayRating:Number.isFinite(awayRating)?Math.round(awayRating):null,
  homeGames:teamCount(own),awayGames:teamCount(other),allTimeHomeGames:counts.get(own)||0,allTimeAwayGames:counts.get(other)||0,
  homeLastMatch:lastSeen(own),awayLastMatch:lastSeen(other),sourceLastMatch:data.latest,
  fetchedAt:data.fetchedAt||null,method:'경기별 결과 업데이트 Elo (친선 가중치 낮춤 · 홈 보정 40 · 상대 전력 반영)',neutralUnknown:true
 }};
}
function health(){return {ready:!!cache,loadedAt:cache?.fetchedAt||null,lastMatchDate:cache?.latest||null,rows:cache?.rows?.length||0,error:fetchIssue,url:SOURCE};}
module.exports={SOURCE,load,health,matchFacts,parseResults,ratingsAsOf,canon};
