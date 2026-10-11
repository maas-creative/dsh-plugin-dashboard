import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {prepareDsh} from './dsh.mjs';
import {resolveScrum} from './resident-plugin.mjs';
export async function launchResident({dataDir=process.env.DASHBOARD_DATA||join(homedir(),'Library/Application Support/Project Dashboard'),dshHome=process.env.DSH_HOME,port=Number(process.env.PORT||4318),scrumPackageRoot=process.env.DASHBOARD_SCRUM_PACKAGE_ROOT,scrumDataDir=process.env.DASHBOARD_SCRUM_DATA}={}){
 resolveScrum('dsh-plugin-scrum',scrumPackageRoot);await mkdir(dataDir,{recursive:true,mode:0o700});if(!dshHome){await prepareDsh(dataDir);dshHome=process.env.DASHBOARD_DSH_HOME}
 const root=import.meta.dirname,patch=join(dataDir,'dashboard-resident.yml'),base=(await readFile(join(root,'dsh.patch.yml'),'utf8')).replace(/name: \.\//g,'name: '+root+'/');
 await writeFile(patch,base+'\n- id: dashboard-bridge\n  disabled: true\n- insert: '+JSON.stringify([{id:'dashboard-resident',name:join(root,'resident-plugin.mjs'),config:{dataDir,port,scrumPackageRoot,scrumDataDir}}])+'\n',{mode:0o600});
 return spawn(process.execPath,[join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','sdk','--patch',patch],{cwd:dataDir,stdio:'inherit',env:{...process.env,DSH_HOME:dshHome,DASHBOARD_DSH_HOME:dshHome,DASHBOARD_ENGINE:'dsh',DSH_DASHBOARD_LEDGER:'',DSH_SCRUM_SOCKET:'',DSH_SCRUM_TOKEN:''}});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){const child=await launchResident();for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>child.kill(signal));child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0)})}
