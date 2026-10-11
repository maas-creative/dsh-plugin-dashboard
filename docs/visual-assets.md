# 公開画像とロゴ

ロゴは組み込みのimagegenで制作したPNG原本です。両製品はインディゴ・青・ティールを共通の色調にし、Scrumは協調する経路、Dashboardは全体を見渡す構成を表しています。OMOやDSHのロゴをScrum／Dashboardのロゴとして流用していません。

READMEでは112px角で表示します。透明背景のため、使用先では十分なコントラストがある背景を選んでください。ロゴはPNGで、ベクター原稿ではありません。

スクリーンショットは公開用の架空データを使い、実際のアプリをブラウザで表示して撮影しました。画像生成による架空のUIではありません。認証URLやブラウザのアドレスバーは画像に含みません。画面には個人の履歴・プロジェクト・アカウントを使用していません。モデル実行の成果を示す画像ではありません。

## 再撮影

```sh
node scripts/readme-demo.mjs
```

表示されたローカルURLをブラウザで開きます。既存のデータや常駐版を変更せず、独立した一時環境で起動します。Ctrl-Cで停止すると一時環境を終了・削除します。

`overview.png`は1440×1000で全体の進捗と配下プロジェクトを開いた状態、`today-tasks.png`は同じサイズで今日のタスク、`mobile.png`は390×844の表示です。外部の履歴取得や期限点検は実行しないため、その状態は未取得と表示されます。実データの状態に置き換えて撮影しないでください。

## 生成プロンプト

組み込みimagegenを使用。透明背景を指定。

```text
Use case: logo-brand. Create one finished original square logomark for 'Dashboard', MaaS Creative's open-source project oversight application. No words or lettering. Same calm family as professional coordination software: deep indigo and clear blue with a restrained teal accent, flat crisp geometric design. A compact rounded grid of three panels with a distinct nested progression, one small teal completion element, subtly suggesting a D through the outer silhouette. Clear at 32 pixels, generous negative space and safe margins, centered. Truly transparent background. No gradients, shadows, text, mockup, watermark, existing brand references, or sheet of alternatives.
```
