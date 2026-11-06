import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {dashboardRead} from './dashboard-read.mjs';
const exec=promisify(execFile),pending=new Map();
const relations=new Set(['file_summary','imports_of','importers_of','children_of','callers_of','callees_of','tests_for']);
export async function projectGraph(store,args,scope,{run=exec}={}){
 const project=dashboardRead(store,{view:'projects',projectId:args.projectId},scope).items.find(p=>p.id===args.projectId);
 if(!project||!isAbsolute(project.cwd||''))throw Error('登録済み案件の作業フォルダが必要です');
 const cwd=await realpath(project.cwd),action=args.action||'search';if(!['search','relation','refresh'].includes(action))throw Error('グラフ操作が不正です');
 const argsList=['--offline','code-review-graph'];
 if(action==='refresh')argsList.push('update','--repo',cwd,'--skip-flows');
 else{if(typeof args.query!=='string'||!args.query.trim()||args.query.length>500||args.query.startsWith('-'))throw Error('検索語または対象を指定してください');if(action==='relation'){if(!relations.has(args.relation))throw Error('関係の種類が不正です');argsList.push('query',args.relation,args.query,'--repo',cwd)}else argsList.push('search',args.query,'--limit','20','--repo',cwd)}
 const uvx=[join(homedir(),'.local/bin/uvx'),'/opt/homebrew/bin/uvx'].find(existsSync);if(!uvx)throw Error('コードグラフ実行環境がありません。資料検索を続けてください');
 const execute=async()=>{const {stdout}=await run(uvx,argsList,{cwd,timeout:120000,maxBuffer:2*1024*1024});return {projectId:project.id,action,cwd,observedAt:Date.now(),result:stdout.slice(0,24000),truncated:stdout.length>24000,notice:'コードの関係は業務上の所属とは別です。結果を根拠として確認し、親子関係を推測で確定しないでください。'}};
 if(action!=='refresh')return execute();if(pending.has(cwd))return pending.get(cwd);const work=execute().finally(()=>pending.delete(cwd));pending.set(cwd,work);return work;
}
