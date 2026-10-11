import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const tables=['projects','tasks','deadlines','deadline_revisions','deliverables','submissions','receipt_meta','task_runs','runs'];
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function recordIntegrity(path){
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  db.exec('BEGIN');const result={tables:{}};
  for(const table of tables){
   const columns=db.prepare(`PRAGMA table_info("${table}")`).all();
   if(!columns.length)throw Error('Required record table missing: '+table);
   const keys=columns.filter(column=>column.pk).sort((a,b)=>a.pk-b.pk).map(column=>column.name);
   if(!keys.length)throw Error('Record table has no stable identity: '+table);
   const rows=db.prepare(`SELECT * FROM "${table}" ORDER BY ${keys.map(key=>'"'+key+'"').join(',')}`).all();
   result.tables[table]={count:rows.length,hash:digest(rows),rows:Object.fromEntries(rows.map(row=>[JSON.stringify(keys.map(key=>row[key])),digest(row)]))};
  }
  db.exec('COMMIT');return result;
 }finally{db.close();}
}
export function compareRecords(before,after){
 const missing=[],changed=[];
 for(const [table,data]of Object.entries(before.tables))for(const [id,hash]of Object.entries(data.rows)){
  const current=after.tables[table]?.rows[id];
  if(!current)missing.push({table,id});else if(current!==hash)changed.push({table,id});
 }
 return {preserved:missing.length===0&&changed.length===0,missing,changed};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [database,output,baseline]=process.argv.slice(2);if(!database||!output)throw Error('Usage: record-integrity.mjs DATABASE OUTPUT [BASELINE]');
 const snapshot=recordIntegrity(database),comparison=baseline?compareRecords(JSON.parse(await readFile(baseline,'utf8')).snapshot,snapshot):null;
 await writeFile(output,JSON.stringify({at:new Date().toISOString(),snapshot,comparison},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({counts:Object.fromEntries(Object.entries(snapshot.tables).map(([name,data])=>[name,data.count])),comparison}));
 if(comparison&&!comparison.preserved)process.exitCode=1;
}
