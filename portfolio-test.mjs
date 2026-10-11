import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {portfolio} from './portfolio.mjs';
import {createApp} from './server.mjs';
const snapshot={now:123,projects:[{id:'p',kind:'project',status:'active',name:'Paper'},{id:'w',kind:'workspace',status:'active',name:'Source history'}],tasks:[{id:'parent',projectId:'p',status:'todo'},{id:'a',parentId:'parent',projectId:'p',status:'done'},{id:'b',parentId:'parent',projectId:'p',status:'reported'}],deadlines:[{id:'d',projectId:'w',title:'Submission',received:0,priority:0}],runs:[{id:'old',source:'Pi',projectId:'p',status:'running_observed'}]};
const result=portfolio(snapshot);
assert.equal(result.totals.projects,1);assert.equal(result.projects[0].total,2);assert.equal(result.projects[0].done,1);assert.equal(result.projects[0].reported,1);assert.equal(result.projects[0].completed,false);assert.equal(result.totals.livePi,0);assert.equal(result.unassignedDeadlines.length,1);assert.equal(result.totals.deadlines,1);
assert.equal(portfolio(snapshot,[{id:'old',status:'running'}]).totals.livePi,1);
assert.equal(result.unassignedDeadlines[0].projectId,'w');
assert.equal(portfolio({...snapshot,tasks:[{id:'a',projectId:'p',title:'前提',status:'todo'},{id:'b',projectId:'p',status:'todo',dependencies:['a']}]}).projects[0].blockers[1].reason,'前提未完了：前提');
const temp=await mkdtemp(join(tmpdir(),'portfolio-api-')),app=await createApp({dataDir:temp,port:45349,background:false});
try{
 const endpoint='http://127.0.0.1:45349/api/portfolio',key=(await readFile(join(temp,'portfolio-read-key'),'utf8')).trim();
 assert.equal((await fetch(endpoint)).status,401);assert.equal((await fetch(endpoint,{headers:{authorization:'Bearer invalid'}})).status,401);
 const headers={authorization:'Bearer '+key};const response=await fetch(endpoint,{headers});assert.equal(response.status,200);assert.equal((await response.json()).schemaVersion,1);
 assert.equal((await fetch('http://127.0.0.1:45349/api/state',{headers})).status,401);
 assert.equal((await fetch(endpoint,{method:'POST',headers:{...headers,origin:'http://127.0.0.1:45349','content-type':'application/json'},body:'{}'})).status,401);
}finally{await app.close();await rm(temp,{recursive:true,force:true})}
console.log('PASS: leaf progress, reported != verified, orphan deadlines retained, history != live, read-only credential cannot read state or mutate');
