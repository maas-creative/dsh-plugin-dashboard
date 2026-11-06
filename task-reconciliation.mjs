import {boundedSourceDiscovery,isSensitiveSourcePath} from './source-discovery.mjs';
import {createHash} from 'node:crypto';

// Re-read cited evidence before applying an agent's assessment.
export async function prepareReconciliations(store, proposals, tasks, assignments=[], signal){
 if(proposals===undefined)return [];
 if(!Array.isArray(proposals)||proposals.length>10)throw Error('照合結果は10件以内で指定してください');
 const seen=new Set(),prepared=[];
 for(const proposal of proposals){
  const {taskId,version,decision,reason,nextAction,evidence,searchScope}=proposal||{};
  const task=tasks.find(t=>t.id===taskId);
  if(!task||task.status!=='review'||task.version!==version||seen.has(taskId))throw Error('照合対象の作業または版が無効です');
  if(!['done','reported','continue','needs_review'].includes(decision))throw Error('照合結果の判定が無効です');
  if(typeof reason!=='string'||!reason.trim()||reason.length>2000||typeof nextAction!=='string'||nextAction.length>1000)throw Error('照合理由と次の行動を確認してください');
  if(!['done','reported'].includes(decision)&&!nextAction.trim())throw Error('未完了の作業には次の行動が必要です');
  if(assignments.some(a=>a.taskId===taskId&&['running','preparing','uncertain'].includes(a.status)))throw Error('実行中の作業は照合結果を反映できません');
  if(decision==='done'&&tasks.some(t=>t.parentId===taskId&&!['done','cancelled'].includes(t.status))||decision==='reported'&&tasks.some(t=>t.parentId===taskId&&!['done','reported','cancelled'].includes(t.status)))throw Error('子作業が未完了です');
  if(!Array.isArray(evidence)||evidence.length>5||(!evidence.length&&(decision!=='needs_review'||typeof searchScope!=='string'||!searchScope.trim()||searchScope.length>1000)))throw Error('原資料の引用、または要確認の探索範囲が必要です');
  const checked=[];let artifactEvidence=false,userReport=false;
  for(const item of evidence){
   if(!item||typeof item.path!=='string'||typeof item.hash!=='string'||typeof item.quote!=='string'||item.quote.trim().length<8||item.quote.length>1000)throw Error('証拠のパス・ハッシュ・引用が不正です');
   if(item.snapshotId!==undefined){
    if(decision!=='reported'||typeof item.snapshotId!=='string'||item.snapshotId!==item.hash||!/^[a-f0-9]{64}$/.test(item.snapshotId)||typeof item.messageId!=='string')throw Error('保存済み履歴は本人報告の確認に限ります');
    const row=store.get("SELECT i.body,i.created,s.id AS sourceId,s.projectId,s.path FROM manager_inputs i JOIN manager_sources s ON s.id=i.sourceId WHERE i.id=? AND s.kind='session'",item.snapshotId);
    if(!row||row.path!==item.path||isSensitiveSourcePath(row.path)||createHash('sha256').update(row.body).digest('hex')!==item.snapshotId)throw Error('保存済み履歴を検証できません');
    let doc;try{doc=JSON.parse(row.body)}catch{throw Error('保存済み履歴を読み取れません')}
    const message=doc.messages?.find(m=>m.id===item.messageId&&m.role==='user'&&typeof m.text==='string'&&m.text.includes(item.quote));
    if(doc.id!==row.sourceId||doc.projectId!==row.projectId||!message)throw Error('保存済み履歴に本人の発言がありません');
    userReport=true;checked.push({path:item.path,hash:item.hash,hashKind:'snapshot',snapshotId:item.snapshotId,messageId:item.messageId,quote:item.quote,messageAt:Number.isSafeInteger(message.at)&&message.at>0&&message.at<=8640000000000000?message.at:null,recordedAt:row.created});continue;
   }
   const doc=await boundedSourceDiscovery(store,{action:'read',path:item.path,...(Number.isInteger(item.offset)?{offset:item.offset}:{}),...(Number.isInteger(item.line)?{line:item.line}:{})},'all',{signal});
   if(Array.isArray(doc.messages)&&!item.messageId)throw Error('履歴の引用にはメッセージIDが必要です');
   const content=typeof doc.text==='string'?doc.text:(doc.messages||[]).filter(m=>m.id===item.messageId).map(m=>m.text).join('\n');
   if(typeof doc.text==='string')artifactEvidence=true;
   if((doc.sourceHash||doc.contentHash)!==item.hash||!content.includes(item.quote))throw Error('原資料のハッシュまたは引用が一致しません');
   if(Array.isArray(doc.messages)&&doc.messages.some(m=>m.id===item.messageId&&m.role==='user'&&m.text.includes(item.quote)))userReport=true;
   checked.push({path:item.path,hash:item.hash,hashKind:typeof doc.text==='string'?'file':'history-content',quote:item.quote,...(item.messageId?{messageId:item.messageId}:{}),...(Number.isInteger(item.line)?{line:item.line}:{})});
  }
  if(decision==='done'&&!task.completionCriteria)throw Error('完了条件がない作業は完了にできません');
  if(decision==='done'&&!artifactEvidence)throw Error('会話履歴だけでは独立した完了確認にできません。本人報告は報告として扱ってください');
  if(decision==='reported'&&!userReport)throw Error('本人の完了報告を含む履歴が必要です');
  seen.add(taskId);prepared.push({task,decision,reason:reason.trim(),nextAction:nextAction.trim(),evidence:checked,searchScope:typeof searchScope==='string'?searchScope.trim():''});
 }
 return prepared;
}
export async function prepareIndividualReconciliations(store,proposals,tasks,assignments=[],signal){
 if(proposals===undefined)return {rows:[],held:0,skipped:0,skippedIds:[],excluded:0};
 if(!Array.isArray(proposals)||proposals.length>10)throw Error('照合結果は10件以内で指定してください');
 const rows=[],seen=new Set(),skippedIds=[];let held=0,skipped=0,excluded=0,allTasks;
 for(const proposal of proposals){
  const task=tasks.find(t=>t.id===proposal?.taskId);
  if(task?.actor==='archived'||task&&['done','reported','cancelled'].includes(task.status)){excluded++;continue}
  if(!task){allTasks??=store.snapshot().tasks;const existing=allTasks.find(t=>t.id===proposal?.taskId);if(existing&&(existing.actor==='archived'||['done','reported','cancelled'].includes(existing.status))){excluded++;continue}}
  if(!task||task.status!=='review'||task.version!==proposal.version||seen.has(task.id)){skipped++;skippedIds.push(String(proposal?.taskId||'未指定'));continue}
  seen.add(task.id);
  try{rows.push(...await prepareReconciliations(store,[proposal],tasks,assignments,signal))}catch(error){
   if(signal?.aborted)throw error;
   if(assignments.some(a=>a.taskId===task.id&&['running','preparing','uncertain'].includes(a.status)))throw error;
   const knownErrors=new Set(['照合結果の判定が無効です','照合理由と次の行動を確認してください','未完了の作業には次の行動が必要です','子作業が未完了です','原資料の引用、または要確認の探索範囲が必要です','証拠のパス・ハッシュ・引用が不正です','保存済み履歴は本人報告の確認に限ります','保存済み履歴を検証できません','保存済み履歴を読み取れません','保存済み履歴に本人の発言がありません','履歴の引用にはメッセージIDが必要です','原資料のハッシュまたは引用が一致しません','完了条件がない作業は完了にできません','会話履歴だけでは独立した完了確認にできません。本人報告は報告として扱ってください','本人の完了報告を含む履歴が必要です']);
   const detail=knownErrors.has(error?.message)?error.message:'検証処理の詳細は未確認です';
   const nextAction='検証できなかった理由を確認し、原資料と作業履歴を完了条件と照合する。';
   const scope=typeof proposal.searchScope==='string'&&proposal.searchScope.trim()&&proposal.searchScope.length<=900?'エージェントが報告した探索範囲（未検証）: '+proposal.searchScope.trim():'提示された根拠の再確認';
   const fallback={taskId:task.id,version:task.version,decision:'needs_review',reason:'提示された証拠または判定を検証できず、完了・継続の判定を保留しました。'+detail,nextAction,evidence:[],searchScope:scope};
   rows.push(...await prepareReconciliations(store,[fallback],tasks,assignments,signal));held++;
  }
 }
 return {rows,held,skipped,skippedIds,excluded};
}
export function applyReconciliations(store, rows){
 for(const r of rows){
  const current=store.get('SELECT version,status FROM tasks WHERE id=?',r.task.id);
  if(!current||current.version!==r.task.version||current.status!=='review')throw Error('照合中に作業が変更されました');
  const evidence=r.evidence.map(e=>`${e.path}\n${e.hashKind==='file'?'資料':e.hashKind==='snapshot'?'保存済み発言（原本の現行性は未確認）':'抽出履歴'}のSHA-256: ${e.hash}${e.hashKind==='snapshot'?`\n発言日時: ${e.messageAt?new Date(e.messageAt).toISOString():'不明'}`:''}\n引用: ${e.quote}`).join('\n\n')+(r.searchScope?`\n探索範囲: ${r.searchScope}`:'');
  const record={decision:r.decision,reason:r.reason,nextAction:r.nextAction,evidence:r.evidence,searchScope:r.searchScope,at:Date.now()};
  store.set('task-reconciliation:'+r.task.id,record);
  if(r.decision==='done')store.task({...r.task,status:'done',completionEvidence:`照合理由: ${r.reason}\n${evidence}`});
  else if(r.decision==='reported')store.task({...r.task,status:'reported',completionEvidence:`本人報告（独立確認は未実施）: ${r.reason}\n${evidence}`});
  else if(r.decision==='continue')store.task({...r.task,status:'todo',nextAction:r.nextAction,completionEvidence:`照合結果（作業継続）: ${r.reason}\n${evidence}`});
  else store.task({...r.task,nextAction:r.nextAction,completionEvidence:`照合結果（要確認）: ${r.reason}\n${evidence}`});
 }
}
