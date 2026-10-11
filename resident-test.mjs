import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import net from 'node:net';
import {Store} from './store.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('production resident entry connects independent public package and preserves ledger and DSH home across restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dashboard-resident-')),home=join(dir,'dsh');await mkdir(home);const auth=JSON.stringify({version:1,refs:{},records:{}});await writeFile(join(home,'.credentials.yaml'),auth,{mode:0o600});await writeFile(join(home,'history-sentinel'),'retained');const s=new Store(join(dir,'dashboard.sqlite'));s.project({name:'Retained project'});s.close();const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 let child;try{for(let attempt=0;attempt<2;attempt++){let output='';child=spawn(process.execPath,['resident.mjs'],{cwd:import.meta.dirname,env:{...process.env,DASHBOARD_DATA:dir,DSH_HOME:home,PORT:String(port),DASHBOARD_SCRUM_PACKAGE_ROOT:process.env.DASHBOARD_SCRUM_PACKAGE_ROOT||join(import.meta.dirname,'../Scrum')},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const until=Date.now()+30000;while(true){try{const response=await fetch('http://127.0.0.1:'+port+'/api/state');if(response.status===401)break}catch{}if(child.exitCode!==null||Date.now()>until)throw Error('Resident boot failed '+output);await sleep(100)}const key=(await readFile(join(dir,'local-key'),'utf8')).trim();const login=await fetch('http://127.0.0.1:'+port+'/api/login',{method:'POST',headers:{origin:'http://127.0.0.1:'+port,'content-type':'application/json'},body:JSON.stringify({code:key})});const state=await (await fetch('http://127.0.0.1:'+port+'/api/state',{headers:{cookie:login.headers.get('set-cookie')}})).json();assert.equal(state.runtime.scrumConnected,true);assert.equal(state.projects[0].name,'Retained project');assert.equal(await readFile(join(home,'.credentials.yaml'),'utf8'),auth);assert.equal(await readFile(join(home,'history-sentinel'),'utf8'),'retained');const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([exited,sleep(10000).then(()=>{throw Error('Resident shutdown timed out')})]);assert.equal(child.exitCode,0);child=null;}
 await writeFile(join(import.meta.dirname,'work/plugin-separation/resident-verification.json'),JSON.stringify({passed:true,productionEntry:true,publicScrumPackage:true,authenticatedHTTP:true,restartPreservedLedger:true,credentialsAndHistoryUnchanged:true,gracefulShutdown:true},null,2));
 }finally{child?.kill('SIGKILL');await rm(dir,{recursive:true,force:true})}
});
