import {hasExecution} from './planning.mjs';
import {createHash} from 'node:crypto';
import {discoverSources,discoveryRoots} from './source-discovery.mjs';
import {realpath,stat} from 'node:fs/promises';
import {sep,isAbsolute} from 'node:path';
import {sourceDocument,validateItem,applyItem} from './manager.mjs';
import {fail,text} from './store.mjs';
function groundedDeadline({local,zone,quote}){
 if(!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(local||''))return false;
 const day=local.slice(0,10),date=new Date(day+'T00:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)return false;
 const q=quote.normalize('NFKC'),dates=[...q.matchAll(/(\d{4})\s*(?:年|[-/])\s*(\d{1,2})\s*(?:月|[-/])\s*(\d{1,2})(?:日)?/g)].map(m=>m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0'));
 const parts=new Intl.DateTimeFormat('ja-JP-u-ca-japanese',{era:'long',year:'numeric',month:'numeric',day:'numeric',timeZone:'UTC'}).formatToParts(date),era=Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 const eraMatch=[...q.matchAll(/(令和|平成|昭和|大正|明治)(元|\d+)年\s*(\d{1,2})月\s*(\d{1,2})日/g)].some(m=>m[1]===era.era&&(m[2]==='元'?'1':String(Number(m[2])))===(era.year==='元'?'1':String(Number(era.year)))&&Number(m[3])===Number(era.month)&&Number(m[4])===Number(era.day));
 if(!dates.includes(day)&&!eraMatch)return false;if(local.length===10)return true;
 const zoned=zone&&(q.includes(zone)||zone==='Asia/Tokyo'&&/(日本時間|\bJST\b)/i.test(q)||['UTC','Etc/UTC'].includes(zone)&&/(\bUTC\b|協定世界時)/i.test(q));if(!zoned)return false;
 const times=[...q.matchAll(/(?:T|\s)(\d{1,2}):(\d{2})/g)].map(m=>m[1].padStart(2,'0')+':'+m[2]);for(const m of q.matchAll(/(午前|午後)?\s*(\d{1,2})時(?:(\d{1,2})分)?/g)){let hour=Number(m[2]);if(m[1]&&hour>12)continue;if(m[1]==='午前'&&hour===12)hour=0;if(m[1]==='午後'&&hour<12)hour+=12;times.push(String(hour).padStart(2,'0')+':'+String(Number(m[3]||0)).padStart(2,'0'))}return times.includes(local.slice(11));
}
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export async function prepareProjectDefinitions(store,changes){
 if(changes===undefined)return changes;
 if(!Array.isArray(changes))fail('案件の変更は配列にしてください');
 const result=[];for(const change of changes){
  if(!['define','create','repair-location'].includes(change.type)){result.push(change);continue}
  if(change.type!=='create')store.requireProject(change.projectId);
  if(change.type==='repair-location'){const old=store.get('SELECT * FROM projects WHERE id=?',change.projectId);if(!old.cwd||old.cwd!==change.previousCwd)fail('復旧元の作業先が現在の登録と一致しません',409);try{await stat(old.cwd);fail('存在する作業先は自動復旧で変更しません')}catch(e){if(e.code!=='ENOENT')throw e}}
  const read=await discoverSources(store,{action:'read',path:change.sourcePath,offset:change.sourceOffset},change.type==='define'?[change.projectId]:'all'),quote=text(change.sourceQuote,'案件の原文根拠',1500);
  if(change.sourceHash!==(read.sourceHash||read.contentHash)||!(read.text?.includes(quote)||read.messages?.some(m=>m.text.includes(quote))))fail('案件の根拠が現在の原資料と一致しません',409);
  let cwd=change.cwd;
  if(['create','repair-location'].includes(change.type)){if(!isAbsolute(text(cwd,'作業先',2000)))fail('作業先は絶対パスにしてください');cwd=await realpath(cwd);const roots=await discoveryRoots(store,'all'),path=await realpath(change.sourcePath);if(!(await stat(cwd)).isDirectory()||!roots.some(r=>cwd===r||cwd.startsWith(r+sep))||!path.startsWith(cwd+sep))fail('作業先と原資料が許可された資料範囲内にありません');}
  result.push({...change,...(['create','repair-location'].includes(change.type)?{cwd}:{}),sourceEvidence:{path:read.path||change.sourcePath,hash:change.sourceHash,quote}});
 }return result;
}

// Prepare outside the ledger transaction; apply the whole validated batch inside it.
export async function prepareSourceRegistrations(store,rows,notes,scope='all'){
 if(rows===undefined)return [];
 if(!Array.isArray(rows)||rows.length>30)fail('資料から登録する項目は30件以内の配列にしてください');
 const prepared=[];
 for(const row of rows){
  const instruction=text(row.instructionQuote,'今回の本人指示',2000);let note=notes.find(n=>n.at===row.noteAt);
  // Continue only the latest human instruction, without borrowing execution permission.
  if(!note&&!notes.length&&!row.startQuote){const prior=store.setting('dailyPlan',{}).notes?.at(-1);if(prior?.at===row.noteAt&&prior.text.includes(instruction))note=prior;}
  if(!note?.text.includes(instruction))fail('資料の登録には今回の本人指示の原文が必要です');
  store.requireProject(row.projectId);
  if(scope!=='all'&&!scope.includes(row.projectId))fail('登録先がこのセッションの範囲外です');
  const read=await discoverSources(store,{action:'read',path:row.path,offset:row.offset},scope);
  if(read.supported===false)fail('この資料形式は本文を取得してから登録してください');
  if(row.sourceHash!==(read.sourceHash||read.contentHash))fail('資料が更新されたかハッシュが一致しません。引用を含む資料のpathをdashboard_sourcesのreadで再読し、返されたsourceHashをそのまま指定してください',409);
  const path=read.path||row.path,existing=store.get('SELECT * FROM manager_sources WHERE path=? AND projectId=?',path,row.projectId),shared=store.get('SELECT id FROM manager_sources WHERE path=?',path),id='plan:'+hash(shared?[path,row.projectId]:path);
  const source=existing||{id,projectId:row.projectId,path,title:path.split('/').at(-1),kind:/\.jsonl$/i.test(path)?'session':'plan'};
  const quoteOffset=typeof read.text==='string'?read.text.indexOf(row.quote):-1;const messageIds=row.messageId?[row.messageId]:source.kind==='plan'&&quoteOffset>=0?['document:'+Math.floor(((read.offset||0)+quoteOffset)/4000)*4000]:[];const doc=await sourceDocument({...source,cursor:0,contentHash:'',messageIds});
  const after=await discoverSources(store,{action:'read',path:row.path},scope);
  if(row.sourceHash!==(after.sourceHash||after.contentHash))fail('登録の照合中に資料が更新されました',409);
  const message=doc.messages.find(m=>(!row.messageId||m.id===row.messageId)&&m.text.includes(row.quote));
  if(!message)fail('引用が原文と一致しません。引用を含む資料をdashboard_sourcesのreadで読み、同じ資料のpath・sourceHash・引用を指定してください',409);
  // Membership is already the selected project. Do not invent a parent task from a generated goal label.
  const body=validateItem({...row,sourceId:source.id,messageId:message?.id,explicit:true,open:true,goal:row.title},[doc]);
  if(body.kind==='deadline'&&!groundedDeadline(body))fail('締切は原文に明記された年・月・日が必要です。時刻を登録する場合は地域も明示してください');
  let revision=null;
  if(row.taskId){const task=store.get('SELECT * FROM tasks WHERE id=?',row.taskId);if(body.kind!=='task'||row.startQuote||!task||task.projectId!==row.projectId||task.status!=='todo'||task.version!==row.version||hasExecution(store,'t.id',task.id))fail('管理情報の更新は、同じ案件の未着手・未実行の現在版タスクだけに指定できます',409);text(row.nextAction,'更新後の次の行動',2000);revision={taskId:task.id,version:task.version};}
  const start=row.startQuote?text(row.startQuote,'本人開始指示',2000):null;
  if(start&&!note.text.includes(start))fail('資料の開始指示が本人の原文と一致しません');
  if(start&&body.kind!=='task')fail('開始指示は作業だけに指定できます');
  prepared.push({source,sourceHash:doc.contentHash,body,id:hash([source.id,body.kind,body.title,body.quote]),authorization:start?{quote:start,noteAt:row.noteAt}:null,originNote:note,revision});
 }
 return prepared;
}

export function applySourceRegistrations(store,prepared){
 const results=[];
 for(const {source,sourceHash,body,id,authorization,originNote,revision} of prepared){
  store.run("INSERT INTO manager_sources(id,projectId,path,title,kind,hash) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash",source.id,source.projectId,source.path,source.title,source.kind,sourceHash);
  const previous=store.get('SELECT * FROM manager_items WHERE id=?',id);
  const table=body.kind==='task'?'tasks':'deadlines',same=store.get(`SELECT id FROM ${table} WHERE projectId=? AND title=?`,body.projectId,body.title);
  let revised=false;
  if(revision){const task=store.get('SELECT * FROM tasks WHERE id=?',revision.taskId);if(!task||task.projectId!==body.projectId||task.version!==revision.version||task.status!=='todo'||hasExecution(store,'t.id',task.id))fail('更新対象の作業が変更されています',409);if(same&&same.id!==task.id||previous?.entityId&&previous.entityId!==task.id)fail('新しい見出しが別の作業と重複しています',409);if(task.title!==body.title||task.nextAction!==body.nextAction){store.task({id:task.id,projectId:task.projectId,version:task.version,status:task.status,title:body.title,nextAction:body.nextAction});store.set('task-start:'+task.id,null);revised=true;}}
  store.run("INSERT INTO manager_items(id,projectId,sourceId,sourceHash,kind,title,body,state,entityId,created) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sourceHash=excluded.sourceHash,body=excluded.body",id,body.projectId,source.id,sourceHash,body.kind,body.title,JSON.stringify(body),revision||same?'applied':'pending',revision?.taskId||same?.id||null,Date.now());
  const entityId=revision?.taskId||previous?.entityId||same?.id||applyItem(store,id);
  if(authorization){const task=store.get('SELECT * FROM tasks WHERE id=?',entityId);if(task?.status!=='todo')fail('未着手以外の作業には新しい開始指示を保存しません',409);store.set('task-start:'+entityId,{...authorization,projectId:task.projectId,version:task.version})}
  else if(body.kind==='task'&&!revision&&!same&&!previous?.entityId){const task=store.get('SELECT * FROM tasks WHERE id=?',entityId);if(task?.status==='todo'&&originNote?.text?.length<=2000)store.set('task-registration-note:'+entityId,{projectId:task.projectId,version:task.version,noteAt:originNote.at})}
  if(previous?.entityId&&!revised){results.push({itemId:id,entityId,existing:true,...(revision?{revised:false}:{})});continue}
  store.run('INSERT INTO manager_events(itemId,action,body,created) VALUES(?,?,?,?)',id,revision?'source-revision':'source-registration',JSON.stringify({entityId,quote:body.quote,sourceHash,existing:!!revision||!!same,revised}),Date.now());
  results.push({itemId:id,entityId,existing:!!revision||!!same,...(revision?{revised}:{})});
 }
 return results;
}
