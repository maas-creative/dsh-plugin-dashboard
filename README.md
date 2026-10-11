<p align="center">
  <img src="docs/assets/logo.png" alt="Dashboard logo" width="112" height="112">
</p>

# Dashboard

プロジェクトの成果物、内部タスク、締切、提出記録を俯瞰し、エージェントの作業と結び付けるローカルアプリケーションです。

![Dashboardの全体の進捗と階層プロジェクト](docs/assets/overview.png)

*公開用サンプルデータで撮影した実画面です。個人の履歴や認証情報は含みません。*

<details>
<summary>今日のタスクとスマートフォン幅の表示を見る</summary>

![今日のタスク、出力、依存関係、次の行動](docs/assets/today-tasks.png)

<img src="docs/assets/mobile.png" alt="スマートフォン幅での全体の進捗表示" width="300">

</details>

## Initial release scope

This is an early release for macOS arm64, Node.js 24+, and DeepSeek Harness 0.2.0-rc.2. Current regression tests pass; sustained high-load operation and other operating systems are not certified. Authentication, paid model accounts and macOS permissions are configured by each user. No personal sessions or credentials are shipped.

Clone this repository and install its pinned dependencies:

```sh
git clone https://github.com/maas-creative/dsh-plugin-dashboard.git
cd dsh-plugin-dashboard
npm ci
npm test
```


Dashboard is an independent local business ledger and browser UI for projects, tasks, deadlines, submissions and verified artifacts. It provides a read-only DSH plugin. Scrum is an optional, separately installed execution plugin; Dashboard does not bundle Scrum.

MaaS Creative's original source is licensed under **AGPL-3.0-only**. Third-party components retain their licenses; see [LICENSE](LICENSE), [NOTICE](NOTICE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The source provenance checks are recorded in [the publication audit](docs/publication-audit.md).

## Requirements and local installation

Node.js 24 or newer and npm are required. The standalone ledger UI runs on loopback. macOS provides the bundled native notification helper; other platforms can use the ledger without enabling Mac notifications. AI features require separately configured provider credentials and network access. No personal database or credentials are included.

```sh
npm ci
DASHBOARD_DATA="$HOME/.local/share/maas-dashboard" PORT=4318 npm start
```

Open the loopback URL printed by the process. Local setup uses the application's local authentication flow. Keep the data directory private; it contains the SQLite ledger, local sessions and authentication material. Stop with Ctrl-C. `npm run start:standalone` is an alias for the standalone server. Choose a different PORT if 4318 is occupied. Do not expose the server directly to the Internet.

## DSH plugin

The package entry point and `dsh-plugin-dashboard/plugin` export load the Dashboard plugin. Configure `ledgerPath` with an absolute path to the ledger and `projectIds` with the authorized project IDs. Permissions default to an empty scope. Only explicitly trusted hosts should set `projectIds: "all"`. Hosts may inject `scopeForSession(sessionId)` for a narrower per-session scope.

`dashboard_read` reads overview, projects, tasks, deadlines, submissions and artifacts. Pagination returns snapshotVersion, observedAt, items and nextCursor. Restart pagination if the snapshot changes. Reading does not change business completion or submission receipts.

## Optional Scrum integration

Install the independently released [Scrum](https://github.com/maas-creative/dsh-plugin-scrum) into the same host environment, or set `DASHBOARD_SCRUM_PACKAGE_ROOT` to its extracted package root. Then run:

```sh
DASHBOARD_DATA="$HOME/.local/share/maas-dashboard" npm run start:with-scrum
```

The resident entry connects both plugins to one DSH host and requires Scrum. Its absence is an error. The standalone entry needs no Scrum installation. A custom host may inject `createExecutionBridge(runtime)` from `dsh-plugin-scrum/execution` into `createApp({scrumClient: bridge})`. Execution finishing does not itself mark a business task complete. Dashboard verifies the artifact hash and task version; submission receipts and deadlines remain separate business records. Scrum's HardTackle entry is `hdt` or `/hdt`.

## Verification and publication preparation

```sh
npm test
npm pack --dry-run
npm run publication:source -- /absolute/path/to/new-public-source
```

The source preparation command exports an allowlisted fresh tree, without local Git history, historical OMO port scripts, private work, reports, databases, credentials or caches. Review its manifest before initializing a new public repository. It never pushes or publishes. Do not publish this entire development folder with `git add .`; use the prepared tree and resolve all audit blockers first.

Modification and network use of modified versions are governed by the AGPL license. Include the corresponding source and third-party notices when distributing. This technical audit is not a legal guarantee.

## Antigravity OAuth configuration

Bundled Google OAuth client identifiers and secrets are not distributed. Antigravity OAuth requires your own `ANTIGRAVITY_CLIENT_ID` and `ANTIGRAVITY_CLIENT_SECRET` in the process environment. Configure your approved OAuth application with the callback URI documented by the adapter (`http://localhost:51121/oauth-callback`). A missing configuration fails before authentication requests. Provider access and Google approval are not implied by this release. OpenAI and other configured providers remain available independently.
