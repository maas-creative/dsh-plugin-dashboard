// Copyright (c) 2026 MaaS Creative. SPDX-License-Identifier: AGPL-3.0-only
// Starts an isolated, synthetic ledger for documentation screenshots. No model calls.
import {createApp} from '../server.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const dir=await mkdtemp(join(tmpdir(),'dashboard-docs-'));
const app=await createApp({dataDir:dir,port:0,background:false});
const s=app.store,day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date());
const research=s.project({name:'研究論文',category:'研究',summary:'分析と原稿をまとめ、投稿までの進捗を管理',outcome:'投稿用原稿と再現可能な分析資料',completionCriteria:'分析・原稿・投稿記録を確認'});
const analysis=s.project({name:'データ分析',parentProjectId:research,category:'研究',summary:'集計から結果確認まで',outcome:'再現可能な分析結果'});
const product=s.project({name:'Webアプリ公開',category:'開発',summary:'実装・テスト・公開準備',outcome:'公開版と操作ガイド'});
const operations=s.project({name:'会社の運営',category:'会社',summary:'月次処理と次回の確認事項',outcome:'月次の報告資料'});
function task(projectId,title,status,extra={}){return s.task({projectId,title,status,planDay:day,completionCriteria:'出力を照合できること',...extra});}
const input=task(analysis,'入力データを確認','done',{completionEvidence:'公開用サンプルの項目と欠損を確認済み'});
const aggregate=task(analysis,'集計結果を照合','doing',{dependencies:[input],nextAction:'集計表と元データの件数を照合する',output:'集計結果.csv'});
task(research,'結果を原稿に反映','todo',{dependencies:[aggregate],nextAction:'確認済みの集計結果を原稿へ反映',output:'投稿原稿.md'});
task(research,'投稿条件を確認','todo',{nextAction:'投稿先の要項を確認する'});
task(product,'操作ガイドを作成','doing',{nextAction:'導入と最初の操作を説明',output:'操作ガイド.md'});
task(product,'公開前レビュー','todo',{nextAction:'操作ガイドと公開範囲を確認する'});
task(operations,'月次レポートを整理','todo',{nextAction:'今月の収支と確認事項をまとめる'});
console.log('Documentation demo: http://127.0.0.1:'+app.port+'/#key='+app.key);
let stopping=false;for(const signal of ['SIGTERM','SIGINT'])process.on(signal,async()=>{if(stopping)return;stopping=true;await app.close();await rm(dir,{recursive:true,force:true});process.exit()});
