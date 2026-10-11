import {projectAttemptOutcome} from './vendor/orca/attempt-outcome-projection.mjs';
export const PI_ARGS=['--provider','openai-codex','--model','gpt-6.1-sol','--thinking','low'];
export function initRuntime(s){s.db.exec(`CREATE TABLE IF NOT EXISTS assignment_observations(dispatchId TEXT NOT NULL REFERENCES assignments(id),facet TEXT NOT NULL,payload TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(dispatchId,facet))`)}
export function observe(s,id,facet,payload){if(!s.get('SELECT 1 FROM assignments WHERE id=?',id))return;s.run('INSERT INTO assignment_observations VALUES(?,?,?,?) ON CONFLICT(dispatchId,facet) DO UPDATE SET payload=excluded.payload,at=excluded.at',id,facet,JSON.stringify(payload),Date.now())}
export function observation(s,a,entry){
 const facts=s.all('SELECT * FROM assignment_observations WHERE dispatchId=?',a.id).map((r,i)=>({id:a.id+':'+r.facet,dispatchId:a.id,sequence:i,authorityId:'local-pi-rpc',authorityClock:'home',homeReceivedAt:r.at,facet:r.facet,payload:JSON.parse(r.payload)}));
 const op=s.setting('pi-send:'+a.id,null),add=(facet,payload)=>facts.push({id:a.id+':'+facet,sequence:facts.length,authorityClock:'home',homeReceivedAt:Date.now(),facet,payload});
 if(op?.status==='completed'||op?.status==='failed')add('process_turn',{process:'stopped',turn:'finished'});
 if(a.status==='done'&&a.artifact?.hash&&a.verification)add('worker_report',{status:'accepted',outcome:'succeeded',reportId:a.id});
 else if(a.status==='error'&&op?.status==='failed')add('worker_report',{status:'accepted',outcome:'failed',reportId:a.id});
 if(entry?.rpc&&!entry.rpc.error)add('liveness',{status:'live'});else if(!facts.some(f=>f.facet==='liveness'&&f.payload.status==='exited'))add('liveness',{status:'unverifiable',reason:'No owned live Pi RPC process'});
 return projectAttemptOutcome({dispatchId:a.id,taskId:a.taskId,facts,authorityNow:{home:Date.now()}});
}
