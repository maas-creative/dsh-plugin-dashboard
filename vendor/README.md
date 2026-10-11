# Vendored extensions

- oh-my-dsh: npm 0.1.7, MIT. Only usage.mjs and editor.mjs are included. Usage is adapted to read durable events through DSH rc.2 public sessionPersistence API; editor is unchanged.
- oh-my-deepseek-harness: commit 1d555dbd5e821a97ccf92bfa0a5f235aadf73958 (2.0.1). Skills, roles and registration code; licenses and notices preserved.
- pi-web-access: @kvidzibo/pi-web-access 0.1.1, bundled with esbuild for DSH adaptation. Original license preserved.

DSH dependencies pinned to 0.2.0-rc.2. Before upgrading, verify authentication, durable resume, skills, hash_edit, usage and parent/worker/artifact review/task completion. Native team orchestration and automatic advisor calls are not enabled; the dashboard coordinator owns delegation.

- dsh-antigravity-auth: rc.2-compatible Git commit 4a4ccd36958581bec497e30e008c50f155e24bea, Host source bundled using esbuild with @cortexkit/antigravity-auth-core 2.2.0. MIT license preserved. Authentication stays in plugin-owned local storage.
