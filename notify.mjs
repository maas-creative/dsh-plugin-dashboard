import {projectIsActive,quiet} from './store.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
export async function notify(title,body,id){const bin=fileURLToPath(new URL('./native/Project Dashboard Notifier.app/Contents/MacOS/notifier',import.meta.url));const {stdout}=await exec(bin,[title,body,id],{timeout:30000});const r=JSON.parse(stdout.trim());if(!r.accepted)throw new Error(r.error||'通知できません');return r}
export async function dispatch(store,send=notify,clock=Date.now){
 const time=typeof clock==='function'?clock:()=>clock,now=time(),settings=store.setting('notification',{enabled:false,quietStart:22,quietEnd:8});
 if(!settings.enabled||quiet(now,settings))return;
 const projects=store.all('SELECT * FROM projects'),deadlines=[],tasks=[];
 for(const candidate of store.all("SELECT id FROM notifications WHERE state IN ('pending','failed','snoozed','uncertain','sent')")){
  const n=store.get("SELECT n.*,d.title,d.projectId,(SELECT status FROM submissions WHERE deadlineId=d.id ORDER BY created DESC,rowid DESC LIMIT 1) submissionStatus FROM notifications n JOIN deadlines d ON n.deadlineId=d.id WHERE n.id=? AND d.received=0 AND d.monitor='active' AND n.version=d.version AND n.state IN ('pending','failed','snoozed','uncertain','sent') AND (n.snooze IS NULL OR n.snooze<=?) AND NOT EXISTS(SELECT 1 FROM revision_snooze s WHERE s.deadlineId=n.deadlineId AND s.version=n.version AND s.untilTime>?)",candidate.id,now,now);if(!n||!projectIsActive(n.projectId,projects))continue;
  const last=store.get('SELECT * FROM attempts WHERE notificationId=? ORDER BY id DESC LIMIT 1',n.id),interval=n.state==='sent'?(settings.repeatHours??6)*3600000:300000;if(last&&now-last.created<interval)continue;
  if(store.run("UPDATE notifications SET state='sending' WHERE id=? AND state=?",n.id,n.state).changes)deadlines.push(n);
 }
 for(const r of store.all("SELECT r.*,t.title,t.projectId FROM task_reminders r JOIN tasks t ON t.id=r.taskId JOIN projects p ON p.id=t.projectId WHERE r.nextAt<=? AND t.checkAt=r.checkAt AND t.trashAt IS NULL AND t.status IN ('waiting','review') AND p.status='active'",now)){
  if(!projectIsActive(r.projectId,projects))continue;
  if(store.run("UPDATE task_reminders SET state='sending',nextAt=? WHERE taskId=? AND nextAt<=?",now+300000,r.taskId,now).changes)tasks.push(r);
 }
 const all=[...deadlines,...tasks];if(!all.length)return;
 const single=all.length===1, title=single?(deadlines.length?'締切を確認してください':'作業の再確認時刻です'):'確認が必要な項目があります';
 const body=single?(deadlines.length?all[0].title+(all[0].submissionStatus==='reported'?' — 提出報告済み・受付は未確認':' — ダッシュボードに未確認の提出があります'):all[0].title):[deadlines.length?`締切 ${deadlines.length}件`:null,tasks.length?`作業 ${tasks.length}件`:null].filter(Boolean).join('・')+'。ダッシュボードで確認できます。';
 const id=deadlines[0]?.id||(tasks[0]?'task:'+tasks[0].taskId:'');let error=null;
 try{await send(title,body,id)}catch(e){error=e}
 const at=time();
 for(const n of deadlines){store.run('INSERT INTO attempts(notificationId,result,detail,created) VALUES(?,?,?,?)',n.id,error?'failed':'accepted',error?String(error.message):'macOS受付。表示・既読は未確認',at);store.run("UPDATE notifications SET state=? WHERE id=? AND state='sending'",error?'failed':'sent',n.id)}
 for(const r of tasks){if(error)store.run("UPDATE task_reminders SET state='failed',detail=? WHERE taskId=? AND state='sending'",String(error.message),r.taskId);else store.run("UPDATE task_reminders SET state='sent',lastSent=?,nextAt=?,detail='OS受付済み' WHERE taskId=? AND state='sending'",at,at+(settings.repeatHours??6)*3600000,r.taskId)}
}
