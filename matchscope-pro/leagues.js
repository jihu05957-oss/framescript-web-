'use strict';
const LEAGUES=[
{id:'kleague1',name:'K리그 1',sport:'soccer',region:'대한민국',flag:'🇰🇷',espn:'kor.1',tsdb:4689},
{id:'kleague2',name:'K리그 2',sport:'soccer',region:'대한민국',flag:'🇰🇷',espn:'kor.2',tsdb:4822},
{id:'epl',name:'프리미어리그',sport:'soccer',region:'잉글랜드',flag:'🏴',espn:'eng.1',tsdb:4328},
{id:'laliga',name:'라리가',sport:'soccer',region:'스페인',flag:'🇪🇸',espn:'esp.1',tsdb:4335},
{id:'bundesliga',name:'분데스리가',sport:'soccer',region:'독일',flag:'🇩🇪',espn:'ger.1',tsdb:4331},
{id:'seriea',name:'세리에 A',sport:'soccer',region:'이탈리아',flag:'🇮🇹',espn:'ita.1',tsdb:4332},
{id:'ligue1',name:'리그 1',sport:'soccer',region:'프랑스',flag:'🇫🇷',espn:'fra.1',tsdb:4334},
{id:'j1',name:'J1리그',sport:'soccer',region:'일본',flag:'🇯🇵',espn:'jpn.1',tsdb:4633},
{id:'kbo',name:'KBO',sport:'baseball',region:'대한민국',flag:'🇰🇷',espn:null,tsdb:4830},
{id:'mlb',name:'MLB',sport:'baseball',region:'미국',flag:'🇺🇸',espn:'mlb',tsdb:4424},
{id:'npb',name:'NPB',sport:'baseball',region:'일본',flag:'🇯🇵',espn:null,tsdb:4591},
{id:'kbl',name:'KBL',sport:'basketball',region:'대한민국',flag:'🇰🇷',espn:null,tsdb:5124},
{id:'nba',name:'NBA',sport:'basketball',region:'미국',flag:'🇺🇸',espn:'nba',tsdb:4387}
];
const leagueById=id=>LEAGUES.find(l=>l.id===id);
const espnPath=sport=>sport;
module.exports={LEAGUES,leagueById,espnPath};
