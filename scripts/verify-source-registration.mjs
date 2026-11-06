import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {createApp} from '../server.mjs';
import {analyzePi} from '../manager.mjs';

// Real model + real phone-role browser, with isolated business data and no worker dispatch.
const dir=await mkdtemp(join(tmpdir(),'dashboard-phone-registration-'));
process.env.DASHBOARD_ENGINE='dsh';
let app,browser;const progress=[];
try{
 app=await createApp({dataDir:dir,port:45658,background:false,dshHome:join(homedir(),'Library/Application Support/Project Dashboard/dsh'),dailyAnalyze:(...args)=>{const notify=args[6];args[6]=event=>{progress.push(event);notify?.(event)};return analyzePi(...args)}});
 const projectId=app.store.project({name:'研究資料の受入試験',cwd:dir}),path=join(dir,'plan.md');
 await writeFile(path,'未登録の作業「第3章の引用照合」を行う。次は本文と参考文献の対応を照合する。');
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true});
 const base='http://127.0.0.1:45658',phone='https://127.0.0.1:45659';
 assert.equal((await page.request.post(base+'/api/login',{headers:{origin:base},data:{code:app.key}})).status(),200);
 const pair=await(await page.request.post(base+'/api/mobile',{headers:{origin:base},data:{}})).json();
 assert.equal((await page.request.post(phone+'/api/pair',{headers:{origin:phone},data:{code:pair.code}})).status(),200);
 await page.goto(phone);await page.locator('#shell').waitFor({state:'visible'});await page.locator('[data-view=daily]').click();
 const area=page.locator('[data-ui-component=arc-chat-thread] textarea');await area.waitFor({state:'visible'});
 const instruction=`隔離台帳の受入試験です。案件ID ${projectId} の計画書 ${path} をdashboard_sourcesのreadで実際に読み、原文の「第3章の引用照合」を既存案件の作業として登録してください。今回は登録だけで実作業・構造変更・委譲はしません。sourceRegistrationsにはreadのsourceHashと原文引用、今回の指示引用とnotes.atを含めてください。`;
 await area.fill(instruction);await page.getByRole('button',{name:'送信',exact:true}).click();
 const deadline=Date.now()+210000;let plan;
 while(Date.now()<deadline){plan=app.store.setting('dailyPlan',{});if(plan.finished&&!plan.running||plan.error)break;await new Promise(r=>setTimeout(r,500))}
 assert.ok(plan?.finished&&!plan.running,'Actual model turn did not settle');assert.equal(plan.error,null);
 const tasks=app.store.snapshot().tasks;assert.equal(tasks.length,1,'Registration must not invent a parent task');assert.equal(tasks[0].title,'第3章の引用照合');assert.equal(tasks[0].parentId,null);assert.equal(plan.sourceRegistrations.length,1);
 const item=app.store.get('SELECT * FROM manager_items WHERE entityId=?',tasks[0].id);assert.ok(JSON.parse(item.body).quote.includes('第3章の引用照合'));assert.equal(item.state,'applied');
 assert.ok(app.store.setting('dailyNeedsPlan',false));
 await page.getByText(plan.summary,{exact:true}).waitFor({state:'visible',timeout:10000});
 await page.locator('[data-view=projects]').click();await page.locator(`[data-action=project-detail][data-id="${projectId}"]`).click();await page.getByText('第3章の引用照合',{exact:true}).first().waitFor({state:'visible',timeout:10000});
 assert.ok(progress.some(e=>e.phase==='searching'&&e.label==='PC内の資料を調査中'),'Actual model must use the source tool');
 assert.equal(plan.model,'gpt-6.1-sol');
 const parentId=app.store.task({projectId,title:'博士論文の章改稿',status:'todo',nextAction:'章ごとの改稿をまとめる'});
 await page.locator('[data-view=daily]').click();await area.waitFor({state:'visible'});
 await area.fill(`同じ案件の作業ID ${tasks[0].id} 「第3章の引用照合」を、親作業ID ${parentId} 「博士論文の章改稿」の下へ移してください。既存IDのtask-parent変更だけを行い、登録・委譲・完了変更はしません。`);
 const previousFinished=plan.finished;await page.getByRole('button',{name:'送信',exact:true}).click();
 const secondDeadline=Date.now()+210000;while(Date.now()<secondDeadline){plan=app.store.setting('dailyPlan',{});if(plan.finished>previousFinished&&!plan.running||plan.error)break;await new Promise(r=>setTimeout(r,500))}
 assert.ok(plan.finished>previousFinished&&!plan.running,'Hierarchy turn did not settle');assert.equal(plan.error,null);assert.equal(app.store.get('SELECT parentId FROM tasks WHERE id=?',tasks[0].id).parentId,parentId);
 await page.getByText(plan.summary,{exact:true}).waitFor({state:'visible',timeout:10000});await page.locator('[data-view=projects]').click();await page.locator(`[data-action=project-detail][data-id="${projectId}"]`).click();
 await page.locator(`[data-portfolio-detail="task:${parentId}"] > summary`).click();
 await page.locator(`[data-task-id="${tasks[0].id}"][data-depth="1"]`).waitFor({state:'visible'});await page.locator(`[data-task-id="${parentId}"][data-depth="0"]`).waitFor({state:'visible'});
 assert.ok((await page.locator('.section-head').filter({hasText:'作業の階層'}).locator(':scope > div').boundingBox()).width>300,'Mobile hierarchy title must not be squeezed by buttons');
 // Correct the registered work from a smartphone instruction and a revised source.
 await writeFile(path,'既存の第3章の作業名は「第3章の出典照合」とし、本文・参考文献・出典の対応を照合する。');
 const current=app.store.snapshot().tasks.find(t=>t.id===tasks[0].id);await page.locator('[data-view=daily]').click();
 await area.fill(`案件 ${projectId} の ${path} をreadして、作業ID ${current.id} の現在版 ${current.version} の見出しを「第3章の出典照合」、次の行動を「本文・参考文献・出典の対応を照合する」へ修正してください。sourceRegistrationsへtaskId/versionと再読した引用・sourceHashを指定し、同じID・親作業・状態・履歴を保持します。新規タスク作成や本業開始はしません。`);
 const previousRevision=plan.finished;await page.getByRole('button',{name:'送信',exact:true}).click();const thirdDeadline=Date.now()+210000;while(Date.now()<thirdDeadline){plan=app.store.setting('dailyPlan',{});if(plan.finished>previousRevision&&!plan.running||plan.error)break;await new Promise(r=>setTimeout(r,500))}
 assert.ok(plan.finished>previousRevision&&!plan.running,'Revision turn did not settle');assert.equal(plan.error,null);const revised=app.store.snapshot().tasks.find(t=>t.id===current.id);assert.equal(revised.title,'第3章の出典照合');assert.equal(revised.nextAction,'本文・参考文献・出典の対応を照合する');assert.equal(revised.parentId,parentId);assert.equal(revised.status,'todo');assert.equal(app.store.snapshot().tasks.length,2);
 await page.locator('[data-view=projects]').click();await page.locator(`[data-action=project-detail][data-id="${projectId}"]`).click();const branch=page.locator(`[data-portfolio-detail="task:${parentId}"]`);if(!await branch.evaluate(el=>el.open))await branch.locator(':scope > summary').click();await page.getByText(revised.title,{exact:true}).waitFor({state:'visible'});
 await mkdir('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/source-registration-hierarchy.png',fullPage:true});
 const evidence={at:new Date().toISOString(),realPhoneRole:true,realModel:true,model:plan.model,sourceToolObserved:true,sourceQuotePreserved:true,registeredTaskCount:tasks.length,noInventedParent:true,savedResultVisible:true,ledgerTaskVisible:true,hierarchyInstructionApplied:true,parentAndChildVisible:true,phoneSourceRevisionApplied:true,originalTaskIdPreserved:true,noDuplicateOnRevision:true,hierarchy:[{title:'博士論文の章改稿',children:[{title:'第3章の出典照合'}]}],parentWasFixtureSetup:true,scope:'isolated source registration and explicit hierarchy change; real business work and resident execution are not proven'};
 await mkdir('output/acceptance',{recursive:true});await writeFile('output/acceptance/source-registration.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await browser?.close();await app?.close();await rm(dir,{recursive:true,force:true})}
