import {DatabaseSync, backup} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
export function text(v,name,max=2000,required=true){if(typeof v!=='string'||v.length>max||(required&&!v.trim()))fail(`${name}を確認してください`);return v.trim()}
export function localTime(value,zone){
  text(value,'日時',30); text(zone,'タイムゾーン',80);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))fail('日時の形式が違います');
  let fmt;try{fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})}catch{fail('タイムゾーンが無効です')}
  const base=Date.parse(value+'Z');if(!Number.isFinite(base))fail('日時が無効です');
  const offsets=new Set();
  for(const h of [-36,0,36]){const t=base+h*3600000;offsets.add(Date.parse(fmt.format(t).replace(' ','T')+'Z')-t)}
  const matches=[...offsets].map(o=>base-o).filter(t=>fmt.format(t).replace(' ','T')===value);
  if(matches.length!==1)fail(matches.length?'夏時間で二通りある日時です。UTCで指定してください':'存在しない日時です');
  return matches[0];
}
export function deadlineState(d,now=Date.now()) {
 if(d.received||d.monitor==='excluded')return {band:null,dayOffset:null,category:d.received?'received':'excluded'};
 if(!d.local&&!d.due)return {band:'unknown',dayOffset:null,category:'unknown'};
 let today;try{today=new Intl.DateTimeFormat('sv-SE',{timeZone:d.zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now)}catch{return {band:'zone-unknown',dayOffset:null,category:'unknown'}}
 if(d.due!=null){const h=(d.due-now)/3600000;return {band:h<=0?'overdue':h<=2?'2h':h<=6?'6h':h<=24?'24h':h<=72?'72h':h<=168?'7d':null,dayOffset:h/24,category:'exact'}}
 const days=(Date.parse(d.local)-Date.parse(today))/86400000;
 if(!Number.isFinite(days))return {band:'unknown',dayOffset:null,category:'unknown'};
 return {band:days<0?'date-overdue':days===0?'date-today':days<=7?'date-7d':null,dayOffset:days,category:'date'};
}
export function band(d,now=Date.now()){return deadlineState(d,now).band}
export function projectIsActive(id,projects){const seen=new Set();while(id){const p=projects.find(p=>p.id===id);if(!p||p.status!=='active'||seen.has(id))return false;seen.add(id);id=p.parentProjectId}return true}
export function priority(d,now=Date.now()){const b=band(d,now);return ['overdue','2h','6h','date-overdue','date-today'].includes(b)?0:['24h','unknown','zone-unknown'].includes(b)?1:b?2:3}
export function actionability(t,tasks,projects){
 const active=x=>projectIsActive(x.projectId,projects);
 const open=x=>!['done','cancelled','reported'].includes(x.status);const blockers=[];
 const byId=new Map(tasks.map(x=>[x.id,x]));
 const depends=(x,id)=>{const pending=[...x.dependencies],seen=new Set();while(pending.length){const k=pending.pop();if(k===id)return true;if(seen.has(k))continue;seen.add(k);pending.push(...(byId.get(k)?.dependencies||[]))}return false};
 for(const x of tasks)if(active(x)&&open(x)&&x.due&&depends(x,t.id))blockers.push(x);
 blockers.sort((a,b)=>a.due-b.due);const inherited=blockers[0];
 const available=active(t)&&open(t)&&!tasks.some(c=>c.parentId===t.id&&open(c))&&t.dependencies.every(id=>tasks.find(x=>x.id===id)?.status==='done');
 const actor=!active(t)?'archived':t.waitReason==='external'?'external':!['自分','本人','Pi'].includes(t.owner)?'other':t.owner==='Pi'?'pi':'self';
 return {actionable:available&&['todo','doing'].includes(t.status)&&['self','pi'].includes(actor),actor,actionDue:Math.min(t.due||Infinity,inherited?.due||Infinity)||null,priorityReason:inherited&&(!t.due||inherited.due<t.due)?'前提待ち：'+inherited.title+'（'+new Date(inherited.due).toISOString()+ '）':''};
}
export function quiet(now,settings){const hr=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Tokyo',hour:'numeric',hourCycle:'h23'}).format(now));const {quietStart:s,quietEnd:e}=settings;return s===e?false:s<e?hr>=s&&hr<e:hr>=s||hr<e}
export class Store {
 constructor(path){mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
 CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,cwd TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,status TEXT NOT NULL,owner TEXT NOT NULL,nextAction TEXT NOT NULL,due INTEGER,dependencies TEXT NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS deadlines(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,due INTEGER,local TEXT NOT NULL,zone TEXT NOT NULL,source TEXT NOT NULL,excerpt TEXT NOT NULL,stage TEXT NOT NULL,received INTEGER NOT NULL DEFAULT 0,receivedAt INTEGER,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS deadline_revisions(id INTEGER PRIMARY KEY,deadlineId TEXT NOT NULL REFERENCES deadlines(id),version INTEGER NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(deadlineId,version));
 CREATE TABLE IF NOT EXISTS deliverables(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id),path TEXT NOT NULL,hash TEXT NOT NULL,reviewed INTEGER NOT NULL,checked INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,deadlineId TEXT NOT NULL REFERENCES deadlines(id),status TEXT NOT NULL,evidence TEXT NOT NULL,artifactId TEXT REFERENCES deliverables(id),artifactHash TEXT,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,deadlineId TEXT NOT NULL REFERENCES deadlines(id),version INTEGER NOT NULL,band TEXT NOT NULL,state TEXT NOT NULL,snooze INTEGER,created INTEGER NOT NULL,UNIQUE(deadlineId,version,band));
 CREATE TABLE IF NOT EXISTS attempts(id INTEGER PRIMARY KEY,notificationId TEXT NOT NULL REFERENCES notifications(id),result TEXT NOT NULL,detail TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,source TEXT NOT NULL,title TEXT NOT NULL,cwd TEXT NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL,observed INTEGER NOT NULL,checked INTEGER NOT NULL,projectId TEXT REFERENCES projects(id),detail TEXT NOT NULL,threadId TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS receipt_meta(submissionId TEXT PRIMARY KEY,deadlineVersion INTEGER NOT NULL,snapshot TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS revision_snooze(deadlineId TEXT NOT NULL,version INTEGER NOT NULL,untilTime INTEGER NOT NULL,PRIMARY KEY(deadlineId,version));
 CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS due_index ON deadlines(due); CREATE INDEX IF NOT EXISTS run_time ON runs(observed DESC);`);
 this.tx(()=>{
 if(!this.all('PRAGMA table_info(deadlines)').some(c=>c.name==='monitor'))this.db.exec("ALTER TABLE deadlines ADD COLUMN monitor TEXT NOT NULL DEFAULT 'active'");
 this.db.exec("CREATE TABLE IF NOT EXISTS task_reminders(taskId TEXT PRIMARY KEY REFERENCES tasks(id),checkAt INTEGER NOT NULL,state TEXT NOT NULL,nextAt INTEGER NOT NULL,lastSent INTEGER,detail TEXT)");
 const projectColumns=new Set(this.all('PRAGMA table_info(projects)').map(c=>c.name));
 for(const name of ['outcome','output','completionCriteria','basis','category','sourceProjectId','summary','parentProjectId'])if(!projectColumns.has(name))this.db.exec(`ALTER TABLE projects ADD COLUMN ${name} TEXT NOT NULL DEFAULT ''`);
 if(!projectColumns.has('kind'))this.db.exec("ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'workspace'");
 if(!projectColumns.has('execution'))this.db.exec("ALTER TABLE projects ADD COLUMN execution TEXT NOT NULL DEFAULT 'manual'");
 const columns=new Set(this.all('PRAGMA table_info(tasks)').map(c=>c.name));
 for(const [name,type] of Object.entries({body:"TEXT NOT NULL DEFAULT ''",inputs:"TEXT NOT NULL DEFAULT ''",output:"TEXT NOT NULL DEFAULT ''",parentId:'TEXT REFERENCES tasks(id)',waitReason:"TEXT NOT NULL DEFAULT ''",waitingFor:"TEXT NOT NULL DEFAULT ''",checkAt:'INTEGER',planDay:"TEXT NOT NULL DEFAULT ''",completedAt:'INTEGER',completionCriteria:"TEXT NOT NULL DEFAULT ''",completionEvidence:"TEXT NOT NULL DEFAULT ''",canonicalTarget:"TEXT NOT NULL DEFAULT ''"}))if(!columns.has(name))this.db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
 this.db.exec(`CREATE TABLE IF NOT EXISTS task_runs(taskId TEXT NOT NULL REFERENCES tasks(id),runId TEXT NOT NULL REFERENCES runs(id),PRIMARY KEY(taskId,runId)); CREATE INDEX IF NOT EXISTS task_parent ON tasks(parentId); CREATE INDEX IF NOT EXISTS task_run ON task_runs(runId);`);
 if(this.get('PRAGMA user_version').user_version<2){this.run("UPDATE notifications SET snooze=? WHERE state='ack' AND snooze IS NULL",Date.now()+86400000);this.db.exec('PRAGMA user_version=2')}
 });
 }
 all(sql,...args){return this.db.prepare(sql).all(...args)}
 get(sql,...args){return this.db.prepare(sql).get(...args)}
 run(sql,...args){return this.db.prepare(sql).run(...args)}
 tx(fn){const nested=this.db.isTransaction;this.db.exec(nested?'SAVEPOINT nested_write':'BEGIN IMMEDIATE');try{const v=fn();this.db.exec(nested?'RELEASE nested_write':'COMMIT');return v}catch(e){this.db.exec(nested?'ROLLBACK TO nested_write':'ROLLBACK');if(nested)this.db.exec('RELEASE nested_write');throw e}}
 setting(k,fallback){const r=this.get('SELECT value FROM settings WHERE key=?',k);return r?JSON.parse(r.value):fallback}
 set(k,v){this.run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',k,JSON.stringify(v))}
 project(p){return this.tx(()=>{const old=p.id?this.get('SELECT * FROM projects WHERE id=?',p.id):null;if(p.id&&!old)fail('プロジェクトがありません',404);
 const name=text(p.name,'プロジェクト名',150),id=p.id||randomUUID(),cwd=text(p.cwd??old?.cwd??'','フォルダ',2000,false),status=p.status??old?.status??'active',execution=p.execution??old?.execution??'manual';
 if(!['active','paused','completed','archived','deleted'].includes(status)||!['manual','auto'].includes(execution))fail('状態が無効です');
 const values=['outcome','output','completionCriteria','basis','category','summary'].map(k=>text(p[k]??old?.[k]??'',k,k==='summary'?240:4000,false));
 const parentProjectId=text(p.parentProjectId??old?.parentProjectId??'','親プロジェクト',200,false),seen=new Set([id]);
 for(let parent=parentProjectId;parent;){if(seen.has(parent))fail('プロジェクトの親子関係が循環しています');seen.add(parent);const target=this.get('SELECT * FROM projects WHERE id=?',parent);if(!target||target.kind==='workspace'||parentProjectId!==(old?.parentProjectId||'')&&['archived','deleted'].includes(target.status))fail('親プロジェクトが無効です');parent=target.parentProjectId}
 if(execution==='auto'&&(!cwd||values.slice(0,4).some(v=>!v)))fail('Piに委譲するには成果物・保存先・完了条件・根拠・作業フォルダを設定してください');
 if(old)this.run('UPDATE projects SET name=?,cwd=?,status=?,outcome=?,output=?,completionCriteria=?,basis=?,category=?,summary=?,execution=? WHERE id=?',name,cwd,status,...values,execution,id);
 else this.run('INSERT INTO projects(id,name,cwd,status,outcome,output,completionCriteria,basis,category,summary,execution,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,name,cwd,status,...values,execution,Date.now());this.run("UPDATE projects SET kind='project',parentProjectId=? WHERE id=?",parentProjectId,id);return id;
 })}

 requireProject(id){if(!this.get('SELECT id FROM projects WHERE id=?',id))fail('プロジェクトを選んでください')}
 task(p){return this.tx(()=>{
 this.requireProject(p.projectId);
 const id=p.id?text(p.id,'作業ID',200):randomUUID(),old=p.id?this.get('SELECT * FROM tasks WHERE id=?',id):null;
 if(p.id&&(!old||old.version!==p.version))fail('別の画面で変更されました。再読込してください',409);
 const title=text(p.title,'作業名',200),owner=text(p.owner??old?.owner??'自分','担当',100),next=text(p.nextAction??old?.nextAction??'','次の行動',2000,false);
 if(!['todo','doing','waiting','review','done','cancelled','reported'].includes(p.status))fail('作業状態が無効です');
 const deps=p.dependencies===undefined?(old?JSON.parse(old.dependencies):[]):p.dependencies;if(!Array.isArray(deps)||deps.length>50||deps.some(x=>typeof x!=='string')||new Set(deps).size!==deps.length)fail('前提作業が無効です');
 const parentId=text(p.parentId??old?.parentId??'','親作業',200,false)||null;
 const waitReason=text(p.waitReason??old?.waitReason??'','待ち理由',50,false),waitingFor=text(p.waitingFor??old?.waitingFor??'','待ち先',500,false);
 if(!['','approval','external','physical','technical','paused','unknown'].includes(waitReason))fail('待ち理由が無効です');
 const checkAt=p.checkLocal===undefined?old?.checkAt??null:p.checkLocal?localTime(p.checkLocal,p.zone||'Asia/Tokyo'):null;
 const completionCriteria=text(p.completionCriteria??old?.completionCriteria??'','完了条件',4000,false),completionEvidence=text(p.completionEvidence??old?.completionEvidence??'','完了証拠',4000,false),canonicalTarget=text(p.canonicalTarget??old?.canonicalTarget??'','正本・作業先',2000,false);
 const tasks=new Map(this.all('SELECT * FROM tasks').map(t=>[t.id,{...t,dependencies:JSON.parse(t.dependencies)}]));
 for(const d of deps)if(!tasks.has(d)||d===id)fail('前提作業が無効です');
 if(parentId&&(!tasks.has(parentId)||tasks.get(parentId).projectId!==p.projectId))fail('親作業は同じプロジェクトから選んでください');
 tasks.set(id,{id,projectId:p.projectId,title,status:p.status,dependencies:deps,parentId});
 const graph=new Map([...tasks].map(([key,t])=>[key,[...t.dependencies]]));
 for(const t of tasks.values())if(t.parentId){if(tasks.get(t.parentId)?.projectId!==t.projectId)fail('子作業があるためプロジェクトを変更できません');graph.get(t.parentId).push(t.id)}
 const seen=new Set(),visiting=new Set();for(const key of graph.keys()){const pending=[[key,false]];while(pending.length){const [k,exit]=pending.pop();if(exit){visiting.delete(k);seen.add(k);continue}if(seen.has(k))continue;if(visiting.has(k))fail('親子・依存関係が循環しています');visiting.add(k);pending.push([k,true]);for(const d of graph.get(k)||[])pending.push([d,false])}}
 for(const t of tasks.values())if(t.status==='done'&&(t.id===id||t.dependencies.includes(id)||t.id===parentId||t.id===old?.parentId)){
 if(t.dependencies.some(d=>tasks.get(d)?.status!=='done'))fail('前提作業が未完了です。完了済みの後続作業は先に再開してください');
 if(graph.get(t.id).some(id=>{const c=tasks.get(id);return c.parentId===t.id&&!['done','cancelled'].includes(c.status)}))fail('子作業が未完了です。完了済みの親作業は先に再開してください');
 }
 if(p.status==='reported'&&!completionEvidence)fail('完了報告の引用・根拠を記録してください');
 if(p.status==='done'&&(!completionCriteria||!completionEvidence))fail('完了には完了条件と確認した証拠が必要です');
 if(['waiting','review'].includes(p.status)&&(!waitReason||!checkAt))fail('待ち理由と次回確認日時を指定してください');
 const runIds=p.runIds===undefined?this.all('SELECT runId FROM task_runs WHERE taskId=?',id).map(r=>r.runId):p.runIds;
 if(!Array.isArray(runIds)||runIds.length>100||runIds.some(r=>typeof r!=='string')||new Set(runIds).size!==runIds.length)fail('関連セッションが無効です');
 for(const runId of runIds){const r=this.get('SELECT projectId FROM runs WHERE id=?',runId);if(!r||r.projectId!==p.projectId&&r.projectId!==this.get('SELECT sourceProjectId FROM projects WHERE id=?',p.projectId)?.sourceProjectId)fail('関連セッションは同じプロジェクトに関連付けてください')}
 const due=p.local===undefined?(old?.due??null):p.local?localTime(p.local,p.zone||'Asia/Tokyo'):null;
 const planDay=text(p.planDay??old?.planDay??'','作業予定日',10,false);
 if(planDay&&(!/^\d{4}-\d{2}-\d{2}$/.test(planDay)||!Number.isFinite(Date.parse(planDay))||new Date(planDay).toISOString().slice(0,10)!==planDay))fail('作業予定日が無効です');
 const completedAt=p.status==='done'?(old?.status==='done'?old.completedAt:Date.now()):null;
 const values=[p.projectId,title,p.status,owner,next,due,JSON.stringify(deps),parentId,['waiting','review'].includes(p.status)?waitReason:'',['waiting','review'].includes(p.status)?waitingFor:'',['waiting','review'].includes(p.status)?checkAt:null,completionCriteria,completionEvidence,canonicalTarget,planDay,completedAt];
 if(old)this.run('UPDATE tasks SET projectId=?,title=?,status=?,owner=?,nextAction=?,due=?,dependencies=?,parentId=?,waitReason=?,waitingFor=?,checkAt=?,completionCriteria=?,completionEvidence=?,canonicalTarget=?,planDay=?,completedAt=?,version=version+1 WHERE id=?',...values,id);
 else this.run('INSERT INTO tasks(projectId,title,status,owner,nextAction,due,dependencies,parentId,waitReason,waitingFor,checkAt,completionCriteria,completionEvidence,canonicalTarget,planDay,completedAt,id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',...values,id);
 const body=p.body??old?.body??'';if(typeof body!=='string'||Buffer.byteLength(body)>200000)fail('作業本文を確認してください');
 this.run('UPDATE tasks SET body=?,inputs=?,output=? WHERE id=?',body,text(p.inputs??old?.inputs??'','入力資料',8000,false),text(p.output??old?.output??'','出力',2000,false),id);
 this.run('DELETE FROM task_runs WHERE taskId=?',id);for(const runId of runIds)this.run('INSERT INTO task_runs VALUES(?,?)',id,runId);
 return id;
 })}
 binding(p){return this.tx(()=>{
 this.requireProject(p.projectId);const id=text(p.id,'セッション',200);if(!this.get('SELECT id FROM runs WHERE id=?',id))fail('セッションがありません',404);
 const previous=this.all('SELECT taskId FROM task_runs WHERE runId=?',id).map(r=>r.taskId);if(p.expectedBinding!==undefined&&p.expectedBinding!==this.bindingVersion(id))fail('関連付けが変更されています。再読込してください',409);const ids=p.taskIds===undefined?previous:p.taskIds;
 if(!Array.isArray(ids)||ids.length>100||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)fail('関連作業が無効です');
 for(const taskId of ids)if(this.get('SELECT projectId FROM tasks WHERE id=?',taskId)?.projectId!==p.projectId)fail('関連作業は同じプロジェクトから選んでください');
 this.run('UPDATE runs SET projectId=? WHERE id=?',p.projectId,id);this.run('DELETE FROM task_runs WHERE runId=?',id);
 for(const taskId of ids)this.run('INSERT INTO task_runs VALUES(?,?)',taskId,id);
 for(const taskId of new Set([...previous,...ids]))this.run('UPDATE tasks SET version=version+1 WHERE id=?',taskId);
 })}
 bindingVersion(id){return JSON.stringify([this.get('SELECT projectId FROM runs WHERE id=?',id)?.projectId,this.all('SELECT taskId FROM task_runs WHERE runId=? ORDER BY taskId',id).map(x=>x.taskId)])}
 deadline(p){this.requireProject(p.projectId);const id=p.id||randomUUID(),title=text(p.title,'締切名',200),zone=text(p.zone||'Asia/Tokyo','地域',80),source=text(p.source,'根拠（URL・資料・本人指定）',2000),excerpt=text(p.excerpt||'','根拠の抜粋',4000,false),stage=text(p.stage||'本稿','提出段階',100);let due=null;const value=text(p.local||'','日時',30,false);if(value){try{new Intl.DateTimeFormat('ja-JP',{timeZone:zone})}catch{fail('日付を登録する場合は有効なタイムゾーンを指定してください')}if(/^\d{4}-\d{2}-\d{2}$/.test(value)){if(new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)fail('日付が無効です')}else due=localTime(value,zone)}
 return this.tx(()=>{const old=p.id?this.get('SELECT * FROM deadlines WHERE id=?',id):null;if(p.id&&(!old||old.version!==p.version))fail('締切が変更されています。再読込してください',409);if(old?.received)fail('受付確認済みの締切は変更できません。新しい提出段階を登録してください');const monitor=p.monitor??old?.monitor??(value?'active':'candidate');if(!['active','candidate','excluded'].includes(monitor))fail('監視状態が不正です');if(monitor==='active'&&!value)fail('監視する日付を確認してください');if(monitor==='excluded')text(p.reason,'対象外の理由',1000);const version=(old?.version||0)+1;
 if(old){text(p.reason,'変更理由',1000);this.run('UPDATE deadlines SET projectId=?,title=?,version=?,due=?,local=?,zone=?,source=?,excerpt=?,stage=? WHERE id=?',p.projectId,title,version,due,value,zone,source,excerpt,stage,id);this.run("UPDATE notifications SET state='superseded' WHERE deadlineId=? AND state NOT IN ('ack','superseded')",id)}else this.run('INSERT INTO deadlines(id,projectId,title,version,due,local,zone,source,excerpt,stage,created) VALUES(?,?,?,?,?,?,?,?,?,?,?)',id,p.projectId,title,version,due,value,zone,source,excerpt,stage,Date.now());this.run('UPDATE deadlines SET monitor=? WHERE id=?',monitor,id);this.run('INSERT INTO deadline_revisions(deadlineId,version,body,created) VALUES(?,?,?,?)',id,version,JSON.stringify({title,due,local:value,zone,source,excerpt,stage,monitor,reason:p.reason||'新規登録'}),Date.now());return id})}
 submission(p){return this.tx(()=>{const id=text(p.requestId,'リクエストID',100);const previous=this.get('SELECT * FROM submissions WHERE id=?',id);if(previous){if(previous.deadlineId!==p.deadlineId||previous.status!==p.status||previous.evidence!==p.evidence)fail('リクエストIDが重複しています',409);return id}const d=this.get('SELECT * FROM deadlines WHERE id=?',p.deadlineId);if(!d)fail('締切がありません',404);if(d.monitor==='excluded')fail('対象外の締切です。監視を再開してから記録してください');if(d.version!==p.expectedDeadlineVersion)fail('締切が変更されています。再読込してください',409);if(!['reported','uncertain','received','retracted'].includes(p.status))fail('提出状態が無効です');if(p.status==='retracted'&&!d.received)fail('取り消す受付確認がありません');const evidence=text(p.evidence,'提出先・受付番号・確認内容',4000);let artifact=null;if(p.artifactId){artifact=this.get('SELECT * FROM deliverables WHERE id=? AND projectId=?',p.artifactId,d.projectId);if(!artifact||!artifact.reviewed)fail('確認済みの成果物を選んでください')}
 this.run('INSERT INTO submissions VALUES(?,?,?,?,?,?,?)',id,d.id,p.status,evidence,artifact?.id||null,artifact?.hash||null,Date.now());this.run('INSERT INTO receipt_meta VALUES(?,?,?)',id,d.version,JSON.stringify({stage:d.stage,source:d.source,due:d.due}));if(p.status==='received'){this.run('UPDATE deadlines SET received=1,receivedAt=? WHERE id=?',Date.now(),d.id);this.run("UPDATE notifications SET state='resolved' WHERE deadlineId=? AND state!='superseded'",d.id)}if(p.status==='retracted'){this.run('UPDATE deadlines SET received=0,receivedAt=NULL WHERE id=?',d.id);this.run("UPDATE notifications SET state='superseded' WHERE deadlineId=? AND version=?",d.id,d.version);this.evaluate()}return id})}
 evaluate(now=Date.now()) {for(const d of this.all('SELECT * FROM deadlines WHERE received=0')){let b=band(d,now);if(!b){this.run("UPDATE notifications SET state='superseded' WHERE deadlineId=? AND state NOT IN ('resolved','superseded')",d.id);continue;}const settings=this.setting('notification',{enabled:false,quietStart:22,quietEnd:8});if(d.due&&d.due>now){const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Tokyo',hour:'numeric',minute:'numeric',hourCycle:'h23'}).formatToParts(now);const hr=Number(parts.find(p=>p.type==='hour').value),min=Number(parts.find(p=>p.type==='minute').value);const hoursUntilEnd=(settings.quietEnd-settings.quietStart+24)%24;const lead=(settings.quietStart-hr+24)%24*60-min;if(lead>=0&&lead<=30&&d.due<now+(lead+hoursUntilEnd*60)*60000)b='before-quiet'}
 this.run("UPDATE notifications SET state='superseded' WHERE deadlineId=? AND version=? AND band!=? AND state IN ('pending','failed','uncertain','snoozed','sent','sending')",d.id,d.version,b);
 this.run("INSERT INTO notifications VALUES(?,?,?,?, 'pending',NULL,?) ON CONFLICT(deadlineId,version,band) DO UPDATE SET state='pending' WHERE state='superseded'",randomUUID(),d.id,d.version,b,now);this.run("UPDATE notifications SET state='pending',snooze=NULL WHERE deadlineId=? AND version=? AND band=? AND state='ack' AND snooze<=?",d.id,d.version,b,now)}
 for(const t of this.all("SELECT t.* FROM tasks t JOIN projects p ON p.id=t.projectId WHERE p.status='active' AND t.status IN ('waiting','review') AND t.checkAt<=?",now))this.run("INSERT INTO task_reminders(taskId,checkAt,state,nextAt) VALUES(?,?,'pending',?) ON CONFLICT(taskId) DO UPDATE SET checkAt=excluded.checkAt,state='pending',nextAt=excluded.nextAt WHERE task_reminders.checkAt!=excluded.checkAt",t.id,t.checkAt,now);
 this.run("DELETE FROM task_reminders WHERE NOT EXISTS(SELECT 1 FROM tasks t JOIN projects p ON p.id=t.projectId WHERE t.id=taskId AND t.checkAt=task_reminders.checkAt AND t.status IN ('waiting','review') AND p.status='active')");this.set('lastEvaluation',now)}
 notifyAction(p){if(p.id?.startsWith('task:')){const taskId=p.id.slice(5),r=this.get('SELECT * FROM task_reminders WHERE taskId=?',taskId);if(!r)fail('現在の再確認通知ではありません');if(!['ack','snooze'].includes(p.action))fail('操作が無効です');const until=p.action==='ack'?Date.now()+86400000:p.until;if(!Number.isFinite(until)||until<=Date.now()||until>Date.now()+86400000)fail('再確認は24時間以内です');this.run("UPDATE task_reminders SET state='snoozed',nextAt=? WHERE taskId=?",until,taskId);return}const n=this.get('SELECT * FROM notifications WHERE id=?',p.id);if(!n||['superseded','resolved'].includes(n.state))fail('現在の通知ではありません');if(p.action==='ack')this.run("UPDATE notifications SET state='ack',snooze=? WHERE id=?",Date.now()+86400000,p.id);else if(p.action==='snooze'){if(!Number.isFinite(p.until)||p.until<=Date.now()||p.until>Date.now()+86400000)fail('再通知は24時間以内を指定してください');this.run('INSERT INTO revision_snooze VALUES(?,?,?) ON CONFLICT(deadlineId,version) DO UPDATE SET untilTime=excluded.untilTime',n.deadlineId,n.version,p.until);this.run("UPDATE notifications SET state='snoozed',snooze=? WHERE id=?",p.until,p.id)}else fail('操作が無効です')}
 snapshot(now=Date.now()){const projects=this.all('SELECT * FROM projects ORDER BY created'),tasks=this.all('SELECT * FROM tasks').map(t=>({...t,dependencies:JSON.parse(t.dependencies)}));return {now,projects:projects.map(p=>({...p,canRun:projectIsActive(p.id,projects)})),taskRuns:this.all('SELECT * FROM task_runs'),tasks:tasks.map(t=>({...t,...actionability(t,tasks,projects)})),deadlines:this.all('SELECT * FROM deadlines').map(d=>({...d,priority:priority(d,now),...deadlineState(d,now)})).sort((a,b)=>a.priority-b.priority||(a.due??Infinity)-(b.due??Infinity)),runs:this.all('SELECT * FROM runs WHERE id IN (SELECT id FROM runs ORDER BY observed DESC LIMIT 300) OR id IN (SELECT runId FROM task_runs) ORDER BY observed DESC').map(r=>({...r,bindingVersion:this.bindingVersion(r.id)})),deliverables:this.all('SELECT * FROM deliverables'),submissions:this.all('SELECT * FROM submissions ORDER BY created DESC'),notifications:this.all("SELECT n.*,d.title FROM notifications n JOIN deadlines d ON d.id=n.deadlineId WHERE n.state NOT IN ('ack','superseded','resolved') ORDER BY CASE WHEN d.due IS NULL THEN 1 ELSE 0 END,d.due,n.created"),taskNotices:this.all("SELECT 'task:'||r.taskId id,t.title,t.projectId,r.state,r.nextAt FROM task_reminders r JOIN tasks t ON t.id=r.taskId JOIN projects p ON p.id=t.projectId WHERE t.checkAt=r.checkAt AND t.status IN ('waiting','review') AND p.status='active' AND (r.state!='snoozed' OR r.nextAt<=?)",now).filter(t=>projectIsActive(t.projectId,projects)),attempts:this.all('SELECT * FROM attempts ORDER BY id DESC LIMIT 20'),sources:this.setting('sources',{}),notification:this.setting('notification',{enabled:false,quietStart:22,quietEnd:8}),lastEvaluation:this.setting('lastEvaluation',null)}}
 async backup(path){await backup(this.db,path);return path}
 close(){this.db.close()}
}
