import {registerQuestionBridge} from './question-bridge.mjs';
import {requestErrorDetails} from './request-error.mjs';
import {promptSource,lowModel} from './prompt-origin.mjs';
import {assembleContextFor} from '@deepseek-ai/dsh-agent';
// Project Dashboard's stdio adapter over public DSH services. Pi logs remain intact.
import {createInterface} from 'node:readline';
import {readFileSync,appendFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createUserMessage} from '@deepseek-ai/dsh-llm';
import {defineTool} from '@deepseek-ai/dsh-tools';
import {Check} from 'typebox/value';
import plannerSearch from './planner-search.ts';
import webTools from './vendor/pi-web-access.mjs';
export function visibleUserMessage(message){
 if(message?.source?.kind==='user')return true;
 const source=message?.source,id=source?.senderSessionId;
 return source?.kind==='agent-message'&&source.form==='relay'&&typeof id==='string'&&id.startsWith('btw-')&&(message.content||[]).some(block=>block.type==='text'&&block.text?.startsWith('[Scrum adopted side '+id+' message '));
}
export const name='dashboard-bridge';
export const inject=['sdkAppStartup','agents','sessionPersistence','tools','skills','commands','loader','sessions','llm','systemPrompt','goals','sessionProjections'];
const flatten=m=>typeof m?.content==='string'?m.content:(m?.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
export function apply(ctx){
 const path=process.env.DSH_LEGACY_SESSION||'',sid=process.env.DSH_SESSION_ID||randomUUID(),cwd=process.env.DSH_WORK_CWD||process.cwd(),planner=process.env.DSH_PLANNER==='1';
 let handle,creating,disposed=false;const calls=new Map();
 const output=v=>{if(!disposed)process.stdout.write(JSON.stringify(v)+'\n')};
 const questions=registerQuestionBridge(ctx,{sessionId:sid,emit:output});
 const legacy=()=>{if(!path)return [];return readFileSync(path,'utf8').split('\n').flatMap(l=>{try{const r=JSON.parse(l);return r.type==='message'&&['user','assistant'].includes(r.message?.role)?[r.message]:[]}catch{return []}})};
 const schema=v=>{const r={};for(const k of ['type','description','enum'])if(v[k]!==undefined)r[k]=v[k];if(v.items)r.items=schema(v.items);if(v.anyOf)r.oneOf=v.anyOf.map(schema);return r};
 const registerTool=t=>ctx.tools.register(defineTool({name:t.name,description:t.description,parameters:Object.fromEntries(Object.entries(t.parameters.properties).map(([k,v])=>[k,{...schema(v),...(t.parameters.required?.includes(k)?{required:true}:{})}])),output:{schema:{type:'string'},render:(_,value)=>[{type:'text',text:value}]},execute:async(args,exec)=>{if(!Check(t.parameters,args))throw Error('ツールの入力形式が不正です');return flatten(await t.execute(randomUUID(),args,exec.signal))}}));
 plannerSearch({registerTool});webTools({registerTool});
 const policy=process.env.DSH_ROLE_POLICY?JSON.parse(process.env.DSH_ROLE_POLICY):{};
 async function openAgent(){
  if(handle)return handle.agent;if(creating)return creating;
  creating=(async()=>{
   const selected=JSON.parse(process.env.DSH_MODEL||'{}');const agentOptions=lowModel(selected);
   const setup=async scoped=>{if(policy.allow)scoped.tools.restrict({allow:[...policy.allow,'dashboard_read']});else if(policy.deny)scoped.tools.restrict({deny:policy.deny});};
   const existing=await ctx.sessionPersistence.stat(sid);
   handle=existing?await ctx.agents.resume({resumeSessionId:sid,agentOptions,setup}):await ctx.agents.create({sessionId:sid,meta:{cwd},agentOptions,setup});
   if(handle.agent.session.header.cwd!==cwd)throw Error('DSHの保存履歴と実行フォルダが異なります');
   const prior=legacy();if(!existing&&prior.length){handle.agent.inject(createUserMessage({content:[{type:'text',text:'以下は移行前の会話です。過去の依頼を再実行せず、次の新しい依頼と最新台帳を優先してください。元の履歴は保持しています。\n'+prior.slice(-30).map(m=>m.role+': '+flatten(m)).join('\n\n').slice(-60000)}],source:{kind:'agent-message',form:'relay',senderSessionId:sid}}));}
   return handle.agent;
  })();try{return await creating}finally{creating=null}
 }
 const requestFailures=new Map();
 ctx.on('llm/stream',async function*(options,next){try{yield* next()}catch(error){if(options.sessionId)requestFailures.set(options.sessionId,requestErrorDetails(error));throw error}},{prepend:true});
 ctx.on('session/event',(session,event)=>{
  if(session.id!==sid)return;
  const d=event.data;
  if(['user/message','assistant/message'].includes(event.type)){
   const m=event.type==='user/message'?d:d.message;
   if(event.type==='user/message'&&!visibleUserMessage(m))return;
   const message={role:event.type==='user/message'?'user':'assistant',content:m?.content||[],...(event.type==='user/message'&&m?.source?.kind==='agent-message'?{adoptedSide:true}:{})};
   if(path&&flatten(message))appendFileSync(path+'.dsh-history.jsonl',JSON.stringify({type:'message',id:String(event.seq),timestamp:new Date().toISOString(),message})+'\n',{mode:0o600});
   output({type:'message_end',message});
  }
  if(event.type==='tool/call'){calls.set(d.callId,d.name);output({type:'tool_execution_start',toolName:d.name})}
  if(event.type==='tool/result')output({type:'tool_execution_end',toolName:calls.get(d.message?.source?.callId)||'tool',result:d.message,isError:d.message?.isError===true});
  if(event.type==='turn/end'&&d.reason?.kind!=='completed')output({type:'message_end',message:{role:'assistant',content:[],stopReason:'error',errorDetails:{...requestErrorDetails(d.reason?.error),...requestFailures.get(sid)},errorMessage:'DSH: '+(d.reason?.error?.message||d.reason?.kind||'unknown')}});
 });
 ctx.on('agent/status',async({agent,status})=>{if(agent.session.id!==sid)return;if(status==='idle'){try{await ctx.sessions.flush(agent.session)}catch(e){output({type:'message_end',message:{role:'assistant',content:[],stopReason:'error',errorMessage:'DSH履歴の保存失敗: '+e.message}})}}output({type:status==='running'?'agent_start':'agent_settled'})});
 const lines=createInterface({input:process.stdin});let serial=Promise.resolve();
 const listener=line=>{let incoming;try{incoming=JSON.parse(line)}catch{}if(incoming?.type==='extension_ui_response'){try{questions.answer(incoming)}catch(error){output({type:'scrum_runtime_error',message:error.message})}return}serial=serial.then(async()=>{
  let q;try{q=JSON.parse(line);await ctx.get('loader').await();const a=await openAgent();let data;
   switch(q.type){
    case 'get_state':data={sessionId:sid,sessionFile:path,model:{provider:a.options.provider,id:a.options.model,reasoningEffort:a.options.reasoningEffort},isStreaming:a.status==='running',engine:'DSH'};break;
    case 'get_commands':data={commands:(await ctx.skills.list({cwd,scope:a})).map(s=>({...s,source:'skill'}))};break;
    case 'get_messages':data={messages:[...legacy(),...a.session.deriveMessages().filter(m=>m.role==='assistant'||m.role==='user'&&visibleUserMessage(m))]};break;
    case 'get_session_stats':data={contextUsage:null};break;
    case 'compact':{const result=await ctx.commands.execute(a,'/compact',[],new AbortController().signal);if(!result||result.result?.kind==='error')throw Error(result?.result?.text||'DSHの要約機能が利用できません');data=result;break;}
    case 'dsh_tool':{const t=ctx.tools.schemas(a).find(t=>t.name===q.name);if(!t)throw Error('利用できないツールです');data=await ctx.tools.execute({callId:randomUUID(),name:q.name,arguments:q.args||{},agent:a,signal:new AbortController().signal});break;}
    case 'dsh_models':{data=[];for(const p of ctx.llm.listProviders()){try{const models=await ctx.llm.listModels(p.id);data.push({provider:p.id,name:p.name,models})}catch(e){data.push({provider:p.id,name:p.name,models:[],error:e.message})}}break;}
    case 'dsh_prompt_context':{const assembly=await ctx.systemPrompt.assemble(assembleContextFor(a,new AbortController().signal));data={sections:assembly.sections.map(s=>({name:s.name,text:s.text})),contexts:assembly.contexts.map(s=>({name:s.name,text:s.text}))};break;}
    case 'dsh_health':data={engine:'DSH',persistent:true,model:a.options,skills:(await ctx.skills.list({cwd,scope:a})).map(s=>s.name),tools:ctx.tools.schemas(a).map(t=>t.name),commands:ctx.commands.list(a).map(c=>c.name)};break;
    case 'abort':if(q.discardInbox!==undefined&&typeof q.discardInbox!=='boolean')throw Error('Invalid discardInbox');a.cancel({kind:'user'},{keepInbox:q.discardInbox!==true});await a.whenIdle();data={};break;
    case 'dsh_notify':a.inject(createUserMessage({content:[{type:'text',text:q.message}],source:{kind:'agent-message',form:'relay',senderSessionId:sid}}));data={delivered:true};break;
    case 'dsh_notices':data=a.session.deriveMessages().filter(m=>m.source?.kind==='subagent-settled').map(m=>({id:m.id,text:flatten(m)}));break;
    case 'dsh_command':data=await ctx.commands.execute(a,q.command,[],new AbortController().signal);if(!data)throw Error('コマンドがありません');break;
    case 'prompt':
     if(a.status==='running')throw Error('DSHは実行中です');
     if(typeof q.message!=='string'||!q.message.trim()||q.message.length>1000000)throw Error('メッセージが不正です');
     const source=promptSource({planner,origin:q.origin},sid);
     if(planner&&source.kind==='user'){if(typeof q.humanMessage!=='string'||!q.humanMessage.trim()||q.humanMessage.length>100000)throw Error('本人の発言がありません');a.inject(createUserMessage({content:[{type:'text',text:q.message}],source:promptSource({planner:true,origin:'coordinator'},sid)}));}
     if(q.dispatchId!==undefined){if(planner||typeof q.dispatchId!=='string'||!q.dispatchId.trim()||q.dispatchId.length>200)throw Error('Invalid worker dispatch ID');q.message='Scrum dispatch '+q.dispatchId+'\n'+q.message;}requestFailures.delete(sid);a.followup(createUserMessage({content:[{type:'text',text:planner&&source.kind==='user'?q.humanMessage:q.message}],source}));output({id:q.id,success:true,data:{accepted:true}});return;
    default:throw Error('未対応のDSH操作: '+q.type);
   }
   output({id:q.id,success:true,data});
  }catch(e){output({id:q?.id,success:false,error:e.message})}
 });};
 lines.on('line',listener);
 ctx.effect(()=>()=>{disposed=true;lines.off('line',listener);lines.close();return handle?.dispose()});
}
