import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createApp} from './server.mjs';
import {createRemoteGateway} from './remote-gateway.mjs';

await test('外部HTTPSは一回限りのスマホ認証を維持し、Mac管理権限と別Originを拒否する',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dashboard-remote-'));
 let received;const app=await createApp({dataDir:dir,port:45538,background:false,dailyAnalyze:async(_inputs,ledger)=>{received=ledger.notes;return {summary:'スマホからの指示を受信しました',picks:[]}}});let gateway;
 const local='http://127.0.0.1:45538',origin='https://dashboard-test.trycloudflare.com';
 try{
  const login=await fetch(local+'/api/login',{method:'POST',headers:{origin:local,'content-type':'application/json'},body:JSON.stringify({code:app.key})});
  const adminCookie=login.headers.get('set-cookie').split(';')[0];
  const mobile=await fetch(local+'/api/mobile',{method:'POST',headers:{origin:local,cookie:adminCookie,'content-type':'application/json'},body:'{}'});
  const {code}=await mobile.json();
  gateway=await createRemoteGateway({port:0,upstreamPort:45539,ca:await readFile(join(dir,'tls/ca.crt')),origin:()=>origin});
  const base='http://127.0.0.1:'+gateway.address().port;
  const request=(path,body,cookie,extra={})=>new Promise((resolve,reject)=>{
   const req=http.request(base+path,{method:body===undefined?'GET':'POST',headers:{host:new URL(origin).host,'x-forwarded-proto':'https',origin,'content-type':'application/json',...(cookie?{cookie}:{}),...extra}},res=>{const parts=[];res.on('data',b=>parts.push(b));res.on('end',()=>resolve(new Response(Buffer.concat(parts),{status:res.statusCode,headers:Object.fromEntries(Object.entries(res.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(', '):v]))}))) });
   req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  assert.equal((await request('/')).status,200);
  assert.equal((await request('/api/state')).status,401);
  assert.equal((await request('/api/state',undefined,adminCookie)).status,403);
  assert.equal((await request('/api/login',{code:app.key})).status,403);
  assert.equal((await request('/api/pair',{code},null,{origin:'https://attacker.example'})).status,403);
  assert.equal((await request('/api/pair',{code},null,{host:'attacker.example'})).status,403);
  assert.equal((await request('/api/pair',{code},null,{'x-forwarded-proto':'http'})).status,403);
  const paired=await request('/api/pair',{code});assert.equal(paired.status,200);assert.match(paired.headers.get('set-cookie'),/Secure/);
  const cookie=paired.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/pair',{code})).status,401);
  assert.equal((await (await request('/api/state',undefined,cookie)).json()).role,'phone');
  assert.equal((await request('/api/project',{name:'外出先の操作試験'},cookie)).status,200);
  assert.equal((await request('/api/backup',{},cookie)).status,403);
  assert.equal((await request('/api/external',{enabled:true},cookie)).status,403);
  assert.equal((await request('/api/pi-prompt',{},cookie)).status,400,'phone may send, but input validation remains');
  assert.equal((await request('/api/daily-plan',{note:'スマホから今日の作業を指示します'},cookie)).status,200);
  for(let i=0;i<100&&!received;i++)await new Promise(r=>setTimeout(r,20));
  assert.ok(received?.some(n=>n.text==='スマホから今日の作業を指示します'),'phone message reaches the analyzer');
  for(let i=0;i<8;i++)await fetch(local+'/api/login',{method:'POST',headers:{origin:local,'content-type':'application/json'},body:'{"code":"wrong"}'});
  const next=await (await fetch(local+'/api/mobile',{method:'POST',headers:{origin:local,cookie:adminCookie,'content-type':'application/json'},body:'{}'})).json();
  assert.equal((await request('/api/pair',{code:next.code})).status,200,'Mac login attempts must not block phone pairing');
  for(let i=0;i<8;i++)await request('/api/pair',{code:'wrong'});
  assert.equal((await request('/api/pair',{code:'wrong'})).status,429,'phone brute-force protection remains');
 }finally{if(gateway)await new Promise(r=>gateway.close(r));await app.close();await rm(dir,{recursive:true,force:true})}
});
