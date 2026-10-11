import {projectIsActive} from './store.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {quiet} from './store.mjs';
const exec=promisify(execFile);
export async function notify(title,body,id){const bin=fileURLToPath(new URL('./native/Project Dashboard Notifier.app/Contents/MacOS/notifier',import.meta.url));const {stdout}=await exec(bin,[title,body,id],{timeout:30000});const r=JSON.parse(stdout.trim());if(!r.accepted)throw new Error(r.error||'通知できません');return r}
export async function dispatch(store,send=notify,clock=Date.now){
 const time=typeof clock==='function'?clock:()=>clock;
 for(const candidate of store.all("SELECT id FROM notifications WHERE state IN ('pending','failed','snoozed','uncertain','sent')")){
  const now=time(),settings=store.setting('notification',{enabled:false,quietStart:22,quietEnd:8}),projects=store.all('SELECT * FROM projects');if(!settings.enabled||quiet(now,settings))return;
  const n=store.get("SELECT n.*,d.title FROM notifications n JOIN deadlines d ON n.deadlineId=d.id WHERE n.id=? AND d.received=0 AND d.monitor!='excluded' AND n.version=d.version AND n.state IN ('pending','failed','snoozed','uncertain','sent') AND (n.snooze IS NULL OR n.snooze<=?) AND NOT EXISTS(SELECT 1 FROM revision_snooze s WHERE s.deadlineId=n.deadlineId AND s.version=n.version AND s.untilTime>?)",candidate.id,now,now);if(!n)continue;
  const last=store.get('SELECT * FROM attempts WHERE notificationId=? ORDER BY id DESC LIMIT 1',n.id);const interval=n.state==='sent'?(settings.repeatHours??6)*3600000:300000;if(last&&now-last.created<interval)continue;
  if(!store.run("UPDATE notifications SET state='sending' WHERE id=? AND state=?",n.id,n.state).changes)continue;
  try{await send('締切を確認してください',n.title+' — ダッシュボードに未確認の提出があります',n.id);store.run('INSERT INTO attempts(notificationId,result,detail,created) VALUES(?,?,?,?)',n.id,'accepted','macOS受付。表示・既読は未確認',time());store.run("UPDATE notifications SET state='sent' WHERE id=? AND state='sending'",n.id)}catch(e){store.run('INSERT INTO attempts(notificationId,result,detail,created) VALUES(?,?,?,?)',n.id,'failed',e.message,time());store.run("UPDATE notifications SET state='failed' WHERE id=? AND state='sending'",n.id)}
 }
 const now=time(),settings=store.setting('notification',{enabled:false,quietStart:22,quietEnd:8}),projects=store.all('SELECT * FROM projects');
 if(!settings.enabled||quiet(now,settings))return;
 for(const r of store.all("SELECT r.*,t.title,t.projectId FROM task_reminders r JOIN tasks t ON t.id=r.taskId JOIN projects p ON p.id=t.projectId WHERE r.nextAt<=? AND t.checkAt=r.checkAt AND t.status IN ('waiting','review') AND p.status='active'",now)){
  if(!projectIsActive(r.projectId,projects))continue;
  // Claim before delivery: a crash may postpone a retry, never mark the task complete.
  store.run("UPDATE task_reminders SET state='sending',nextAt=? WHERE taskId=?",now+300000,r.taskId);
  try{await send('作業の再確認時刻です',r.title,'task:'+r.taskId);store.run("UPDATE task_reminders SET state='sent',lastSent=?,nextAt=?,detail='OS受付済み' WHERE taskId=?",time(),time()+(settings.repeatHours??6)*3600000,r.taskId)}catch(e){store.run("UPDATE task_reminders SET state='failed',detail=? WHERE taskId=?",e.message,r.taskId)}
 }

}
