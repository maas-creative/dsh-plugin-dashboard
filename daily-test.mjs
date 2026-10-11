import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,appendFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {Store} from './store.mjs';import {Manager} from './manager.mjs';import {DailyPlanner} from './daily.mjs';
await test('専用エージェントは同日のセッションを再利用し、計画だけ反映、完了・競合・不正参照を保護',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'daily-test-')),s=new Store(join(dir,'db'));new Manager(s,dir);
 try{const p=s.project({name:'研究'}),id=s.task({projectId:p,title:'分析',status:'todo'}),done=s.task({projectId:p,title:'既に完了',status:'done',completionCriteria:'確認',completionEvidence:'確認済'});let path,call=0;
 const d=new DailyPlanner(s,dir,async(docs,ledger,dir,signal,system,session,onProgress)=>{onProgress({phase:'generating',label:'エージェントが計画の生成を開始',model:'test-model'});assert.equal(s.setting('dailyPlan',{}).phase,'generating');call++;if(path)assert.equal(path,session);path=session;if(call===1)await appendFile(session,JSON.stringify({type:'message',id:'response',parentId:null,timestamp:new Date().toISOString(),message:{role:'assistant',model:'test-model',content:[{type:'thinking',thinking:'PRIVATE_THOUGHT'},{type:'text',text:JSON.stringify({summary:'保存済みの回答',picks:[]})}]}})+'\n');assert((await readFile(session,'utf8')).includes('session'));assert(!ledger.tasks.some(t=>t.id===done));return {summary:'分析を進める',picks:[{taskId:id,reason:'研究を進めるため',action:'CSVを集計'}]}});
 await d.run({force:true,note:'研究を優先'});assert.equal(call,1);assert.equal(d.snapshot().phase,'idle');assert.equal(d.history().messages.length,2);assert(d.history().messages.find(m=>m.role==='assistant').text.includes('保存済みの回答'));assert(!JSON.stringify(d.history()).includes('PRIVATE_THOUGHT'));assert.equal(s.snapshot().tasks.find(t=>t.id===id).planDay,d.snapshot().day);assert.equal(s.snapshot().tasks.find(t=>t.id===id).status,'todo');assert.equal(s.snapshot().tasks.find(t=>t.id===done).status,'done');await d.run({force:true,note:'午前に行う'});assert.equal(d.snapshot().notes.length,2);
 d.analyze=async()=>({summary:'不正',picks:[{taskId:done,reason:'r',action:'a'}]});await assert.rejects(d.run({force:true}),/参照/);
 d.analyze=async()=>{const t=s.snapshot().tasks.find(t=>t.id===id);s.task({...t,status:'doing'});return {summary:'古い応答',picks:[{taskId:id,reason:'r',action:'a'}]}};await assert.rejects(d.run({force:true}),/変更/);assert.equal(s.snapshot().tasks.find(t=>t.id===id).status,'doing');assert.equal(d.snapshot().running,false);
 }finally{s.close();await rm(dir,{recursive:true,force:true})}
});
await test('本人の完了報告は引用で照合し、当日の候補に含まれても未完了へ戻さない',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'daily-report-')),s=new Store(join(dir,'db'));new Manager(s,dir);
 try{const p=s.project({name:'会計'}),id=s.task({projectId:p,title:'会計作業',status:'todo'});const d=new DailyPlanner(s,dir,async(docs,ledger)=>({summary:'本人の完了報告を記録',picks:[{taskId:id,reason:'r',action:'a'}],reportedTasks:[{taskId:id,quote:'会計は終わった',noteAt:ledger.notes.at(-1).at}]}));await d.run({force:true,note:'会計は終わった'});assert.equal(s.get('SELECT status FROM tasks WHERE id=?',id).status,'reported');assert.equal(s.get('SELECT completedAt FROM tasks WHERE id=?',id).completedAt,null);const t=s.get('SELECT completionEvidence FROM tasks WHERE id=?',id);assert(t.completionEvidence.includes('会計は終わった'));await d.stop();
 }finally{s.close();await rm(dir,{recursive:true,force:true})}
});
await test('継続する親エージェントは上限前に圧縮し、同じRPCとセッションを維持する',async()=>{
 const {EventEmitter}=await import('node:events'),{analyzePi}=await import('./manager.mjs');const dir=await mkdtemp(join(tmpdir(),'daily-compact-')),process=new EventEmitter(),calls=[];
 const rpc={process,stop(){throw Error('成功時に停止してはいけない')},async call(method,params,pi,timeout){calls.push(method);if(method==='get_session_stats')return {contextUsage:{tokens:80000,contextWindow:100000}};if(method==='compact'){assert.equal(timeout,180000);return {estimatedTokensAfter:1000}}if(method==='get_state')return {model:{id:'test',provider:'test'}};if(method==='prompt'){this.onEvent({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'{"summary":"ok","picks":[]}'}]}});this.onEvent({type:'agent_settled'});return {}}}};
 const connection={rpc,path:'session'};try{await analyzePi([],{},dir,undefined,'system','session',()=>{},connection);assert.equal(connection.rpc,rpc);assert.deepEqual(calls,['get_session_stats','compact','get_state','prompt']);}finally{await rm(dir,{recursive:true,force:true})}
});
await test('応答中の追加指示を保存し、次のターンで一度だけ取り込む',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'daily-queue-')),s=new Store(join(dir,'db'));new Manager(s,dir);let release,started;const ready=new Promise(r=>started=r),gate=new Promise(r=>release=r);let calls=0;const d=new DailyPlanner(s,dir,async(docs,ledger)=>{if(++calls===1){started();await gate}else assert.deepEqual(ledger.notes.map(n=>n.text),['最初','追加']);return {summary:'ok',picks:[]}});
 try{const first=d.run({force:true,note:'最初'});await ready;await d.run({note:'追加'});assert.equal(d.snapshot().pendingNotes.length,1);release();await first;await d.run();assert.equal(calls,2);assert.equal(d.snapshot().pendingNotes.length,0);assert.deepEqual(d.snapshot().notes.map(n=>n.text),['最初','追加']);}finally{await d.stop();s.close();await rm(dir,{recursive:true,force:true})}
});
await test('計画エージェントの検索は登録先だけを許し、空検索・未登録先を実行前に拒否する',async()=>{
 const {default:install}=await import('./planner-search.ts');let tool;install({registerTool(t){tool=t}});assert.equal(tool.name,'project_search');const previous=process.env.PI_PLANNER_SEARCH_ROOTS;process.env.PI_PLANNER_SEARCH_ROOTS='[]';
 try{await assert.rejects(tool.execute('x',{projectPath:'/tmp',query:'code'}),/登録済み/);await assert.rejects(tool.execute('x',{projectPath:'/tmp',query:' '}),/不正/);await assert.rejects(tool.execute('x',{projectPath:'.',query:'code'}),/不正/)}finally{if(previous===undefined)delete process.env.PI_PLANNER_SEARCH_ROOTS;else process.env.PI_PLANNER_SEARCH_ROOTS=previous}
});

