import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {createApp} from './server.mjs';
import {apply as applyDashboard} from './dashboard-plugin.mjs';
import {createHostAnalyzer} from './host-analyzer.mjs';
export const name='dashboard-resident';
export const inject=['skills','commands','tools','fs','systemPrompt','sessionPersistence','attachments','llm','agents','sessions','goals','sessionProjections','sandbox','sandboxPolicy','credentials','compaction','loader'];
export function resolveScrum(specifier='dsh-plugin-scrum',packageRoot){const require=createRequire(packageRoot?join(packageRoot,'package.json'):import.meta.url);return {entry:require.resolve(specifier),standalone:require.resolve(specifier+'/standalone')}}
export function apply(ctx,config={}){
 let app,runtime,analyze,closing,started=false;
 const close=()=>closing||=(async()=>{await app?.close();await analyze?.close();await runtime?.standalone.close()})();
 const boot=async()=>{await ctx.get('loader').await();if(closing)return;const resolved=resolveScrum(config.scrumPackage,config.scrumPackageRoot);const {createStandaloneRuntime}=await import(pathToFileURL(resolved.standalone).href);const scrum=await import(pathToFileURL(resolved.entry).href);runtime=await createStandaloneRuntime(ctx,{dataDir:config.scrumDataDir||join(config.dataDir,'scrum-execution')});await ctx.plugin(scrum,{runtime,lifecycle:{onboardingDisabled:true,interactive:false,stateDir:join(config.dataDir,'dsh/scrum'),telemetry:{enabled:false}}}).await();analyze=createHostAnalyzer(ctx);app=await createApp({dataDir:config.dataDir,port:config.port??4318,background:config.background!==false,scrumClient:runtime.execution,dailyAnalyze:analyze,dshHome:process.env.DSH_HOME});applyDashboard(ctx,{store:app.store,projectIds:config.projectIds??'all',coordinator:app.coordinator});started=true;config.onReady?.({app,runtime,analyze});console.log('Dashboard resident connected: http://127.0.0.1:'+app.port)};
 const timer=setTimeout(()=>boot().catch(async error=>{console.error('Dashboard resident startup failed: '+error.message);await close();process.exitCode=1;if(config.exitOnFailure!==false)process.exit(1)}),0);
 const stop=()=>{void close().then(()=>process.exit(0),error=>{console.error(error.message);process.exit(1)})};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 ctx.effect(()=>()=>{clearTimeout(timer);process.off('SIGTERM',stop);process.off('SIGINT',stop);return close()});return {close,get ready(){return started},get app(){return app},get runtime(){return runtime}};
}
