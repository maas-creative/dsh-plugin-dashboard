import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import {Rpc} from './connectors.mjs';
import {randomUUID} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));
export function localGlmConnection(){
 const connection=JSON.parse(readFileSync(join(homedir(),'Library/Application Support/GLM53-Selected/connection.json'),'utf8'));
 if(connection.local_base_url!=='http://127.0.0.1:8000/v1'||connection.model!=='glm53-fast'||typeof connection.api_key!=='string'||!connection.api_key)throw Error('ローカルGLMの接続設定が一致しません');
 return connection;
}
export function localDeepSeekConnection(){
 const connection=JSON.parse(readFileSync(join(homedir(),'Library/Application Support/DeepSeek-Mia/connection.json'),'utf8'));
 if(connection.base_url!=='http://100.66.64.103:8022/v1'||connection.model!=='deepseek-mia-jp'||typeof connection.api_key!=='string'||!connection.api_key)throw Error('ローカルDeepSeekの接続設定が一致しません');
 return connection;
}
export async function verifyLocalGlm(connection=localGlmConnection(),request=fetch){
 const response=await request('http://127.0.0.1:8000/v1/models',{headers:{Authorization:'Bearer '+connection.api_key},signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error('ローカルGLMに接続できません');
 const result=await response.json();if(!Array.isArray(result.data)||!result.data.some(m=>m.id===connection.model))throw Error('設定したGLMモデルが見つかりません');
 return {model:connection.model};
}
export async function prepareDsh(dataDir){
 const home=join(dataDir,'dsh');await mkdir(home,{recursive:true,mode:0o700});const credentials=join(home,'.credentials.yaml');
 try{await access(credentials)}catch(e){if(e.code!=='ENOENT')throw e;const auth=JSON.parse(await readFile(join(homedir(),'.pi/agent/auth.json'),'utf8'));if(!auth['openai-codex'])throw Error('OpenAI Codexのログインが必要です');await writeFile(credentials,JSON.stringify({version:1,refs:{},records:{'llm-pi-ai/openai-codex':{kind:'grant',payload:auth['openai-codex']}}}),{flag:'wx',mode:0o600})}
 const configDir=join(home,'scrum');await mkdir(configDir,{recursive:true,mode:0o700});const config=join(configDir,'lsp.json');
 try{await access(config)}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(config,JSON.stringify({lsp:{typescript:{command:[process.execPath,join(root,'node_modules/typescript-language-server/lib/cli.mjs'),'--stdio'],extensions:['.ts','.tsx','.js','.jsx','.mjs','.cjs','.mts','.cts'],initialization:{tsserver:{path:join(root,'node_modules/typescript/lib/tsserver.js')}}}}}),{flag:'wx',mode:0o600})}
 process.env.DASHBOARD_DSH_HOME=home;
}
export function dshRpc({cwd,sessionPath,system='',planner=false,search=false,searchRoots='',model,scrum=false,role='executor',policy,reportPath='',dashboardScope=[]}){
 if(!process.env.DASHBOARD_DSH_HOME)throw Error('DSHの実行環境が未設定です');
 let glmKey,deepSeekKey;
 try{const connection=localDeepSeekConnection();if(model?.provider==='local-deepseek'&&connection.model!==model.model)throw Error('ローカルDeepSeekのモデルが一致しません');deepSeekKey=connection.api_key;}catch(error){if(model?.provider==='local-deepseek')throw error;}
 if(model?.provider==='local-glm'){
  const connection=localGlmConnection();if(connection.model!==model.model)throw Error('ローカルGLMのモデルが一致しません');
  glmKey=connection.api_key;
 }
 const sessionId=sessionPath?JSON.parse(readFileSyncSession(sessionPath)).id:randomUUID();
 return new Rpc(process.execPath,['--import',join(root,'cache-usage-hook.mjs'),join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','sdk','--patch',join(root,'dsh.patch.yml')],{cwd,env:{...process.env,TMPDIR:runtimeTempDir(process.env.DASHBOARD_DSH_HOME),DASHBOARD_GLM_KEY:glmKey,DASHBOARD_DEEPSEEK_KEY:deepSeekKey,DSH_HOME:process.env.DASHBOARD_DSH_HOME,DSH_MODEL:JSON.stringify(model||{}),DSH_ROLE:role,DSH_ROLE_POLICY:policy?JSON.stringify(policy):'',DSH_REPORT_PATH:reportPath,DSH_SCRUM_SOCKET:typeof scrum==='object'?scrum.path:scrum?(process.env.DSH_SCRUM_SOCKET||''):'',DSH_SCRUM_TOKEN:typeof scrum==='object'?scrum.token:scrum?(process.env.DSH_SCRUM_TOKEN||''):'',DSH_DASHBOARD_LEDGER:process.env.DSH_DASHBOARD_LEDGER||'',DSH_DASHBOARD_SCOPE:JSON.stringify(planner?JSON.parse(process.env.DSH_DASHBOARD_SCOPE||'[]'):dashboardScope),DSH_WORK_CWD:cwd,DSH_SESSION_ID:sessionId,DSH_LEGACY_SESSION:sessionPath||'',DSH_SYSTEM_PROMPT:system,DSH_PLANNER:planner?'1':'0',DSH_ALLOW_SEARCH:search?'1':'0',PI_PLANNER_SEARCH_ROOTS:searchRoots}});
}
import {readFileSync,mkdirSync} from 'node:fs';
export function runtimeTempDir(home){const dir=join(home,'runtime-tmp');mkdirSync(dir,{recursive:true,mode:0o700});return dir}
function readFileSyncSession(path){return readFileSync(path,'utf8').split('\n')[0]}
