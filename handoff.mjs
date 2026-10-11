import {workerModel} from './model-settings.mjs';
import {dshRpc} from './dsh.mjs';
import {PI_ARGS,observe} from './runtime.mjs';
import {prepareWorkspace,validateWorkspace} from './workspaces.mjs';
import {readFile,writeFile,mkdir,stat,realpath,unlink,open,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {SessionManager} from '@earendil-works/pi-coding-agent';
import {Rpc,saveRun,managedSessions} from './connectors.mjs';
import {fail,text,projectIsActive} from './store.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export function conversation(rows){const result=[],seen=new Set();for(const r of rows){if(r.type!=='response_item'||r.payload?.type!=='message')continue;const p=r.payload;if(!['user','assistant'].includes(p.role)||p.phase==='analysis')continue;const value=(p.content||[]).filter(c=>['input_text','output_text','text'].includes(c.type)).map(c=>c.text).join('\n');if(!value)continue;const key=p.id;if(key&&seen.has(key))continue;if(key)seen.add(key);result.push({role:p.role,text:value,timestamp:Date.parse(r.timestamp)||0})}return result}
export async function preview(store,id){const r=store.get("SELECT * FROM runs WHERE id=? AND source='Codex'",id);if(!r)fail('Codexセッションがありません',404);const size=(await stat(r.path)).size;if(size>150*1024*1024)fail('履歴が150MBを超えています。個別移行が必要です');const raw=await readFile(r.path,'utf8');const rows=raw.split('\n').filter(Boolean).flatMap(l=>{try{return [JSON.parse(l)]}catch{return []}});const messages=conversation(rows);return {fingerprint:createHash('sha256').update(JSON.stringify(messages)).digest('hex'),run:r,messages,title:r.title,description:`ユーザーとアシスタントの会話 ${messages.length}件を引き継ぎ用の形式に保存します。内部推論・認証設定ファイル・実行中プロセスは移しません。会話本文に貼った秘密情報は含まれる可能性があります。内容を確認してください。`,summary:`作業フォルダ：${r.cwd}\n共通スキル：~/.agents/skills と ~/.codex/skills\n成果物：同じ作業フォルダを参照\nCodex専用のMCP／承認フック：エージェント側で別途対応が必要`}}
const migrations=new Map();
export async function migrate(store,id,dataDir,expected){const key=dataDir+':'+id;while(migrations.has(key))await migrations.get(key);const operation=migrateSnapshot(store,id,dataDir,expected);migrations.set(key,operation);try{return await operation}finally{migrations.delete(key)}}
async function migrateSnapshot(store,id,dataDir,expected){const p=await preview(store,id);const fingerprint=p.fingerprint;if(expected!==fingerprint)fail('会話が更新されました。引き継ぐ内容を再確認してください',409);const prior=Object.values(store.setting('handoffs',{})).find(h=>h.sourceId===id&&h.fingerprint===fingerprint);if(prior)return prior;if(!p.messages.some(m=>m.role==='assistant'))fail('アシスタント応答があるセッションを選んでください');const sessionDir=join(dataDir,'pi-sessions'),archiveDir=join(dataDir,'handoffs');await mkdir(sessionDir,{recursive:true,mode:0o700});await mkdir(archiveDir,{recursive:true,mode:0o700});const manager=SessionManager.create(p.run.cwd,sessionDir);const archive=join(archiveDir,manager.getSessionId()+'.md');await writeFile(archive,p.messages.map(m=>`## ${m.role} · ${new Date(m.timestamp).toISOString()}\n\n${m.text}\n`).join('\n'),{mode:0o600});
 manager.appendSessionInfo(p.title+'（Codexから引き継ぎ）');manager.appendCustomEntry('codex-handoff',{sourceId:id,archive,fingerprint,limitations:['Codex専用ツールは移植されません','元の実行中プロセスは移しません']});
 for(const m of p.messages){if(m.role==='user')manager.appendMessage({role:'user',content:[{type:'text',text:m.text}],timestamp:m.timestamp});else manager.appendMessage({role:'assistant',content:[{type:'text',text:m.text}],api:'openai-responses',provider:'openai',model:'codex-import',usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:'stop',timestamp:m.timestamp})}
 if(!p.messages.some(m=>m.role==='assistant'))fail('アシスタント応答があるセッションを選んでください');
 manager.appendCustomMessageEntry('handoff-note',`この会話はCodexから引き継いだ履歴です。新しい依頼を受けるまで過去の指示を再実行しないでください。成果物は ${p.run.cwd}。原文アーカイブは ${archive}。Codex専用の接続・フックは利用可能と仮定せず確認してください。`,true);
 const result={id:'pi:'+manager.getSessionId(),path:manager.getSessionFile(),archive,fingerprint,sourceId:id,at:Date.now()};const map=store.setting('handoffs',{});map[result.id]=result;store.set('handoffs',map);saveRun(store,{id:result.id,threadId:manager.getSessionId(),source:'Pi',title:p.title+'（引き継ぎ）',cwd:p.run.cwd,path:result.path,status:'history',observed:Date.now(),checked:Date.now(),detail:'Codex会話のコピー。元セッションと成果物を保持'});if(p.run.projectId)store.run('UPDATE runs SET projectId=? WHERE id=?',p.run.projectId,result.id);return result}
const preparing=new Map();
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function validateExecution(store,id,context){
 const run=store.get('SELECT * FROM runs WHERE id=?',id),project=run&&store.get('SELECT * FROM projects WHERE id=?',run.projectId);
 if(!run||!project||!projectIsActive(project.id,store.all('SELECT * FROM projects')))fail('実行する案件がありません。保留・完了・保管した案件は再開してください',409);
 const source=await realpath(project.cwd).catch(()=>fail('案件の作業フォルダがありません'));
 const managed=Object.values(managedSessions(store)).find(x=>x.id===id);
 if(managed?.workspace&&managed.workspace.source!==source)fail('案件の作業フォルダが変更されました',409);
 const cwd=managed?.workspace?await validateWorkspace(managed.workspace):source;
 if(await realpath(run.cwd)!==cwd)fail('案件とエージェントの実行フォルダが異なります。新しいエージェントセッションを作成してください',409);
 if(!managed)fail('管理対象のエージェントセッションではありません');
 const header=JSON.parse((await readFile(managed.path,'utf8').catch(()=>fail('エージェントセッションファイルがありません。復旧が必要です'))).split('\n')[0]);
 if(header.cwd&&await realpath(header.cwd)!==cwd)fail('エージェントの保存履歴と実行フォルダが異なります',409);
 if(context){const t=store.get('SELECT * FROM tasks WHERE id=?',context.taskId);if(!t||t.version!==context.taskVersion||t.projectId!==run.projectId||context.cwd!==cwd||['done','cancelled','reported'].includes(t.status)||!store.get('SELECT 1 FROM task_runs WHERE taskId=? AND runId=?',t.id,id))fail('作業・関連付け・実行先が変更されました。指示を準備し直してください',409)}
 // Re-read after filesystem awaits; a project edit must not retarget an existing process.
 const current=store.get('SELECT * FROM projects WHERE id=?',project.id),r=store.get('SELECT * FROM runs WHERE id=?',id);
 if(current.cwd!==project.cwd||!projectIsActive(current.id,store.all('SELECT * FROM projects'))||r.projectId!==run.projectId||r.cwd!==run.cwd)fail('実行先が変更されました',409);
 return cwd;
}
export async function createPiSession(store,dataDir,input){
 const requestId=text(input.requestId||randomUUID(),'操作ID',200),key='pi-prepare:'+requestId,lock=dataDir+key;
 while(preparing.has(lock))await preparing.get(lock);
 const work=(async()=>{
 const body={projectId:input.projectId,title:input.title,taskId:input.taskId||'',taskVersion:input.taskVersion??null,runId:input.runId||''},fingerprint=hash(body);
 let op=store.setting(key,null);if(op&&op.fingerprint!==fingerprint)fail('同じ操作IDで内容を変更できません',409);if(op?.status==='ready')return op.result;
 const title=text(input.title,'セッション名',200),project=store.get('SELECT * FROM projects WHERE id=?',input.projectId);if(!project||!projectIsActive(project.id,store.all('SELECT * FROM projects')))fail('実行する案件を確認してください');
 const task=input.taskId?store.get('SELECT * FROM tasks WHERE id=?',input.taskId):null;
 if(input.taskId&&(!task||task.projectId!==project.id||task.version!==input.taskVersion||['done','cancelled','reported'].includes(task.status)))fail('作業が変更されました。再読込してください',409);
 const source=await realpath(project.cwd).catch(()=>fail('プロジェクトの作業フォルダを設定してください'));const existingSession=input.runId?Object.values(managedSessions(store)).find(x=>x.id===input.runId):null;const workspace=input.runId?existingSession?.workspace:task?await prepareWorkspace(store,dataDir,project,task.id):null;const cwd=workspace?await validateWorkspace(workspace):source;if(!(await stat(cwd)).isDirectory())fail('作業フォルダを指定してください');
 if(input.runId){await validateExecution(store,input.runId);if(!task||!store.get('SELECT 1 FROM task_runs WHERE taskId=? AND runId=?',task.id,input.runId))fail('この作業に関連するエージェントを選んでください');}
 if(!op){const manager=input.runId?null:SessionManager.create(cwd,join(dataDir,'pi-sessions'));manager?.appendSessionInfo(title);op={fingerprint,status:'preparing',cwd,projectCwd:project.cwd,result:input.runId?{id:input.runId,workspace:existingSession?.workspace||null}:{id:'pi:'+manager.getSessionId(),path:manager.getSessionFile(),at:Date.now(),workspace},contents:manager?[manager.getHeader(),...manager.getEntries()].map(x=>JSON.stringify(x)+'\n').join(''):null};store.set(key,op)}
 if(op.cwd!==cwd||op.projectCwd!==project.cwd)fail('準備中に作業フォルダが変更されました',409);
 if(op.contents){const path=op.result.path,existing=await readFile(path,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e});
 if(existing!==op.contents&&!store.get('SELECT id FROM runs WHERE id=?',op.result.id)){
  if(existing!==null&&!op.contents.startsWith(existing))fail('準備ファイルが変わっています。復旧が必要です',409);
  const owner=await stat(path+'.owner').catch(e=>{if(e.code==='ENOENT')return null;throw e});if(owner)fail('準備ファイルは別のプロセスが使用しています',409);
  // Publish only a complete file. A retry rebuilds our reserved temporary file from the durable operation.
  const temp=path+'.preparing',file=await open(temp,'w',0o600);try{await file.writeFile(op.contents);await file.sync()}finally{await file.close()}
  await rename(temp,path);
 }
 }
 return store.tx(()=>{const current=store.get('SELECT * FROM projects WHERE id=?',project.id);if(current.cwd!==project.cwd||!projectIsActive(current.id,store.all('SELECT * FROM projects')))fail('案件が変更されています',409);if(task&&store.get('SELECT version FROM tasks WHERE id=?',task.id)?.version!==input.taskVersion)fail('作業が変更されています',409);
 if(!input.runId){const r=op.result;store.set('piSessions',{...store.setting('piSessions',{}),[r.id]:r});saveRun(store,{...r,projectId:project.id,threadId:r.id.slice(3),source:'Pi',title,cwd,status:'history',observed:r.at,checked:r.at,detail:'エージェントの新規セッション。まだ指示を送信していません'});if(task)store.binding({id:r.id,projectId:project.id,taskIds:[task.id]})}
 const result={...op.result,cwd,...(task?{context:{taskId:task.id,taskVersion:store.get('SELECT version FROM tasks WHERE id=?',task.id).version,cwd}}:{})};store.set(key,{fingerprint,status:'ready',result});return result;
 });
 })();preparing.set(lock,work);try{return await work}finally{preparing.delete(lock)}
}
export class PiController {
 constructor(store){this.store=store;this.sessions=new Map();this.starting=new Map();this.stopped=false;for(const r of store.all("SELECT key,value FROM settings WHERE key LIKE 'pi-send:%'")){const op=JSON.parse(r.value);if(['submitting','accepted'].includes(op.status))store.set(r.key,{...op,status:'uncertain',error:'再起動前の実行結果を照合してください'})}}
 async readMessages(id){const entry=await this.start(id);const response=await entry.rpc.call('get_messages',{},true);return response.messages||[];}
 async start(id){if(this.stopped)fail('停止中です',503);if(this.starting.has(id))return this.starting.get(id);if(this.sessions.get(id)?.rpc)return this.sessions.get(id);const p=this.initialize(id);this.starting.set(id,p);try{return await p}finally{this.starting.delete(id)}}
 async initialize(id){const managed=Object.values(managedSessions(this.store)).find(h=>h.id===id);if(!managed)fail('同時書込を避けるため、ダッシュボードで作成・取り込んだセッションだけ実行できます');const cwd=await validateExecution(this.store,id);const r=this.store.get('SELECT * FROM runs WHERE id=?',id);const canonical=await realpath(managed.path).catch(()=>fail('エージェントセッションファイルがありません。復旧が必要です'));const header=JSON.parse((await readFile(canonical,'utf8')).split('\n')[0]);if(header.type!=='session'||'pi:'+header.id!==id)fail('セッションの識別情報が一致しません');const lock=canonical+'.owner';try{const pid=Number(await readFile(lock,'utf8'));try{process.kill(pid,0);fail('このエージェントセッションは別のプロセスが使用中です',409)}catch(e){if(e.code!=='ESRCH')throw e}await unlink(lock)}catch(e){if(e.code!=='ENOENT')throw e}await writeFile(lock,String(process.pid),{flag:'wx',mode:0o600});const rpc=process.env.DASHBOARD_ENGINE==='dsh'?dshRpc({cwd,sessionPath:managed.path,dashboardScope:r.projectId?[r.projectId]:[],model:workerModel(this.store,id),scrum:this.store.setting('runScrum:'+id,false),role:this.store.setting('runRole:'+id,'executor'),policy:this.store.setting('runPolicy:'+id,null),reportPath:this.store.setting('runReport:'+id,'')}):new Rpc(process.execPath,[join(root,'node_modules/@earendil-works/pi-coding-agent/dist/cli.js'),'--mode','rpc',...PI_ARGS,'--session',managed.path,'--skill',join(homedir(),'.codex/skills')],{cwd});await writeFile(lock,String(rpc.process.pid),{mode:0o600});const entry={rpc,messages:[],status:'starting',error:null};this.sessions.set(id,entry);rpc.process.on('close',()=>{entry.closeCleanup=unlink(lock).catch(()=>{});if(this.stopped||entry.released)return;this.event(id,entry,{type:'process_exit'});if(this.sessions.get(id)===entry)this.sessions.delete(id)});rpc.onEvent=e=>this.event(id,entry,e);try{const state=await rpc.call('get_state',{},true);entry.state=state;if(state.sessionId!==header.id||await realpath(state.sessionFile)!==canonical)fail('エージェントが異なるセッションを開きました');const commands=await rpc.call('get_commands',{},true);entry.skills=(commands.commands||[]).filter(c=>c.source==='skill');const history=await rpc.call('get_messages',{},true);entry.messages=(history.messages||[]).filter(m=>['user','assistant'].includes(m.role)).slice(-50).map(m=>({role:m.role,text:typeof m.content==='string'?m.content:(m.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n')}));entry.status=state.isStreaming?'running':'idle';return entry}catch(e){rpc.stop();this.sessions.delete(id);throw e}}
 event(id,entry,e){
 if(this.stopped)return;
 if(entry.operation&&['agent_start','message_end','tool_execution_start','tool_execution_end'].includes(e.type)){const op=this.store.setting(entry.operation,{});this.store.set(entry.operation,{...op,...(e.type==='agent_start'&&!op.startedAt?{startedAt:Date.now()}:{}),lastEventAt:Date.now()})}
 if(['agent_settled','process_exit'].includes(e.type))queueMicrotask(()=>this.onSettled?.(id));
 if(entry.operation&&['agent_start','agent_settled','process_exit'].includes(e.type)){const op=this.store.setting(entry.operation,null);if(op?.requestId&&this.store.get("SELECT 1 FROM sqlite_master WHERE name='assignments'"))observe(this.store,op.requestId,e.type==='process_exit'?'liveness':'process_turn',e.type==='process_exit'?{status:'exited'}:{process:e.type==='agent_start'?'running':'stopped',turn:e.type==='agent_start'?'working':'finished'})}
 if(e.type==='process_exit'){entry.status='error';entry.error='エージェントプロセスが終了しました。送信結果を照合してください';if(entry.operation){const op=this.store.setting(entry.operation,null);if(op&&['submitting','accepted'].includes(op.status))this.store.set(entry.operation,{...op,status:'uncertain',error:entry.error})}}
 if(e.type==='extension_ui_dismiss'&&entry.question?.id===e.id){entry.question=null;entry.status='running'}
 if(e.type==='extension_ui_request'){
  if(['confirm','select','input','editor'].includes(e.method)){if(entry.question&&entry.question.id!==e.id)entry.rpc.send({type:'extension_ui_response',id:entry.question.id,cancelled:true});entry.status='waiting_input';entry.question={id:e.id,method:e.method,title:e.title,message:e.message,options:e.options,prefill:e.prefill,expires:e.timeout?Date.now()+e.timeout:null}}
  else {entry.notice=e.message||e.text||e.status||'';return}
 }
 if(e.type==='agent_start'){entry.status='running';entry.activity='応答を作成中'}
 if(e.type==='tool_execution_start')entry.activity=({read:'ファイルを読取中',write:'成果物を書込中',edit:'ファイルを編集中',bash:'コマンドを実行中'})[e.toolName]||'ツールを実行中';
 if(e.type==='tool_execution_end'){entry.activity=e.isError?'ツールの失敗を確認中':'実行結果を整理中';if(entry.operation){const op=this.store.setting(entry.operation,{});this.store.set(entry.operation,{...op,toolEvidence:[...(op.toolEvidence||[]),{tool:e.toolName,error:!!e.isError,at:Date.now(),text:(e.result?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n').slice(0,12000)}].slice(-12)})}}
 if(e.type==='agent_settled'){entry.status=entry.error?'error':'idle';entry.question=null;entry.activity='';if(entry.operation){const op=this.store.setting(entry.operation,{});this.store.set(entry.operation,{...op,status:entry.error?'failed':'completed',error:entry.error,result:entry.messages.filter(m=>m.role==='assistant').at(-1)?.text||'',finished:Date.now()});entry.operation=null}}
 if(e.type==='auto_retry_start')entry.status='retrying';
 if(e.type==='message_end'){const m=e.message,value=typeof m?.content==='string'?m.content:(m?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');if(value){entry.messages.push({role:m.role,text:value});entry.messages=entry.messages.slice(-50)}if(m?.errorMessage||['error','aborted'].includes(m?.stopReason)){entry.error=m.errorMessage||'エージェントの応答が中断されました';entry.status='error'}}
 this.store.run('UPDATE runs SET status=?,observed=?,checked=?,detail=? WHERE id=?',entry.status==='idle'?'turn_finished':entry.status==='error'?'error':entry.status==='waiting_input'?'waiting_input':'running_observed',Date.now(),Date.now(),entry.error||'ダッシュボードが所有するPi RPC実行',id);
 }
 async prompt(id,message,requestId,context){
 text(message,'メッセージ',60000);text(requestId,'送信操作ID',200);const key='pi-send:'+requestId,fingerprint=hash([id,message,context||null]);
 const existing=this.store.setting(key,null);if(existing){if(existing.fingerprint!==fingerprint)fail('同じ送信IDで本文・実行先を変更できません',409);return existing}
 await validateExecution(this.store,id,context);const e=await this.start(id);await validateExecution(this.store,id,context);
 const prior=this.store.setting(key,null);if(prior){if(prior.fingerprint!==fingerprint)fail('送信IDが重複しています',409);return prior}
 if(this.store.all("SELECT value FROM settings WHERE key LIKE 'pi-send:%'").some(r=>{const o=JSON.parse(r.value);return o.id===id&&['uncertain','submitting','accepted'].includes(o.status)}))fail('前回の送信結果が不明です。実行記録を照合してください',409);
 if(!e.state.model||e.state.model.provider==='unknown'||e.state.model.id==='unknown')fail('エージェントのモデル認証が未設定です。ローカルエージェントで /login を実行してください');
 if(['starting','submitting','running','retrying','waiting_input','uncertain'].includes(e.status))fail('エージェントは実行中です。完了後に送ってください',409);
 const op={id,requestId,fingerprint,context:context||null,messageHash:hash(message),status:'submitting',created:Date.now(),...(process.env.DASHBOARD_ENGINE==='dsh'&&(context?.taskId||context?.threadId)?{receiptMarker:'Scrum dispatch '+requestId+'\n'}:{})};this.store.set(key,op);e.error=null;e.status='submitting';e.operation=key;
 try{await e.rpc.call('prompt',{message,...(op.receiptMarker?{dispatchId:requestId}:{})},true);const current=this.store.setting(key,op);if(current.status==='submitting')this.store.set(key,{...current,status:'accepted'})}catch(error){const current=this.store.setting(key,op);if(current.status==='completed')return current;const status=error.rpcRejected&&current.status==='submitting'?'rejected':'uncertain';this.store.set(key,{...op,status,error:error.message});e.status=status==='rejected'?'idle':'uncertain';e.error=error.message;if(status==='rejected')e.operation=null}
 return this.store.setting(key,op);
 }
 state(id){const e=this.sessions.get(id),operations=this.store.all("SELECT value FROM settings WHERE key LIKE 'pi-send:%'").map(r=>JSON.parse(r.value)).filter(o=>o.id===id).slice(-20);return e?{status:e.status,activity:e.activity,error:e.error,messages:e.messages.slice(-50),question:e.question,notice:e.notice,model:e.state?.model?.id,engine:e.state?.engine||'Pi',skills:e.skills,operations}:{status:'not_started',messages:[],operations}}
 async sessionExists(id){
 const managed=Object.values(managedSessions(this.store)).find(h=>h.id===id);if(!managed)return null;
 try{const file=await open(managed.path,'r');try{const buffer=Buffer.alloc(65536),{bytesRead}=await file.read(buffer,0,buffer.length,0),line=buffer.subarray(0,bytesRead).toString('utf8'),end=line.indexOf('\n');if(end<0)throw Error('Managed session header missing or too large');const header=JSON.parse(line.slice(0,end));if(header.type!=='session'||'pi:'+header.id!==id)throw Error('Managed session identity changed');return true}finally{await file.close()}}catch(error){if(error.code==='ENOENT')return false;throw error}
 }
 async abortSession(id){const entry=await this.start(id);await entry.rpc.call('abort',{discardInbox:true},true)}
 async reconcileDispatch(requestId){
 const key='pi-send:'+requestId,op=this.store.setting(key,null);if(!op?.receiptMarker||process.env.DASHBOARD_ENGINE!=='dsh')return {unknown:true};
 const live=this.sessions.get(op.id);if(live&&['running','submitting','retrying','waiting_input'].includes(live.status))return {pending:true};
 const entry=await this.start(op.id),state=await entry.rpc.call('get_state',{},true);if(state.isStreaming)return {pending:true};
 const proof=await entry.rpc.call('dsh_dispatch_receipt',{dispatchId:requestId},true);if(!proof.receipt)return {unknown:true};
 const result={...op,...proof.receipt,result:proof.result,reconciledAt:Date.now()};this.store.set(key,result);entry.status=result.status==='completed'?'idle':'error';entry.error=result.error;return result;
 }
 async resolve(id,requestId,evidence){text(evidence,'照合結果',4000);const key='pi-send:'+text(requestId,'送信ID',200),op=this.store.setting(key,null);if(!op||op.id!==id||op.status!=='uncertain')fail('照合対象の送信ではありません',409);const running=await this.start(id),current=await running.rpc.call('get_state',{},true);if(current.isStreaming||running.question)fail('エージェントは実行中です。終了後に結果を照合してください',409);this.store.set(key,{...op,status:'reviewed',evidence,reviewed:Date.now()});const e=this.sessions.get(id);if(e?.status==='uncertain'){e.status='idle';e.error=null}return {ok:true}}
 answer(id,p){const e=this.sessions.get(id),q=e?.question;if(!q||q.id!==p.questionId||q.expires&&q.expires<Date.now())fail('表示していた質問は失効しました。最新の質問を確認してください',409);const method=q.method;
 if(!['confirm','input','select','editor'].includes(method))fail('対応していない質問です');
 if(!p.cancelled){if(method==='confirm'&&typeof p.value!=='boolean')fail('選択が無効です');if(method!=='confirm')text(p.value,'回答',60000,false);if(method==='select'&&!q.options?.includes(p.value))fail('選択肢が変更されています',409)}
 e.rpc.send({type:'extension_ui_response',id:p.questionId,...(p.cancelled?{cancelled:true}:method==='confirm'?{confirmed:p.value}:{value:p.value})});e.question=null;e.status='running';}
 async release(id){const e=this.sessions.get(id);if(!e?.rpc||e.operation||e.question||!['idle','error'].includes(e.status))return;e.released=true;const rpc=e.rpc;await new Promise(resolve=>{if(rpc.process.exitCode!==null)return resolve();const timer=setTimeout(()=>rpc.process.kill('SIGKILL'),3000);rpc.process.once('close',()=>{clearTimeout(timer);resolve()});rpc.stop()});await e.closeCleanup;e.rpc=null;e.status='parked';}
 async stop(){this.stopped=true;await Promise.allSettled([...this.starting.values()]);await Promise.all([...this.sessions.values()].filter(e=>e.rpc).map(e=>new Promise(resolve=>{if(e.rpc.process.exitCode!==null)return resolve();const timer=setTimeout(()=>e.rpc.process.kill('SIGKILL'),3000);e.rpc.process.once('close',()=>{clearTimeout(timer);resolve()});e.rpc.stop()})));this.sessions.clear()}
}
