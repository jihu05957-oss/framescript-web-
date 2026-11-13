'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),path=require('node:path');
const port=18088,base='http://127.0.0.1:'+port;
const appPass='integration-test-password-long',cookie='test-secret-12345678901234567890123456789012';
let server;
async function awaitReady(){
 for(let i=0;i<70;i++){
  if(server.exitCode!==null)throw Error('Server exited early');
  try{const r=await fetch(base+'/api/health');if(r.ok)return r.json()}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 throw Error('Server failed to start');
}
test('without permanent R2 no collection or upload starts, login still works',async()=>{
 server=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:String(port),APP_PASSWORD:appPass,COOKIE_SECRET:cookie,
  R2_ENDPOINT:'',R2_BUCKET:'',R2_ACCESS_KEY_ID:'',R2_SECRET_ACCESS_KEY:''},stdio:['ignore','pipe','pipe']});
 let output='';server.stderr.on('data',b=>output+=b.toString());
 try{
  const health=await awaitReady();
  assert.equal(health.ok,true);assert.equal(health.ready,false);assert.equal(health.persistent,false);
  const noAuthGallery=await fetch(base+'/api/gallery');
  assert.equal(noAuthGallery.status,401);
  const noAuthMedia=await fetch(base+'/api/file/some-id');
  assert.equal(noAuthMedia.status,401);
  const noAuthUpload=await fetch(base+'/api/upload',{method:'POST'});
  assert.equal(noAuthUpload.status,401);
  const publicState=await (await fetch(base+'/api/me')).json();
  assert.equal(publicState.ready,false);
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:appPass})});
  assert.equal(login.status,200);
  const securityHeaders=login.headers;
  assert.equal(securityHeaders.get('x-frame-options'),'DENY');
  assert.ok(securityHeaders.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.ok(securityHeaders.get('set-cookie').includes('HttpOnly'));
  assert.ok(securityHeaders.get('set-cookie').includes('SameSite=Strict'));
  assert.ok(securityHeaders.get('set-cookie').includes('Secure'));
  const cookieHeader=login.headers.get('set-cookie').split(';')[0];
  const evilOrigin=await fetch(base+'/api/scan',{method:'POST',headers:{cookie:cookieHeader,Origin:'https://evil.example'}});
  assert.equal(evilOrigin.status,403);
  const run=await fetch(base+'/api/scan',{method:'POST',headers:{cookie:cookieHeader}});
  assert.equal(run.status,503);
  const upload=await fetch(base+'/api/upload',{method:'POST',headers:{cookie:cookieHeader}});
  assert.equal(upload.status,503);
  const stat=await(await fetch(base+'/api/status',{headers:{cookie:cookieHeader}})).json();
  assert.equal(stat.persistent,false);assert.equal(stat.completion,'storage_unconfigured');
  assert.equal(stat.total,0);assert.equal(stat.storage.usedBytes,0);
 }finally{if(server){server.kill('SIGTERM');await new Promise(resolve=>{if(server.exitCode!==null)resolve();else{server.once('exit',resolve);setTimeout(resolve,4000)}})}}
});
