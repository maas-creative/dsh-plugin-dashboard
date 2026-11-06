import {readFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {extname,join} from 'node:path';
import {homedir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const run=promisify(execFile),binary=new Set(['.pdf','.docx','.xlsx']);
export async function readSourceText(path,{signal}={}){
 const info=await stat(path),format=extname(path).toLowerCase(),converted=binary.has(format);
 if(!info.isFile()||info.size>(converted?50:2)*1024*1024)throw Error('資料は通常ファイルで、テキストは2MB、PDF・Officeは50MB以下にしてください');
 const before=await readFile(path,{signal}),sourceHash=createHash('sha256').update(before).digest('hex');let result={text:before.toString('utf8'),limited:false};
 if(converted){const python=[process.env.DASHBOARD_DOCUMENT_PYTHON,join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3')].filter(Boolean).find(existsSync);if(!python)throw Error('PDF・Office本文を読むPython環境がありません。DASHBOARD_DOCUMENT_PYTHONを設定してください');const {stdout}=await run(python,[join(import.meta.dirname,'scripts/extract-source-text.py'),path],{timeout:60000,maxBuffer:16*1024*1024,signal});result=JSON.parse(stdout);if(createHash('sha256').update(await readFile(path,{signal})).digest('hex')!==sourceHash)throw Error('本文抽出中に資料が変更されました');}
 return {...result,sourceHash,binary:converted,modifiedAt:info.mtimeMs};
}
