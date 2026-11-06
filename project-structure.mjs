import {randomUUID,createHash} from 'node:crypto';
function changeKey(change){return createHash('sha256').update(JSON.stringify(change,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])):value)).digest('hex')}
import {fail,text} from './store.mjs';
function retainRequestedStart(s,task,note){const start=s.setting('task-start:'+task.id,null);if(start?.version===task.version&&start.projectId===task.projectId&&start.noteAt===note.at&&note.text.includes(start.quote)){const moved=s.get('SELECT projectId,version FROM tasks WHERE id=?',task.id);s.set('task-start:'+task.id,{...start,...moved})}}
export function projectFamily(id,projects){const ids=new Set([id]);for(let size=-1;size!==ids.size;){size=ids.size;for(const p of projects)if(ids.has(p.parentProjectId))ids.add(p.id)}return ids}
// Keep child projects' execution folders and session bindings when grouping them.
export function applyProjectChanges(s,changes,notes,busyProjects=[],record=true){return s.tx(()=>{
 if(!Array.isArray(changes)||changes.length>10)fail('案件の変更は10件以内です');
 let changed=0;for(const c of changes){const n=notes.find(n=>n.at===c.noteAt),quote=text(c.quote,'構造変更の指示',4000);if(!n?.text.includes(quote))fail('本人の構造変更の指示が原文と一致しません');const applied=s.setting('structure-note:'+c.noteAt,[]);if(record&&(applied===true||Array.isArray(applied)&&applied.some(entry=>entry.key===changeKey(c))))continue;
  if(c.type==='create'){
   if(!c.sourceEvidence?.path||!c.sourceEvidence.hash||!c.sourceEvidence.quote||!c.cwd)fail('新規案件には照合済みの原資料と作業先が必要です');
   const name=text(c.name,'案件名',150),existing=s.get("SELECT * FROM projects WHERE kind='project' AND name=? AND cwd=?",name,c.cwd);
   if(existing){s.set('project-change:'+existing.id+':'+Date.now()+':'+randomUUID(),{project:existing,change:c,at:Date.now(),reused:true});s.set('dailyNeedsPlan',true);continue;}
   const id=s.project({name,cwd:c.cwd,summary:text(c.summary,'案件の目的',240),outcome:text(c.outcome,'最終成果物',4000),basis:c.sourceEvidence.path+'\n'+c.sourceEvidence.quote,parentProjectId:c.parentProjectId||''});
   s.set('project-change:'+id+':'+Date.now()+':'+randomUUID(),{project:s.get('SELECT * FROM projects WHERE id=?',id),change:c,at:Date.now()});changed++;continue;
  }
  const task=c.type==='task-parent'?s.snapshot().tasks.find(t=>t.id===c.taskId):null;
  const projects=s.all('SELECT * FROM projects'),source=projects.find(p=>p.id===(task?.projectId||c.projectId||c.projectIds?.[0])),target=projects.find(p=>p.id===c.targetProjectId);
  if(!source||source.kind==='workspace'&&!['define','repair-location'].includes(c.type))fail('変更する成果プロジェクトがありません');
  const family=projectFamily(source.id,projects);
  if([...family].some(id=>busyProjects.includes(id))||['assignments','dashboard_execution_bindings'].some(table=>s.get("SELECT name FROM sqlite_master WHERE name=?",table)&&s.all(`SELECT t.projectId FROM ${table} a JOIN tasks t ON t.id=a.taskId WHERE a.status NOT IN ('done','cancelled','error','failed')`).some(t=>family.has(t.projectId))))fail('担当Piの作業・成果物確認が残っています。先に処理を終えてください',409);
  s.set('project-change:'+source.id+':'+Date.now()+':'+randomUUID(),{project:source,tasks:s.all('SELECT * FROM tasks WHERE projectId=?',source.id),change:c,at:Date.now()});
  if(c.type==='repair-location'){
   if(source.cwd!==c.previousCwd)fail('復旧元の作業先が更新されています',409);
   if(!c.sourceEvidence?.path||!c.sourceEvidence.hash||!c.sourceEvidence.quote||!c.cwd)fail('作業先の復旧には照合済みの原資料が必要です');
   s.project({...source,cwd:c.cwd});
  }else if(c.type==='define'){
   if(!c.sourceEvidence?.path||!c.sourceEvidence.hash||!c.sourceEvidence.quote)fail('案件定義には照合済みの原資料が必要です');
   s.project({...source,name:text(c.name,'案件名',150),summary:text(c.summary,'案件の目的',240),outcome:text(c.outcome,'最終成果物',4000),basis:c.sourceEvidence.path+'\n'+c.sourceEvidence.quote});
  }else if(c.type==='merge'){
   if(!['project','task'].includes(c.mode)||!Array.isArray(c.projectIds)||!c.projectIds.length||c.projectIds.length>20||new Set(c.projectIds).size!==c.projectIds.length)fail('統合する案件を確認してください');
   const sources=c.projectIds.map(id=>projects.find(p=>p.id===id));if(sources.some(p=>!p||p.kind==='workspace'||p.status==='deleted'))fail('成果プロジェクトを選んでください');
   let destination=target;
   if(!destination){if(c.mode==='task')fail('親タスクの移動先プロジェクトを選んでください');const id=s.project({name:text(c.title,'まとめるプロジェクト名',150),summary:c.summary||'',cwd:sources.every(p=>p.cwd===sources[0].cwd)?sources[0].cwd:'',outcome:sources.map(p=>p.outcome||p.name).join('\n'),completionCriteria:'配下の成果物と完了条件をそれぞれ満たす',basis:quote,category:sources[0].category});destination=s.get('SELECT * FROM projects WHERE id=?',id)}
   if(c.projectIds.includes(destination.id))fail('統合元と移動先は分けてください');
   const parentTaskId=c.mode==='task'?s.task({projectId:destination.id,title:text(c.title,'親タスク名',200),status:'todo',owner:'自分',nextAction:c.summary||'配下の作業を進める',completionCriteria:'配下の作業と元案件の完了条件をそれぞれ満たす'}):'';
   applyProjectChanges(s,sources.map(p=>({...c,projectId:p.id,type:c.mode==='task'?'taskify':'group',targetProjectId:destination.id,parentTaskId})),notes,busyProjects,false);
  }else if(c.type==='group'){
   if(!target||target.kind==='workspace'||family.has(target.id))fail('親プロジェクトが無効です');
   s.project({...source,parentProjectId:target.id});
  }else if(c.type==='ungroup'){
   s.project({...source,parentProjectId:''});
  }else if(c.type==='task-parent'){
   if(!task)fail('変更する作業がありません');
   s.task({...task,parentId:c.parentTaskId||''});
   retainRequestedStart(s,task,n);
  }else if(c.type==='taskify'){
   if(s.setting('project-task:'+source.id,null))fail('この案件は既にタスク化されています');
   if(!target||target.kind==='workspace'||target.id===source.id||family.size!==1||source.cwd!==target.cwd||source.execution!==target.execution)fail('タスク化は子案件なし・同じ作業先と委譲方式の案件間で行ってください');
   if(target.status!=='active')fail('移動先のプロジェクトは進行中にしてください');
   const tasks=s.snapshot().tasks.filter(t=>t.projectId===source.id);
   const parent=s.task({projectId:target.id,parentId:c.parentTaskId||'',title:source.name,status:source.status==='completed'?'done':'todo',owner:'自分',nextAction:source.summary||source.outcome,completionCriteria:source.completionCriteria,completionEvidence:source.status==='completed'?'本人が完了と設定した元案件：'+source.id:'',output:source.output});
   for(const t of tasks){s.run('UPDATE tasks SET projectId=?,parentId=?,version=version+1 WHERE id=?',target.id,t.parentId||parent,t.id);s.run('UPDATE manager_items SET projectId=? WHERE entityId=?',target.id,t.id);retainRequestedStart(s,t,n)}
   for(const table of ['runs','deadlines','deliverables'])s.run(`UPDATE ${table} SET projectId=? WHERE projectId=?`,target.id,source.id);
   s.run("UPDATE projects SET status='archived',parentProjectId='' WHERE id=?",source.id);
   s.set('project-task:'+source.id,{projectId:target.id,taskId:parent});
  }else if(c.type==='status')s.project({...source,status:c.status});
  else if(c.type==='summary')s.project({...source,summary:text(c.summary,'画面の説明文',240)});
  else fail('案件の変更方法が不正です');
  changed++;
 }
 if(record)for(const c of changes){const key=changeKey(c),applied=s.setting('structure-note:'+c.noteAt,[]);if(applied===true)continue;const entries=Array.isArray(applied)?applied:[];if(!entries.some(entry=>entry.key===key))s.set('structure-note:'+c.noteAt,[...entries,{key,change:c}])}return changed;
})}
