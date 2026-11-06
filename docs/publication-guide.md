# 公開ソースの準備

## Verification and publication preparation

```sh
npm test
npm pack --dry-run
npm run publication:source -- /absolute/path/to/new-public-source
```

The source preparation command exports an allowlisted fresh tree, without local Git history, historical OMO port scripts, private work, reports, databases, credentials or caches. Review its manifest before initializing a new public repository. It never pushes or publishes. Do not publish this entire development folder with `git add .`; use the prepared tree and resolve all audit blockers first.

Modification and network use of modified versions are governed by the AGPL license. Include the corresponding source and third-party notices when distributing. This technical audit is not a legal guarantee.


製品名はProject Dashboard、パッケージ名はdsh-plugin-dashboardを維持します。利用者向けREADMEには試験件数・内部経緯・私的履歴を載せません。

公開用画像は架空データで実画面を撮影します。`npm run demo:readme`で再撮影でき、画像の由来はassets-manifest.jsonに保持します。公開前にLICENSE・NOTICE・THIRD_PARTY_NOTICES.mdと公式の依存ソースを照合します。古い監査文書だけで公開可能と判断しません。
