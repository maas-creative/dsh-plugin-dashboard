import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {recordIntegrity,compareRecords} from './scripts/record-integrity.mjs';
test('record verification proves exact restored content and detects edits and deletion with unchanged counts',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'scrum-record-check-'));let db;
 try{
  const path=join(dir,'source.sqlite');db=new DatabaseSync(path);
  for(const table of ['projects','tasks','deadlines','deadline_revisions','deliverables','submissions','receipt_meta','task_runs','runs']){
   db.exec(`CREATE TABLE "${table}"(owner TEXT,id TEXT,body TEXT,PRIMARY KEY(owner,id))`);
   db.prepare(`INSERT INTO "${table}" VALUES(?,?,?)`).run('a','same','original');
   db.prepare(`INSERT INTO "${table}" VALUES(?,?,?)`).run('b','same','second');
  }
  const before=recordIntegrity(path),copy=join(dir,'restore.sqlite');await backup(db,copy);
  assert.deepEqual(compareRecords(before,recordIntegrity(copy)),{preserved:true,missing:[],changed:[]});
  db.exec("UPDATE deadlines SET body='altered' WHERE owner='a';DELETE FROM submissions WHERE owner='b';INSERT INTO submissions VALUES('c','same','replacement');");
  const after=recordIntegrity(path),result=compareRecords(before,after);
  assert.equal(after.tables.submissions.count,before.tables.submissions.count);
  assert.equal(result.preserved,false);assert.deepEqual(result.changed,[{table:'deadlines',id:'["a","same"]'}]);assert.deepEqual(result.missing,[{table:'submissions',id:'["b","same"]'}]);
 }finally{db?.close();await rm(dir,{recursive:true,force:true});}
});
