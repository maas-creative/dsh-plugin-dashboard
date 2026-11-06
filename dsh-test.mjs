import test from 'node:test';
import assert from 'node:assert/strict';
import {sessionEvents,lastCallUsage,conversationEvents} from './dsh-history.mjs';
test('圧縮済みの履歴でも本人と応答だけを保存イベントから復元する',()=>{
 const user={role:'user',source:{kind:'user'},content:[{type:'text',text:'指示'}]},internal={role:'user',source:{kind:'runtime-context'},content:[{type:'text',text:'内部'}]},answer={role:'assistant',content:[{type:'text',text:'回答'}]};
 const events=[{type:'user/message',data:user},{type:'user/message',data:internal},{type:'assistant/message',data:{message:answer}},{type:'compaction/summary',data:{}}];
 assert.deepEqual(conversationEvents(events,m=>m?.source?.kind==='user'),[user,answer]);
});
test('使用量がない場合やキャッシュ内訳がない場合はゼロを捏造しない',()=>{assert.equal(lastCallUsage([]),null);assert.deepEqual(lastCallUsage([{type:'assistant/message',data:{}}]),{available:false});assert.deepEqual(lastCallUsage([{type:'assistant/message',data:{usage:{inputTokens:100,outputTokens:12,totalTokens:112}}}]),{available:true,inputTokens:100,outputTokens:12,cacheReadTokens:null,cacheWriteTokens:null,totalTokens:112});});
test('使用量の照会は実行中の担当だけに転送する',async()=>{const {PiController}=await import('./handoff.mjs');const pi=new PiController({all:()=>[]});let called=0;pi.sessions.set('fixture',{rpc:{call:async method=>{called++;assert.equal(method,'get_session_stats');return {lastCall:{available:false}}}}});assert.deepEqual(await pi.stats('fixture'),{lastCall:{available:false}});await assert.rejects(pi.stats('missing'),/取得できません/);assert.equal(called,1)});
test('ローカルGLMの登録は認証してモデル一覧を検証し、キーを結果に含めない',async()=>{
 const {verifyLocalGlm}=await import('./dsh.mjs'),connection={model:'glm53-fast',api_key:'fixture-secret'};let called=false;
 const result=await verifyLocalGlm(connection,async(url,options)=>{called=true;assert.equal(url,'http://127.0.0.1:8000/v1/models');assert.equal(options.headers.Authorization,'Bearer fixture-secret');return {ok:true,json:async()=>({data:[{id:'glm53-fast'}]})}});
 assert(called);assert.deepEqual(result,{model:'glm53-fast'});assert(!JSON.stringify(result).includes('fixture-secret'));
 await assert.rejects(verifyLocalGlm(connection,async()=>({ok:true,json:async()=>({data:[]})})),/見つかりません/);
 await assert.rejects(verifyLocalGlm(connection,async()=>({ok:false})),/接続できません/);
});
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
test('直近の失敗試行と圧縮で報告された使用量を表示する',()=>{
 const usage=n=>({inputTokens:n,outputTokens:2,cacheReadTokens:1,cacheWriteTokens:0,totalTokens:n+3});
 const events=[{type:'assistant/message',data:{usage:usage(10)}},{type:'assistant/attempt',data:{stream:[{type:'chunk',time:1,chunk:{type:'usage',usage:usage(20)}}]}}];
 assert.equal(lastCallUsage(events).inputTokens,20);events[1].data.stream=[];assert.deepEqual(lastCallUsage(events),{available:false});
 events.push({type:'compaction/summary',data:{llmStreamCall:true,usage:usage(30)}});assert.equal(lastCallUsage(events).inputTokens,30);
});
test('実行中に履歴が増えても取得開始時の記録を返す',async()=>{
 const session={id:'session',seq:1},events=[{seq:0}],reads=[];let closed=false;
 const ctx={sessions:{async flush(){session.seq=2}},sessionPersistence:{async open(){return {async read(offset,count){reads.push({offset,count});return {events:events.slice(offset,offset+count)}},async close(){closed=true}}}}};
 assert.deepEqual(await sessionEvents(ctx,session),events);assert.deepEqual(reads,[{offset:0,count:1}]);assert.equal(closed,true);
});
