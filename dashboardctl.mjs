#!/usr/bin/env node
import {readFile} from 'node:fs/promises';import {homedir} from 'node:os';import {join} from 'node:path';
const [command,id,...words]=process.argv.slice(2),origin='http://127.0.0.1:'+Number(process.env.PORT||4318);
if(!['status','tasks','dispatch','stop','retry'].includes(command)){console.error('Usage: node dashboardctl.mjs status | tasks | dispatch <taskId> <instruction> | stop <assignmentId> | retry <assignmentId>');process.exit(2)}
try{
 const login=await fetch(origin+'/api/login',{signal:AbortSignal.timeout(20000),method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({code:(await readFile(join(process.env.DASHBOARD_DATA||join(homedir(),'Library/Application Support/Project Dashboard'),'local-key'),'utf8')).trim()})});if(!login.ok)throw Error('Local dashboard login failed');
 const headers={origin,'content-type':'application/json',cookie:login.headers.get('set-cookie').split(';')[0]},request=async(path,body)=>{const r=await fetch(origin+'/api/'+path,{signal:AbortSignal.timeout(20000),headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})}),result=await r.json();if(!r.ok)throw Error(result.error||'Request failed');return result},state=await request('state');
 let result;if(command==='status')result={runtime:state.runtime,daily:{day:state.daily.workDay,sessionId:state.daily.sessionId,running:state.daily.running,error:state.daily.error},assignments:state.daily.assignments.map(a=>({id:a.id,taskId:a.taskId,status:a.status,outcome:a.observation?.outcome}))};
 else if(command==='tasks')result=state.tasks.filter(t=>t.actionable&&t.owner==='Pi').map(t=>({id:t.id,title:t.title,projectId:t.projectId,output:t.output,version:t.version}));
 else if(command==='dispatch'){const task=state.tasks.find(t=>t.id===id);if(!task||!words.length)throw Error('Provide a registered task ID and instruction');result=await request('worker-dispatch',{taskId:id,taskVersion:task.version,parentSession:state.daily.sessionId,action:words.join(' ')})}
 else{if(!id)throw Error('Assignment ID required');result=await request('assignment-'+command,{id})}
 console.log(JSON.stringify(result,null,2));
}catch(e){console.error(e.message);process.exitCode=1}
