import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Store,fail} from './store.mjs';
import {portfolio} from './portfolio.mjs';
export function openLedgerReader(path){const s=Object.create(Store.prototype);s.db=new DatabaseSync(path,{readOnly:true});s.db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=3000');return s}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function dashboardRead(store,args={},scope=[]){
 const allowed=['overview','projects','tasks','deadlines','submissions','artifacts'];
 const view=args.view||'overview';if(!allowed.includes(view))fail('Unknown dashboard view');
 if(scope!=='all'&&(!Array.isArray(scope)||scope.some(id=>typeof id!=='string')))fail('Invalid Dashboard host scope',403);
 let snap;const nested=store.db.isTransaction;if(!nested)store.db.exec('BEGIN');try{snap=store.snapshot();if(!nested)store.db.exec('COMMIT')}catch(e){if(!nested)store.db.exec('ROLLBACK');throw e}const ids=new Set(scope==='all'?snap.projects.map(p=>p.id):scope);
 if(args.projectId&&!ids.has(args.projectId))fail('Project is outside this session scope',403);
 const projects=snap.projects.filter(p=>ids.has(p.id)&&(!args.projectId||p.id===args.projectId));
 const selected=new Set(projects.map(p=>p.id));
 const tasks=snap.tasks.filter(t=>selected.has(t.projectId)).map(t=>({...t,actionDue:t.due||null,priorityReason:'',parentId:snap.tasks.some(x=>x.id===t.parentId&&selected.has(x.projectId))?t.parentId:null,dependencies:t.dependencies.filter(id=>snap.tasks.some(x=>x.id===id&&selected.has(x.projectId)))}));
 const deadlines=snap.deadlines.filter(d=>selected.has(d.projectId));
 const submissions=snap.submissions.filter(s=>deadlines.some(d=>d.id===s.deadlineId));
 const artifacts=snap.deliverables.filter(a=>selected.has(a.projectId));
 const raw={projects:projects.map(p=>({...p,parentProjectId:selected.has(p.parentProjectId)?p.parentProjectId:null})),tasks,deadlines,submissions,artifacts};
 // Version changes on ledger content, never on the time-dependent priority projection.
 const canonical={projects:raw.projects,tasks:tasks.map(({actionable,actionDue,blockers,...t})=>t),deadlines:deadlines.map(({priority,band,dayOffset,category,...d})=>d),submissions,artifacts};
 for(const values of Object.values(canonical))values.sort((a,b)=>String(a.id).localeCompare(String(b.id)));const snapshotVersion=hash(canonical),observedAt=snap.now;
 const rows=view==='overview'?portfolio({...snap,projects:raw.projects,tasks,deadlines,submissions,deliverables:artifacts,runs:[],taskRuns:[]}).projects:raw[view];
 const limit=args.limit??50;if(!Number.isInteger(limit)||limit<1||limit>100)fail('limit must be 1..100');
 let offset=0;if(args.cursor){let c;try{c=JSON.parse(Buffer.from(args.cursor,'base64url').toString())}catch{fail('Invalid cursor')}
 if(c.version!==snapshotVersion||c.view!==view||c.projectId!==(args.projectId||''))fail('Ledger changed; read again from the first page',409);
 if(!Number.isSafeInteger(c.offset)||c.offset<0)fail('Invalid cursor');offset=c.offset;}
 const next=offset+limit<rows.length?Buffer.from(JSON.stringify({version:snapshotVersion,view,projectId:args.projectId||'',offset:offset+limit})).toString('base64url'):null;
 return {schemaVersion:1,snapshotVersion,observedAt,view,items:rows.slice(offset,offset+limit),total:rows.length,nextCursor:next};
}
