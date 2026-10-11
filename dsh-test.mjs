import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionEvents} from './dsh-history.mjs';
test('DSHの使用量集計は永続履歴をページ単位で読み、必ず閉じる',async()=>{
 let closed=false,flushed=false;const events=Array.from({length:2050},(_,seq)=>({seq}));
 const ctx={sessions:{async flush(){flushed=true}},sessionPersistence:{async open(id,mode){assert.equal(id,'session');assert.equal(mode,'read');return {async read(offset,count){assert(flushed);assert(count<=1024);return {events:events.slice(offset,offset+count)}},async close(){closed=true}}}}};
 assert.deepEqual(await sessionEvents(ctx,{id:'session',seq:2050}),events);assert(closed);
});
test('DSHの保存履歴欠落を成功扱いせず、読み取りハンドルを閉じる',async()=>{
 let closed=false;const ctx={sessions:{async flush(){}},sessionPersistence:{async open(){return {async read(){return {events:[]}},async close(){closed=true}}}}};
 await assert.rejects(sessionEvents(ctx,{id:'session',seq:1}),/欠け/);assert(closed);
});
test('単体DSHのレビュー役は未登録の委譲ツールを要求せず固定モデルで起動する',async()=>{
 const {mkdtemp,mkdir,writeFile,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {dshRpc}=await import('./dsh.mjs');
 const root=await mkdtemp(join(tmpdir(),'scrum-reviewer-boot-')),home=join(root,'dsh');await mkdir(home);await writeFile(join(home,'.credentials.yaml'),JSON.stringify({version:1,refs:{},records:{'llm-pi-ai/openai-codex':{kind:'grant',payload:{type:'oauth',access:'fixture-only-not-valid',refresh:'fixture-only-not-valid',expires:Date.now()+3600000,accountId:'fixture-only'}}}}),{mode:0o600});const previous=process.env.DASHBOARD_DSH_HOME;process.env.DASHBOARD_DSH_HOME=home;let rpc;
 try{rpc=dshRpc({cwd:root,role:'reviewer'});const state=await rpc.call('get_state',{},true,60000);assert.equal(state.model.id,'gpt-6.1-sol');assert.equal(state.model.reasoningEffort,'low');}finally{rpc?.stop();if(previous===undefined)delete process.env.DASHBOARD_DSH_HOME;else process.env.DASHBOARD_DSH_HOME=previous;await new Promise(r=>setTimeout(r,500));await rm(root,{recursive:true,force:true})}
});
