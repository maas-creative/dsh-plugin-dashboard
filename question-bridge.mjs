import {randomUUID} from 'node:crypto';
import {UserQuestionError} from '@deepseek-ai/dsh-user-questions';
// The host renders requests; this plugin owns waiting, validation and cancellation.
export function registerQuestionBridge(ctx,{sessionId,emit}){
 const pending=new Map();
 const askOne=(question,signal)=>new Promise((resolve,reject)=>{
  signal?.throwIfAborted();const id='dashboard-question-'+randomUUID(),labels=(question.options||[]).map(o=>o.label);
  const finish=(error,value)=>{const row=pending.get(id);if(!row)return;pending.delete(id);signal?.removeEventListener('abort',abort);try{emit({type:'extension_ui_dismiss',id})}finally{error?reject(error):resolve(value)}};
  const abort=()=>finish(new UserQuestionError('Question canceled','ASK_ABORTED'));
  pending.set(id,{question,labels,finish});signal?.addEventListener('abort',abort,{once:true});
  const presentation={type:'extension_ui_request',id,method:question.multiSelect?'editor':labels.length?'select':'input',title:question.header||'Agent question',message:question.question+(question.multiSelect?'\nReturn a JSON array of selected option labels.':''),...(labels.length&&!question.multiSelect?{options:labels}:{}),...(question.multiSelect?{prefill:'[]'}:{})};pending.get(id).presentation=presentation;try{emit(presentation)}catch(error){finish(error)}
 });
 ctx.on('user-questions/request',async(request,next)=>{if(request.agent?.session.id!==sessionId)return next();const answers=[];for(const question of request.questions)answers.push(await askOne(question,request.signal));return {answers}});
 const accept=message=>{const row=pending.get(message.id);if(!row)throw Error('Question is no longer pending');if(message.cancelled){row.finish(new UserQuestionError('Question canceled by user','ASK_ABORTED'));return {canceled:true}}const value=message.value;if(typeof value!=='string')throw Error('Question answer must be a string');let selected=[],custom;
  if(row.question.multiSelect){selected=JSON.parse(value);if(!Array.isArray(selected)||selected.some(label=>typeof label!=='string'||!row.labels.includes(label))||new Set(selected).size!==selected.length)throw Error('Invalid selected option labels')}
  else if(row.labels.length){if(!row.labels.includes(value))throw Error('Invalid selected option');selected=[value]}else custom=value;
  row.finish(null,{id:row.question.id,selected,...(custom!==undefined?{custom}:{})});return {answered:true};};
 const answer=message=>{try{return accept(message)}catch(error){const row=pending.get(message.id);if(row)emit({...row.presentation,message:row.presentation.message+'\n'+error.message});throw error}};
 const dispose=()=>{for(const row of [...pending.values()])row.finish(new UserQuestionError('Question host closed','ASK_ABORTED'))};
 ctx.effect(()=>dispose);return {answer,dispose,get active(){return pending.size>0}};
}
