import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Store} from './store.mjs';
import {dispatch} from './notify.mjs';
import {saveRun} from './connectors.mjs';
const dir=mkdtempSync(join(tmpdir(),'dashboard-workflow-'));
try{
await test('旧DBの移行、親子・前提の循環、完了条件、逆向きの未完了化を防ぐ',()=>{
 const path=join(dir,'old.sqlite'),old=new DatabaseSync(path);
 old.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,cwd TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',created INTEGER NOT NULL);
 CREATE TABLE tasks(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES projects(id),title TEXT NOT NULL,status TEXT NOT NULL,owner TEXT NOT NULL,nextAction TEXT NOT NULL,due INTEGER,dependencies TEXT NOT NULL DEFAULT '[]',version INTEGER NOT NULL DEFAULT 1);
 INSERT INTO projects(id,name,created) VALUES('old','既存の研究',1); INSERT INTO tasks(id,projectId,title,status,owner,nextAction) VALUES('old-task','old','以前の作業','todo','本人','確認'); INSERT INTO tasks(id,projectId,title,status,owner,nextAction,dependencies) VALUES('legacy-done','old','legacy completed','done','owner','','["old-task"]');`);old.close();
 const s=new Store(path);const task=(title,more={})=>s.task({projectId:'old',title,status:'todo',...more});
 const update=(id,more)=>{const t=s.snapshot().tasks.find(t=>t.id===id);return s.task({...t,...more})};
 try{
 assert.equal(s.get('SELECT title FROM tasks WHERE id=?','old-task').title,'以前の作業');
 const parent=task('論文'),child=task('分析',{parentId:parent}),submission=task('提出',{dependencies:[parent]});
 assert.throws(()=>update(parent,{parentId:child}),/循環/);
 assert.throws(()=>update(child,{dependencies:[parent]}),/循環/);
 assert.throws(()=>update(parent,{status:'done',completionCriteria:'原稿一致',completionEvidence:'照合済'}),/子作業が未完了/);
 assert.throws(()=>update(child,{status:'done'}),/完了条件/);
 update(child,{status:'done',completionCriteria:'集計一致',completionEvidence:'試験データの再集計済'});
 update(parent,{status:'done',completionCriteria:'原稿一致',completionEvidence:'版A確認済'});
 assert.throws(()=>update(child,{status:'doing'}),/親作業/);
 update(submission,{status:'done',completionCriteria:'受付',completionEvidence:'試験受付番号'});
 assert.throws(()=>update(parent,{status:'doing'}),/後続作業/);
 const other=s.project({name:'別の会社'});assert.throws(()=>task('別案件',{projectId:other,parentId:parent}),/同じプロジェクト/);
 assert.throws(()=>task('待ち',{status:'waiting'}),/待ち理由/);
 const wait=task('編集部回答',{status:'waiting',waitReason:'external',waitingFor:'編集部',checkLocal:'2030-04-01T10:00',nextAction:'回答を確認'});
 assert.equal(s.get('SELECT waitingFor FROM tasks WHERE id=?',wait).waitingFor,'編集部');
 update(wait,{status:'doing'});assert.equal(s.get('SELECT checkAt FROM tasks WHERE id=?',wait).checkAt,null);
 }finally{s.close()}
 const again=new Store(path);assert.equal(again.snapshot().tasks.length,6);assert.equal(again.get('PRAGMA user_version').user_version,2);again.close();
});
await test('今日の予定と完了日時は保存され、過去完了を今日に変えず、競合と不正日付を拒否する',()=>{
 const s=new Store(join(dir,'today.sqlite')),projectId=s.project({name:'今日の試験'});
 try{
 const id=s.task({projectId,title:'集計',status:'todo',planDay:'2026-09-30'}),get=()=>s.snapshot().tasks.find(t=>t.id===id);
 assert.equal(get().planDay,'2026-09-30');assert.equal(get().completedAt,null);
 assert.throws(()=>s.task({...get(),planDay:'2026-02-30'}),/予定日/);
 assert.throws(()=>s.task({...get(),status:'done'}),/完了条件/);
 const stale=get();s.task({...get(),status:'done',completionCriteria:'集計完了',completionEvidence:'CSVを照合'});
 const at=get().completedAt;assert(at>0);assert.equal(get().planDay,'2026-09-30');
 s.task({...get(),title:'集計の記録',completedAt:1});assert.equal(get().completedAt,at);
 assert.throws(()=>s.task({...stale,status:'doing'}),/再読込/);
 s.task({...get(),status:'doing'});assert.equal(get().completedAt,null);
 s.task({...get(),status:'done'});assert(get().completedAt>=at);
 s.run('UPDATE tasks SET completedAt=NULL WHERE id=?',id);s.task({...get(),title:'以前の完了'});assert.equal(get().completedAt,null);
 }finally{s.close()}
});
await test('複数セッションと複数タスク、保存競合、プロジェクト移動、再起動・バックアップ',async()=>{
 const path=join(dir,'relations.sqlite');let s=new Store(path);const projectId=s.project({name:'研究'}),other=s.project({name:'会社'});
 const a=s.task({projectId,title:'分析',status:'todo'}),b=s.task({projectId,title:'原稿',status:'todo'});
 for(const id of ['a','b'])saveRun(s,{id,source:'Codex',title:'試験'+id,cwd:'',path:'',status:'history',observed:1,checked:1,detail:'履歴のみ',threadId:id});
 const stale=s.snapshot().tasks.find(t=>t.id===a);
 s.binding({id:'a',projectId,taskIds:[a,b]});s.binding({id:'b',projectId,taskIds:[a]});
 assert.equal(s.snapshot().taskRuns.length,3);
 assert.throws(()=>s.task({...stale,title:'古い編集'}),/再読込/);
 assert.throws(()=>s.binding({id:'a',projectId:other,taskIds:[a]}),/同じプロジェクト/);
 assert.equal(s.get('SELECT projectId FROM runs WHERE id=?','a').projectId,projectId);
 saveRun(s,{...s.get('SELECT * FROM runs WHERE id=?','a'),observed:2,checked:2});assert.equal(s.snapshot().taskRuns.length,3);
 const backup=join(dir,'relations-backup.sqlite');await s.backup(backup);s.close();s=new Store(backup);try{assert.equal(s.snapshot().taskRuns.length,3);s.binding({id:'a',projectId:other,taskIds:[]});assert.equal(s.snapshot().taskRuns.length,1);assert.equal(s.snapshot().tasks.length,2);}finally{s.close()}
});
await test('未確認通知の繰り返し・既読後の再確認・静音・延期・受付解除',async()=>{
 const path=join(dir,'notify.sqlite');let s=new Store(path);let calls=0;const send=async()=>{calls++};
 const projectId=s.project({name:'提出試験'}),id=s.deadline({projectId,title:'本稿',local:'2020-01-01T12:00',zone:'Asia/Tokyo',source:'架空の期限'}),now=Date.now();
 s.set('notification',{enabled:true,quietStart:0,quietEnd:0,repeatHours:6});s.evaluate(now);
 await dispatch(s,send,now);await dispatch(s,send,now+5*3600000);assert.equal(calls,1);
 s.close();s=new Store(path);try{
 s.evaluate(now+6*3600000);await dispatch(s,send,now+6*3600000);assert.equal(calls,2);
 const n=s.get('SELECT * FROM notifications WHERE deadlineId=?',id);s.notifyAction({id:n.id,action:'ack'});
 const ack=s.get('SELECT snooze FROM notifications WHERE id=?',n.id).snooze;s.evaluate(ack-1);await dispatch(s,send,ack-1);assert.equal(calls,2);
 s.evaluate(ack);await dispatch(s,send,ack);assert.equal(calls,3);
 s.notifyAction({id:n.id,action:'snooze',until:Date.now()+3600000});await dispatch(s,send,now+30000);assert.equal(calls,3);
 const hr=Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Tokyo',hour:'numeric',hourCycle:'h23'}).format(ack+7*3600000));s.set('notification',{enabled:true,quietStart:hr,quietEnd:(hr+1)%24,repeatHours:6});s.evaluate(ack+7*3600000);await dispatch(s,send,ack+7*3600000);assert.equal(calls,3);
 s.set('notification',{enabled:true,quietStart:0,quietEnd:0,repeatHours:6});s.submission({requestId:'receipt',deadlineId:id,expectedDeadlineVersion:1,status:'received',evidence:'試験受付番号'});s.evaluate(ack+48*3600000);await dispatch(s,send,ack+48*3600000);assert.equal(calls,3);
 }finally{s.close()}
});
}finally{rmSync(dir,{recursive:true,force:true})}
