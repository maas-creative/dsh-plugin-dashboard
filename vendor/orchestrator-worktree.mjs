// Derived from @groeponline/pi-agent-orchestrator 0.19.2, commit 7208bdb089f15c7d371407531d53394fb2a61f6a. MIT; see LICENSE.orchestrator. Only createWorktree is bundled; no cleanup/auto-commit code.

// work/oss-research/pi-agent-orchestrator/src/worktree.ts
import { execFile as execFileCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFileCb);
function sanitizeAgentId(agentId) {
  if (typeof agentId !== "string" || agentId === "") return "unknown";
  const cleaned = agentId.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/[-_]{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  return cleaned.slice(0, 64).replace(/[-_]+$/g, "") || "unknown";
}
async function createWorktree(cwd, agentId) {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, timeout: 5e3 });
    await execFileAsync("git", ["rev-parse", "HEAD"], { cwd, timeout: 5e3 });
  } catch {
    return void 0;
  }
  const safeId = sanitizeAgentId(agentId);
  const branch = `pi-agent-${safeId}`;
  const suffix = randomUUID().slice(0, 8);
  const worktreePath = join(tmpdir(), `pi-agent-${safeId}-${suffix}`);
  try {
    await execFileAsync("git", ["worktree", "add", "--detach", worktreePath, "HEAD"], {
      cwd,
      timeout: 3e4
    });
    return { path: worktreePath, branch };
  } catch {
    return void 0;
  }
}
export {
  createWorktree
};
