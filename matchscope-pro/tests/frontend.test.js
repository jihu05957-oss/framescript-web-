'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('Deployed HTML scripts parse and expose all four analysis tabs',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(x=>x.trim());
 assert.ok(scripts.length>0,'inline app must be included in shipped HTML');
 for(const script of scripts)assert.doesNotThrow(()=>new vm.Script(script,{filename:'index.html'}));
 for(const section of ['renderOverview','renderForm','renderMarket','renderSources'])assert.ok(html.includes('function '+section+'('));
 for(const tab of ['overview','form','market','sources'])assert.ok(html.includes("'"+tab+"'"));
 assert.ok(html.includes('data-tab'));
 assert.ok(html.includes('available===false'),'Missing-data guard required before probabilities render');
});
