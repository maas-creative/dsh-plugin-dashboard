import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from './store.mjs';
import {Manager} from './manager.mjs';
import {DailyPlanner} from './daily.mjs';
import {createFixtureAnalyzer} from './test-fixtures/browser-fixture.mjs';
test('browser fixture persists each response in the history the real conversation UI reads',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'dashboard-hdt-fixture-')),s=new Store(join(dir,'db')),notes=[];new Manager(s,dir);
 try{const daily=new DailyPlanner(s,dir,createFixtureAnalyzer(notes));for(const command of ['hdt','/hdt']){await daily.run({force:true,note:command});const history=daily.history();assert(history.messages.some(m=>m.role==='user'&&m.text===command));assert.equal(history.messages.filter(m=>m.role==='assistant').at(-1).text,'入力を受信しました: '+command)}assert.deepEqual(notes,['hdt','/hdt']);assert.equal(daily.history().messages.filter(m=>m.role==='assistant').length,2)}finally{s.close();await rm(dir,{recursive:true,force:true})}
});
