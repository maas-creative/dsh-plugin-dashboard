# Dashboard publication candidate audit

Audit date: 2026-10-11. Scope: the Dashboard package allowlist and freshly exported public source, not the historical development folder or Git history. No publication or resident deployment was performed.

## Licensing and boundary

Original MaaS Creative source has AGPL-3.0-only package metadata, full LICENSE and NOTICE. MIT third-party licenses are retained. Scrum stays a separate optional package. Historical scripts that port OMO implementation are not selected for the npm package or public source. Private work, reports, SQLite files, credentials, caches and local project metadata are excluded by allowlisted export and .gitignore. A new public repository must be initialized from the export; existing development history is not an approved publication boundary.

The 2026-10-10 license review is historical. Its Scrum SUL status does not describe the separately replaced Scrum 0.7.0. It was not used as proof that Dashboard was clean.

## Resolved source audit findings

- app.js contained an explicit pinned OMO question-label-truncator provenance comment. The UI owner independently replaced the presentation implementation. Tests preserve complete answer identity, accessible labels, HTML escaping and Unicode boundaries.
- vendor/antigravity.mjs: retrieved its matching original MIT DSH auth TypeScript source and configuration, included MIT core preferred source, and ran the pinned build recipe. Exact rebuilt SHA-256: `a83acdd799cb1a46034ba131a1ef5686ed1cbe215d209f1a910d84a26c2cc79f`.
- vendor/pi-web-access.mjs: byte-identical to the independently audited Scrum adapter. Included its MIT preferred TypeScript source and provenance, and ran its build recipe. Exact rebuilt SHA-256: `32bd130add9bdaacf2e2c41b69062a7b813835c194a8e5c8046c49812f15c45a`.
- vendor/oh-my-deepseek-harness is supplied under MIT with upstream notices. prometheus-strict explicitly describes inspiration from OMO and independent DSH reimplementation. Root screened the 253-file export against pinned OMO commit 59d23b5c1ddc2a02210ede4cb485f88996fd02bd, using normalized 48-word windows with stride 8. The 14 matches were 13 MIT license/notices and generated registry lock records; no implementation or prose match was found at that threshold. This is mechanical screening, not a clean-room or legal guarantee. The final frozen export is screened separately with the same method; classifications and archive hashes are recorded outside the package.

UI and actual installed runtime smoke verification passed. Final export screening results are recorded in the release proof. Copying license text alone does not resolve source provenance. Package dry-run, clean installation and runtime smoke evidence should be captured after final source freeze. npm registry dependencies are pinned by lockfile and retain their own licenses; third-party license files must remain available to recipients.

## Reproduction

Run `npm run publication:source -- /new/absolute/path` to generate a fresh export with a SHA-256 manifest. Run npm ci and npm pack in that tree, then install the tarball into a separate temporary directory and import the Dashboard plugin without Scrum. Run a loopback standalone smoke using a fresh temporary data directory. Use synthetic test data only. The export command never publishes.

## Executed checks before final freeze

All three bundled source rebuilds (auth, web access, worktree) reproduce runtime bytes exactly. Web tools tests pass 2/2. A fresh allowlisted export accepted npm ci --ignore-scripts and installed 653 dependencies without changing the developer installation. Final UI and overlap audit results must be added by the final publication owner after freeze.

The initial actual npm-installed standalone smoke exposed Node's prohibition on TypeScript stripping inside node_modules: runtime.mjs imported Orca .ts directly. The preferred MIT TypeScript source is retained; a plain-JavaScript runtime and exact native Node 24.19.0 strip verification recipe were added. runtime.mjs now imports the generated .mjs; the actual installed-package smoke passed. This finding would not have appeared from a checkout-only test.

After the runtime import fix, a real tarball was installed into a separate node_modules tree with lifecycle scripts disabled. On Node 24.19.0, `import('dsh-plugin-dashboard')`, `import('dsh-plugin-dashboard/server')`, creation with a fresh synthetic data directory, HTTP GET `/` status 200 and clean shutdown passed without Scrum installed. The earlier TypeScript-in-node_modules failure is resolved. This smoke verifies loading and standalone serving, not live credentialed AI integrations.

## Final functional verification

The updated Dashboard standard suite passed 95 tests with zero failures/skips. The resident restart integration test passed separately. Arc-inspired desktop (1440px), mobile (390px) and portfolio screens were inspected; worker Stop is at the top of its card. Synthetic browser tests cover keyboard send, draft clearing, reduced motion, focus, existing project/task/deadline/submission actions and horizontal overflow. Scrum connection is actual; HardTackle execution is explicitly unconfirmed because the bridge has no public status operation. No new AI execution capability is implied by these visual changes.

Only app.js, style.css and index.html are deployed to the existing resident UI with recoverable backups and served-byte checks. Deployment does not restart agents or migrate the business database. This document records the pre-publication verification. GitHub publication is tracked by the repository and its initial release; npm registry publication is not performed.

## Public checkout verification

The freshly exported checkout passes all 95 standard tests and the separate real resident restart test. Test fixture and record-integrity helper dependencies are included. MCP client 2.3.1 and fflate 0.8.3 replace vulnerable dependencies; the OAuth provider binds stored and configured credentials to their authorization issuer. The final dependency audit reports zero known vulnerabilities. Public package metadata points to the MaaS Creative repositories.

The public Antigravity adapter no longer embeds OAuth application identifiers or secrets. Its included MIT preferred sources are explicitly adapted to environment configuration, the resulting bundle reproduces exactly, and missing/present configuration cases are covered by two additional tests. Antigravity login requires user-supplied application configuration; other provider routes are independent.
