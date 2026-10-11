// Build adapter copyright (c) 2026 MaaS Creative, AGPL-3.0-only.
// Original source retains its MIT license.
import {stripTypeScriptTypes} from 'node:module';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('./attempt-outcome-projection.ts',import.meta.url),'utf8');
const result='// Generated from preserved MIT TypeScript source using Node 24 stripTypeScriptTypes.\n'+stripTypeScriptTypes(source,{mode:'strip'});
const expected=await readFile(new URL('./attempt-outcome-projection.mjs',import.meta.url),'utf8');
if(result!==expected)throw Error('Projection runtime differs; use Node 24.19.0 for the recorded build');
console.log(JSON.stringify({exactReproduction:true,node:process.version}));
