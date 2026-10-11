# Digital Agency Design System HTML examples

Adapted palette, focus styles, button sizing and dense selectable table from:
https://github.com/digital-go-jp/design-system-example-components-html

Commit: af8b6656c8d864a22ef444d088e5568f3416f6aa

Sources: src/global.css, src/components/button/button.css, src/components/table/table.css and selectable-table.html.
This application is independently designed; this is not a Digital Agency product or a claim of full DADS conformance.

MIT License

Copyright (c) 2025 デジタル庁

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


# Marked 18.0.11

Browser Markdown parser already supplied by the Pi dependency tree, vendored as marked.umd.js. MIT license: marked-LICENSE.md. https://github.com/markedjs/marked

# DeepSeek Harness interaction reference

Conversation order, separate work details, centered reading column, bottom composer and scroll-follow behavior were informed by shiguredo/deepseek-harness (ff419b1091110c6514db23273f4ef4f91b7ce627). No DSH implementation code was copied.
https://github.com/shiguredo/deepseek-harness

# Other bundled runtime components

The package includes the following components under their preserved MIT licenses:

- pi-agent-orchestrator worktree implementation: `vendor/orchestrator-worktree.mjs`; license in `vendor/LICENSE.orchestrator`.
- Orca attempt projection, repository https://github.com/stablyai/orca, commit `444f1952c771e08134d490145ca6c756487ad163`: source hashes in `vendor/orca/provenance.json`; license in `vendor/orca/LICENSE`.
- oh-my-dsh 0.1.7: `vendor/oh-my-dsh/LICENSE`; usage adapter modified for DSH rc.2, editor unchanged.
- oh-my-deepseek-harness 2.0.1, commit `1d555dbd5e821a97ccf92bfa0a5f235aadf73958`: license and upstream notices in its vendor directory. Its own notices distinguish workflow inspiration from copied implementation.
- @kvidzibo/pi-web-access 0.1.1 bundled and adapted for DSH: `vendor/pi-web-access.LICENSE`.
- dsh-antigravity-auth commit `4a4ccd36958581bec497e30e008c50f155e24bea`, bundled with @cortexkit/antigravity-auth-core 2.2.0: `vendor/antigravity.LICENSE`.

Registry dependencies are separate packages installed through npm, not relicensed by Dashboard. Exact versions, URLs and integrity hashes are recorded in package-lock.json. Their license files remain in installed node_modules. No OMO/Sustainable Use License implementation is intended in the Dashboard public package; the publication audit records the source-boundary verification and its limits.

Orca projection is shipped as plain JavaScript for npm-installed Node compatibility. Its original MIT TypeScript source is retained alongside the generated runtime, with `vendor/orca/rebuild.mjs` checking the native Node 24.19.0 transformation.
