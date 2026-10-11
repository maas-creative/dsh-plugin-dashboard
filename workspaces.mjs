import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,realpath,readFile,lstat,readlink} from 'node:fs/promises';
import {join,resolve,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {createWorktree} from './vendor/orchestrator-worktree.mjs';
import {fail} from './store.mjs';
const exec=promisify(execFile);
export async function git(cwd,...args){return (await exec('git',args,{cwd,timeout:30000,maxBuffer:2*1024*1024})).stdout.replace(/\r?\n$/,'')}
export async function prepareWorkspace(s,dir,p,taskId){
 const source=await realpath(p.cwd),key='workspace:'+taskId,prior=s.setting(key,null);
 if(prior){if(prior.source!==source)fail('作業フォルダが変更されています。元の担当Piの成果物を確認してください',409);await validateWorkspace(prior);return prior}
 let repo;try{repo=await realpath(await git(source,'rev-parse','--show-toplevel'))}catch(e){if(e.code===128&&e.stderr?.includes('not a git repository'))return null;throw e}
 if(await git(repo,'status','--porcelain'))fail('未コミットの変更があります。保存してから隔離作業を開始してください',409);
 const baseHead=await git(repo,'rev-parse','HEAD'),created=await createWorktree(repo,taskId);
 if(!created)fail('隔離作業フォルダを作成できませんでした。共有フォルダでは実行しません',503);
 // Keep recoverable work outside temporary storage. Never invoke upstream auto-commit/cleanup.
 const root=join(await realpath(dir),'worktrees',createHash('sha256').update(taskId).digest('hex').slice(0,24));
 const workspace={source,repo,root:created.path,path:join(created.path,relative(repo,source)),baseHead,kind:'git'};
 s.set(key,workspace);await mkdir(join(dir,'worktrees'),{recursive:true});
 await git(repo,'worktree','move',created.path,root);workspace.root=root;workspace.path=join(root,relative(repo,source));s.set(key,workspace);return workspace;
}
export async function validateWorkspace(w){
 const root=await realpath(w.root),path=await realpath(w.path);if(path!==root&&!path.startsWith(root+sep))fail('隔離作業フォルダの参照が不正です');
 const common=async dir=>realpath(resolve(dir,await git(dir,'rev-parse','--git-common-dir')));
 if(await common(root)!==await common(w.repo))fail('隔離作業フォルダのGitが変更されています',409);return path;
}
export async function workspaceChanges(w){
 await validateWorkspace(w);const status=await git(w.root,'status','--porcelain'),diff=await git(w.root,'diff','--no-ext-diff','--no-textconv',w.baseHead,'--');
 if((await git(w.root,'diff','--no-ext-diff','--no-textconv','--numstat',w.baseHead,'--')).split('\n').some(line=>line.startsWith('-\t-\t')))fail('バイナリの変更があります。作業フォルダで確認・統合してください',409);
 const files=(await git(w.root,'ls-files','--others','--exclude-standard','-z')).split('\0').filter(Boolean),untracked=[];
 // ponytail: review up to 30 small text files; use a local Git client for larger/binary changes.
 for(const path of files.slice(0,30)){const full=join(w.root,path),info=await lstat(full);if(info.isSymbolicLink()){untracked.push({path,content:'シンボリックリンク → '+await readlink(full)});continue}if(info.size>60000)fail('大きい未追跡ファイルがあります。作業フォルダで確認してください',409);const bytes=await readFile(full);if(bytes.includes(0))fail('バイナリの変更があります。作業フォルダで確認・統合してください',409);untracked.push({path,content:bytes.toString('utf8'),hash:createHash('sha256').update(bytes).digest('hex')});}
 if(files.length>30)fail('未追跡ファイルが30件を超えています。作業フォルダで確認してください',409);
 const fingerprint=createHash('sha256').update(JSON.stringify({status,diff,untracked})).digest('hex');return {path:w.path,baseHead:w.baseHead,status,diff,untracked,fingerprint};
}
