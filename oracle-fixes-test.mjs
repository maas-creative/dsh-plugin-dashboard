import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {saveRun} from './connectors.mjs';
import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Store,deadlineState,actionability} from './store.mjs';
import {dispatch} from './notify.mjs';
import {createPiSession,PiController,validateExecution} from './handoff.mjs';
import {Manager,addPlan,sourceDocument} from './manager.mjs';
import {organizeProject} from './organize.mjs';
const dir=await mkdtemp(join(tmpdir(),'oracle-fixes-'));
try{
await test('日付のみの通知、地域検証、対象外、再確認通知',async()=>{
 const s=new Store(join(dir,'dates.sqlite'));try{const p=s.project({name:'研究',cwd:dir});const id=s.deadline({projectId:p,title:'締切',local:'2030-11-06',zone:'Asia/Tokyo',source:'test'});
 const d=s.get('SELECT * FROM deadlines WHERE id=?',id);
 assert.equal(d.due,null);for(const [day,b] of [['2030-09-06',null],['2030-10-30','date-7d'],['2030-11-06','date-today'],['2030-11-07','date-overdue']])assert.equal(deadlineState(d,Date.parse(day+'T12:00:00+09:00')).band,b);
 assert.throws(()=>s.deadline({projectId:p,title:'不正',local:'2030-11-06',zone:'未確認',source:'test'}),/タイムゾーン/);
 assert.equal(deadlineState({...d,zone:'未確認'}).category,'unknown');
 const day=Date.parse('2030-11-06T12:00:00+09:00');s.evaluate(day);assert.equal(s.snapshot(day).notifications[0].band,'date-today');
 s.deadline({...d,reason:'応募しない',monitor:'excluded'});s.evaluate(day+86400000);assert.equal(s.snapshot(day+86400000).notifications.length,0);assert.equal(s.all('SELECT * FROM submissions').length,0);assert.equal(s.get('SELECT received FROM deadlines').received,0);
 const task=s.task({projectId:p,title:'返信確認',status:'waiting',waitReason:'external',checkLocal:'2030-11-06T10:00'});s.set('notification',{enabled:true,quietStart:0,quietEnd:0,repeatHours:6});s.evaluate(day);let sent=[];await dispatch(s,async(...a)=>sent.push(a),day);assert.equal(sent.length,1);assert.equal(sent[0][2],'task:'+task);await dispatch(s,async(...a)=>sent.push(a),day+1000);assert.equal(sent.length,1);assert.equal(s.snapshot(day+1000).taskNotices.length,1);s.run("UPDATE tasks SET status='todo' WHERE id=?",task);assert.equal(s.snapshot(day+1000).taskNotices.length,0);
 }finally{s.close()}
});
await test('担当・保管・依存先期限を共有した次の行動選定',()=>{
 const projects=[{id:'p',status:'active'},{id:'q',status:'archived'}],tasks=[{id:'a',projectId:'p',title:'前提A',status:'todo',owner:'自分',dependencies:[]},{id:'b',projectId:'p',title:'明日期限B',status:'todo',owner:'自分',dependencies:['a'],due:Date.now()+86400000},{id:'c',projectId:'p',title:'他者',status:'todo',owner:'他者',dependencies:[]},{id:'d',projectId:'q',title:'保管',status:'todo',owner:'自分',dependencies:[]}];
 assert(actionability(tasks[0],tasks,projects).priorityReason.includes('明日期限B'));assert.equal(actionability(tasks[0],tasks,projects).actionDue,tasks[1].due);for(const t of tasks.slice(1))assert.equal(actionability(t,tasks,projects).actionable,false);assert.equal(tasks[0].due,undefined);
});
await test('エージェント準備の応答喪失・再起動後の再試行は同じID、実行先・関連競合を拒否',async()=>{
 const s=new Store(join(dir,'pi.sqlite'));try{const a=join(dir,'A'),b=join(dir,'B');await mkdir(a);await mkdir(b);const p=s.project({name:'A',cwd:a}),q=s.project({name:'B',cwd:b}),task=s.task({projectId:p,title:'作業',status:'todo'});const input={projectId:p,title:'作業',taskId:task,taskVersion:1,requestId:'prepare-one'};
 const [r,second]=await Promise.all([createPiSession(s,dir,input),createPiSession(s,dir,input)]);assert.equal(r.id,second.id);assert.equal(s.all('SELECT * FROM runs').length,1);assert.equal(s.all('SELECT * FROM task_runs').length,1);assert.equal((await createPiSession(s,dir,input)).id,r.id);
 await assert.rejects(createPiSession(s,dir,{...input,title:'変更'}),/同じ操作ID/);
 const set=s.set.bind(s),crashInput={projectId:p,title:'クラッシュ境界',requestId:'prepare-crash'};
 s.set=(k,v)=>{set(k,v);if(k==='pi-prepare:prepare-crash'&&v.status==='preparing')throw Error('simulate crash before file write')};
 await assert.rejects(createPiSession(s,dir,crashInput),/simulate crash/);s.set=set;
 const recovered=await createPiSession(s,dir,crashInput);const reopened=new Store(join(dir,'pi.sqlite'));try{assert.equal((await createPiSession(reopened,dir,crashInput)).id,recovered.id)}finally{reopened.close()}
 assert.equal(s.all('SELECT * FROM runs').length,2);
 const expected=s.bindingVersion(r.id);s.binding({id:r.id,projectId:q,taskIds:[],expectedBinding:expected});assert.throws(()=>s.binding({id:r.id,projectId:p,taskIds:[task],expectedBinding:expected}),/変更/);await assert.rejects(validateExecution(s,r.id),/フォルダが異なり/);
 s.binding({id:r.id,projectId:p,taskIds:[task]});await assert.rejects(validateExecution(s,r.id,r.context),/変更/);
 }finally{s.close()}
});
await test('エージェント送信の受理後応答喪失・不明復旧・本文競合と質問IDの競合',async()=>{
 const s=new Store(join(dir,'send.sqlite'));try{const p=s.project({name:'送信試験',cwd:dir}),r=await createPiSession(s,dir,{projectId:p,title:'送信',requestId:'send-prepare'});let calls=0,answers=[];
 const e={state:{model:{id:'fake',provider:'fake'}},status:'idle',messages:[],rpc:{call:async(method)=>{if(method==='get_state')return {isStreaming:false};calls++;return {}},send:v=>answers.push(v)}};
 const pi=new PiController(s);pi.start=async()=>{pi.sessions.set(r.id,e);return e};
 await pi.prompt(r.id,'無害な検証','send-one');await pi.prompt(r.id,'無害な検証','send-one');assert.equal(calls,1);pi.event(r.id,e,{type:'agent_settled'});await pi.prompt(r.id,'無害な検証','send-one');assert.equal(calls,1);await assert.rejects(pi.prompt(r.id,'変更','send-one'),/変更/);
 await pi.prompt(r.id,'プロセス終了','send-exit');pi.event(r.id,e,{type:'process_exit'});assert.equal(s.setting('pi-send:send-exit').status,'uncertain');await assert.rejects(pi.prompt(r.id,'再送しない','send-blocked'),/不明/);e.status='idle';await pi.resolve(r.id,'send-exit','履歴を照合し実行終了を確認');
 e.rpc.call=async(method)=>{if(method==='get_state')return {isStreaming:false};calls++;throw Error('応答喪失')};const uncertain=await pi.prompt(r.id,'二回目','send-two');assert.equal(uncertain.status,'uncertain');
 const restart=new PiController(s);restart.start=pi.start;await restart.prompt(r.id,'二回目','send-two');assert.equal(calls,3);await assert.rejects(restart.prompt(r.id,'再送しない','send-three'),/不明/);
 pi.event(r.id,e,{type:'extension_ui_request',id:'q1',method:'confirm'});pi.event(r.id,e,{type:'extension_ui_request',id:'q2',method:'confirm'});assert.throws(()=>pi.answer(r.id,{questionId:'q1',value:true}),/失効/);assert.equal(answers.length,1);assert.deepEqual(answers[0],{type:'extension_ui_response',id:'q1',cancelled:true});pi.answer(r.id,{questionId:'q2',value:false});assert.equal(answers[1].id,'q2');assert.equal(answers[1].confirmed,false);
 e.status='idle';pi.event(r.id,e,{type:'extension_ui_request',id:'notice',method:'notify',message:'情報'});assert.equal(e.status,'idle');assert.equal(e.question,null);
 pi.event(r.id,e,{type:'extension_ui_request',id:'editor',method:'editor',prefill:'draft'});pi.answer(r.id,{questionId:'editor',cancelled:true});assert.equal(answers.at(-1).cancelled,true);
 e.status='idle';e.rpc.call=async()=>{pi.event(r.id,e,{type:'agent_settled'});throw Error('late RPC response loss')};s.set('pi-send:send-two',{...s.setting('pi-send:send-two'),status:'reviewed'});const late=await pi.prompt(r.id,'完了後の応答喪失','send-late');assert.equal(late.status,'completed');assert.equal(e.status,'idle');
 s.set('pi-send:crash',{id:r.id,requestId:'crash',status:'submitting'});new PiController(s);assert.equal(s.setting('pi-send:crash').status,'uncertain');
 }finally{s.close()}
});
await test('計画書だけの案件、提出記録変更、期限超過の翌日再評価',async()=>{
 const s=new Store(join(dir,'organize.sqlite'));let realNow=Date.now;try{new Manager(s,dir);const p=s.project({name:'計画のみ',cwd:dir}),path=join(dir,'plan.md');await writeFile(path,'研究の原稿を確認する作業を続ける。');await addPlan(s,{projectId:p,path});let calls=0;const analyze=async docs=>{calls++;return {items:[{sourceId:docs[0].id,messageId:docs[0].messages[0].id,kind:'task',title:'原稿確認',goal:'原稿確認',quote:'研究の原稿を確認する作業を続ける。',nextAction:'確認する',open:true,explicit:true}]}};
 await organizeProject(s,p,dir,null,analyze);assert.equal(calls,1);assert.equal(s.get('SELECT status FROM tasks').status,'review');await organizeProject(s,p,dir,null,analyze);assert.equal(calls,1);
 const d=s.deadline({projectId:p,title:'提出',local:'2030-11-06',zone:'Asia/Tokyo',source:'test'});await organizeProject(s,p,dir,null,analyze);const before=calls;s.submission({deadlineId:d,expectedDeadlineVersion:1,requestId:'reported',status:'reported',evidence:'送信操作のみ'});await organizeProject(s,p,dir,null,analyze);assert.equal(calls,before+1);
 const check=s.get('SELECT checkAt FROM tasks').checkAt;Date.now=()=>check+86400000;await organizeProject(s,p,dir,null,analyze);const first=calls;Date.now=()=>check+2*86400000;await organizeProject(s,p,dir,null,analyze);assert.equal(calls,first+1);assert.equal(s.get('SELECT checkAt FROM tasks').checkAt,check);
 assert.equal(s.all("SELECT p.id FROM projects p JOIN manager_sources r ON r.projectId=p.id WHERE p.status='active' GROUP BY p.id").length,1);
 }finally{Date.now=realNow;s.close()}
});

await test('エージェント準備の部分書込み・公開後停止を同じ予約IDから復旧',async()=>{
 const s=new Store(join(dir,'partial.sqlite'));try{const p=s.project({name:'途中書込み',cwd:dir}),set=s.set.bind(s);
 for(const stage of ['empty','partial','temporary','published']){
  const task=s.task({projectId:p,title:stage,status:'todo'}),input={projectId:p,title:stage,taskId:task,taskVersion:1,requestId:'partial-'+stage};let reserved;
  s.set=(k,v)=>{set(k,v);if(k==='pi-prepare:'+input.requestId&&v.status==='preparing'){reserved=v;writeFileSync(v.result.path+(stage==='temporary'?'.preparing':''),stage==='published'?v.contents:stage==='empty'?'':v.contents.slice(0,17));throw Error('interrupted write')}};
  await assert.rejects(createPiSession(s,dir,input),/interrupted write/);s.set=set;
  const result=await createPiSession(s,dir,input);assert.equal(result.id,reserved.result.id);assert.equal(await readFile(result.path,'utf8'),reserved.contents);assert.equal(s.setting('pi-prepare:'+input.requestId).status,'ready');assert.equal(s.all('SELECT * FROM runs WHERE id=?',result.id).length,1);assert.equal(s.all('SELECT * FROM task_runs WHERE runId=?',result.id).length,1);assert.equal((await createPiSession(s,dir,input)).id,result.id);
 }
 }finally{s.close()}
});
await test('手動解除したセッションを再整理が復活させず、自動関連の版は連動',async()=>{
 const s=new Store(join(dir,'links.sqlite'));try{new Manager(s,dir);const p=s.project({name:'関連',cwd:dir}),path=join(dir,'links.jsonl');await writeFile(path,JSON.stringify({type:'response_item',timestamp:new Date().toISOString(),payload:{type:'message',role:'user',content:[{type:'input_text',text:'原稿を照合してください。'}]}})+'\n');
 for(const id of ['link-run-1','link-run-2'])saveRun(s,{id,source:'Pi',threadId:id,title:'関連',cwd:dir,path,projectId:p,status:'history',observed:Date.now(),checked:Date.now(),detail:''});s.run("INSERT INTO manager_sources(id,projectId,runId,path,title,kind) VALUES(?,?,?,?,?,'session')",'links-source',p,'link-run-1',path,'関連');
 let taskId='';const analyze=async docs=>({items:[{existingTaskId:taskId,sourceId:docs[0].id,messageId:docs[0].messages[0].id,kind:'task',title:'原稿照合',goal:'原稿照合',quote:'原稿を照合してください。',nextAction:'原稿と証拠を照合',open:true,explicit:false}]});
 await organizeProject(s,p,dir,null,analyze);taskId=s.get('SELECT id FROM tasks').id;const first=s.get('SELECT * FROM tasks WHERE id=?',taskId);
 s.run("UPDATE manager_sources SET runId='link-run-2' WHERE id='links-source'");await organizeProject(s,p,dir,null,analyze);const automatic=s.get('SELECT * FROM tasks WHERE id=?',taskId);assert.equal(automatic.version,first.version+1);assert.equal(s.all('SELECT * FROM task_runs WHERE taskId=?',taskId).length,2);
 s.task({id:taskId,version:automatic.version,projectId:p,title:automatic.title,status:automatic.status,runIds:[]});const manual=s.get('SELECT version FROM tasks WHERE id=?',taskId).version;await organizeProject(s,p,dir,null,analyze);assert.equal(s.all('SELECT * FROM task_runs WHERE taskId=?',taskId).length,0);assert.equal(s.get('SELECT version FROM tasks WHERE id=?',taskId).version,manual);
 }finally{s.close()}
});
await test('5分後の確認日時を越えた最初の周期で再評価し、同じ周期では繰り返さない',async()=>{
 const s=new Store(join(dir,'boundary.sqlite')),realNow=Date.now;try{let now=Math.floor(realNow()/60000)*60000;Date.now=()=>now;new Manager(s,dir);const p=s.project({name:'境界',cwd:dir}),path=join(dir,'boundary.md');await writeFile(path,'現在の研究の進捗を確認する。');await addPlan(s,{projectId:p,path});let calls=0;const analyze=async()=>{calls++;return {items:[]}};
 const check=now+300000,id=s.task({projectId:p,title:'5分後',status:'review',waitReason:'unknown',checkLocal:new Date(check).toISOString().slice(0,16),zone:'UTC'});await organizeProject(s,p,dir,null,analyze);assert.equal(calls,1);now=check-1;await organizeProject(s,p,dir,null,analyze);assert.equal(calls,1);now=check+1;await organizeProject(s,p,dir,null,analyze);assert.equal(calls,2);now+=120000;await organizeProject(s,p,dir,null,analyze);assert.equal(calls,2);now=check+86400001;await organizeProject(s,p,dir,null,analyze);assert.equal(calls,3);assert.equal(s.get('SELECT checkAt FROM tasks WHERE id=?',id).checkAt,check);
 }finally{Date.now=realNow;s.close()}
});

await test('完了報告を再確認作業へ変換せず、手編集と提出受付を保持する',async()=>{
 const s=new Store(join(dir,'reported.sqlite'));try{new Manager(s,dir);const p=s.project({name:'完了報告',cwd:dir}),path=join(dir,'reported.md');await writeFile(path,'資料集を作成してください。資料集は完成しました。');await addPlan(s,{projectId:p,path});
 const raw=docs=>({sourceId:docs[0].id,messageId:docs[0].messages[0].id,kind:'task',title:'資料集の成果物確認',goal:'資料集作成',quote:'資料集を作成してください。',nextAction:'資料集を確認',open:true,explicit:false});
 await organizeProject(s,p,dir,null,async docs=>({items:[raw(docs)]}));const task=s.get("SELECT * FROM tasks WHERE parentId IS NOT NULL");s.evaluate(task.checkAt+1);assert.equal(s.all('SELECT * FROM task_reminders').length,1);
 const report=async docs=>({items:[{...raw(docs),existingTaskId:task.id,open:false,resolution:'reported',quote:'資料集は完成しました。'}]});s.set('organized:'+p,{});await organizeProject(s,p,dir,null,report);
 const reported=s.get('SELECT * FROM tasks WHERE id=?',task.id);assert.equal(reported.status,'reported');assert.equal(reported.checkAt,null);assert.equal(reported.nextAction,'');assert(reported.completionEvidence.includes('資料集は完成しました。'));assert.equal(s.get('SELECT status FROM tasks WHERE id=?',task.parentId).status,'reported');assert.equal(s.all('SELECT * FROM task_reminders').length,0);assert.equal(s.all('SELECT * FROM submissions').length,0);assert(!s.snapshot().tasks.some(t=>t.actionable));
 s.set('organized:'+p,{});await organizeProject(s,p,dir,null,async docs=>({items:[{...raw(docs),existingTaskId:task.id}]}));assert.equal(s.get('SELECT status FROM tasks WHERE id=?',task.id).status,'reported');
 s.task({id:task.id,version:reported.version,projectId:p,title:task.title,status:'review',waitReason:'unknown',checkLocal:'2030-01-01T00:00',zone:'UTC',nextAction:'本人が改めて確認を依頼'});const manual=s.get('SELECT * FROM tasks WHERE id=?',task.id);await organizeProject(s,p,dir,null,report);assert.equal(s.get('SELECT version FROM tasks WHERE id=?',task.id).version,manual.version);assert.equal(s.get('SELECT status FROM tasks WHERE id=?',task.id).status,'review');
 s.set('organized:'+p,{});const count=s.all('SELECT * FROM tasks').length;await organizeProject(s,p,dir,null,async docs=>({items:[{...raw(docs),resolution:'reported',open:false}]}));assert.equal(s.all('SELECT * FROM tasks').length,count);
 assert.throws(()=>s.task({projectId:p,title:'根拠なし',status:'reported'}),/引用・根拠/);
 }finally{s.close()}
});

await test('古い作業の根拠も最新分岐内で再読し、別分岐の完了報告は取り込まない',async()=>{
 const path=join(dir,'anchor.jsonl'),rows=[{type:'session',id:'session'},...[
  ['request',null,'user','資料集を作成してください。'],['completion','request','assistant','資料集は完成しました。'],['long','completion','assistant','別件の長い記録'.repeat(3000)]
 ].map(([id,parentId,role,text])=>({type:'message',id,parentId,timestamp:new Date().toISOString(),message:{role,content:[{type:'text',text}]}}))];await writeFile(path,rows.map(JSON.stringify).join('\n')+'\n');const input={id:'anchor',projectId:'p',title:'anchor',kind:'session',path};const tail=await sourceDocument(input);assert(!tail.messages.some(m=>m.id==='completion:0'));const anchored=await sourceDocument({...input,messageIds:['completion:0']});assert(anchored.messages.some(m=>m.id==='completion:0'));
 rows.push({type:'message',id:'fork',parentId:'request',timestamp:new Date().toISOString(),message:{role:'user',content:[{type:'text',text:'別の分岐で続ける'}]}});await writeFile(path,rows.map(JSON.stringify).join('\n')+'\n');const fork=await sourceDocument({...input,messageIds:['completion:0']});assert(!fork.messages.some(m=>m.id==='completion:0'));
});
}finally{await rm(dir,{recursive:true,force:true})}