await test('chat projection removes repeated ledger inputs and preserves human/assistant chronology',async()=>{
 const {SessionManager}=await import('@earendil-works/pi-coding-agent');
 const dir=await mkdtemp(join(tmpdir(),'daily-chat-')),s=new Store(join(dir,'db'));new Manager(s,dir);
 try{
  const session=SessionManager.create(dir,dir),path=session.getSessionFile();await appendFile(path,JSON.stringify(session.getHeader())+'\n');
  s.set('dailyPlan',{day:'2026-09-30',notes:[{at:1,text:'First'},{at:3,text:'Second'}]});s.set('dailySession:2026-09-30',{id:session.getSessionId(),path});s.set('dailyPendingNotes',[{at:7,text:'Queued'}]);
  let parentId=null;
  for(const [id,at,role,content] of [['u1',1,'user',JSON.stringify({ledger:{notes:[{at:1,text:'First'}],tasks:[{title:'PRIVATE_LEDGER'}]}})],['a1',2,'assistant',JSON.stringify({summary:'Reply 1',picks:[]})],['u2',3,'user',JSON.stringify({ledger:{notes:[{at:1,text:'First'},{at:3,text:'Second'}]}})],['a2',4,'assistant',JSON.stringify({summary:'Reply 2',picks:[]})],['u3',5,'user',JSON.stringify({ledger:{notes:[{at:1,text:'First'},{at:3,text:'Second'}]}})],['a3',6,'assistant',JSON.stringify({summary:'Automatic result',picks:[]})]]){
   await appendFile(path,JSON.stringify({type:'message',id,parentId,timestamp:new Date(at).toISOString(),message:{role,content:[{type:'text',text:content}]}})+'\n');parentId=id;
  }
  const d=new DailyPlanner(s,dir),messages=d.history().messages;
  assert.deepEqual(messages.map(m=>[m.role,m.text]),[['user','First'],['assistant','Reply 1'],['user','Second'],['assistant','Reply 2'],['assistant','Automatic result'],['user','Queued']]);
  assert(!JSON.stringify(messages).includes('PRIVATE_LEDGER'));assert.equal(new Set(messages.map(m=>m.id)).size,messages.length);
 }finally{s.close();await rm(dir,{recursive:true,force:true})}
});
await test('作業日は日本時間9時で切り替わる（0時・9時境界・年越し）',async()=>{const {workDay}=await import('./daily.mjs');for(const [time,day] of [['2026-10-01T00:00:00+09:00','2026-09-30'],['2026-10-01T08:59:59.999+09:00','2026-09-30'],['2026-10-01T09:00:00+09:00','2026-10-01'],['2027-01-01T08:59:59+09:00','2026-12-31']])assert.equal(workDay(Date.parse(time)),day)});
await test('0時をまたいでも同じ計画を反映、9時と手動切替で会話を分け履歴を保持',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'daily-boundary-')),s=new Store(join(dir,'db'));new Manager(s,dir);let now=Date.parse('2026-09-30T23:59:50+09:00'),calls=0;t.mock.method(Date,'now',()=>now);const paths=[];
 const d=new DailyPlanner(s,dir,async(docs,ledger,dir,signal,prompt,path)=>{paths.push(path);if(++calls===1)now=Date.parse('2026-10-01T00:00:10+09:00');return {summary:'ok',picks:[]}});
 try{await d.run({force:true,note:'継続'});assert.equal(d.snapshot().day,'2026-09-30');now=Date.parse('2026-10-01T08:59:59+09:00');await d.run({force:true});assert.equal(paths[0],paths[1]);now=Date.parse('2026-10-01T09:00:00+09:00');await d.run({force:true});assert.equal(d.snapshot().day,'2026-10-01');assert.notEqual(paths[1],paths[2]);assert(s.setting('dailySession:2026-09-30').path);const manual=d.advanceDay('2026-10-01');assert.equal(manual,'2026-10-02');assert.throws(()=>d.advanceDay('2026-10-01'),/変更/);await d.run({force:true});const path=paths.at(-1);assert.equal(d.snapshot().day,manual);assert.equal(d.dayStart(),now);const restored=new DailyPlanner(s,dir,async()=>({summary:'restored',picks:[]}));assert.equal(restored.day(),manual);now=Date.parse('2026-10-02T09:00:00+09:00');await d.run({force:true});assert.equal(paths.at(-1),path);now=Date.parse('2026-10-03T09:00:00+09:00');assert.equal(d.day(),'2026-10-03');
 }finally{await d.stop();s.close();await rm(dir,{recursive:true,force:true})}
});
await test('記録済みの同じ完了報告を再送しても失敗・二重更新にならず不正引用は拒否',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'daily-idempotent-')),s=new Store(join(dir,'db'));new Manager(s,dir);const p=s.project({name:'会計'}),id=s.task({projectId:p,title:'会計',status:'todo'});const d=new DailyPlanner(s,dir,async(docs,ledger)=>({summary:'記録',picks:[],reportedTasks:[{taskId:id,quote:'会計は終わった',noteAt:ledger.notes[0].at}]}));
 try{await d.run({force:true,note:'会計は終わった'});const before=s.get('SELECT * FROM tasks WHERE id=?',id);await d.run({force:true});assert.deepEqual(s.get('SELECT * FROM tasks WHERE id=?',id),before);assert.equal(d.snapshot().error,null);d.analyze=async(docs,ledger)=>({summary:'再報告',picks:[],reportedTasks:[{taskId:id,quote:'会計は終わった',noteAt:ledger.notes.at(-1).at}]});await d.run({force:true,note:'会計は終わった'});assert.deepEqual(s.get('SELECT * FROM tasks WHERE id=?',id),before);d.analyze=async(docs,ledger)=>({summary:'不正',picks:[],reportedTasks:[{taskId:id,quote:'別の作業も終わった',noteAt:ledger.notes[0].at}]});await assert.rejects(d.run({force:true}),/根拠/);
 }finally{await d.stop();s.close();await rm(dir,{recursive:true,force:true})}
});
await test('失敗状態では同一入力でも1分後に自動再試行し、処理中の手動切替は拒否',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'daily-retry-')),s=new Store(join(dir,'db'));new Manager(s,dir);let now=Date.parse('2026-10-01T12:00:00+09:00'),calls=0;t.mock.method(Date,'now',()=>now);const d=new DailyPlanner(s,dir,async()=>{calls++;return {summary:'ok',picks:[]}});
 try{await d.run({force:true});s.set('dailyPlan',{...d.snapshot(),error:'一時的な失敗'});now+=30000;await d.run();assert.equal(calls,1);now+=31000;await d.run();assert.equal(calls,2);assert.equal(d.snapshot().error,null);d.running=Promise.resolve();assert.throws(()=>d.advanceDay(d.day()),/処理が終わって/);d.running=null;
 }finally{await d.stop();s.close();await rm(dir,{recursive:true,force:true})}
});

