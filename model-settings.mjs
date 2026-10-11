import {dshRpc} from './dsh.mjs';
import {selectModel,defaultModel} from './model-policy.mjs';
export {defaultModel,saveModel} from './model-policy.mjs';
export function workerModel(store,runId){const tasks=store.all('SELECT taskId FROM task_runs WHERE runId=?',runId);const task=tasks.length===1?tasks[0]:null;return store.setting('runModel:'+runId,null)||selectModel(store.setting('workerModels',{}),store.setting('runRole:'+runId,'executor'),task?.taskId,store.setting('runCategory:'+runId,''));}
export async function modelCatalog(cwd){const rpc=dshRpc({cwd,planner:true});try{return await rpc.call('dsh_models',{},true,60000)}finally{rpc.stop()}}
