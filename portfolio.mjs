// One projection of the canonical ledger, shared by both dashboard surfaces.
import {projectFamily} from './project-structure.mjs';
export function portfolio(snapshot, liveSessions=[]) {
 const rows=snapshot.projects.filter(p=>p.kind!=='workspace'&&!p.parentProjectId&&!['archived','deleted'].includes(p.status)).map(p=>{
  const ids=projectFamily(p.id,snapshot.projects),members=snapshot.projects.filter(x=>ids.has(x.id)&&!['archived','deleted'].includes(x.status)),memberIds=new Set(members.map(x=>x.id));
  const tasks=snapshot.tasks.filter(t=>memberIds.has(t.projectId)&&t.status!=='cancelled');
  const parents=new Set(tasks.map(t=>t.parentId).filter(Boolean)),leaves=tasks.filter(t=>!parents.has(t.id));
  const unfinished=leaves.filter(t=>t.status!=='done');
  const deadlines=snapshot.deadlines.filter(d=>memberIds.has(d.projectId)&&!d.received&&d.monitor!=='excluded');
  const runs=snapshot.runs.filter(r=>memberIds.has(r.projectId)&&r.source==='Pi');
  const sessions=liveSessions.filter(s=>runs.some(r=>r.id===s.id)).map(s=>({id:s.id,title:runs.find(r=>r.id===s.id)?.title,status:s.status,activity:s.activity||''}));
  const blocked=unfinished.filter(t=>['waiting','review','reported'].includes(t.status)||!t.actionable);
  const next=unfinished.filter(t=>t.actionable).sort((a,b)=>(a.status==='doing'?-1:0)-(b.status==='doing'?-1:0)||(a.actionDue||a.due||Infinity)-(b.actionDue||b.due||Infinity));
  return {id:p.id,name:p.name,status:p.status,projectIds:[...memberIds],children:members.filter(x=>x.id!==p.id).map(x=>({id:x.id,name:x.name,status:x.status})),category:p.category||'未分類',outcome:p.outcome||'',summary:p.summary||'',total:leaves.length,done:leaves.filter(t=>t.status==='done').length,
   reported:leaves.filter(t=>t.status==='reported').length,doing:unfinished.filter(t=>t.status==='doing').length,blocked:blocked.length,
   completed:(p.status==='completed'||leaves.length>0&&unfinished.length===0)&&deadlines.length===0,
   next:next.slice(0,2).map(t=>({id:t.id,title:t.title,nextAction:t.nextAction||'',status:t.status,owner:t.owner||''})),
   blockers:blocked.slice(0,3).map(t=>({id:t.id,title:t.title,status:t.status,reason:t.status==='reported'?'完了報告の確認待ち':t.waitingFor||(t.dependencies||[]).filter(id=>snapshot.tasks.find(x=>x.id===id)?.status!=='done').map(id=>'前提未完了：'+(snapshot.tasks.find(x=>x.id===id)?.title||id)).join('、')||'担当・完了条件の確認が必要'})),
   deadlines:deadlines.map(d=>({id:d.id,title:d.title,due:d.due,local:d.local,zone:d.zone,category:d.category,dayOffset:d.dayOffset,band:d.band,priority:d.priority})),sessions};
 });
 rows.sort((a,b)=>Number(a.completed)-Number(b.completed)||Math.min(9,...a.deadlines.map(d=>d.priority??9))-Math.min(9,...b.deadlines.map(d=>d.priority??9))||b.doing-a.doing||a.name.localeCompare(b.name,'ja'));
 const unassignedDeadlines=snapshot.deadlines.filter(d=>!d.received&&d.monitor!=='excluded'&&!rows.some(p=>p.projectIds.includes(d.projectId))).map(d=>({id:d.id,projectId:d.projectId,title:d.title,stage:d.stage,monitor:d.monitor,local:d.local,due:d.due,zone:d.zone,band:d.band,category:d.category,priority:d.priority,projectName:snapshot.projects.find(p=>p.id===d.projectId)?.name||'未分類'}));
 return {schemaVersion:1,observedAt:snapshot.now,projects:rows,unassignedDeadlines,totals:{projects:rows.length,doing:rows.reduce((n,p)=>n+p.doing,0),blocked:rows.reduce((n,p)=>n+p.blocked,0),deadlines:rows.reduce((n,p)=>n+p.deadlines.length,0)+unassignedDeadlines.length,livePi:rows.reduce((n,p)=>n+p.sessions.filter(s=>['running','submitting','retrying','waiting_input'].includes(s.status)).length,0)}};
}
