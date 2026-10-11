// Copyright (c) 2026 MaaS Creative. SPDX-License-Identifier: AGPL-3.0-only
import {execFileSync} from 'node:child_process';
import {mkdir,cp,writeFile,stat,readFile} from 'node:fs/promises';
import {resolve,join,relative} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),out=process.argv[2]&&resolve(process.argv[2]);
if(!out||out===root||out.startsWith(root+'/'))throw Error('Supply a new destination outside this development tree');
try{await stat(out);throw Error('Destination already exists')}catch(error){if(error.code!=='ENOENT')throw error}
const packed=JSON.parse(execFileSync('npm',['pack','--dry-run','--json'],{cwd:root,encoding:'utf8'}))[0];
const names=new Set(packed.files.map(file=>file.path));
const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
for(const [key,command] of Object.entries(pkg.scripts))if(key==='test'||key.startsWith('test:'))for(const name of command.match(/[\w-]+\.mjs/g)||[])names.add(name);
for(const name of ['package-lock.json','.gitignore','scripts/prepare-public-source.mjs','docs/publication-audit.md','scripts/record-integrity.mjs','test-fixtures/browser-fixture.mjs','mcp-oauth-issuer-test.mjs','resident-test.mjs'])names.add(name);
await mkdir(out,{recursive:true});
const manifest=[];
for(const name of [...names].sort()){
 if(/(^|\/)(work|node_modules|\.scrum|\.development|\.git|reports|outputs|cache)(\/|$)|\.(sqlite|db|tgz|log)(-|\.|$)|^scripts\/port-/.test(name))throw Error('Private path selected: '+name);
 const src=join(root,name),dst=join(out,name);if(relative(root,src).startsWith('..'))throw Error('Unsafe source path');
 await mkdir(resolve(dst,'..'),{recursive:true});await cp(src,dst,{dereference:false});
 manifest.push({path:name,sha256:createHash('sha256').update(await readFile(src)).digest('hex')});
}
await writeFile(join(out,'PUBLICATION_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({destination:out,files:manifest.length,published:false}));
