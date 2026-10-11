import test from 'node:test';import assert from 'node:assert/strict';import {createJiti} from 'jiti';
await test('Web拡張は検索・取得・再参照のみで、空検索とローカルURLを拒否する',async()=>{
 const {default:install}=await import('./vendor/pi-web-access.mjs'),tools=new Map();install({registerTool:t=>tools.set(t.name,t)});
 assert.deepEqual([...tools.keys()],['web_search','fetch_content','get_search_content']);
 await assert.rejects(tools.get('web_search').execute('empty',{query:'   '}),/query/i);
 await assert.rejects(tools.get('fetch_content').execute('private',{url:'http://127.0.0.1:4318/'}),/blocked|private|loopback|public|SSRF/i);
 await assert.rejects(tools.get('get_search_content').execute('unknown',{responseId:'does-not-exist'}),/No stored results/);
});
import {fetchRemoteUrl} from './vendor/pi-web-access.mjs';
import {createServer} from 'node:http';
test('Scrum web execution follows ten redirects, closes loops and blocks private redirect targets',async()=>{let hits=0;const server=createServer((req,res)=>{hits++;const n=Number(req.url.slice(1));if(n>0){res.writeHead(302,{location:'/'+(n-1)});res.end()}else{res.end('FINAL')}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{const base='http://public-fixture.test',local='http://127.0.0.1:'+server.address().port,lookup=async()=>[{address:'93.184.216.34',family:4}],route=(url,address,init)=>fetch(local+url.pathname,init);const result=await fetchRemoteUrl(base+'/10',{}, {lookup,pinnedFetch:route});assert.equal(await result.response.text(),'FINAL');assert.equal(hits,11);hits=0;await assert.rejects(fetchRemoteUrl(base+'/11',{}, {lookup,pinnedFetch:route}),/Too many redirects/);assert.equal(hits,11);let network=0;await assert.rejects(fetchRemoteUrl(base+'/start',{}, {lookup,pinnedFetch:async()=>{network++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}})}}),/blocked|private|loopback/i);assert.equal(network,1);const controller=new AbortController();controller.abort();await assert.rejects(fetchRemoteUrl(base+'/0',{signal:controller.signal},{lookup,pinnedFetch:route}),/abort/i)}finally{await new Promise(resolve=>server.close(resolve))}});
