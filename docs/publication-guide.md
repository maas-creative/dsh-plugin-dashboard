# 公開ソースの準備

## Verification and publication preparation

```sh
npm test
npm pack --dry-run
npm run publication:source -- /absolute/path/to/new-public-source
```

The source preparation command exports an allowlisted fresh tree, without local Git history, historical OMO port scripts, private work, reports, databases, credentials or caches. Review its manifest before initializing a new public repository. It never pushes or publishes. Do not publish this entire development folder with `git add .`; use the prepared tree and resolve all audit blockers first.

Modification and network use of modified versions are governed by the AGPL license. Include the corresponding source and third-party notices when distributing. This technical audit is not a legal guarantee.


監査記録は[publication-audit.md](publication-audit.md)に保存します。利用者向けREADMEには試験件数や開発経緯を掲載しません。
