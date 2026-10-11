import {readdir,lstat,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
// Never follow symlinks: existing external recovery archives are not ours to remove.
export async function diskBytes(path){try{const s=await lstat(path);if(s.isSymbolicLink())return 0;if(!s.isDirectory())return s.size;let total=0;for(const name of await readdir(path))total+=await diskBytes(join(path,name));return total}catch(e){if(e.code==='ENOENT')return 0;throw e}}
export async function pruneBackups(root,{pattern,marker,keep=3,maxBytes=2*1024**3,parts}={}){
 const entries=[];for(const name of await readdir(root)){if(!pattern.test(name))continue;const path=join(root,name);if(!(await lstat(path)).isDirectory())continue;let evidence;try{evidence=JSON.parse(await readFile(join(path,marker),'utf8'))}catch{continue}const paths=parts?parts.map(p=>join(path,p)):[path];const bytes=(await Promise.all(paths.map(diskBytes))).reduce((a,b)=>a+b,0);entries.push({name,path,paths,bytes,time:Number(evidence.created)||Date.parse(evidence.at)||0})}
 entries.sort((a,b)=>b.time-a.time||b.name.localeCompare(a.name,undefined,{numeric:true}));let retainedBytes=0,retained=0;const removed=[];
 for(const entry of entries){if(!entry.bytes)continue;if(retained===0||(retained<keep&&retainedBytes+entry.bytes<=maxBytes)){retained++;retainedBytes+=entry.bytes;continue}for(const path of entry.paths)await rm(path,{recursive:true,force:true});removed.push(entry.name)}
 if(parts)for(const entry of entries.slice(100))await rm(entry.path,{recursive:true,force:true});
 return {retained,retainedBytes,removed,maxBytes,oversize:retainedBytes>maxBytes};
}
