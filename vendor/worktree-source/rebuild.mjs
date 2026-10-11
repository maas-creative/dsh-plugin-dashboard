// Own adapter; upstream worktree.ts retains its MIT license.
import {build} from 'esbuild';
import {mkdtemp,cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const source=dirname(fileURLToPath(import.meta.url));
const stage=await mkdtemp(join(tmpdir(),'scrum-worktree-source-'));
await mkdir(join(stage,'work/oss-research/pi-agent-orchestrator/src'),{recursive:true});
await cp(join(source,'worktree.ts'),join(stage,'work/oss-research/pi-agent-orchestrator/src/worktree.ts'));
await writeFile(join(stage,'package.json'),'{"type":"module"}');
await writeFile(join(stage,'entry.ts'),'export { createWorktree } from "./work/oss-research/pi-agent-orchestrator/src/worktree.ts";\n');
const r=await build({absWorkingDir:stage,entryPoints:['entry.ts'],bundle:true,platform:'node',format:'esm',target:'node24',write:false});
const text='// Derived from @groeponline/pi-agent-orchestrator 0.19.2, commit 7208bdb089f15c7d371407531d53394fb2a61f6a. MIT; see LICENSE.orchestrator. Only createWorktree is bundled; no cleanup/auto-commit code.\n\n'+r.outputFiles[0].text;
await writeFile(join(stage,'rebuilt.mjs'),text);
if(text!==await readFile(join(source,'../orchestrator-worktree.mjs'),'utf8'))throw new Error(`Rebuild differs; retained at ${stage}`);
console.log(JSON.stringify({exactReproduction:true,sha256:createHash('sha256').update(text).digest('hex')}));