await test('今日の提案件数に上限を設けず、全件を保存し、不正な配列と重複は拒否する',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'daily-unlimited-')),s=new Store(join(dir,'db'));new Manager(s,dir);
 try{const projectId=s.project({name:'件数上限なし'}),ids=Array.from({length:12},(_,i)=>s.task({projectId,title:'作業'+i,status:'todo'}));
 const picks=ids.map(taskId=>({taskId,reason:'今日必要な作業',action:'進める'}));
 const d=new DailyPlanner(s,dir,async(docs,ledger,dir,signal,system)=>{assert(!system.includes('最大5件'));return {summary:'全件を提案',picks}});
 await d.run({force:true});assert.equal(d.snapshot().picks.length,12);assert(ids.every(id=>s.snapshot().tasks.find(t=>t.id===id).planDay===d.snapshot().day));
 d.analyze=async()=>({summary:'不正',picks:{}});await assert.rejects(d.run({force:true}),/配列/);
 d.analyze=async()=>({summary:'重複',picks:[picks[0],picks[0]]});await assert.rejects(d.run({force:true}),/参照/);
 await d.stop();
 }finally{s.close();await rm(dir,{recursive:true,force:true})}
});
test('Scrumの親再開は日付変更後も委譲元の履歴を使い、今日の会話と追加指示を保持',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'scrum-parent-day-')),s=new Store(join(dir,'db'));new Manager(s,dir);const calls=[];
 const d=new DailyPlanner(s,dir,async(docs,ledger,cwd,signal,system,path)=>{calls.push({day:ledger.day,path,notifications:ledger.parentNotifications,notes:ledger.notes});return {summary:'確認しました',picks:[]}});
 try{
  await d.run({force:true});const old=s.setting('dailyPlan',{}),oldSession=s.setting('dailySession:'+old.day,{});d.advanceDay(old.day);await d.run({force:true});const current=s.setting('dailyPlan',{});assert.notEqual(current.sessionId,old.sessionId);
  s.set('dailyPendingNotes',[{text:'今日の新しい指示',at:Date.now()}]);
  await d.receive(old.sessionId,{id:'day-change',wake:true,reports:[{id:'report',assignmentId:'worker',status:'review'}]});
  assert.equal(calls.at(-1).path,oldSession.path);assert.equal(calls.at(-1).day,old.day);assert.equal(calls.at(-1).notifications.length,1);assert.equal(calls.at(-1).notes.some(n=>n.text==='今日の新しい指示'),false);
  assert.equal(s.setting('dailyPlan',{}).sessionId,current.sessionId);assert.equal(s.setting('dailyPendingNotes',[]).length,1);const count=calls.length;
  await d.receive(old.sessionId,{id:'day-change',wake:true,reports:[]});assert.equal(calls.length,count);
 }finally{await d.stop();s.close();await rm(dir,{recursive:true,force:true})}
});
test('DSH request classification survives analyzer event rejection',async()=>{
 const {EventEmitter}=await import('node:events'),{analyzePi}=await import('./manager.mjs'),dir=await mkdtemp(join(tmpdir(),'daily-error-shape-')),process=new EventEmitter();
 const rpc={process,stop(){},async call(method){if(method==='get_session_stats')return {contextUsage:null};if(method==='get_state')return {model:{id:'test',provider:'test'}};if(method==='prompt'){this.onEvent({type:'message_end',message:{role:'assistant',content:[],stopReason:'error',errorMessage:'Malformed request',errorDetails:{statusCode:422,isRetryable:false,privateBody:'must not preserve'}}});this.onEvent({type:'agent_settled'});return {}}}};
 try{await assert.rejects(analyzePi([],{},dir,undefined,'system','session',()=>{},{rpc,path:'session'}),error=>error.statusCode===422&&error.isRetryable===false&&!Object.hasOwn(error,'privateBody'))}finally{await rm(dir,{recursive:true,force:true})}
});
test('configuration reload uses the live parent without closing it and rejects active turns',async()=>{
 const {DashboardPlanner:ScrumPlanner}=await import('./daily.mjs'),dir=await mkdtemp(join(tmpdir(),'daily-reload-')),s=new Store(join(dir,'db')),old=process.env.DASHBOARD_ENGINE,calls=[];try{
 process.env.DASHBOARD_ENGINE='dsh';const planner=new ScrumPlanner(s,dir,async()=>{},null,{fail:(message,status)=>{throw Object.assign(Error(message),{status})}}),session={id:'parent',path:join(dir,'parent.jsonl')};s.set('dailySession:'+planner.day(),session);planner.connection.path=session.path;planner.connection.rpc={call:async(method,args)=>{calls.push({method,args});if(method==='dsh_health')return {commands:['scrum-reload']};if(method==='dsh_command')return {result:{kind:'success',text:JSON.stringify({commands:['updated'],cwd:dir})}};return {}},stop:()=>assert.fail('Live parent must remain connected')};const result=await planner.reloadConfiguration();assert.deepEqual(result.commands,['updated']);assert.equal(s.setting('scrumConfigurationReload').sessionId,'parent');assert.deepEqual(calls.map(c=>c.method),['get_state','dsh_health','dsh_command']);planner.running=Promise.resolve();await assert.rejects(planner.reloadConfiguration(),/応答が終わって/);assert.equal(calls.length,3);
 }finally{if(old===undefined)delete process.env.DASHBOARD_ENGINE;else process.env.DASHBOARD_ENGINE=old;s.close();await rm(dir,{recursive:true,force:true})}
});

await test('host shutdown preserves pending plan without recording a model failure',async()=>{const dir=await mkdtemp(join(tmpdir(),'daily-shutdown-')),s=new Store(join(dir,'db'));new Manager(s,dir);let ready;const started=new Promise(resolve=>ready=resolve);const d=new DailyPlanner(s,dir,async(_docs,_ledger,_dir,signal)=>{ready();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('Interrupted by host shutdown')),{once:true}))});try{s.project({name:'fixture'});const run=d.run({force:true,note:'Preserve this instruction'});run.catch(()=>{});await started;await d.stop();await assert.rejects(run,/shutdown/);const state=d.snapshot();assert.equal(state.phase,'interrupted');assert.equal(state.error,null);assert.equal(state.attempted,0);assert.equal(state.notes[0].text,'Preserve this instruction');const resumed=new DailyPlanner(s,dir,async()=>({summary:'Resumed',picks:[]}));await resumed.run();assert.equal(resumed.snapshot().phase,'idle');await resumed.stop();}finally{s.close();await rm(dir,{recursive:true,force:true})}});
