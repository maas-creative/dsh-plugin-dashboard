import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {organizeProject} from './organize.mjs';
import {Store} from './store.mjs';
import {saveRun} from './connectors.mjs';
import {Manager,applyItem,dismissItem,validateItem,addPlan,sourceDocument} from './manager.mjs';
const dir=await mkdtemp(join(tmpdir(),'manager-test-'));
try{
await test('根拠付きの階層登録・重複防止・人の編集保持・候補締切・棄却・通知への接続',async()=>{
 const s=new Store(join(dir,'ledger.sqlite'));const projectId=s.project({name:'研究',cwd:dir});const path=join(dir,'session.jsonl');const quote='研究論文の分析を続けるために元データを集計してください。';const deadline='2030年10月1日の17時が本稿の正式な締切だと記憶しています。';
 const entries=[{type:'session',id:'s',cwd:dir,timestamp:new Date().toISOString()},...[[deadline,'m2'],[quote,'m1']].map(([text,id])=>({type:'message',id,parentId:id==='m1'?'m2':null,timestamp:new Date().toISOString(),message:{role:'user',content:[{type:'text',text}]}}))];await writeFile(path,entries.map(JSON.stringify).join('\n')+'\n');saveRun(s,{id:'pi:s',source:'Pi',threadId:'s',title:'研究計画',cwd:dir,projectId,path,status:'history',observed:Date.now(),checked:Date.now(),detail:''});
 let calls=0;const analyze=async docs=>{calls++;return {items:[{sourceId:docs[0].id,messageId:'m1:0',kind:'task',title:'元データ集計',goal:'研究論文',nextAction:'元データを集計する',quote,explicit:true,open:true},{sourceId:docs[0].id,messageId:'m2:0',kind:'deadline',title:'本稿',goal:'研究論文',quote:deadline,explicit:true,open:true,local:'2030-10-01T17:00',zone:'Asia/Tokyo'}]}};
 const manager=new Manager(s,dir,analyze);try{
 await manager.run();assert.equal(s.setting('managerStatus').error,null);assert.equal(s.all('SELECT * FROM tasks').length,0);await organizeProject(s,projectId,dir,null,async docs=>({items:(await analyze(docs)).items.filter(i=>i.kind==='task')}));assert.equal(s.all('SELECT * FROM tasks').length,2);const task=s.get('SELECT * FROM tasks WHERE title=?','元データ集計');assert(task.parentId);assert.equal(s.all('SELECT * FROM task_runs').length,1);assert.equal(s.all('SELECT * FROM deadlines').length,0);
 s.task({...task,dependencies:[],nextAction:'本人が修正した行動'});await manager.run();assert.equal(calls,2);assert.equal(s.get('SELECT nextAction FROM tasks WHERE id=?',task.id).nextAction,'本人が修正した行動');
 const candidate=s.get("SELECT * FROM manager_items WHERE kind='deadline'");applyItem(s,candidate.id);assert.equal(s.all('SELECT * FROM deadlines').length,1);applyItem(s,candidate.id);assert.equal(s.all('SELECT * FROM deadlines').length,1);s.evaluate(Date.parse('2030-10-01T09:00:00Z'));assert(s.all('SELECT * FROM notifications').length);
 const plan=join(dir,'plan.md');await writeFile(plan,'変更前の計画書に記載した確認が必要な作業です。');await addPlan(s,{projectId,path:plan});assert.rejects(addPlan(s,{projectId,path:'/etc/hosts'}));
 const oldDoc={id:'old',projectId,title:'履歴',limited:true,messages:[{id:'m',role:'assistant',at:0,text:quote}]};assert.throws(()=>validateItem({kind:'task',sourceId:'old',messageId:'m',quote:'原文にない架空の依頼を自動で登録してしまうテスト',title:'偽'},[oldDoc]),/一致/);
 const extracted=validateItem({kind:'task',sourceId:'old',messageId:'m',quote,title:'古い提案'},[oldDoc]);assert.equal(extracted.explicit,false);
 s.run("INSERT INTO manager_items VALUES('dismiss',?,'old','h','task','古い提案',?,'pending',NULL,?)",projectId,JSON.stringify(extracted),Date.now());dismissItem(s,'dismiss');assert.equal(s.get("SELECT state FROM manager_items WHERE id='dismiss'").state,'dismissed');assert.throws(()=>applyItem(s,'dismiss'),/現在/);
 }finally{await manager.stop();s.close()}
});
await test('不正引用では一件も反映せず、失敗・中断を記録する',async()=>{
 const s=new Store(join(dir,'failure.sqlite')),projectId=s.project({name:'会社',cwd:dir});const path=join(dir,'failure.md');await writeFile(path,'これは確認用の計画書です。翌月の作業について検討する。');let manager=new Manager(s,dir,async docs=>({items:[{sourceId:docs[0].id,messageId:'document',kind:'task',title:'捏造',quote:'この引用は原文に存在しないため登録を拒否する必要がある'}]}));await addPlan(s,{projectId,path});await manager.run();assert.match(s.setting('managerStatus').error,/一致/);assert.equal(s.all('SELECT * FROM tasks').length,0);assert.equal(s.all('SELECT * FROM manager_items').length,0);await manager.stop();s.run("UPDATE manager_sources SET state='running'");manager=new Manager(s,dir);assert.equal(s.get('SELECT state FROM manager_sources').state,'pending');await manager.stop();s.close();
});
await test('分割履歴の続き・破損行・棄却後の改題・部分変更の競合',async()=>{
 const s=new Store(join(dir,'chunks.sqlite')),projectId=s.project({name:'履歴',cwd:dir}),path=join(dir,'chunks.jsonl');const rows=Array.from({length:12},(_,n)=>({type:'response_item',timestamp:new Date().toISOString(),payload:{id:'m'+n,type:'message',role:'user',content:[{type:'input_text',text:'過去の依頼について確認が必要な試験用の履歴です。'.repeat(90)+n}]}}));await writeFile(path,rows.map(JSON.stringify).join('\n')+'\n{broken\n');saveRun(s,{id:'codex:chunks',source:'Codex',threadId:'chunks',projectId,cwd:dir,path,title:'過去の履歴',status:'history',observed:1,checked:1,detail:''});let calls=0;
 const m=new Manager(s,dir,async docs=>{calls++;const d=docs[0],msg=d.messages.at(-1);return {items:[{sourceId:d.id,messageId:msg.id,kind:'task',title:'候補'+calls,goal:'試験',quote:msg.text.slice(0,40),explicit:true,open:true}]}});
 try{await m.run();assert.equal(s.get('SELECT state FROM manager_sources').state,'partial');const first=s.get('SELECT * FROM manager_items');dismissItem(s,first.id);const cursor=s.get('SELECT cursor FROM manager_sources').cursor;await m.run();assert(s.get('SELECT cursor FROM manager_sources').cursor>cursor);assert.equal(s.all('SELECT * FROM tasks').length,0);for(let n=0;n<10&&s.get('SELECT state FROM manager_sources').state==='partial';n++)await m.run();assert.equal(s.get('SELECT state FROM manager_sources').state,'incomplete');assert.equal(s.get('SELECT damaged FROM manager_sources').damaged,1);
 s.run("UPDATE manager_sources SET cursor=0,analyzedHash=''");await m.run();assert.equal(s.get('SELECT state FROM manager_items WHERE id=?',first.id).state,'dismissed');
 const source=s.get('SELECT * FROM manager_sources'),document=await sourceDocument(source);assert.equal(document.damaged,1);
 }finally{await m.stop();s.close()}
});
await test('JSONLのLF・CRLF・改行なし最終行を保持する',async()=>{for(const ending of ['','\n','\r\n']){const path=join(dir,'ending-'+ending.length);await writeFile(path,JSON.stringify({type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'正常な最終行'}]}})+ending);const doc=await sourceDocument({id:'test',projectId:'p',kind:'session',path,title:'test'});assert.equal(doc.messages.length,1);assert.equal(doc.damaged,0)}});
}finally{await rm(dir,{recursive:true,force:true})}
