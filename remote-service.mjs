import {createRemoteGateway} from './remote-gateway.mjs';
import {readFile,writeFile,unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {homedir} from 'node:os';
import {join} from 'node:path';
const data=process.env.DASHBOARD_DATA||join(homedir(),'Library/Application Support/Project Dashboard');
const status=join(data,'remote-access.json');let publicOrigin=null;
await unlink(status).catch(e=>{if(e.code!=='ENOENT')throw e});
const gateway=await createRemoteGateway({ca:await readFile(join(data,'tls/ca.crt')),origin:()=>publicOrigin});
const tunnel=spawn(process.env.DASHBOARD_CLOUDFLARED||'/opt/homebrew/bin/cloudflared',['tunnel','--no-autoupdate','--url','http://127.0.0.1:4320'],{stdio:['ignore','pipe','pipe']});
let buffer='';
const record=async chunk=>{
 buffer=(buffer+chunk.toString()).slice(-16384);
 const url=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/)?.[0];
 if(url&&!publicOrigin){publicOrigin=url;await writeFile(status,JSON.stringify({url,temporary:true,pid:process.pid,created:Date.now()})+'\n',{mode:0o600});console.log('Remote dashboard: '+url)}
};
tunnel.stdout.on('data',chunk=>record(chunk).catch(()=>shutdown(1)));
tunnel.stderr.on('data',chunk=>record(chunk).catch(()=>shutdown(1)));
let closing=false;
async function shutdown(code){if(closing)return;closing=true;publicOrigin=null;await unlink(status).catch(()=>{});tunnel.kill();gateway.close();process.exitCode=code;setTimeout(()=>process.exit(code),1500).unref()}
tunnel.on('error',()=>shutdown(1));tunnel.on('exit',()=>shutdown(1));
process.on('SIGTERM',()=>shutdown(0));process.on('SIGINT',()=>shutdown(0));
