import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {chromium} from 'playwright';
import {Store} from '../store.mjs';
import {resolveScrum} from '../resident-plugin.mjs';

// Same resident host and public Scrum bridge as production, with isolated data and credentials.
const root=join(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'dashboard-manual-work-')),data=join(dir,'data'),work=join(dir,'work'),dshHome=join(data,'dsh'),base='http://127.0.0.1:45678',phone='https://127.0.0.1:45679';
let host,browser;let hostError='';
try{
 await mkdir(work,{recursive:true});await mkdir(dshHome,{recursive:true,mode:0o700});await mkdir(join(dir,'empty-sessions'));
 await copyFile(join(homedir(),'Library/Application Support/Project Dashboard/dsh/.credentials.yaml'),join(dshHome,'.credentials.yaml'));
 await writeFile(join(work,'data.csv'),'value\n2\n3\n5\n');await writeFile(join(work,'plan.md'),'CSVの集計結果を作成する。data.csv のデータ件数とvalue列の合計を実際に計算し、入力ファイルと計算方法を result.md に記載する。');
 const s=new Store(join(data,'dashboard.sqlite'));const projectId=s.project({name:'手動研究の受入試験',cwd:work});s.set('piRoot',join(dir,'empty-sessions'));s.close();
 const scrumRoot=process.env.DASHBOARD_SCRUM_PACKAGE_ROOT||join(homedir(),'Library/Application Support/Project Dashboard/app');resolveScrum('dsh-plugin-scrum',scrumRoot);
 const patch=join(dir,'resident.yml'),config={dataDir:data,port:45678,scrumPackageRoot:scrumRoot,scrumDataDir:join(data,'scrum-execution'),projectIds:[projectId]};
 await writeFile(patch,(await readFile(join(root,'dsh.patch.yml'),'utf8')).replace(/name: \.\//g,'name: '+root+'/')+'\n- id: dashboard-bridge\n  disabled: true\n- insert: '+JSON.stringify([{id:'dashboard-resident',name:join(root,'resident-plugin.mjs'),config}])+'\n');
 host=spawn(process.execPath,[join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js'),'--profile','sdk','--patch',patch],{cwd:data,env:{...process.env,DSH_HOME:dshHome,DASHBOARD_DSH_HOME:dshHome,DASHBOARD_ENGINE:'dsh',DSH_DASHBOARD_LEDGER:'',DSH_SCRUM_SOCKET:'',DSH_SCRUM_TOKEN:''},stdio:['ignore','pipe','pipe']});
 host.stderr.on('data',chunk=>hostError=(hostError+chunk).slice(-3000));host.stdout.on('data',()=>{});
 const startup=Date.now()+60000;while(true){if(host.exitCode!==null)throw Error('Resident startup failed: '+hostError);try{if((await fetch(base)).ok)break}catch{}if(Date.now()>startup)throw Error('Resident startup timed out: '+hostError);await new Promise(r=>setTimeout(r,300))}
 browser=await chromium.launch();const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,ignoreHTTPSErrors:true});
 const key=(await readFile(join(data,'local-key'),'utf8')).trim();assert.equal((await page.request.post(base+'/api/login',{headers:{origin:base},data:{code:key}})).status(),200);
 const pair=await(await page.request.post(base+'/api/mobile',{headers:{origin:base},data:{}})).json();assert.equal((await page.request.post(phone+'/api/pair',{headers:{origin:phone},data:{code:pair.code}})).status(),200);
 await page.goto(phone);await page.locator('#shell').waitFor({state:'visible'});await page.locator('[data-view=daily]').click();const area=page.locator('[data-ui-component=arc-chat-thread] textarea');await area.waitFor({state:'visible'});
 await area.fill(`案件 ${projectId}「手動研究の受入試験」の ${join(work,'plan.md')} を読んで、不足している作業「CSVの集計結果」を根拠付きで台帳に登録し、その作業を今から実行して完成させてください。設定は手動のままです。原資料は ${join(work,'data.csv')}、出力は作業フォルダ内の result.md。データ件数、value合計、出典、計算方法を記載することが完了条件です。登録時には今回の開始指示をstartQuoteとしてその作業に保存し、入力・出力・完了条件をtaskPlansで具体化してから実作業へ委譲してください。あなた自身で出力を書かず、担当の結果を原資料と照合してください。この隔離案件だけを扱い、他の資料の調査・外部送信・公開は行いません。`);
 await page.getByRole('button',{name:'送信',exact:true}).click();
 const deadline=Date.now()+600000;let state,last;
 while(Date.now()<deadline){if(host.exitCode!==null)throw Error('Resident exited: '+hostError);const response=await page.request.get(phone+'/api/state');assert.equal(response.status(),200);state=await response.json();const tasks=state.tasks.filter(t=>t.projectId===projectId),assignments=state.daily?.assignments||[];const progress=JSON.stringify({phase:state.daily?.phase,error:state.daily?.error||null,tasks:tasks.map(t=>({title:t.title,status:t.status,output:t.output})),assignments:assignments.map(a=>({status:a.status}))});if(progress!==last){console.log(progress);last=progress}if(tasks.length===1&&tasks[0].status==='done'&&assignments.some(a=>a.taskId===tasks[0].id&&a.status==='done'))break;await new Promise(r=>setTimeout(r,1000))}
 const tasks=state.tasks.filter(t=>t.projectId===projectId);assert.equal(tasks.length,1,'The staged request must not duplicate work');assert.equal(tasks[0].status,'done','Real execution and verification did not finish');assert.equal(state.projects.find(p=>p.id===projectId).execution,'manual');
 assert.equal(state.daily?.model,'gpt-6.1-sol');const workerModels=(state.daily?.assignments||[]).map(a=>a.model);for(const model of workerModels){assert.equal(model?.model||model?.id||model,'gpt-6.1-sol');if(typeof model==='object')assert.equal(model.reasoningEffort,'low')}const artifact=state.deliverables.find(a=>a.projectId===projectId);assert.ok(artifact?.reviewed);const report=await readFile(join(work,'result.md'),'utf8');assert.match(report,/3/);assert.match(report,/10/);assert.match(report,/data\.csv/);
 await page.locator('[data-view=projects]').click();await page.locator(`[data-action=project-detail][data-id="${projectId}"]`).click();await page.locator('summary').filter({hasText:'完了作業のアーカイブ'}).click();await page.getByText('CSVの集計結果',{exact:true}).first().waitFor({state:'visible',timeout:10000});
 await mkdir('output/playwright',{recursive:true});await page.screenshot({path:'output/playwright/manual-work-completed.png',fullPage:true});
 const evidence={at:new Date().toISOString(),residentHost:true,phoneRole:true,oneHumanInstruction:true,manualSettingPreserved:true,registeredTaskCount:tasks.length,realExecutionVerified:true,artifactHash:artifact.hash,report,model:state.daily.model,workerModels,reasoningEffort:'low',hierarchy:[{project:'手動研究の受入試験',tasks:tasks.map(t=>({title:t.title,parentId:t.parentId,status:t.status}))}],scope:'isolated resident acceptance; real business ledger organization is not proven'};
 await mkdir('output/acceptance',{recursive:true});await writeFile('output/acceptance/manual-work.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{await browser?.close();if(host&&host.exitCode===null){const exit=once(host,'exit');host.kill('SIGTERM');const timer=setTimeout(()=>host.kill('SIGKILL'),10000);try{await exit}finally{clearTimeout(timer)}}await rm(dir,{recursive:true,force:true})}
