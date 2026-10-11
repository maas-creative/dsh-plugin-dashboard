# Project Dashboard：接続・実行のリファレンス

利用者向けの導入と操作は[README](../README.md)を参照してください。以下はDSHホストへの組み込みと追加認証の仕様です。

## DSH plugin

The package entry point and `dsh-plugin-dashboard/plugin` export load the Dashboard plugin. Configure `ledgerPath` with an absolute path to the ledger and `projectIds` with the authorized project IDs. Permissions default to an empty scope. Only explicitly trusted hosts should set `projectIds: "all"`. Hosts may inject `scopeForSession(sessionId)` for a narrower per-session scope.

`dashboard_read` reads overview, projects, tasks, deadlines, submissions and artifacts. Pagination returns snapshotVersion, observedAt, items and nextCursor. Restart pagination if the snapshot changes. Reading does not change business completion or submission receipts.

## Optional Scrum integration

Install the independently released [Scrum](https://github.com/maas-creative/dsh-plugin-scrum) into the same host environment, or set `DASHBOARD_SCRUM_PACKAGE_ROOT` to its extracted package root. Then run:

```sh
DASHBOARD_DATA="$HOME/.local/share/maas-dashboard" npm run start:with-scrum
```

The resident entry connects both plugins to one DSH host and requires Scrum. Its absence is an error. The standalone entry needs no Scrum installation. A custom host may inject `createExecutionBridge(runtime)` from `dsh-plugin-scrum/execution` into `createApp({scrumClient: bridge})`. Execution finishing does not itself mark a business task complete. Dashboard verifies the artifact hash and task version; submission receipts and deadlines remain separate business records. Scrum's HardTackle entry is `hdt` or `/hdt`.

## Antigravity OAuth configuration

Bundled Google OAuth client identifiers and secrets are not distributed. Antigravity OAuth requires your own `ANTIGRAVITY_CLIENT_ID` and `ANTIGRAVITY_CLIENT_SECRET` in the process environment. Configure your approved OAuth application with the callback URI documented by the adapter (`http://localhost:51121/oauth-callback`). A missing configuration fails before authentication requests. Provider access and Google approval are not implied by this release. OpenAI and other configured providers remain available independently.
