var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// work/dsh-runtime/dsh-antigravity-auth/src/safe-text.ts
function isBoundedSafeText(value, maxLength, minLength = 1) {
  if (typeof value !== "string" || !Number.isSafeInteger(maxLength) || !Number.isSafeInteger(minLength) || minLength < 0 || maxLength < minLength || value.length < minLength || value.length > maxLength) return false;
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 32 || codePoint === 127) return false;
  }
  return true;
}
var init_safe_text = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/safe-text.ts"() {
    "use strict";
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/auth-store.ts
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, lstat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
function defaultAuthStorePath(env = process.env, home = env.HOME, platform = process.platform) {
  if (platform === "win32") {
    const windowsDataHome = env.LOCALAPPDATA ?? env.APPDATA;
    const base2 = typeof windowsDataHome === "string" && windowsDataHome.length > 0 ? windowsDataHome : env.USERPROFILE ?? home ?? "";
    return join(base2, "dsh-antigravity-auth", "auth.json");
  }
  const dataHome = env.XDG_DATA_HOME;
  const base = typeof dataHome === "string" && dataHome.length > 0 ? dataHome : join(home ?? "", ".local", "share");
  return join(base, "dsh-antigravity-auth", "auth.json");
}
function createAuthStore(path, options = {}) {
  const now = options.now ?? (() => Date.now());
  const platform = options.platform ?? process.platform;
  const enqueue = createMutationQueue();
  const read = () => readAuthRecordForPlatform(path, platform);
  return {
    read,
    commit: (draft) => enqueue(() => withStoreLock(path, async () => {
      const current = await read();
      const record = makeRecord(draft, (current?.revision ?? 0) + 1, now());
      await writeAuthRecord(path, record);
      return record;
    })),
    compareAndCommit: (expectedRevision, draft, expectedLineage) => enqueue(() => withStoreLock(path, async () => {
      const current = await read();
      if ((current?.revision ?? 0) !== expectedRevision) return void 0;
      const lineage = expectedLineage ?? draft.lineage;
      if (lineage === void 0 ? current?.lineage !== void 0 : current?.lineage !== lineage) return void 0;
      const record = makeRecord(draft, expectedRevision + 1, now());
      await writeAuthRecord(path, record);
      return record;
    })),
    clearIfCurrent: (expectedRevision, expectedLineage) => enqueue(() => withStoreLock(path, async () => {
      const current = await read();
      if ((current?.revision ?? 0) !== expectedRevision) return false;
      if (expectedLineage === void 0 ? current?.lineage !== void 0 : current?.lineage !== expectedLineage) return false;
      try {
        await unlink(path);
      } catch (error) {
        if (!isNotFound(error)) throw storeIoError();
      }
      await syncDirectory(dirname(path));
      return true;
    })),
    clear: () => enqueue(() => withStoreLock(path, async () => {
      try {
        await unlink(path);
      } catch (error) {
        if (!isNotFound(error)) throw storeIoError();
      }
      await syncDirectory(dirname(path));
    }))
  };
}
function createMutationQueue() {
  let mutation = Promise.resolve();
  return function enqueue(operation) {
    const next = mutation.then(operation, operation);
    mutation = next.then(() => {
    }, () => {
    });
    return next;
  };
}
async function withStoreLock(path, operation) {
  const parent = dirname(path);
  await prepareParent(parent);
  const lockPath = join(parent, AUTH_STORE_LOCK_NAME);
  const deadline = Date.now() + AUTH_STORE_LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 384);
      try {
        await handle.writeFile(`${process.pid}
`, "utf8");
        await handle.sync();
        return await operation();
      } finally {
        await handle.close().catch(() => {
        });
        await unlink(lockPath).catch(() => {
        });
      }
    } catch (error) {
      if (error instanceof AuthStoreError) throw error;
      if (!isAlreadyExists(error)) throw storeIoError();
      await removeStaleLock(lockPath);
      if (Date.now() >= deadline) throw conflictError();
      await new Promise((resolve2) => setTimeout(resolve2, AUTH_STORE_LOCK_RETRY_MS));
    }
  }
}
async function prepareParent(parent) {
  try {
    const parentInfo = await lstat(parent);
    if (parentInfo.isSymbolicLink() || !parentInfo.isDirectory()) throw unsafePermissionsError();
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  try {
    await mkdir(parent, { recursive: true, mode: 448 });
    await chmod(parent, 448);
  } catch (error) {
    if (error instanceof AuthStoreError) throw error;
    throw storeIoError();
  }
}
async function syncDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close().catch(() => {
    });
  }
}
async function removeStaleLock(path) {
  try {
    const info = await lstat(path);
    if (Date.now() - info.mtimeMs > AUTH_STORE_LOCK_STALE_MS) await unlink(path).catch(() => {
    });
  } catch (error) {
    if (!isNotFound(error)) return;
  }
}
async function readAuthRecordForPlatform(path, platform) {
  let fileInfo;
  try {
    fileInfo = await lstat(path);
  } catch (error) {
    if (isNotFound(error)) return void 0;
    throw storeIoError();
  }
  if (fileInfo.isSymbolicLink() || !fileInfo.isFile()) throw unsafePermissionsError();
  await assertOwnerOnly(path, platform);
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw storeIoError();
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw corruptError();
  }
  return parseRecord(parsed);
}
async function writeAuthRecord(path, record) {
  const validated = parseRecord(record);
  const parent = dirname(path);
  try {
    await prepareParent(parent);
    const temporary = join(parent, `.${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, "wx", 384);
      try {
        await handle.writeFile(`${JSON.stringify(validated)}
`, "utf8");
        await handle.sync();
      } finally {
        await handle.close().catch(() => {
        });
      }
      await chmod(temporary, 384);
      await rename(temporary, path);
      await chmod(path, 384);
      await syncDirectory(parent);
    } catch {
      await unlink(temporary).catch(() => {
      });
      throw storeIoError();
    }
  } catch (error) {
    if (error instanceof AuthStoreError) throw error;
    throw storeIoError();
  }
}
function makeRecord(draft, revision, now) {
  if (!isRecord(draft) || !isBoundedSafeText(draft.refreshToken, 4096) || !isBoundedSafeText(draft.projectId, 4096) || draft.lineage !== void 0 && !isBoundedSafeText(draft.lineage, 4096) || !Number.isSafeInteger(revision) || revision < 1 || !Number.isFinite(now)) {
    throw corruptError();
  }
  const record = {
    version: AUTH_RECORD_VERSION,
    refreshToken: draft.refreshToken,
    projectId: draft.projectId,
    revision,
    updatedAt: new Date(now).toISOString(),
    lineage: draft.lineage ?? randomUUID(),
    ...draft.email === void 0 ? {} : { email: validateEmail(draft.email) }
  };
  return record;
}
function parseRecord(value) {
  if (!isRecord(value)) throw corruptError();
  if (value.version !== AUTH_RECORD_VERSION) throw unsupportedVersionError();
  const keys = Object.keys(value).sort();
  const required = ["projectId", "refreshToken", "revision", "updatedAt", "version"];
  const withEmail = [...required, "email"].sort();
  const withLineage = [...required, "lineage"].sort();
  const withEmailAndLineage = [...required, "email", "lineage"].sort();
  const expected = keys.length === required.length ? required : keys.includes("lineage") ? keys.includes("email") ? withEmailAndLineage : withLineage : withEmail;
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) throw corruptError();
  const refreshToken = value.refreshToken;
  const projectId = value.projectId;
  const revision = value.revision;
  const updatedAt = value.updatedAt;
  const lineage = value.lineage;
  if (!isBoundedSafeText(refreshToken, 4096) || !isBoundedSafeText(projectId, 4096) || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1 || typeof updatedAt !== "string" || !Number.isFinite(Date.parse(updatedAt)) || lineage !== void 0 && !isBoundedSafeText(lineage, 4096)) {
    throw corruptError();
  }
  const email = value.email;
  if (email !== void 0 && !isBoundedSafeText(email, 4096)) throw corruptError();
  return {
    version: AUTH_RECORD_VERSION,
    refreshToken,
    projectId,
    revision,
    updatedAt,
    ...email === void 0 ? {} : { email },
    ...lineage === void 0 ? {} : { lineage }
  };
}
async function assertOwnerOnly(path, platform) {
  try {
    const file = await lstat(path);
    const parent = await lstat(dirname(path));
    const unsafePosixMode = platform !== "win32" && ((file.mode & 63) !== 0 || (parent.mode & 63) !== 0);
    if (file.isSymbolicLink() || parent.isSymbolicLink() || !parent.isDirectory() || unsafePosixMode) {
      throw unsafePermissionsError();
    }
  } catch (error) {
    if (error instanceof AuthStoreError) throw error;
    throw storeIoError();
  }
}
function validateEmail(value) {
  if (!isBoundedSafeText(value, 4096) || !value.includes("@")) throw corruptError();
  return value;
}
function corruptError() {
  return new AuthStoreError("AUTH_STORE_CORRUPT", "The Antigravity auth store is not valid");
}
function unsupportedVersionError() {
  return new AuthStoreError("AUTH_STORE_UNSUPPORTED_VERSION", "The Antigravity auth store version is unsupported");
}
function unsafePermissionsError() {
  return new AuthStoreError("AUTH_STORE_UNSAFE_PERMISSIONS", "The Antigravity auth store permissions are unsafe");
}
function storeIoError() {
  return new AuthStoreError("AUTH_STORE_IO", "The Antigravity auth store could not be accessed");
}
function conflictError() {
  return new AuthStoreError("AUTH_STORE_CONFLICT", "The Antigravity auth store is busy");
}
function isAlreadyExists(error) {
  return error?.code === "EEXIST";
}
function isNotFound(error) {
  return error?.code === "ENOENT";
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var AUTH_RECORD_VERSION, AUTH_STORE_LOCK_NAME, AUTH_STORE_LOCK_TIMEOUT_MS, AUTH_STORE_LOCK_STALE_MS, AUTH_STORE_LOCK_RETRY_MS, AuthStoreError;
var init_auth_store = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/auth-store.ts"() {
    "use strict";
    init_safe_text();
    AUTH_RECORD_VERSION = 1;
    AUTH_STORE_LOCK_NAME = ".auth.lock";
    AUTH_STORE_LOCK_TIMEOUT_MS = 1e4;
    AUTH_STORE_LOCK_STALE_MS = 3e4;
    AUTH_STORE_LOCK_RETRY_MS = 10;
    AuthStoreError = class extends Error {
      code;
      constructor(code, message) {
        super(message);
        this.name = "AuthStoreError";
        this.code = code;
      }
    };
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/atomic-write.js
var init_atomic_write = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/atomic-write.js"() {
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/file-lock.js
var init_file_lock = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/file-lock.js"() {
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/logger.js
function isTruthyFlag(flag) {
  return flag === "1" || flag?.toLowerCase() === "true";
}
function isConsoleLogEnabled() {
  return isTruthyFlag(process.env[ENV_CONSOLE_LOG]);
}
function writeConsoleLog(level, ...args) {
  switch (level) {
    case "debug":
      console.debug(...args);
      break;
    case "info":
      console.info(...args);
      break;
    case "warn":
      console.warn(...args);
      break;
    case "error":
      console.error(...args);
      break;
  }
}
function createLogger(module) {
  const service = `antigravity.${module}`;
  const log5 = (level, message, extra) => {
    if (_sink) {
      try {
        _sink({ service, level, message, extra });
      } catch {
      }
    }
    if (isConsoleLogEnabled()) {
      const prefix = `[${service}]`;
      const args = extra ? [prefix, message, extra] : [prefix, message];
      writeConsoleLog(level, ...args);
    }
  };
  return {
    debug: (message, extra) => log5("debug", message, extra),
    info: (message, extra) => log5("info", message, extra),
    warn: (message, extra) => log5("warn", message, extra),
    error: (message, extra) => log5("error", message, extra)
  };
}
var ENV_CONSOLE_LOG, _sink;
var init_logger = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/logger.js"() {
    ENV_CONSOLE_LOG = "ANTIGRAVITY_CORE_CONSOLE_LOG";
    _sink = null;
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/account-storage.js
var log;
var init_account_storage = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/account-storage.js"() {
    init_atomic_write();
    init_file_lock();
    init_logger();
    log = createLogger("account-storage");
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/auth.js
var ACCESS_TOKEN_EXPIRY_BUFFER_MS;
var init_auth = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/auth.js"() {
    ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60 * 1e3;
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/fingerprint.js
function normalizeHarnessPlatform(platform = process.platform) {
  return platform === "win32" ? "windows" : platform || "unknown";
}
function normalizeHarnessArch(arch = process.arch) {
  switch (arch) {
    case "x64":
      return "amd64";
    case "ia32":
      return "386";
    default:
      return arch || "unknown";
  }
}
function buildAntigravityHarnessUserAgent(version = AGY_CLI_VERSION, platform = process.platform, arch = process.arch, authMethod = "consumer") {
  const osType = normalizeHarnessPlatform(platform);
  const normalizedArch = normalizeHarnessArch(arch);
  const changeList = version === AGY_CLI_VERSION ? `; cl=${AGY_CLI_CHANGE_LIST}` : "";
  return `antigravity/cli/${version} (aidev_client; os_type=${osType}; arch=${normalizedArch}${changeList}; auth_method=${authMethod})`;
}
function buildAntigravityLoadCodeAssistMetadata() {
  return { ideType: "ANTIGRAVITY" };
}
var AGY_CLI_VERSION, AGY_CLI_CHANGE_LIST;
var init_fingerprint = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/fingerprint.js"() {
    AGY_CLI_VERSION = "1.1.24";
    AGY_CLI_CHANGE_LIST = "974782877";
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/model-registry.js
function defineModel(id, model) {
  return {
    id,
    release_date: MODEL_RELEASE_DATE,
    attachment: model.modalities.input.some((modality) => modality !== "text"),
    temperature: true,
    tool_call: true,
    cost: { ...DEFAULT_COST },
    options: { ...DEFAULT_OPTIONS },
    ...model
  };
}
function pickModelDefinitions(ids) {
  return Object.fromEntries(ids.map((id) => [id, ALL_MODEL_DEFINITIONS[id]]));
}
function getPublicModelDefinitions() {
  return OPENCODE_MODEL_DEFINITIONS;
}
function getResolverAliasMap() {
  return RESOLVER_ALIASES;
}
function getGemini35FlashAntigravityModel(tier) {
  if (!tier) {
    return GEMINI_35_FLASH_ROUTES.antigravity.defaultModel;
  }
  return GEMINI_35_FLASH_ROUTES.antigravity.byTier[tier] ?? GEMINI_35_FLASH_ROUTES.antigravity.defaultModel;
}
function getTieredAntigravityModel(routes, tier) {
  return tier ? routes.byTier[tier] ?? routes.defaultModel : routes.defaultModel;
}
function getGemini36FlashAntigravityModel(tier) {
  return getTieredAntigravityModel(GEMINI_36_FLASH_ROUTES, tier);
}
function getGemini37FlashAntigravityModel(tier) {
  return getTieredAntigravityModel(GEMINI_37_FLASH_ROUTES, tier);
}
function getGemini38FlashAntigravityModel(tier) {
  return getTieredAntigravityModel(GEMINI_38_FLASH_ROUTES, tier);
}
var DEFAULT_MODALITIES, MODEL_RELEASE_DATE, DEFAULT_COST, DEFAULT_OPTIONS, ALL_MODEL_DEFINITIONS, RESOLVER_ALIASES, GEMINI_35_FLASH_ROUTES, GEMINI_36_FLASH_ROUTES, GEMINI_37_FLASH_ROUTES, GEMINI_38_FLASH_ROUTES, ANTIGRAVITY_OPENCODE_MODEL_IDS, OPENCODE_MODEL_DEFINITIONS;
var init_model_registry = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/model-registry.js"() {
    DEFAULT_MODALITIES = {
      input: ["text", "image", "pdf"],
      output: ["text"]
    };
    MODEL_RELEASE_DATE = "";
    DEFAULT_COST = { input: 0, output: 0 };
    DEFAULT_OPTIONS = {};
    ALL_MODEL_DEFINITIONS = {
      "antigravity-gemini-3.1-pro": defineModel("antigravity-gemini-3.1-pro", {
        name: "Gemini 3.1 Pro (Antigravity)",
        reasoning: true,
        limit: { context: 1048576, output: 65535 },
        modalities: DEFAULT_MODALITIES,
        variants: {
          low: { thinkingLevel: "low" },
          high: { thinkingLevel: "high" }
        }
      }),
      "antigravity-gemini-3.8-flash": defineModel("antigravity-gemini-3.8-flash", {
        name: "Gemini 3.8 Flash (Antigravity)",
        reasoning: true,
        limit: { context: 1048576, output: 65536 },
        modalities: DEFAULT_MODALITIES,
        variants: {
          low: { thinkingLevel: "low" },
          high: { thinkingLevel: "high" }
        }
      }),
      "antigravity-gemini-3.7-flash": defineModel("antigravity-gemini-3.7-flash", {
        name: "Gemini 3.7 Flash (Antigravity)",
        reasoning: true,
        limit: { context: 1048576, output: 65536 },
        modalities: DEFAULT_MODALITIES,
        variants: {
          low: { thinkingLevel: "low" },
          high: { thinkingLevel: "high" }
        }
      }),
      "antigravity-gemini-3.6-flash": defineModel("antigravity-gemini-3.6-flash", {
        name: "Gemini 3.6 Flash (Antigravity)",
        reasoning: true,
        limit: { context: 1048576, output: 65536 },
        modalities: DEFAULT_MODALITIES,
        variants: {
          low: { thinkingLevel: "low" },
          high: { thinkingLevel: "high" }
        }
      }),
      "antigravity-gemini-3.5-flash": defineModel("antigravity-gemini-3.5-flash", {
        name: "Gemini 3.5 Flash (Antigravity)",
        reasoning: true,
        limit: { context: 1048576, output: 65536 },
        modalities: DEFAULT_MODALITIES,
        variants: {
          low: { thinkingLevel: "low" },
          high: { thinkingLevel: "high" }
        }
      }),
      "antigravity-claude-sonnet-4-6-thinking": defineModel("antigravity-claude-sonnet-4-6-thinking", {
        name: "Claude Sonnet 4.6 Thinking (Antigravity)",
        reasoning: true,
        limit: { context: 25e4, output: 64e3 },
        modalities: DEFAULT_MODALITIES,
        variants: {
          low: { disabled: true },
          high: { disabled: true }
        }
      }),
      "antigravity-claude-opus-4-6-thinking": defineModel("antigravity-claude-opus-4-6-thinking", {
        name: "Claude Opus 4.6 Thinking (Antigravity)",
        reasoning: true,
        limit: { context: 25e4, output: 64e3 },
        modalities: DEFAULT_MODALITIES,
        variants: {
          low: { disabled: true },
          high: { disabled: true }
        }
      }),
      "antigravity-gemini-3.1-flash-image": defineModel("antigravity-gemini-3.1-flash-image", {
        name: "Gemini 3.1 Flash Image (Antigravity)",
        reasoning: false,
        limit: { context: 66e3, output: 33e3 },
        modalities: {
          input: ["text", "image"],
          output: ["text", "image"]
        }
      }),
      "antigravity-gpt-oss-120b-medium": defineModel("antigravity-gpt-oss-120b-medium", {
        name: "GPT-OSS 120B Medium (Antigravity)",
        reasoning: true,
        limit: { context: 131072, output: 32768 },
        modalities: DEFAULT_MODALITIES
      }),
      "gemini-2.5-flash": defineModel("gemini-2.5-flash", {
        name: "Gemini 2.5 Flash (Gemini CLI)",
        reasoning: true,
        limit: { context: 1048576, output: 65536 },
        modalities: DEFAULT_MODALITIES
      }),
      "gemini-2.5-pro": defineModel("gemini-2.5-pro", {
        name: "Gemini 2.5 Pro (Gemini CLI)",
        reasoning: true,
        limit: { context: 1048576, output: 65536 },
        modalities: DEFAULT_MODALITIES
      }),
      "gemini-3-flash-preview": defineModel("gemini-3-flash-preview", {
        name: "Gemini 3 Flash Preview (Gemini CLI)",
        reasoning: true,
        limit: { context: 1048576, output: 65536 },
        modalities: DEFAULT_MODALITIES
      }),
      "gemini-3.1-pro-preview": defineModel("gemini-3.1-pro-preview", {
        name: "Gemini 3.1 Pro Preview (Gemini CLI)",
        reasoning: true,
        limit: { context: 1048576, output: 65535 },
        modalities: DEFAULT_MODALITIES
      }),
      "gemini-3.5-flash-preview": defineModel("gemini-3.5-flash-preview", {
        name: "Gemini 3.5 Flash Preview (Gemini CLI)",
        reasoning: true,
        limit: { context: 1048576, output: 65536 },
        modalities: DEFAULT_MODALITIES
      }),
      "gemini-3.1-flash-image": defineModel("gemini-3.1-flash-image", {
        name: "Gemini 3.1 Flash Image (Gemini CLI)",
        reasoning: false,
        limit: { context: 66e3, output: 33e3 },
        modalities: {
          input: ["text", "image"],
          output: ["text", "image"]
        }
      }),
      "gemini-3.1-flash-image-preview": defineModel("gemini-3.1-flash-image-preview", {
        name: "Gemini 3.1 Flash Image Preview (Gemini CLI)",
        reasoning: false,
        limit: { context: 66e3, output: 33e3 },
        modalities: {
          input: ["text", "image"],
          output: ["text", "image"]
        }
      }),
      "gemini-3.1-pro-preview-customtools": defineModel("gemini-3.1-pro-preview-customtools", {
        name: "Gemini 3.1 Pro Preview Custom Tools (Gemini CLI)",
        reasoning: true,
        limit: { context: 1048576, output: 65535 },
        modalities: DEFAULT_MODALITIES
      })
    };
    RESOLVER_ALIASES = {
      "gemini-3.1-pro-low": "gemini-3.1-pro",
      "gemini-3.1-pro-high": "gemini-3.1-pro",
      "gemini-3-flash-low": "gemini-3-flash",
      "gemini-3-flash-medium": "gemini-3-flash",
      "gemini-3-flash-high": "gemini-3-flash",
      "gemini-3.5-flash-low": "gemini-3.5-flash",
      "gemini-3.5-flash-medium": "gemini-3.5-flash",
      "gemini-3.5-flash-high": "gemini-3.5-flash",
      "gemini-3.6-flash-low": "gemini-3.6-flash",
      "gemini-3.6-flash-medium": "gemini-3.6-flash",
      "gemini-3.6-flash-high": "gemini-3.6-flash",
      "gemini-3.7-flash-low": "gemini-3.7-flash",
      "gemini-3.7-flash-medium": "gemini-3.7-flash",
      "gemini-3.7-flash-high": "gemini-3.7-flash",
      "gemini-3.8-flash-low": "gemini-3.8-flash",
      "gemini-3.8-flash-medium": "gemini-3.8-flash",
      "gemini-3.8-flash-high": "gemini-3.8-flash",
      "gemini-claude-opus-4-6-thinking-low": "claude-opus-4-6-thinking",
      "gemini-claude-opus-4-6-thinking-medium": "claude-opus-4-6-thinking",
      "gemini-claude-opus-4-6-thinking-high": "claude-opus-4-6-thinking",
      "gemini-claude-sonnet-4-6-thinking-low": "claude-sonnet-4-6",
      "gemini-claude-sonnet-4-6-thinking-medium": "claude-sonnet-4-6",
      "gemini-claude-sonnet-4-6-thinking-high": "claude-sonnet-4-6",
      "gemini-claude-sonnet-4-6": "claude-sonnet-4-6",
      "claude-sonnet-4-6-thinking": "claude-sonnet-4-6",
      "claude-sonnet-4-6-thinking-low": "claude-sonnet-4-6",
      "claude-sonnet-4-6-thinking-medium": "claude-sonnet-4-6",
      "claude-sonnet-4-6-thinking-high": "claude-sonnet-4-6",
      "gpt-oss-120b": "gpt-oss-120b-medium"
    };
    GEMINI_35_FLASH_ROUTES = {
      antigravity: {
        defaultModel: "gemini-3-flash-agent",
        byTier: {
          low: "gemini-3.5-flash-extra-low",
          medium: "gemini-3.5-flash-low",
          high: "gemini-3-flash-agent"
        }
      },
      geminiCliFallbackModel: "gemini-3-flash-preview"
    };
    GEMINI_36_FLASH_ROUTES = {
      defaultModel: "gemini-3.6-flash-medium",
      byTier: {
        low: "gemini-3.6-flash-low",
        medium: "gemini-3.6-flash-medium",
        high: "gemini-3.6-flash-high"
      }
    };
    GEMINI_37_FLASH_ROUTES = {
      defaultModel: "gemini-3.7-flash-medium",
      byTier: {
        low: "gemini-3.7-flash-low",
        medium: "gemini-3.7-flash-medium",
        high: "gemini-3.7-flash-high"
      }
    };
    GEMINI_38_FLASH_ROUTES = {
      defaultModel: "gemini-3.8-flash-medium",
      byTier: {
        low: "gemini-3.8-flash-low",
        medium: "gemini-3.8-flash-medium",
        high: "gemini-3.8-flash-high"
      }
    };
    ANTIGRAVITY_OPENCODE_MODEL_IDS = [
      "antigravity-gemini-3.8-flash",
      "antigravity-gemini-3.7-flash",
      "antigravity-gemini-3.6-flash",
      "antigravity-gemini-3.5-flash",
      "antigravity-gemini-3.1-pro",
      "antigravity-claude-sonnet-4-6-thinking",
      "antigravity-claude-opus-4-6-thinking",
      "antigravity-gemini-3.1-flash-image",
      "antigravity-gpt-oss-120b-medium"
    ];
    OPENCODE_MODEL_DEFINITIONS = pickModelDefinitions(ANTIGRAVITY_OPENCODE_MODEL_IDS);
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/quota-types.js
var init_quota_types = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/quota-types.js"() {
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/rotation.js
var init_rotation = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/rotation.js"() {
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/account-manager.js
var ACCOUNT_SESSION_STATE_TTL_MS;
var init_account_manager = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/account-manager.js"() {
    init_account_storage();
    init_auth();
    init_fingerprint();
    init_model_registry();
    init_quota_types();
    init_rotation();
    init_rotation();
    init_rotation();
    ACCOUNT_SESSION_STATE_TTL_MS = 24 * 60 * 60 * 1e3;
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/account-types.js
var init_account_types = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/account-types.js"() {
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/agy-request-metadata.js
import { Buffer as Buffer2 } from "node:buffer";
import { randomUUID as randomUUID2 } from "node:crypto";
function fnv1a64Signed(input) {
  let hash = FNV1A_64_OFFSET_BASIS;
  for (const byte of Buffer2.from(input, "utf8")) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * FNV1A_64_PRIME);
  }
  return BigInt.asIntN(64, hash).toString();
}
function createAgyRequestSessionContext(workspaceUri, ids = {}) {
  return {
    conversationId: ids.conversationId ?? randomUUID2(),
    trajectoryId: ids.trajectoryId ?? randomUUID2(),
    numericSessionId: fnv1a64Signed(workspaceUri)
  };
}
function getAgyModelEnum(model) {
  return AGY_MODEL_ENUM_BY_WIRE_MODEL[model.toLowerCase()];
}
function orderAgyRequestPayloadInPlace(payload) {
  const ordered = {};
  const remaining = new Set(Object.keys(payload));
  for (const key of AGY_REQUEST_FIELD_ORDER) {
    if (key in payload) {
      ordered[key] = payload[key];
      remaining.delete(key);
    }
  }
  for (const key of remaining) {
    ordered[key] = payload[key];
  }
  for (const key of Object.keys(payload)) {
    delete payload[key];
  }
  Object.assign(payload, ordered);
}
function countAgyRequestSteps(payload, mode = "parts") {
  const contents = payload.contents;
  if (!Array.isArray(contents))
    return 1;
  if (mode === "contents")
    return Math.max(1, contents.length);
  let partCount = 0;
  let functionResponseCount = 0;
  for (const content of contents) {
    if (!content || typeof content !== "object" || Array.isArray(content))
      continue;
    const parts = content.parts;
    if (!Array.isArray(parts))
      continue;
    partCount += parts.length;
    if (mode === "cli") {
      functionResponseCount += parts.filter((part) => {
        if (!part || typeof part !== "object" || Array.isArray(part))
          return false;
        return "functionResponse" in part;
      }).length;
    }
  }
  if (mode === "cli") {
    return Math.max(1, contents.length + functionResponseCount);
  }
  return Math.max(1, partCount);
}
function buildAgyAgentRequestMetadata(session, payload, model, timestamp = Date.now(), options = {}) {
  const lastStepIndex = countAgyRequestSteps(payload, options.stepCountMode) + (session.lastExecutionId ? 1 : 0);
  const isClaude = model.toLowerCase().startsWith("claude-");
  const isNonGemini = isClaude || model.toLowerCase().startsWith("gpt-");
  session.usedClaude = session.usedClaude === true || isClaude;
  session.usedNonGeminiModel = session.usedNonGeminiModel === true || isNonGemini;
  const modelEnum = getAgyModelEnum(model);
  const labels = {
    ...session.lastExecutionId ? { last_execution_id: session.lastExecutionId } : {},
    last_step_index: String(lastStepIndex),
    ...modelEnum ? { model_enum: modelEnum } : {},
    trajectory_id: session.trajectoryId,
    used_claude: session.usedClaude ? "true" : "false",
    used_claude_conservative: session.usedClaude ? "true" : "false",
    used_non_gemini_model: session.usedNonGeminiModel ? "true" : "false"
  };
  return {
    requestId: `agent/${session.conversationId}/${timestamp}/${session.trajectoryId}/${lastStepIndex + 1}`,
    sessionId: session.numericSessionId,
    labels,
    lastStepIndex
  };
}
var FNV1A_64_OFFSET_BASIS, FNV1A_64_PRIME, DEFAULT_SESSION_STATE_TTL_MS, DEFAULT_MAX_SESSION_STATES, AGY_REQUEST_FIELD_ORDER, AGY_MODEL_ENUM_BY_WIRE_MODEL, AgyRequestSessionStore;
var init_agy_request_metadata = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/agy-request-metadata.js"() {
    FNV1A_64_OFFSET_BASIS = 0xcbf29ce484222325n;
    FNV1A_64_PRIME = 0x100000001b3n;
    DEFAULT_SESSION_STATE_TTL_MS = 24 * 60 * 60 * 1e3;
    DEFAULT_MAX_SESSION_STATES = 256;
    AGY_REQUEST_FIELD_ORDER = [
      "contents",
      "systemInstruction",
      "tools",
      "toolConfig",
      "labels",
      "generationConfig",
      "sessionId"
    ];
    AGY_MODEL_ENUM_BY_WIRE_MODEL = {
      "gemini-3.5-flash-extra-low": "MODEL_PLACEHOLDER_M187",
      "gemini-3.5-flash-low": "MODEL_PLACEHOLDER_M20",
      "gemini-3-flash-agent": "MODEL_PLACEHOLDER_M84",
      "gemini-3.6-flash-low": "MODEL_PLACEHOLDER_M73",
      "gemini-3.6-flash-medium": "MODEL_PLACEHOLDER_M72",
      "gemini-3.6-flash-high": "MODEL_PLACEHOLDER_M71",
      "gemini-3.7-flash-low": "MODEL_PLACEHOLDER_M300",
      "gemini-3.7-flash-medium": "MODEL_PLACEHOLDER_M299",
      "gemini-3.7-flash-high": "MODEL_PLACEHOLDER_M298",
      "gemini-3.8-flash-low": "MODEL_PLACEHOLDER_M320",
      "gemini-3.8-flash-medium": "MODEL_PLACEHOLDER_M319",
      "gemini-3.8-flash-high": "MODEL_PLACEHOLDER_M318",
      "gemini-3.1-pro-low": "MODEL_PLACEHOLDER_M36",
      "gemini-pro-agent": "MODEL_PLACEHOLDER_M16",
      "claude-sonnet-4-6": "MODEL_PLACEHOLDER_M35",
      "claude-opus-4-6-thinking": "MODEL_PLACEHOLDER_M26",
      "gemini-3.1-flash-image": "MODEL_PLACEHOLDER_M21",
      "gpt-oss-120b-medium": "MODEL_OPENAI_GPT_OSS_120B_MEDIUM"
    };
    AgyRequestSessionStore = class {
      entries = /* @__PURE__ */ new Map();
      workspaceUri;
      ttlMs;
      maxEntries;
      now;
      constructor(workspaceUri, options = {}) {
        this.workspaceUri = workspaceUri;
        this.ttlMs = options.ttlMs ?? DEFAULT_SESSION_STATE_TTL_MS;
        this.maxEntries = options.maxEntries ?? DEFAULT_MAX_SESSION_STATES;
        this.now = options.now ?? Date.now;
      }
      getOrCreate(key) {
        const timestamp = this.now();
        this.prune(timestamp, key);
        const existing = this.entries.get(key);
        if (existing) {
          existing.lastAccessedAt = timestamp;
          return existing.context;
        }
        const context = createAgyRequestSessionContext(this.workspaceUri);
        this.entries.set(key, {
          context,
          lastAccessedAt: timestamp,
          lastRequestTimestamp: 0
        });
        return context;
      }
      beginRequest(key) {
        const session = this.getOrCreate(key);
        const stored = this.entries.get(key);
        const timestamp = Math.max(stored.lastAccessedAt, stored.lastRequestTimestamp + 1);
        stored.lastRequestTimestamp = timestamp;
        return { session, timestamp };
      }
      completeExecution(key) {
        const stored = this.entries.get(key);
        if (stored) {
          stored.context.lastExecutionId = randomUUID2();
        }
      }
      has(key) {
        return this.entries.has(key);
      }
      delete(key) {
        this.entries.delete(key);
      }
      clear() {
        this.entries.clear();
      }
      get size() {
        return this.entries.size;
      }
      prune(timestamp, preservedKey) {
        const expiry = timestamp - this.ttlMs;
        for (const [key, value] of this.entries) {
          if (key !== preservedKey && value.lastAccessedAt < expiry) {
            this.entries.delete(key);
          }
        }
        while (this.entries.size >= this.maxEntries && !this.entries.has(preservedKey)) {
          let oldestKey = null;
          let oldestAccess = Number.POSITIVE_INFINITY;
          for (const [key, value] of this.entries) {
            if (key !== preservedKey && value.lastAccessedAt < oldestAccess) {
              oldestKey = key;
              oldestAccess = value.lastAccessedAt;
            }
          }
          if (!oldestKey) {
            break;
          }
          this.entries.delete(oldestKey);
        }
      }
    };
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/agy-transport.js
import { Buffer as Buffer3 } from "node:buffer";
function headersToRecord(headers) {
  const result2 = {};
  if (!headers)
    return result2;
  const normalized = new Headers(headers);
  normalized.forEach((value, key) => {
    result2[key.toLowerCase()] = value;
  });
  return result2;
}
function getHeader(headers, name2) {
  return headers[name2.toLowerCase()];
}
function bodyToBuffer(body) {
  if (body == null)
    return Buffer3.alloc(0);
  if (typeof body === "string")
    return Buffer3.from(body);
  if (body instanceof Uint8Array)
    return Buffer3.from(body);
  if (body instanceof ArrayBuffer)
    return Buffer3.from(body);
  throw new Error("agy transport only supports string/byte request bodies");
}
function shouldUseChunkedBody(url) {
  return url.pathname.includes(":streamGenerateContent");
}
function buildAgyCliHeaderPairs(url, init = {}) {
  const parsedUrl = new URL(url);
  const headers = headersToRecord(init.headers);
  const body = bodyToBuffer(init.body);
  const host = parsedUrl.port ? `${parsedUrl.hostname}:${parsedUrl.port}` : parsedUrl.hostname;
  const userAgent = getHeader(headers, "User-Agent") ?? buildAntigravityHarnessUserAgent();
  const authorization = getHeader(headers, "Authorization");
  const contentType = getHeader(headers, "Content-Type") ?? "application/json";
  const acceptEncoding = getHeader(headers, "Accept-Encoding") ?? "gzip";
  const chunked = shouldUseChunkedBody(parsedUrl);
  const pairs = [
    ["Host", host],
    ["User-Agent", userAgent]
  ];
  if (chunked) {
    pairs.push(["Transfer-Encoding", "chunked"]);
  } else {
    pairs.push(["Content-Length", String(body.byteLength)]);
  }
  if (authorization) {
    pairs.push(["Authorization", authorization]);
  }
  pairs.push(["Content-Type", contentType]);
  pairs.push(["Accept-Encoding", acceptEncoding]);
  return pairs;
}
var init_agy_transport = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/agy-transport.js"() {
    init_fingerprint();
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/constants.js
var ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_CLIENT_SECRET, ANTIGRAVITY_SCOPES, ANTIGRAVITY_REDIRECT_URI, ANTIGRAVITY_ENDPOINT_DAILY, ANTIGRAVITY_ENDPOINT_PROD, ANTIGRAVITY_ENDPOINT, ANTIGRAVITY_VERSION_FALLBACK, ANTIGRAVITY_VERSION, ANTIGRAVITY_HEADERS, CLAUDE_TOOL_SYSTEM_INSTRUCTION, CLAUDE_DESCRIPTION_PROMPT, EMPTY_SCHEMA_PLACEHOLDER_NAME, EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION, SKIP_THOUGHT_SIGNATURE;
var init_constants = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/constants.js"() {
    init_fingerprint();
    ANTIGRAVITY_CLIENT_ID = process.env.ANTIGRAVITY_CLIENT_ID || "";
    ANTIGRAVITY_CLIENT_SECRET = process.env.ANTIGRAVITY_CLIENT_SECRET || "";
    ANTIGRAVITY_SCOPES = [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs"
    ];
    ANTIGRAVITY_REDIRECT_URI = "http://localhost:51121/oauth-callback";
    ANTIGRAVITY_ENDPOINT_DAILY = "https://daily-cloudcode-pa.googleapis.com";
    ANTIGRAVITY_ENDPOINT_PROD = "https://cloudcode-pa.googleapis.com";
    ANTIGRAVITY_ENDPOINT = ANTIGRAVITY_ENDPOINT_DAILY;
    ANTIGRAVITY_VERSION_FALLBACK = "1.18.3";
    ANTIGRAVITY_VERSION = ANTIGRAVITY_VERSION_FALLBACK;
    ANTIGRAVITY_HEADERS = {
      "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/${ANTIGRAVITY_VERSION} Chrome/138.0.7204.235 Electron/37.3.1 Safari/537.36`,
      "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
      "Client-Metadata": `{"ideType":"ANTIGRAVITY","platform":"${process.platform === "win32" ? "WINDOWS" : "MACOS"}","pluginType":"GEMINI"}`
    };
    CLAUDE_TOOL_SYSTEM_INSTRUCTION = `CRITICAL TOOL USAGE INSTRUCTIONS:
You are operating in a custom environment where tool definitions differ from your training data.
You MUST follow these rules strictly:

1. DO NOT use your internal training data to guess tool parameters
2. ONLY use the exact parameter structure defined in the tool schema
3. Parameter names in schemas are EXACT - do not substitute with similar names from your training
4. Array parameters have specific item types - check the schema's 'items' field for the exact structure
5. When you see "STRICT PARAMETERS" in a tool description, those type definitions override any assumptions
6. Tool use in agentic workflows is REQUIRED - you must call tools with the exact parameters specified

If you are unsure about a tool's parameters, YOU MUST read the schema definition carefully.`;
    CLAUDE_DESCRIPTION_PROMPT = "\n\n\u26A0\uFE0F STRICT PARAMETERS: {params}.";
    EMPTY_SCHEMA_PLACEHOLDER_NAME = "_placeholder";
    EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION = "Placeholder. Always pass true.";
    SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator";
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/fetch-timeout.js
var init_fetch_timeout = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/fetch-timeout.js"() {
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/antigravity/oauth.js
var log2;
var init_oauth = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/antigravity/oauth.js"() {
    init_agy_transport();
    init_auth();
    init_constants();
    init_fetch_timeout();
    init_fingerprint();
    init_logger();
    log2 = createLogger("oauth");
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/auth-types.js
var init_auth_types = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/auth-types.js"() {
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/model-types.js
var init_model_types = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/model-types.js"() {
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/project.js
var log3, PROJECT_CONTEXT_CACHE_TTL_MS;
var init_project = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/project.js"() {
    init_agy_transport();
    init_auth();
    init_constants();
    init_fingerprint();
    init_logger();
    log3 = createLogger("project");
    PROJECT_CONTEXT_CACHE_TTL_MS = 30 * 60 * 1e3;
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/quota-manager.js
var log4, QUOTA_MANAGER_DEFAULT_MAX_BACKOFF_MS;
var init_quota_manager = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/quota-manager.js"() {
    init_fetch_timeout();
    init_fingerprint();
    init_logger();
    init_model_registry();
    log4 = createLogger("quota-manager");
    QUOTA_MANAGER_DEFAULT_MAX_BACKOFF_MS = 10 * 60 * 1e3;
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/transform/claude.js
function computeClaudeMaxOutputTokens(thinkingBudget) {
  if (typeof thinkingBudget !== "number" || thinkingBudget <= 0) {
    return CLAUDE_THINKING_MAX_OUTPUT_TOKENS;
  }
  return Math.min(Math.max(thinkingBudget * 2, 32e3), CLAUDE_THINKING_MAX_OUTPUT_TOKENS);
}
function isClaudeThinkingModel(model) {
  const lower = model.toLowerCase();
  return lower.includes("claude") && lower.includes("thinking");
}
function configureClaudeToolConfig(payload) {
  if (!payload.toolConfig) {
    payload.toolConfig = {};
  }
  if (typeof payload.toolConfig === "object" && payload.toolConfig !== null) {
    const toolConfig = payload.toolConfig;
    if (!toolConfig.functionCallingConfig) {
      toolConfig.functionCallingConfig = {};
    }
    if (typeof toolConfig.functionCallingConfig === "object" && toolConfig.functionCallingConfig !== null) {
      ;
      toolConfig.functionCallingConfig.mode = "VALIDATED";
    }
  }
}
function buildClaudeThinkingConfig(includeThoughts, thinkingBudget) {
  return {
    include_thoughts: includeThoughts,
    ...typeof thinkingBudget === "number" && thinkingBudget > 0 ? { thinking_budget: thinkingBudget } : {}
  };
}
function ensureClaudeMaxOutputTokens(generationConfig, thinkingBudget) {
  const currentMax = generationConfig.maxOutputTokens ?? generationConfig.max_output_tokens;
  if (!currentMax || currentMax <= thinkingBudget) {
    generationConfig.maxOutputTokens = computeClaudeMaxOutputTokens(thinkingBudget);
    if (generationConfig.max_output_tokens !== void 0) {
      delete generationConfig.max_output_tokens;
    }
  }
}
function appendClaudeThinkingHint(payload, hint = CLAUDE_INTERLEAVED_THINKING_HINT) {
  const existing = payload.systemInstruction;
  if (typeof existing === "string" && existing.includes(hint)) {
    return;
  }
  if (existing && typeof existing === "object") {
    const sys = existing;
    if (Array.isArray(sys.parts)) {
      const alreadyHasHint = sys.parts.some((p) => p && typeof p === "object" && p.text === hint);
      if (alreadyHasHint)
        return;
    }
  }
  if (typeof existing === "string") {
    payload.systemInstruction = existing.trim().length > 0 ? { role: "user", parts: [{ text: existing }, { text: hint }] } : hint;
  } else if (existing && typeof existing === "object") {
    const sys = existing;
    const partsValue = sys.parts;
    if (Array.isArray(partsValue)) {
      sys.parts = [...partsValue, { text: hint }];
    } else {
      sys.parts = [{ text: hint }];
    }
    payload.systemInstruction = sys;
  } else if (Array.isArray(payload.contents)) {
    payload.systemInstruction = { parts: [{ text: hint }] };
  }
}
function normalizeClaudeTools(payload, cleanJSONSchema) {
  let toolDebugMissing = 0;
  const toolDebugSummaries = [];
  if (!Array.isArray(payload.tools)) {
    return { toolDebugMissing, toolDebugSummaries };
  }
  const functionDeclarations = [];
  const passthroughTools = [];
  const normalizeSchema = (schema) => {
    const createPlaceholderSchema = (base = {}) => ({
      ...base,
      type: "object",
      properties: {
        [EMPTY_SCHEMA_PLACEHOLDER_NAME]: {
          type: "boolean",
          description: EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION
        }
      },
      required: [EMPTY_SCHEMA_PLACEHOLDER_NAME]
    });
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
      toolDebugMissing += 1;
      return createPlaceholderSchema();
    }
    const cleaned = cleanJSONSchema(schema);
    if (!cleaned || typeof cleaned !== "object" || Array.isArray(cleaned)) {
      toolDebugMissing += 1;
      return createPlaceholderSchema();
    }
    const hasProperties = cleaned.properties && typeof cleaned.properties === "object" && Object.keys(cleaned.properties).length > 0;
    cleaned.type = "object";
    if (!hasProperties) {
      cleaned.properties = {
        _placeholder: {
          type: "boolean",
          description: "Placeholder. Always pass true."
        }
      };
      cleaned.required = Array.isArray(cleaned.required) ? Array.from(/* @__PURE__ */ new Set([...cleaned.required, "_placeholder"])) : ["_placeholder"];
    }
    return cleaned;
  };
  payload.tools.forEach((tool) => {
    const t = tool;
    const pushDeclaration = (decl, source) => {
      const schema = decl?.parameters || decl?.parametersJsonSchema || decl?.input_schema || decl?.inputSchema || t.parameters || t.parametersJsonSchema || t.input_schema || t.inputSchema || t.function?.parameters || t.function?.parametersJsonSchema || t.function?.input_schema || t.function?.inputSchema || t.custom?.parameters || t.custom?.parametersJsonSchema || t.custom?.input_schema;
      let name2 = decl?.name || t.name || t.function?.name || t.custom?.name || `tool-${functionDeclarations.length}`;
      name2 = String(name2).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      const description = decl?.description || t.description || t.function?.description || t.custom?.description || "";
      functionDeclarations.push({
        name: name2,
        description: String(description || ""),
        parameters: normalizeSchema(schema)
      });
      toolDebugSummaries.push(`decl=${name2},src=${source},hasSchema=${schema ? "y" : "n"}`);
    };
    if (Array.isArray(t.functionDeclarations) && t.functionDeclarations.length > 0) {
      ;
      t.functionDeclarations.forEach((decl) => {
        pushDeclaration(decl, "functionDeclarations");
      });
      return;
    }
    if (t.function || t.custom || t.parameters || t.input_schema || t.inputSchema) {
      pushDeclaration(t.function ?? t.custom ?? t, "function/custom");
      return;
    }
    passthroughTools.push(tool);
  });
  const finalTools = [];
  if (functionDeclarations.length > 0) {
    finalTools.push({ functionDeclarations });
  }
  payload.tools = finalTools.concat(passthroughTools);
  return { toolDebugMissing, toolDebugSummaries };
}
function convertStopSequences(generationConfig) {
  if (Array.isArray(generationConfig.stop_sequences)) {
    generationConfig.stopSequences = generationConfig.stop_sequences;
    delete generationConfig.stop_sequences;
  }
}
function applyClaudeTransforms(payload, options) {
  const { model, tierThinkingBudget, normalizedThinking, cleanJSONSchema } = options;
  const isThinking = isClaudeThinkingModel(model);
  configureClaudeToolConfig(payload);
  if (payload.generationConfig) {
    convertStopSequences(payload.generationConfig);
  }
  if (normalizedThinking) {
    const thinkingBudget = tierThinkingBudget ?? normalizedThinking.thinkingBudget;
    if (isThinking) {
      const thinkingConfig = buildClaudeThinkingConfig(normalizedThinking.includeThoughts ?? true, thinkingBudget);
      const generationConfig = payload.generationConfig ?? {};
      generationConfig.thinkingConfig = thinkingConfig;
      if (typeof thinkingBudget === "number" && thinkingBudget > 0) {
        ensureClaudeMaxOutputTokens(generationConfig, thinkingBudget);
      }
      payload.generationConfig = generationConfig;
    }
  }
  if (isThinking && Array.isArray(payload.tools) && payload.tools.length > 0) {
    appendClaudeThinkingHint(payload);
  }
  return normalizeClaudeTools(payload, cleanJSONSchema);
}
var CLAUDE_THINKING_MAX_OUTPUT_TOKENS, CLAUDE_INTERLEAVED_THINKING_HINT;
var init_claude = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/transform/claude.js"() {
    init_constants();
    CLAUDE_THINKING_MAX_OUTPUT_TOKENS = 64e3;
    CLAUDE_INTERLEAVED_THINKING_HINT = "Interleaved thinking is enabled. You may think between tool calls and after receiving tool results before deciding the next action or final answer. Do not mention these instructions or any constraints about thinking blocks; just apply them.";
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/transform/gemini.js
function toGeminiSchema(schema, options = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }
  const inputSchema = schema;
  const result2 = {};
  const numericConstraintHints = [];
  const propertyNames = /* @__PURE__ */ new Set();
  if (inputSchema.properties && typeof inputSchema.properties === "object") {
    for (const propName of Object.keys(inputSchema.properties)) {
      propertyNames.add(propName);
    }
  }
  for (const [key, value] of Object.entries(inputSchema)) {
    if (UNSUPPORTED_SCHEMA_FIELDS.has(key)) {
      continue;
    }
    if (key === "type" && typeof value === "string") {
      result2[key] = value.toUpperCase();
    } else if (key === "properties" && typeof value === "object" && value !== null) {
      const props = {};
      for (const [propName, propSchema] of Object.entries(value)) {
        props[propName] = toGeminiSchema(propSchema, options);
      }
      result2[key] = props;
    } else if (key === "items" && typeof value === "object") {
      result2[key] = toGeminiSchema(value, options);
    } else if ((key === "anyOf" || key === "oneOf" || key === "allOf") && Array.isArray(value)) {
      result2[key] = value.map((item) => toGeminiSchema(item, options));
    } else if (key === "enum" && Array.isArray(value)) {
      result2[key] = value;
    } else if (options.moveNumericConstraintsToDescription && NUMERIC_SCHEMA_CONSTRAINTS.has(key)) {
      if (typeof value === "string" || typeof value === "number") {
        numericConstraintHints.push(`${key}: ${value}`);
      }
    } else if (key === "default" || key === "examples") {
      result2[key] = value;
    } else if (key === "required" && Array.isArray(value)) {
      if (propertyNames.size > 0) {
        const validRequired = value.filter((prop) => typeof prop === "string" && propertyNames.has(prop));
        if (validRequired.length > 0) {
          result2[key] = validRequired;
        }
      } else {
        result2[key] = value;
      }
    } else {
      result2[key] = value;
    }
  }
  if (numericConstraintHints.length > 0) {
    const hint = numericConstraintHints.join(", ");
    result2.description = typeof result2.description === "string" && result2.description ? `${result2.description} (${hint})` : hint;
  }
  if (result2.type === "ARRAY" && !result2.items) {
    result2.items = { type: "STRING" };
  }
  return result2;
}
function isGemini3Model(model) {
  return model.toLowerCase().includes("gemini-3");
}
function buildGemini3ThinkingConfig(includeThoughts, thinkingLevel) {
  return {
    includeThoughts,
    thinkingLevel
  };
}
function buildGemini25ThinkingConfig(includeThoughts, thinkingBudget) {
  return {
    includeThoughts,
    ...typeof thinkingBudget === "number" && thinkingBudget > 0 ? { thinkingBudget } : {}
  };
}
function normalizeGeminiTools(payload, schemaOptions = {}) {
  let toolDebugMissing = 0;
  const toolDebugSummaries = [];
  if (!Array.isArray(payload.tools)) {
    return { toolDebugMissing, toolDebugSummaries };
  }
  payload.tools = payload.tools.map((tool, toolIndex) => {
    const t = tool;
    if (t.googleSearch || t.googleSearchRetrieval) {
      return t;
    }
    if (Array.isArray(t.functionDeclarations)) {
      return {
        ...t,
        functionDeclarations: t.functionDeclarations.map((declaration) => {
          const normalized = { ...declaration };
          const rawSchema = normalized.parameters ?? normalized.parametersJsonSchema ?? {
            type: "OBJECT",
            properties: {}
          };
          normalized.parameters = toGeminiSchema(rawSchema, schemaOptions);
          delete normalized.parametersJsonSchema;
          return normalized;
        })
      };
    }
    const newTool = { ...t };
    const schemaCandidates = [
      newTool.function?.input_schema,
      newTool.function?.parameters,
      newTool.function?.inputSchema,
      newTool.custom?.input_schema,
      newTool.custom?.parameters,
      newTool.parameters,
      newTool.input_schema,
      newTool.inputSchema
    ].filter(Boolean);
    const placeholderSchema = {
      type: "OBJECT",
      properties: {
        _placeholder: {
          type: "BOOLEAN",
          description: "Placeholder. Always pass true."
        }
      },
      required: ["_placeholder"]
    };
    let schema = schemaCandidates[0];
    const schemaObjectOk = schema && typeof schema === "object" && !Array.isArray(schema);
    if (!schemaObjectOk) {
      schema = placeholderSchema;
      toolDebugMissing += 1;
    } else {
      schema = toGeminiSchema(schema, schemaOptions);
    }
    const nameCandidate = newTool.name || newTool.function?.name || newTool.custom?.name || `tool-${toolIndex}`;
    if (newTool.function && schema) {
      ;
      newTool.function.input_schema = schema;
    }
    if (newTool.custom && schema) {
      ;
      newTool.custom.input_schema = schema;
    }
    if (!newTool.custom && newTool.function) {
      const fn = newTool.function;
      newTool.custom = {
        name: fn.name || nameCandidate,
        description: fn.description,
        input_schema: schema
      };
    }
    if (!newTool.custom && !newTool.function) {
      newTool.custom = {
        name: nameCandidate,
        description: newTool.description,
        input_schema: schema
      };
      if (!newTool.parameters && !newTool.input_schema && !newTool.inputSchema) {
        newTool.parameters = schema;
      }
    }
    if (newTool.custom && !newTool.custom.input_schema) {
      ;
      newTool.custom.input_schema = {
        type: "OBJECT",
        properties: {}
      };
      toolDebugMissing += 1;
    }
    toolDebugSummaries.push(`idx=${toolIndex}, hasCustom=${!!newTool.custom}, customSchema=${!!newTool.custom?.input_schema}, hasFunction=${!!newTool.function}, functionSchema=${!!newTool.function?.input_schema}`);
    if (newTool.custom) {
      delete newTool.custom;
    }
    return newTool;
  });
  return { toolDebugMissing, toolDebugSummaries };
}
function applyGeminiTransforms(payload, options) {
  const { model, tierThinkingBudget, tierThinkingLevel, normalizedThinking, googleSearch } = options;
  if (normalizedThinking) {
    let thinkingConfig;
    if (tierThinkingLevel && isGemini3Model(model)) {
      thinkingConfig = buildGemini3ThinkingConfig(normalizedThinking.includeThoughts ?? true, tierThinkingLevel);
    } else {
      const thinkingBudget = tierThinkingBudget ?? normalizedThinking.thinkingBudget;
      thinkingConfig = buildGemini25ThinkingConfig(normalizedThinking.includeThoughts ?? true, thinkingBudget);
    }
    const generationConfig = payload.generationConfig ?? {};
    generationConfig.thinkingConfig = thinkingConfig;
    payload.generationConfig = generationConfig;
  }
  if (googleSearch && googleSearch.mode === "auto") {
    const tools = payload.tools || [];
    if (!payload.tools) {
      payload.tools = tools;
    }
    ;
    payload.tools.push({
      googleSearch: {}
    });
  }
  const result2 = normalizeGeminiTools(payload, {
    moveNumericConstraintsToDescription: model.toLowerCase().startsWith("gpt-oss-")
  });
  const wrapResult = wrapToolsAsFunctionDeclarations(payload);
  return {
    ...result2,
    wrappedFunctionCount: wrapResult.wrappedFunctionCount,
    passthroughToolCount: wrapResult.passthroughToolCount
  };
}
function isWebSearchTool(tool) {
  if (tool.googleSearch || tool.googleSearchRetrieval) {
    return true;
  }
  if (tool.type === "web_search_20250305") {
    return true;
  }
  const name2 = tool.name;
  if (name2 === "web_search" || name2 === "google_search") {
    return true;
  }
  return false;
}
function wrapToolsAsFunctionDeclarations(payload) {
  if (!Array.isArray(payload.tools) || payload.tools.length === 0) {
    return { wrappedFunctionCount: 0, passthroughToolCount: 0 };
  }
  const functionDeclarations = [];
  const passthroughTools = [];
  let hasWebSearchTool = false;
  for (const tool of payload.tools) {
    if (tool.googleSearch || tool.googleSearchRetrieval || tool.codeExecution) {
      passthroughTools.push(tool);
      continue;
    }
    if (isWebSearchTool(tool)) {
      hasWebSearchTool = true;
      continue;
    }
    if (tool.functionDeclarations) {
      if (Array.isArray(tool.functionDeclarations)) {
        for (const decl of tool.functionDeclarations) {
          functionDeclarations.push({
            name: String(decl.name || `tool-${functionDeclarations.length}`),
            description: String(decl.description || ""),
            parameters: decl.parameters || {
              type: "OBJECT",
              properties: {}
            }
          });
        }
      }
      continue;
    }
    const fn = tool.function;
    const custom = tool.custom;
    const name2 = String(tool.name || fn?.name || custom?.name || `tool-${functionDeclarations.length}`);
    const description = String(tool.description || fn?.description || custom?.description || "");
    const schema = fn?.input_schema || fn?.parameters || fn?.inputSchema || custom?.input_schema || custom?.parameters || tool.parameters || tool.input_schema || tool.inputSchema || { type: "OBJECT", properties: {} };
    functionDeclarations.push({
      name: name2,
      description,
      parameters: schema
    });
  }
  const finalTools = [];
  if (functionDeclarations.length > 0) {
    finalTools.push({ functionDeclarations });
  }
  finalTools.push(...passthroughTools);
  if (hasWebSearchTool && functionDeclarations.length === 0) {
    finalTools.push({ googleSearch: {} });
  } else if (hasWebSearchTool && functionDeclarations.length > 0) {
    console.warn("[gemini] web_search tool detected but cannot be combined with function declarations. Use the explicit google_search() tool call instead.");
  }
  payload.tools = finalTools;
  return {
    wrappedFunctionCount: functionDeclarations.length,
    passthroughToolCount: passthroughTools.length + (hasWebSearchTool && functionDeclarations.length === 0 ? 1 : 0)
  };
}
var UNSUPPORTED_SCHEMA_FIELDS, NUMERIC_SCHEMA_CONSTRAINTS;
var init_gemini = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/transform/gemini.js"() {
    UNSUPPORTED_SCHEMA_FIELDS = /* @__PURE__ */ new Set([
      "additionalProperties",
      "$schema",
      "$id",
      "$comment",
      "$ref",
      "$defs",
      "definitions",
      "const",
      "contentMediaType",
      "contentEncoding",
      "if",
      "then",
      "else",
      "not",
      "patternProperties",
      "unevaluatedProperties",
      "unevaluatedItems",
      "dependentRequired",
      "dependentSchemas",
      "propertyNames",
      "minContains",
      "maxContains"
    ]);
    NUMERIC_SCHEMA_CONSTRAINTS = /* @__PURE__ */ new Set([
      "minLength",
      "maxLength",
      "minItems",
      "maxItems",
      "minProperties",
      "maxProperties",
      "minimum",
      "maximum",
      "exclusiveMinimum",
      "exclusiveMaximum",
      "multipleOf"
    ]);
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/transform/cross-model-sanitizer.js
var init_cross_model_sanitizer = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/transform/cross-model-sanitizer.js"() {
    init_claude();
    init_gemini();
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/transform/model-resolver.js
function supportsThinkingTiers(model) {
  const lower = model.toLowerCase();
  return lower.includes("gemini-3") || lower.includes("gemini-2.5") || lower.includes("claude") && lower.includes("thinking");
}
function extractThinkingTierFromModel(model) {
  if (!supportsThinkingTiers(model)) {
    return void 0;
  }
  const tierMatch = model.match(TIER_REGEX);
  return tierMatch?.[1];
}
function getBudgetFamily(model) {
  if (model.includes("claude")) {
    return "claude";
  }
  if (model.includes("gemini-2.5-pro")) {
    return "gemini-2.5-pro";
  }
  if (model.includes("gemini-2.5-flash")) {
    return "gemini-2.5-flash";
  }
  return "default";
}
function isThinkingCapableModel(model) {
  const lower = model.toLowerCase();
  return lower.includes("thinking") || lower.includes("gemini-3") || lower.includes("gemini-2.5");
}
function isGemini3ProModel(model) {
  return GEMINI_3_PRO_REGEX.test(model);
}
function isGemini3FlashModel(model) {
  return GEMINI_3_FLASH_REGEX.test(model);
}
function resolveGemini35FlashAntigravityModel(tier) {
  return getGemini35FlashAntigravityModel(tier);
}
function getAgyGeminiFlashThinkingBudget(tier, highBudget = 1e4) {
  switch (tier) {
    case "low":
      return 1e3;
    case "high":
      return highBudget;
    default:
      return 4e3;
  }
}
function getAgyGemini31ProModel(tier) {
  return tier === "high" ? "gemini-pro-agent" : "gemini-3.1-pro-low";
}
function getAgyGemini31ProThinkingBudget(tier) {
  return tier === "high" ? 10001 : 1001;
}
function resolveModelWithTier(requestedModel, options = {}) {
  const isAntigravity = QUOTA_PREFIX_REGEX.test(requestedModel);
  const modelWithoutQuota = requestedModel.replace(QUOTA_PREFIX_REGEX, "");
  const tier = extractThinkingTierFromModel(modelWithoutQuota);
  const baseName = tier ? modelWithoutQuota.replace(TIER_REGEX, "") : modelWithoutQuota;
  const isImageModel = IMAGE_GENERATION_MODELS.test(modelWithoutQuota);
  const isClaudeModel2 = modelWithoutQuota.toLowerCase().includes("claude");
  const preferGeminiCli = options.cli_first === true && !isAntigravity && !isImageModel && !isClaudeModel2;
  const quotaPreference = preferGeminiCli ? "gemini-cli" : "antigravity";
  const explicitQuota = isAntigravity || isImageModel;
  const isGemini3 = modelWithoutQuota.toLowerCase().startsWith("gemini-3");
  const skipAlias = isAntigravity && isGemini3;
  const isGemini3Pro = isGemini3ProModel(modelWithoutQuota);
  const isGemini3Flash = isGemini3FlashModel(modelWithoutQuota);
  const isGemini31Pro = /^gemini-3\.1-pro/i.test(baseName);
  const isGemini35Flash = /^gemini-3\.5-flash/i.test(baseName);
  const isGemini36Flash = /^gemini-3\.6-flash/i.test(baseName);
  const isGemini37Flash = /^gemini-3\.7-flash/i.test(baseName);
  const isGemini38Flash = /^gemini-3\.8-flash/i.test(baseName);
  const isGptOss120b = /^gpt-oss-120b(?:-medium)?$/i.test(baseName);
  if (isGemini31Pro && quotaPreference === "antigravity") {
    return {
      actualModel: getAgyGemini31ProModel(tier),
      thinkingBudget: getAgyGemini31ProThinkingBudget(tier),
      tier,
      isThinkingModel: true,
      quotaPreference,
      explicitQuota
    };
  }
  if (isGemini35Flash && quotaPreference === "antigravity") {
    return {
      actualModel: resolveGemini35FlashAntigravityModel(tier ?? "medium"),
      thinkingBudget: getAgyGeminiFlashThinkingBudget(tier),
      tier: tier ?? "medium",
      isThinkingModel: true,
      quotaPreference,
      explicitQuota
    };
  }
  if (isGemini36Flash && quotaPreference === "antigravity") {
    return {
      actualModel: getGemini36FlashAntigravityModel(tier ?? "medium"),
      thinkingBudget: getAgyGeminiFlashThinkingBudget(tier),
      tier: tier ?? "medium",
      isThinkingModel: true,
      quotaPreference,
      explicitQuota
    };
  }
  if (isGemini37Flash && quotaPreference === "antigravity") {
    return {
      actualModel: getGemini37FlashAntigravityModel(tier ?? "medium"),
      thinkingBudget: getAgyGeminiFlashThinkingBudget(tier, -1),
      tier: tier ?? "medium",
      isThinkingModel: true,
      quotaPreference,
      explicitQuota
    };
  }
  if (isGemini38Flash && quotaPreference === "antigravity") {
    return {
      actualModel: getGemini38FlashAntigravityModel(tier ?? "medium"),
      thinkingBudget: getAgyGeminiFlashThinkingBudget(tier, -1),
      tier: tier ?? "medium",
      isThinkingModel: true,
      quotaPreference,
      explicitQuota
    };
  }
  if (isGptOss120b && quotaPreference === "antigravity") {
    return {
      actualModel: "gpt-oss-120b-medium",
      thinkingBudget: 8192,
      isThinkingModel: true,
      quotaPreference,
      explicitQuota
    };
  }
  let antigravityModel = modelWithoutQuota;
  if (skipAlias) {
    if ((isGemini3Pro || isGemini3Flash) && !tier && !isImageModel) {
      const defaultTier = isGemini3Pro ? "low" : "medium";
      antigravityModel = `${modelWithoutQuota}-${defaultTier}`;
    }
  }
  const actualModel = skipAlias ? antigravityModel : MODEL_ALIASES[modelWithoutQuota] || MODEL_ALIASES[baseName] || baseName;
  const resolvedModel = actualModel;
  const isThinking = isThinkingCapableModel(resolvedModel);
  if (isImageModel) {
    return {
      actualModel: resolvedModel,
      isThinkingModel: false,
      isImageModel: true,
      quotaPreference,
      explicitQuota
    };
  }
  const isEffectiveGemini3 = resolvedModel.toLowerCase().includes("gemini-3");
  const lowerModelWithoutQuota = modelWithoutQuota.toLowerCase();
  const isClaudeThinking = resolvedModel.toLowerCase().includes("claude") && resolvedModel.toLowerCase().includes("thinking") || lowerModelWithoutQuota.includes("claude") && lowerModelWithoutQuota.includes("thinking") || lowerModelWithoutQuota === "gemini-claude-sonnet-4-6";
  if (!tier) {
    if (isEffectiveGemini3) {
      return {
        actualModel: resolvedModel,
        thinkingLevel: isGemini35Flash ? "medium" : "low",
        isThinkingModel: true,
        quotaPreference,
        explicitQuota
      };
    }
    if (isClaudeThinking) {
      return {
        actualModel: resolvedModel,
        thinkingBudget: 1024,
        isThinkingModel: true,
        quotaPreference,
        explicitQuota
      };
    }
    return {
      actualModel: resolvedModel,
      isThinkingModel: isThinking,
      quotaPreference,
      explicitQuota
    };
  }
  if (isEffectiveGemini3) {
    return {
      actualModel: resolvedModel,
      thinkingLevel: tier,
      tier,
      isThinkingModel: true,
      quotaPreference,
      explicitQuota
    };
  }
  if (isClaudeThinking) {
    return {
      actualModel: resolvedModel,
      thinkingBudget: 1024,
      tier,
      isThinkingModel: true,
      quotaPreference,
      explicitQuota
    };
  }
  const budgetFamily = getBudgetFamily(resolvedModel);
  const budgets = THINKING_TIER_BUDGETS[budgetFamily];
  const thinkingBudget = budgets[tier];
  return {
    actualModel: resolvedModel,
    thinkingBudget,
    tier,
    isThinkingModel: isThinking,
    quotaPreference,
    explicitQuota
  };
}
var THINKING_TIER_BUDGETS, MODEL_ALIASES, TIER_REGEX, QUOTA_PREFIX_REGEX, GEMINI_3_PRO_REGEX, GEMINI_3_FLASH_REGEX, IMAGE_GENERATION_MODELS;
var init_model_resolver = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/transform/model-resolver.js"() {
    init_model_registry();
    THINKING_TIER_BUDGETS = {
      claude: { low: 8192, medium: 16384, high: 32768 },
      "gemini-2.5-pro": { low: 8192, medium: 16384, high: 32768 },
      "gemini-2.5-flash": { low: 6144, medium: 12288, high: 24576 },
      default: { low: 4096, medium: 8192, high: 16384 }
    };
    MODEL_ALIASES = getResolverAliasMap();
    TIER_REGEX = /-(minimal|low|medium|high)$/;
    QUOTA_PREFIX_REGEX = /^antigravity-/i;
    GEMINI_3_PRO_REGEX = /^gemini-3(?:\.\d+)?-pro/i;
    GEMINI_3_FLASH_REGEX = /^gemini-3(?:\.\d+)?-flash/i;
    IMAGE_GENERATION_MODELS = /image|imagen/i;
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/transform/index.js
var init_transform = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/transform/index.js"() {
    init_claude();
    init_cross_model_sanitizer();
    init_gemini();
    init_model_resolver();
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/version.js
var init_version = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/version.js"() {
    init_constants();
    init_fetch_timeout();
    init_logger();
  }
});

// work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/index.js
var init_dist = __esm({
  "work/dsh-runtime/antigravity-build/node_modules/@cortexkit/antigravity-auth-core/dist/index.js"() {
    init_account_manager();
    init_account_storage();
    init_account_types();
    init_agy_request_metadata();
    init_agy_transport();
    init_oauth();
    init_atomic_write();
    init_auth();
    init_auth_types();
    init_constants();
    init_fetch_timeout();
    init_file_lock();
    init_fingerprint();
    init_logger();
    init_model_registry();
    init_model_types();
    init_project();
    init_quota_manager();
    init_quota_types();
    init_rotation();
    init_transform();
    init_version();
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/credential-coordinator.ts
function createCredentialCoordinator(options) {
  const now = options.now ?? (() => Date.now());
  const refreshAccessToken = options.refreshToken ?? createGoogleRefreshTransport(options.fetchImpl, now);
  const revokeGrant = options.revokeGrant ?? createGoogleRevokeTransport(options.fetchImpl);
  const refreshLeadMs = Math.max(0, options.refreshLeadMs ?? DEFAULT_REFRESH_LEAD_MS);
  const operationTimeoutMs = Math.max(1, options.operationTimeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  let cached;
  let observedRevision = 0;
  let observedLineage;
  let state = "logged-out";
  let errorCode2;
  let lastRefreshAt;
  let refreshFlight;
  let revokeFlight;
  let revokeStatus = { state: "idle" };
  let generation = 0;
  let disposed = false;
  const lifecycleAbort = new AbortController();
  const operations = /* @__PURE__ */ new Set();
  const coordinator = {
    credential: async (signal, credentialOptions) => {
      ensureNotDisposed();
      if (signal?.aborted === true) throw new CredentialOperationError("cancelled");
      const record = await options.store.read();
      if (record === void 0) {
        clearObservedCredential();
        return void 0;
      }
      observe(record);
      if (state === "re-login-required") return void 0;
      if (credentialOptions?.forceRefresh !== true && cached !== void 0 && sameRecord(cached, record) && isFresh(cached.value, now(), refreshLeadMs)) {
        state = "logged-in";
        errorCode2 = void 0;
        return await waitForCaller(Promise.resolve(cached.value), signal);
      }
      if (refreshFlight === void 0) {
        const flight = refreshCredential(generation);
        refreshFlight = flight;
        void flight.then(
          () => clearRefreshFlight(flight),
          () => clearRefreshFlight(flight)
        );
      }
      return await waitForCaller(refreshFlight, signal);
    },
    replaceFromLogin: (credential, record) => {
      if (disposed) return;
      generation += 1;
      abortOperations();
      cached = { value: { ...credential }, revision: record.revision, ...record.lineage === void 0 ? {} : { lineage: record.lineage } };
      observedRevision = record.revision;
      observedLineage = record.lineage;
      state = "logged-in";
      errorCode2 = void 0;
      lastRefreshAt = void 0;
      revokeStatus = { state: "idle" };
      refreshFlight = void 0;
      revokeFlight = void 0;
    },
    status: async () => {
      ensureNotDisposed();
      const record = await options.store.read();
      if (record === void 0) {
        clearObservedCredential();
      } else {
        observe(record);
      }
      return makeCredentialStatus(record);
    },
    revokeStatus: () => ({ ...revokeStatus }),
    resetCache: () => {
      generation += 1;
      abortOperations();
      cached = void 0;
      observedRevision = 0;
      observedLineage = void 0;
      refreshFlight = void 0;
      revokeFlight = void 0;
      state = "logged-out";
      errorCode2 = void 0;
      revokeStatus = { state: "idle" };
      lastRefreshAt = void 0;
    },
    logout: async (binding) => {
      ensureNotDisposed();
      generation += 1;
      const logoutGeneration = generation;
      abortOperations();
      refreshFlight = void 0;
      revokeFlight = void 0;
      cached = void 0;
      observedRevision = 0;
      observedLineage = void 0;
      const record = await options.store.read();
      if (!isActive(logoutGeneration)) return { state: "logged-out" };
      if (binding !== void 0 && !matchesBinding(record, binding.record)) {
        if (record !== void 0) observe(record);
        return { state: "logged-out" };
      }
      let cleared = true;
      if (record !== void 0) {
        cleared = await options.store.clearIfCurrent(record.revision, record.lineage);
      }
      if (!isActive(logoutGeneration)) {
        if (cleared && record !== void 0) await binding?.onCleared();
        return { state: "logged-out" };
      }
      if (!cleared) {
        const latest = await options.store.read();
        if (!isActive(logoutGeneration)) return { state: "logged-out" };
        if (latest === void 0) {
          clearObservedCredential();
          revokeStatus = { state: "logged-out" };
        } else {
          observe(latest);
        }
        return { state: "logged-out" };
      }
      state = "logged-out";
      errorCode2 = void 0;
      lastRefreshAt = void 0;
      revokeStatus = { state: "logged-out" };
      await binding?.onCleared();
      return { state: "logged-out" };
    },
    revoke: async (confirmed, signal, binding) => {
      ensureNotDisposed();
      if (!confirmed) {
        revokeStatus = { state: "confirmation-required" };
        return { state: "confirmation-required" };
      }
      if (signal?.aborted === true) throw new CredentialOperationError("cancelled");
      if (revokeFlight !== void 0) return await waitForCaller(revokeFlight, signal);
      generation += 1;
      abortOperations();
      refreshFlight = void 0;
      const revokeGeneration = generation;
      const record = await options.store.read();
      if (!isActive(revokeGeneration)) return { state: "superseded" };
      if (binding !== void 0 && !matchesBinding(record, binding.record)) return { state: "superseded" };
      if (record === void 0) {
        clearObservedCredential();
        revokeStatus = { state: "logged-out" };
        return { state: "logged-out" };
      }
      revokeStatus = { state: "pending" };
      const flight = revokeCredential(record, revokeGeneration, binding);
      revokeFlight = flight;
      void flight.then(
        () => clearRevokeFlight(flight),
        () => clearRevokeFlight(flight)
      );
      return await waitForCaller(flight, signal);
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      generation += 1;
      lifecycleAbort.abort(new CredentialOperationError("cancelled", "The Antigravity credential service was disposed"));
      abortOperations();
      refreshFlight = void 0;
      revokeFlight = void 0;
      cached = void 0;
      operations.clear();
    }
  };
  function ensureNotDisposed() {
    if (disposed) throw new CredentialOperationError("cancelled", "The Antigravity credential service is unavailable");
  }
  function beginOperation() {
    const controller = new AbortController();
    operations.add(controller);
    if (lifecycleAbort.signal.aborted) controller.abort(lifecycleAbort.signal.reason);
    return controller;
  }
  function endOperation(controller) {
    operations.delete(controller);
  }
  function abortOperations() {
    for (const controller of operations) controller.abort(new CredentialOperationError("cancelled"));
    operations.clear();
  }
  function clearRefreshFlight(flight) {
    if (refreshFlight === flight) refreshFlight = void 0;
  }
  function clearRevokeFlight(flight) {
    if (revokeFlight === flight) revokeFlight = void 0;
  }
  function clearObservedCredential() {
    cached = void 0;
    observedRevision = 0;
    observedLineage = void 0;
    if (!disposed) {
      state = "logged-out";
      errorCode2 = void 0;
      lastRefreshAt = void 0;
    }
  }
  function observe(record) {
    const lineageChanged = observedRevision !== 0 && observedLineage !== record.lineage;
    const recordChanged = observedRevision !== 0 && (observedRevision !== record.revision || lineageChanged);
    if (recordChanged) {
      cached = void 0;
      state = "logged-in";
      errorCode2 = void 0;
      lastRefreshAt = void 0;
    }
    observedRevision = record.revision;
    observedLineage = record.lineage;
    if (state === "logged-out") state = "logged-in";
  }
  function isFresh(credential, timestamp, lead) {
    return Number.isFinite(credential.expiresAt) && credential.expiresAt - timestamp > lead;
  }
  function sameRecord(value, record) {
    return value.revision === record.revision && value.lineage === record.lineage;
  }
  function makeCredentialStatus(record) {
    const configured = record !== void 0;
    const expiresAt = cached === void 0 ? void 0 : new Date(cached.value.expiresAt).toISOString();
    return {
      state: configured ? state : "logged-out",
      configured,
      ...expiresAt === void 0 ? {} : { expiresAt },
      ...lastRefreshAt === void 0 ? {} : { lastRefreshAt: new Date(lastRefreshAt).toISOString() },
      ...errorCode2 === void 0 ? {} : { errorCode: errorCode2 }
    };
  }
  async function refreshCredential(startGeneration) {
    if (disposed || startGeneration !== generation) return void 0;
    let record = await options.store.read();
    if (!isActive(startGeneration)) return void 0;
    if (record === void 0) {
      clearObservedCredential();
      return void 0;
    }
    observe(record);
    if (state === "re-login-required") return void 0;
    for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS; attempt += 1) {
      if (!isActive(startGeneration)) return void 0;
      state = "refreshing";
      errorCode2 = void 0;
      const operation = beginOperation();
      let result2;
      try {
        result2 = await runBounded(
          (signal) => refreshAccessToken({ refreshToken: record.refreshToken, signal }),
          operation,
          operationTimeoutMs
        );
        validateRefreshResult(result2);
      } catch (error) {
        endOperation(operation);
        if (!isActive(startGeneration) || isCancelled(error)) return void 0;
        setRefreshFailure(error);
        return void 0;
      }
      endOperation(operation);
      if (!isActive(startGeneration)) return void 0;
      const current = await options.store.read();
      if (!isActive(startGeneration)) return void 0;
      const responseRefreshToken = result2.refreshToken ?? record.refreshToken;
      if (current === void 0) {
        clearObservedCredential();
        return void 0;
      }
      if (sameLineage(current, record) && current.revision !== record.revision) {
        if (current.refreshToken === responseRefreshToken) {
          return adoptRefreshedCredential(result2, current, startGeneration, record);
        }
        record = current;
        observe(record);
        continue;
      }
      if (!sameLineage(current, record)) {
        record = current;
        observe(record);
        continue;
      }
      const committed = await options.store.compareAndCommit(
        record.revision,
        {
          refreshToken: responseRefreshToken,
          projectId: record.projectId,
          ...record.email === void 0 ? {} : { email: record.email },
          ...record.lineage === void 0 ? {} : { lineage: record.lineage }
        },
        record.lineage
      );
      if (committed !== void 0) return adoptRefreshedCredential(result2, committed, startGeneration, record);
      const latest = await options.store.read();
      if (!isActive(startGeneration)) return void 0;
      if (latest === void 0) {
        clearObservedCredential();
        return void 0;
      }
      if (latest.refreshToken === responseRefreshToken && sameLineage(latest, record)) {
        return adoptRefreshedCredential(result2, latest, startGeneration, record);
      }
      record = latest;
      observe(record);
    }
    if (isActive(startGeneration)) {
      state = "refresh-failed";
      errorCode2 = "conflict";
    }
    return void 0;
  }
  async function adoptRefreshedCredential(result2, record, startGeneration, previous) {
    if (!isActive(startGeneration)) return void 0;
    const credential = {
      accessToken: result2.accessToken,
      refreshToken: result2.refreshToken ?? record.refreshToken,
      expiresAt: result2.expiresAt,
      projectId: record.projectId
    };
    cached = { value: credential, revision: record.revision, ...record.lineage === void 0 ? {} : { lineage: record.lineage } };
    observedRevision = record.revision;
    observedLineage = record.lineage;
    state = "logged-in";
    errorCode2 = void 0;
    lastRefreshAt = now();
    if (result2.refreshToken !== void 0) {
      await options.onTokenRotated?.(record, previous);
    }
    if (!isActive(startGeneration)) return void 0;
    return { ...credential };
  }
  async function revokeCredential(record, revokeGeneration, binding) {
    const operation = beginOperation();
    try {
      await runBounded(
        (signal) => revokeGrant({ token: record.refreshToken, signal }),
        operation,
        operationTimeoutMs
      );
    } catch (error) {
      endOperation(operation);
      if (!isActive(revokeGeneration) || isCancelled(error)) return { state: "superseded" };
      const code = toRevokeErrorCode(error);
      revokeStatus = { state: "failed", errorCode: code };
      return { state: "failed", errorCode: code };
    }
    endOperation(operation);
    if (!isActive(revokeGeneration)) return { state: "superseded" };
    let cleared;
    try {
      cleared = await options.store.clearIfCurrent(record.revision, record.lineage);
    } catch {
      if (!isActive(revokeGeneration)) return { state: "superseded" };
      revokeStatus = { state: "failed", errorCode: "storage" };
      return { state: "failed", errorCode: "storage" };
    }
    if (!cleared) {
      if (isActive(revokeGeneration)) revokeStatus = { state: "superseded" };
      return { state: "superseded" };
    }
    const superseded = !isActive(revokeGeneration);
    if (!superseded) {
      cached = void 0;
      observedRevision = 0;
      observedLineage = void 0;
      state = "logged-out";
      errorCode2 = void 0;
      lastRefreshAt = void 0;
      revokeStatus = { state: "revoked" };
    }
    try {
      await binding?.onCleared();
    } catch {
      if (isActive(revokeGeneration)) revokeStatus = { state: "failed", errorCode: "storage" };
      return { state: "failed", errorCode: "storage" };
    }
    return { state: superseded ? "superseded" : "revoked" };
  }
  function matchesBinding(current, expected) {
    if (current === void 0 || expected === void 0) return current === expected;
    return current.revision === expected.revision && current.lineage === expected.lineage && current.refreshToken === expected.refreshToken;
  }
  function isActive(expectedGeneration) {
    return !disposed && expectedGeneration === generation;
  }
  function setRefreshFailure(error) {
    const code = error instanceof CredentialOperationError ? error.code : "network";
    state = code === "invalid-grant" ? "re-login-required" : "refresh-failed";
    errorCode2 = code;
    cached = void 0;
  }
  function sameLineage(left, right) {
    if (left.lineage !== void 0 || right.lineage !== void 0) return left.lineage === right.lineage;
    return left.revision === right.revision;
  }
  function toRevokeErrorCode(error) {
    const code = error instanceof CredentialOperationError ? error.code : "network";
    if (code === "invalid-grant" || code === "conflict" || code === "cancelled") return "http-error";
    return code;
  }
  return coordinator;
}
function createGoogleRefreshTransport(fetchImpl = globalThis.fetch, now = () => Date.now()) {
  return async ({ refreshToken, signal }) => {
    if (!ANTIGRAVITY_CLIENT_ID || !ANTIGRAVITY_CLIENT_SECRET) throw new Error("Configure your own ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET before Antigravity OAuth");
    let response;
    try {
      response = await fetchImpl(ANTIGRAVITY_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          client_id: ANTIGRAVITY_CLIENT_ID,
          client_secret: ANTIGRAVITY_CLIENT_SECRET,
          grant_type: "refresh_token",
          refresh_token: refreshToken
        }),
        signal
      });
    } catch (error) {
      if (isAbortError(error)) throw new CredentialOperationError("cancelled");
      throw new CredentialOperationError("network");
    }
    if (!response.ok && (response.status === 429 || response.status >= 500)) {
      throw responseError(response.status);
    }
    const body = await readJsonBody(response);
    if (!response.ok) throw responseError(response.status, body);
    if (!isRecord2(body) || typeof body.access_token !== "string" || !isBoundedSafeText(body.access_token, 4096)) {
      throw new CredentialOperationError("invalid-response");
    }
    const expiresIn = body.expires_in;
    if (typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0 || expiresIn > MAX_EXPIRES_IN_SECONDS) {
      throw new CredentialOperationError("invalid-response");
    }
    const nextRefreshToken = body.refresh_token;
    if (nextRefreshToken !== void 0 && (typeof nextRefreshToken !== "string" || !isBoundedSafeText(nextRefreshToken, 4096))) {
      throw new CredentialOperationError("invalid-response");
    }
    return {
      accessToken: body.access_token,
      expiresAt: now() + expiresIn * 1e3,
      ...nextRefreshToken === void 0 ? {} : { refreshToken: nextRefreshToken }
    };
  };
}
function createGoogleRevokeTransport(fetchImpl = globalThis.fetch) {
  return async ({ token, signal }) => {
    let response;
    try {
      response = await fetchImpl(ANTIGRAVITY_REVOKE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "*/*" },
        body: new URLSearchParams({ token }),
        signal
      });
    } catch (error) {
      if (isAbortError(error)) throw new CredentialOperationError("cancelled");
      throw new CredentialOperationError("network");
    }
    if (!response.ok) throw responseError(response.status);
  };
}
async function runBounded(operation, parent, timeoutMs) {
  const controller = new AbortController();
  let timer;
  let removeParentAbort;
  const operationPromise = Promise.resolve().then(() => operation(controller.signal));
  operationPromise.catch(() => {
  });
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new CredentialOperationError("timeout"));
      reject(new CredentialOperationError("timeout"));
    }, timeoutMs);
  });
  const abortPromise = new Promise((_, reject) => {
    const abort = () => {
      controller.abort(parent.signal.reason);
      reject(new CredentialOperationError("cancelled"));
    };
    removeParentAbort = () => parent.signal.removeEventListener("abort", abort);
    if (parent.signal.aborted) abort();
    else parent.signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([operationPromise, timeoutPromise, abortPromise]);
  } finally {
    if (timer !== void 0) clearTimeout(timer);
    removeParentAbort?.();
    controller.abort();
  }
}
async function waitForCaller(promise, signal) {
  if (signal === void 0) return await promise;
  if (signal.aborted) throw new CredentialOperationError("cancelled");
  return await new Promise((resolve2, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      reject(new CredentialOperationError("cancelled"));
    };
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve2(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}
async function readJsonBody(response) {
  const length = response.headers.get("content-length");
  if (length !== null && Number.isFinite(Number(length)) && Number(length) > MAX_RESPONSE_BYTES) {
    throw new CredentialOperationError("invalid-response");
  }
  let text;
  try {
    text = await response.text();
  } catch {
    throw new CredentialOperationError("invalid-response");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) throw new CredentialOperationError("invalid-response");
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new CredentialOperationError("invalid-response");
  }
}
function responseError(status, body) {
  if (status === 400 && isRecord2(body) && body.error === "invalid_grant") return new CredentialOperationError("invalid-grant");
  if (status === 408 || status === 504) return new CredentialOperationError("timeout");
  if (status === 429) return new CredentialOperationError("rate-limited");
  if (status >= 500 && status <= 599) return new CredentialOperationError("server-error");
  return new CredentialOperationError("http-error");
}
function validateRefreshResult(value) {
  if (!isRecord2(value) || typeof value.accessToken !== "string" || !isBoundedSafeText(value.accessToken, 4096) || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) {
    throw new CredentialOperationError("invalid-response");
  }
  if (value.refreshToken !== void 0 && (typeof value.refreshToken !== "string" || !isBoundedSafeText(value.refreshToken, 4096))) {
    throw new CredentialOperationError("invalid-response");
  }
}
function isCancelled(error) {
  return error instanceof CredentialOperationError && error.code === "cancelled";
}
function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}
function credentialErrorMessage(code) {
  switch (code) {
    case "invalid-grant":
      return "The Antigravity grant requires login again";
    case "timeout":
      return "The Antigravity authentication request timed out";
    case "rate-limited":
      return "The Antigravity authentication service is rate-limited";
    case "server-error":
      return "The Antigravity authentication service is unavailable";
    case "network":
      return "The Antigravity authentication request failed";
    case "invalid-response":
      return "The Antigravity authentication response was invalid";
    case "conflict":
      return "The Antigravity credential changed while it was refreshing";
    case "storage":
      return "The Antigravity credential store failed";
    case "cancelled":
      return "The Antigravity authentication request was cancelled";
    case "http-error":
      return "The Antigravity authentication service rejected the request";
    default:
      return void 0;
  }
}
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var ANTIGRAVITY_TOKEN_ENDPOINT, ANTIGRAVITY_REVOKE_ENDPOINT, DEFAULT_REFRESH_LEAD_MS, DEFAULT_OPERATION_TIMEOUT_MS, MAX_REFRESH_ATTEMPTS, MAX_RESPONSE_BYTES, MAX_EXPIRES_IN_SECONDS, CredentialOperationError;
var init_credential_coordinator = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/credential-coordinator.ts"() {
    "use strict";
    init_dist();
    init_safe_text();
    ANTIGRAVITY_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
    ANTIGRAVITY_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
    DEFAULT_REFRESH_LEAD_MS = 3e4;
    DEFAULT_OPERATION_TIMEOUT_MS = 1e4;
    MAX_REFRESH_ATTEMPTS = 2;
    MAX_RESPONSE_BYTES = 64 * 1024;
    MAX_EXPIRES_IN_SECONDS = 31536e3;
    CredentialOperationError = class extends Error {
      code;
      constructor(code, message = credentialErrorMessage(code) ?? "The Antigravity credential operation failed") {
        super(message);
        this.name = "CredentialOperationError";
        this.code = code;
      }
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/private-transport-error.ts
var PrivateTransportError;
var init_private_transport_error = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/private-transport-error.ts"() {
    "use strict";
    PrivateTransportError = class extends Error {
      code;
      status;
      /** Whether an upstream could have accepted the request before the failure. */
      accepted;
      constructor(code, message, options = {}) {
        super(message);
        this.name = "PrivateTransportError";
        this.code = code;
        this.accepted = options.accepted ?? true;
        if (options.status !== void 0) this.status = options.status;
      }
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/wire-identity.ts
import { Buffer as Buffer4 } from "node:buffer";
import { attributionHeaders as dshAttributionHeaders } from "@deepseek-ai/dsh-llm";
function buildWireIdentityHeaders() {
  const attribution = readAttributionValue();
  assertSafeHeaderValue("User-Agent", AGY_PROVIDER_USER_AGENT, "WIRE_PROVIDER_HEADER_UNSAFE");
  return Object.freeze({
    "User-Agent": AGY_PROVIDER_USER_AGENT,
    [DSH_ATTRIBUTION_HEADER]: attribution
  });
}
function createWireIdentity() {
  const headers = buildWireIdentityHeaders();
  const headerPairs = (url, request) => {
    assertHttpsEndpoint(url);
    assertClosedObject(request, ["authorization", "body"], "WIRE_REQUEST_OVERRIDE");
    if (typeof request.body !== "string" && !(request.body instanceof Uint8Array)) {
      throw new WireIdentityError("WIRE_REQUEST_BODY_INVALID", "The private request body is not bounded bytes");
    }
    const authorization = validateAuthorization(request.authorization);
    const basePairs = buildAgyCliHeaderPairs(url, {
      method: "POST",
      body: request.body,
      headers: {
        "User-Agent": headers["User-Agent"],
        Authorization: authorization,
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip"
      }
    });
    const result2 = [];
    for (const pair of basePairs) {
      const immutablePair = Object.freeze([pair[0], pair[1]]);
      result2.push(immutablePair);
      if (pair[0] === "User-Agent") {
        result2.push(Object.freeze([DSH_ATTRIBUTION_HEADER, headers[DSH_ATTRIBUTION_HEADER]]));
      }
    }
    return Object.freeze(result2);
  };
  const serialize = (url, request) => {
    const parsed = new URL(url);
    const pairs = headerPairs(url, request);
    const body = typeof request.body === "string" ? Buffer4.from(request.body) : Buffer4.from(request.body);
    const lines = pairs.map(([name2, value]) => `${name2}: ${value}`).join("\r\n");
    const head = Buffer4.from(`POST ${parsed.pathname}${parsed.search} HTTP/1.1\r
${lines}\r
\r
`);
    if (!pairs.some(([name2]) => name2 === "Transfer-Encoding")) return body.byteLength === 0 ? head : Buffer4.concat([head, body]);
    if (body.byteLength === 0) return Buffer4.concat([head, Buffer4.from("0\r\n\r\n")]);
    return Buffer4.concat([
      head,
      Buffer4.from(`${body.byteLength.toString(16)}\r
`),
      body,
      Buffer4.from("\r\n0\r\n\r\n")
    ]);
  };
  return Object.freeze({ headers: () => headers, headerPairs, serialize });
}
function assertWireIdentityInvariant(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WireIdentityError("WIRE_IDENTITY_INVARIANT", "Wire identity headers must be an object");
  }
  const headers = value;
  const expected = ["User-Agent", DSH_ATTRIBUTION_HEADER].sort();
  const keys = Object.keys(headers).sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new WireIdentityError("WIRE_IDENTITY_INVARIANT", "Wire identity headers contain an unexpected field");
  }
  if (headers["User-Agent"] !== AGY_PROVIDER_USER_AGENT) {
    throw new WireIdentityError("WIRE_IDENTITY_INVARIANT", "Wire identity provider headers changed");
  }
  if (headers[DSH_ATTRIBUTION_HEADER] === AGY_PROVIDER_USER_AGENT) {
    throw new WireIdentityError("WIRE_IDENTITY_INVARIANT", "Wire identity attribution was replaced by the provider");
  }
  for (const key of expected) {
    const header = headers[key];
    if (typeof header !== "string") {
      throw new WireIdentityError("WIRE_IDENTITY_INVARIANT", "Wire identity contains a non-text field");
    }
    assertSafeHeaderValue(key, header, "WIRE_IDENTITY_INVARIANT");
  }
}
function readAttributionValue() {
  let value;
  try {
    value = dshAttributionHeaders();
  } catch {
    throw new WireIdentityError("WIRE_ATTRIBUTION_UNAVAILABLE", "DSH attribution could not be constructed");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new WireIdentityError("WIRE_ATTRIBUTION_INVALID", "DSH attribution returned an invalid header set");
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    throw new WireIdentityError("WIRE_ATTRIBUTION_MISSING", "DSH attribution did not contain a User-Agent");
  }
  for (const key of keys) {
    if (!ATTRIBUTION_KEYS.has(key)) {
      throw new WireIdentityError("WIRE_ATTRIBUTION_UNEXPECTED", "DSH attribution contained an unapproved header");
    }
  }
  const lower = value["user-agent"];
  const title = value["User-Agent"];
  if (lower !== void 0 && title !== void 0) {
    throw new WireIdentityError("WIRE_ATTRIBUTION_DUPLICATE", "DSH attribution contained duplicate User-Agent fields");
  }
  const attribution = lower ?? title;
  if (attribution === void 0) {
    throw new WireIdentityError("WIRE_ATTRIBUTION_MISSING", "DSH attribution did not contain a User-Agent");
  }
  if (attribution === AGY_PROVIDER_USER_AGENT) {
    throw new WireIdentityError(
      "WIRE_ATTRIBUTION_PROVIDER_OVERRIDE",
      "DSH attribution was replaced by the Antigravity provider identity"
    );
  }
  assertSafeHeaderValue(DSH_ATTRIBUTION_HEADER, attribution, "WIRE_ATTRIBUTION_UNSAFE");
  return attribution;
}
function validateAuthorization(value) {
  if (typeof value !== "string" || !/^Bearer\s+\S+$/u.test(value)) {
    throw new WireIdentityError("WIRE_REQUEST_UNSAFE_AUTHORIZATION", "The private request authorization value is invalid");
  }
  assertSafeHeaderValue("Authorization", value, "WIRE_REQUEST_UNSAFE_AUTHORIZATION");
  return value;
}
function assertSafeHeaderValue(name2, value, code) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_HEADER_VALUE_LENGTH) {
    throw new WireIdentityError(code, `${name2} is outside the safe header-value bounds`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const codePoint = value.charCodeAt(index);
    if (codePoint < 32 || codePoint === 127) {
      throw new WireIdentityError(code, `${name2} contains an unsafe header character`);
    }
  }
}
function assertHttpsEndpoint(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new WireIdentityError("WIRE_REQUEST_ENDPOINT_INVALID", "The private request endpoint is invalid");
  }
  if (parsed.protocol !== "https:" || !ANTIGRAVITY_WIRE_ORIGINS.some((origin) => origin === parsed.origin) || !ANTIGRAVITY_WIRE_PATHS.some((path) => path === parsed.pathname) || parsed.search.length > 0 && parsed.search !== "?alt=sse" || parsed.hash.length > 0) {
    throw new WireIdentityError("WIRE_REQUEST_ENDPOINT_INVALID", "The private request endpoint is not allowlisted");
  }
}
function assertClosedObject(value, allowedKeys, code) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new WireIdentityError(code, "The wire identity input must be a closed object");
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new WireIdentityError(code, "The wire identity input contains an unapproved override");
  }
}
var DSH_ATTRIBUTION_HEADER, AGY_PROVIDER_USER_AGENT, ANTIGRAVITY_WIRE_ORIGIN, ANTIGRAVITY_WIRE_ORIGINS, ANTIGRAVITY_WIRE_PATHS, MAX_HEADER_VALUE_LENGTH, ATTRIBUTION_KEYS, WireIdentityError;
var init_wire_identity = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/wire-identity.ts"() {
    "use strict";
    init_dist();
    DSH_ATTRIBUTION_HEADER = "X-DeepSeek-Harness-Attribution";
    AGY_PROVIDER_USER_AGENT = buildAntigravityHarnessUserAgent();
    ANTIGRAVITY_WIRE_ORIGIN = new URL(ANTIGRAVITY_ENDPOINT).origin;
    ANTIGRAVITY_WIRE_ORIGINS = Object.freeze([
      new URL(ANTIGRAVITY_ENDPOINT).origin,
      new URL(ANTIGRAVITY_ENDPOINT_PROD).origin
    ]);
    ANTIGRAVITY_WIRE_PATHS = Object.freeze([
      "/v1internal:loadCodeAssist",
      "/v1internal:streamGenerateContent",
      "/v1internal:generateContent",
      "/v1internal:retrieveUserQuotaSummary",
      "/v1internal:fetchAvailableModels"
    ]);
    MAX_HEADER_VALUE_LENGTH = 1024;
    ATTRIBUTION_KEYS = /* @__PURE__ */ new Set(["user-agent", "User-Agent"]);
    WireIdentityError = class extends Error {
      code;
      constructor(code, message) {
        super(message);
        this.name = "WireIdentityError";
        this.code = code;
      }
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/raw-http.ts
import { Buffer as Buffer5 } from "node:buffer";
import * as net from "node:net";
import { PassThrough, Transform } from "node:stream";
import * as tls from "node:tls";
import { createGunzip } from "node:zlib";
function createRawPrivateDispatcher() {
  const wire = createWireIdentity();
  return async (input) => {
    if (input.signal?.aborted === true) throw cancelled(false);
    const url = new URL(input.url);
    const request = wire.serialize(input.url, {
      authorization: `Bearer ${input.accessToken}`,
      body: input.body
    });
    const socket = await connectTls(url, input.responseHeaderTimeoutMs, input.signal);
    let dispatched = false;
    try {
      if (isAborted(input.signal)) throw cancelled(false);
      socket.write(request);
      dispatched = true;
      const { head, leftover } = await waitForHead(socket, input.responseHeaderTimeoutMs, dispatched, input.signal);
      const parsed = parseResponseHead(head);
      const body = buildResponseBody(socket, leftover, parsed, input.signal);
      return new Response(body, {
        status: parsed.status,
        statusText: parsed.statusText,
        headers: parsed.headers
      });
    } catch (error) {
      socket.destroy();
      if (error instanceof PrivateTransportError) throw error;
      throw new PrivateTransportError("offline", "The private endpoint could not be reached", { accepted: dispatched });
    }
  };
}
async function connectTls(url, timeoutMs, signal) {
  const proxy = httpsProxy(url);
  return proxy === void 0 ? connectDirect(url, timeoutMs, signal) : connectThroughProxy(proxy, url, timeoutMs, signal);
}
async function connectDirect(url, timeoutMs, signal) {
  const socket = tls.connect({
    host: url.hostname,
    port: Number(url.port || DEFAULT_HTTPS_PORT),
    servername: url.hostname
  });
  await waitForConnect(socket, "secureConnect", timeoutMs, signal);
  return socket;
}
async function connectThroughProxy(proxy, target, timeoutMs, signal) {
  const proxyAuthorization = proxyAuthorizationHeader(proxy);
  const proxySocket = net.connect({
    host: proxy.hostname,
    port: Number(proxy.port || DEFAULT_PROXY_PORT)
  });
  await waitForConnect(proxySocket, "connect", timeoutMs, signal);
  const targetPort = Number(target.port || DEFAULT_HTTPS_PORT);
  proxySocket.write(
    `CONNECT ${target.hostname}:${targetPort} HTTP/1.1\r
Host: ${target.hostname}:${targetPort}\r
` + proxyAuthorization + "\r\n"
  );
  const { head, leftover } = await waitForHead(proxySocket, timeoutMs, false, signal);
  if (!/^HTTP\/1\.[01]\s+2\d\d(?:\s|$)/u.test(head.split("\r\n", 1)[0] ?? "")) {
    proxySocket.destroy();
    throw new PrivateTransportError("offline", "The HTTPS proxy rejected the private connection", { accepted: false });
  }
  if (leftover.byteLength > 0) proxySocket.unshift(leftover);
  proxySocket.resume();
  const socket = tls.connect({ socket: proxySocket, servername: target.hostname });
  await waitForConnect(socket, "secureConnect", timeoutMs, signal);
  return socket;
}
async function waitForConnect(socket, event, timeoutMs, signal) {
  await new Promise((resolve2, reject) => {
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener(event, onConnect);
      socket.removeListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onConnect = () => finish(resolve2);
    const onError = () => finish(() => reject(new PrivateTransportError("offline", "The private endpoint could not be reached", { accepted: false })));
    const onAbort = () => finish(() => {
      socket.destroy();
      reject(cancelled(false));
    });
    const timer = setTimeout(() => finish(() => {
      socket.destroy();
      reject(new PrivateTransportError("timeout", "The private endpoint connection timed out", { accepted: false }));
    }), timeoutMs);
    socket.once(event, onConnect);
    socket.once("error", onError);
    if (signal?.aborted === true) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function waitForHead(socket, timeoutMs, accepted, signal) {
  return new Promise((resolve2, reject) => {
    let buffer = Buffer5.alloc(0);
    let settled = false;
    const finish = (action) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onError = (error) => finish(() => reject(
      error instanceof PrivateTransportError ? error : new PrivateTransportError("offline", "The private endpoint closed before response headers", { accepted })
    ));
    const onAbort = () => finish(() => {
      socket.destroy();
      reject(cancelled(accepted));
    });
    const onData = (chunk) => {
      buffer = Buffer5.concat([buffer, chunk]);
      const marker = buffer.indexOf("\r\n\r\n");
      if (marker < 0) {
        if (buffer.byteLength > MAX_RESPONSE_HEAD_BYTES) finish(() => reject(new PrivateTransportError("protocol-drift", "The private response headers exceeded the limit", { accepted })));
        return;
      }
      if (marker > MAX_RESPONSE_HEAD_BYTES) {
        finish(() => reject(new PrivateTransportError("protocol-drift", "The private response headers exceeded the limit", { accepted })));
        return;
      }
      socket.pause();
      const head = buffer.subarray(0, marker).toString("latin1");
      const leftover = buffer.subarray(marker + 4);
      finish(() => resolve2({ head, leftover }));
    };
    const timer = setTimeout(() => finish(() => {
      socket.destroy();
      reject(new PrivateTransportError("timeout", "The private request timed out before response headers", { accepted }));
    }), timeoutMs);
    socket.on("data", onData);
    socket.once("error", onError);
    if (signal?.aborted === true) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}
function parseResponseHead(value) {
  const lines = value.split("\r\n");
  const statusLine = lines.shift() ?? "";
  const match = /^HTTP\/1\.[01]\s+(\d{3})(?:\s+([^\r\n]*))?$/u.exec(statusLine);
  if (match === null) throw new PrivateTransportError("protocol-drift", "The private response status line was malformed");
  const status = Number(match[1]);
  if (status < 200 || status > 599 || hasInvalidHeaderValue(match[2] ?? "")) throw new PrivateTransportError("protocol-drift", "The private response status was unsupported");
  const headers = new Headers();
  let chunked = false;
  let gzip = false;
  let contentLength;
  for (const line of lines) {
    if (line.length === 0 || /^[ \t]/u.test(line)) throw new PrivateTransportError("protocol-drift", "The private response headers were malformed");
    const separator = line.indexOf(":");
    if (separator <= 0) throw new PrivateTransportError("protocol-drift", "The private response headers were malformed");
    const name2 = line.slice(0, separator);
    const raw = line.slice(separator + 1).trim();
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name2) || hasInvalidHeaderValue(raw)) {
      throw new PrivateTransportError("protocol-drift", "The private response headers were malformed");
    }
    const lowerName = name2.toLowerCase();
    const lowerValue = raw.toLowerCase();
    if (lowerName === "transfer-encoding") {
      if (chunked || lowerValue !== "chunked") throw new PrivateTransportError("protocol-drift", "The private response framing was unsupported");
      chunked = true;
      continue;
    }
    if (lowerName === "content-encoding") {
      if (gzip || lowerValue !== "gzip") throw new PrivateTransportError("protocol-drift", "The private response encoding was unsupported");
      gzip = true;
      continue;
    }
    if (lowerName === "content-length") {
      if (contentLength !== void 0 || !/^\d+$/u.test(raw)) throw new PrivateTransportError("protocol-drift", "The private response length was ambiguous");
      const parsed = Number(raw);
      if (!Number.isSafeInteger(parsed) || parsed < 0) throw new PrivateTransportError("protocol-drift", "The private response length was malformed");
      contentLength = parsed;
      continue;
    }
    headers.append(name2, raw);
  }
  if (chunked && contentLength !== void 0) throw new PrivateTransportError("protocol-drift", "The private response framing was ambiguous");
  if (!gzip && contentLength !== void 0) headers.set("content-length", String(contentLength));
  return {
    status,
    statusText: match[2] ?? "",
    headers,
    chunked,
    gzip,
    ...contentLength === void 0 ? {} : { contentLength }
  };
}
function buildResponseBody(socket, leftover, head, signal) {
  const source = new PassThrough();
  let current = source;
  if (head.chunked) current = pipeStage(current, new ChunkedDecoder());
  else if (head.contentLength !== void 0) current = pipeStage(current, new ContentLengthDecoder(head.contentLength));
  if (head.gzip) {
    const gunzip = createGunzip();
    current = pipeStage(current, gunzip);
    current = pipeStage(current, new PassThrough(), () => new PrivateTransportError("protocol-drift", "The private gzip response was malformed"));
  }
  const abort = () => {
    socket.destroy(cancelled(true));
  };
  const cleanup = () => {
    signal?.removeEventListener("abort", abort);
    socket.destroy();
  };
  socket.once("error", (error) => source.destroy(
    error instanceof PrivateTransportError ? error : new PrivateTransportError("offline", "The private response stream failed")
  ));
  if (leftover.byteLength > 0) source.write(leftover);
  socket.pipe(source);
  socket.resume();
  if (signal?.aborted === true) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  current.once("end", cleanup);
  current.once("error", cleanup);
  current.once("close", cleanup);
  return toWebBody(current);
}
function toWebBody(stream) {
  const iterable = {
    [Symbol.asyncIterator]: () => {
      const iterator = stream[Symbol.asyncIterator]();
      return {
        next: () => iterator.next(),
        return: async () => {
          stream.destroy();
          return iterator.return === void 0 ? { done: true, value: void 0 } : await iterator.return();
        }
      };
    }
  };
  return ReadableStream.from(iterable);
}
function pipeStage(source, target, mapError = (error) => error) {
  source.once("error", (error) => target.destroy(mapError(error)));
  return source.pipe(target);
}
function proxyAuthorizationHeader(proxy) {
  if (proxy.username.length === 0) return "";
  let username;
  let password;
  try {
    username = decodeURIComponent(proxy.username);
    password = decodeURIComponent(proxy.password);
  } catch {
    throw new PrivateTransportError("offline", "The configured HTTPS proxy credentials are invalid", { accepted: false });
  }
  if (username.length > 1024 || password.length > 1024 || username.includes(":") || hasInvalidHeaderValue(username) || hasInvalidHeaderValue(password)) {
    throw new PrivateTransportError("offline", "The configured HTTPS proxy credentials are invalid", { accepted: false });
  }
  return `Proxy-Authorization: Basic ${Buffer5.from(`${username}:${password}`).toString("base64")}\r
`;
}
function httpsProxy(url) {
  const noProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  if (matchesNoProxy(url.hostname, noProxy)) return void 0;
  const raw = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.ALL_PROXY ?? process.env.all_proxy;
  if (raw === void 0 || raw.length === 0) return void 0;
  try {
    const proxy = new URL(raw);
    if (proxy.protocol !== "http:") throw new PrivateTransportError("offline", "The configured HTTPS proxy protocol is unsupported", { accepted: false });
    return proxy;
  } catch (error) {
    if (error instanceof PrivateTransportError) throw error;
    throw new PrivateTransportError("offline", "The configured HTTPS proxy URL is invalid", { accepted: false });
  }
}
function matchesNoProxy(hostname, value) {
  const host = hostname.toLowerCase();
  return value.split(",").map((item) => item.trim().toLowerCase()).some((item) => item === "*" || (item.startsWith(".") ? host.endsWith(item) : item.length > 0 && (host === item || host.endsWith(`.${item}`))));
}
function hasInvalidHeaderValue(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 && code !== 9 || code === 127) return true;
  }
  return false;
}
function isAborted(signal) {
  return signal?.aborted === true;
}
function cancelled(accepted) {
  return new PrivateTransportError("cancelled", "The private request was cancelled", { accepted });
}
var DEFAULT_HTTPS_PORT, DEFAULT_PROXY_PORT, MAX_RESPONSE_HEAD_BYTES, ContentLengthDecoder, ChunkedDecoder;
var init_raw_http = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/raw-http.ts"() {
    "use strict";
    init_private_transport_error();
    init_wire_identity();
    DEFAULT_HTTPS_PORT = 443;
    DEFAULT_PROXY_PORT = 8080;
    MAX_RESPONSE_HEAD_BYTES = 64 * 1024;
    ContentLengthDecoder = class extends Transform {
      remaining;
      constructor(contentLength) {
        super();
        this.remaining = contentLength;
        if (contentLength === 0) this.push(null);
      }
      _transform(chunk, _encoding, callback) {
        if (this.remaining <= 0 || chunk.byteLength > this.remaining) {
          callback(new PrivateTransportError("protocol-drift", "The private response exceeded its declared length"));
          return;
        }
        this.remaining -= chunk.byteLength;
        this.push(chunk);
        if (this.remaining === 0) this.push(null);
        callback();
      }
      _flush(callback) {
        callback(this.remaining === 0 ? void 0 : new PrivateTransportError("protocol-drift", "The private response ended before its declared length"));
      }
    };
    ChunkedDecoder = class extends Transform {
      buffer = Buffer5.alloc(0);
      finished = false;
      _transform(chunk, _encoding, callback) {
        if (this.finished && chunk.byteLength > 0) {
          callback(new PrivateTransportError("protocol-drift", "The private chunked response contained trailing bytes"));
          return;
        }
        this.buffer = Buffer5.concat([this.buffer, chunk]);
        try {
          this.flushChunks();
          callback();
        } catch (error) {
          callback(error instanceof Error ? error : new PrivateTransportError("protocol-drift", "The private chunked response was malformed"));
        }
      }
      _flush(callback) {
        try {
          this.flushChunks();
          callback(this.finished ? void 0 : new PrivateTransportError("protocol-drift", "The private chunked response ended early"));
        } catch (error) {
          callback(error instanceof Error ? error : new PrivateTransportError("protocol-drift", "The private chunked response was malformed"));
        }
      }
      flushChunks() {
        while (!this.finished) {
          const lineEnd = this.buffer.indexOf("\r\n");
          if (lineEnd < 0) return;
          const sizeText = this.buffer.subarray(0, lineEnd).toString("latin1").split(";", 1)[0]?.trim() ?? "";
          if (!/^[0-9A-Fa-f]+$/u.test(sizeText)) throw new PrivateTransportError("protocol-drift", "The private chunk size was malformed");
          const size = Number.parseInt(sizeText, 16);
          if (!Number.isSafeInteger(size) || size < 0) throw new PrivateTransportError("protocol-drift", "The private chunk size was malformed");
          const chunkStart = lineEnd + 2;
          const chunkEnd = chunkStart + size;
          const end = chunkEnd + 2;
          if (!Number.isSafeInteger(end)) throw new PrivateTransportError("protocol-drift", "The private chunk size was malformed");
          if (this.buffer.byteLength < end) return;
          if (this.buffer[chunkEnd] !== 13 || this.buffer[chunkEnd + 1] !== 10) throw new PrivateTransportError("protocol-drift", "The private chunk terminator was malformed");
          const payload = this.buffer.subarray(chunkStart, chunkEnd);
          this.buffer = this.buffer.subarray(end);
          if (size === 0) {
            if (this.buffer.byteLength > 0) throw new PrivateTransportError("protocol-drift", "The private chunked response contained trailing bytes");
            this.finished = true;
            this.push(null);
            return;
          }
          this.push(payload);
        }
      }
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/private-transport.ts
function createPrivateTransport(options = {}) {
  let dispatch;
  const headerTimeoutMs = boundedTimeout(options.responseHeaderTimeoutMs, DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS);
  const maxRequestBytes = boundedRequestBytes(options.maxRequestBytes);
  return {
    request: async (input) => {
      if (isAborted2(input.signal)) throw cancelledError(false);
      const requestBytes = typeof input.body === "string" ? new TextEncoder().encode(input.body).byteLength : input.body.byteLength;
      if (requestBytes > maxRequestBytes) throw new PrivateTransportError("request-too-large", "The private request exceeded the byte limit", { accepted: false });
      if (dispatch === void 0) {
        try {
          dispatch = createRawPrivateDispatcher();
        } catch {
          throw new PrivateTransportError("attribution-rejected", "The private request identity could not be constructed", { accepted: false });
        }
      }
      const response = await dispatch({
        url: input.url,
        accessToken: input.accessToken,
        body: input.body,
        ...input.signal === void 0 ? {} : { signal: input.signal },
        responseHeaderTimeoutMs: boundedTimeout(input.responseHeaderTimeoutMs, headerTimeoutMs)
      });
      if (!(response instanceof Response)) throw new PrivateTransportError("invalid-response", "The private endpoint returned no response");
      return response;
    }
  };
}
function privateStatusError(status) {
  if (status >= 200 && status < 300) return void 0;
  if (status === 400) return new PrivateTransportError("protocol-drift", "The private endpoint rejected the request as invalid", { status });
  if (status === 401) return new PrivateTransportError("authentication", "The private endpoint requires authentication", { status });
  if (status === 403) return new PrivateTransportError("forbidden", "The private endpoint forbade this account", { status });
  if (status === 429) return new PrivateTransportError("rate-limited", "The private endpoint is rate-limited", { status });
  if (status >= 500) return new PrivateTransportError("upstream", "The private endpoint is unavailable", { status });
  return new PrivateTransportError("protocol-drift", "The private endpoint returned an unexpected status", { status });
}
async function readPrivateBytes(response, options = {}) {
  const maxBytes = boundedBytes(options.maxBytes, DEFAULT_PRIVATE_RESPONSE_BYTES);
  if (response.body === null) {
    try {
      const data = new Uint8Array(await response.arrayBuffer());
      if (data.byteLength > maxBytes) throw new PrivateTransportError("response-too-large", "The private response exceeded the byte limit");
      return data;
    } catch (error) {
      if (error instanceof PrivateTransportError) throw error;
      if (isAborted2(options.signal)) throw cancelledError();
      throw new PrivateTransportError("offline", "The private response body could not be read");
    }
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  const startedAt = Date.now();
  try {
    for (; ; ) {
      const chunk = await readChunk(reader, options, startedAt);
      if (chunk.done) break;
      const value = chunk.value;
      total += value.byteLength;
      if (total > maxBytes) {
        await cancelReader(reader);
        throw new PrivateTransportError("response-too-large", "The private response exceeded the byte limit");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof PrivateTransportError) throw error;
    if (isAborted2(options.signal)) throw cancelledError();
    throw new PrivateTransportError("offline", "The private response body could not be read");
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
async function readPrivateText(response, options = {}) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(await readPrivateBytes(response, options));
  } catch (error) {
    if (error instanceof PrivateTransportError) throw error;
    throw new PrivateTransportError("invalid-response", "The private response was not valid UTF-8");
  }
}
async function* iteratePrivateSse(response, options = {}) {
  const maxBytes = boundedBytes(options.maxBytes, DEFAULT_PRIVATE_RESPONSE_BYTES);
  const maxFrameBytes = boundedBytes(options.maxFrameBytes, DEFAULT_PRIVATE_FRAME_BYTES);
  if (response.body === null) {
    const text = await readPrivateText(response, options);
    if (text.trim().length > 0) yield { data: text.trim() };
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let eventName;
  let dataLines = [];
  let bytes = 0;
  let frameBytes = 0;
  let sawSseFrame = false;
  let plainText = "";
  const startedAt = Date.now();
  const flush = () => {
    if (dataLines.length === 0) {
      eventName = void 0;
      frameBytes = 0;
      return void 0;
    }
    const data = dataLines.join("\n");
    const event = eventName;
    dataLines = [];
    eventName = void 0;
    frameBytes = 0;
    sawSseFrame = true;
    return event === void 0 ? { data } : { data, event };
  };
  try {
    for (; ; ) {
      const chunk = await readChunk(reader, options, startedAt);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new PrivateTransportError("response-too-large", "The private response exceeded the byte limit");
      let decoded;
      try {
        decoded = decoder.decode(chunk.value, { stream: true });
      } catch {
        throw new PrivateTransportError("invalid-response", "The private response was not valid UTF-8");
      }
      plainText += decoded;
      buffer += decoded;
      for (; ; ) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) break;
        let line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (utf8Bytes(line) > maxFrameBytes) throw new PrivateTransportError("frame-too-large", "The private response frame exceeded the byte limit");
        if (line.length === 0) {
          const event2 = flush();
          if (event2 !== void 0) yield event2;
          continue;
        }
        if (line.startsWith(":")) continue;
        frameBytes += utf8Bytes(line) + 1;
        if (frameBytes > maxFrameBytes) throw new PrivateTransportError("frame-too-large", "The private response frame exceeded the byte limit");
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim() || void 0;
        } else if (line.startsWith("data:")) {
          const value = line.slice("data:".length).replace(/^ /u, "");
          dataLines.push(value);
        }
      }
    }
    let tail;
    try {
      tail = decoder.decode();
    } catch {
      throw new PrivateTransportError("invalid-response", "The private response was not valid UTF-8");
    }
    plainText += tail;
    buffer += tail;
    if (buffer.length > 0) {
      frameBytes += utf8Bytes(buffer);
      if (frameBytes > maxFrameBytes) throw new PrivateTransportError("frame-too-large", "The private response frame exceeded the byte limit");
      if (buffer.startsWith("data:")) dataLines.push(buffer.slice(5).replace(/^ /u, ""));
    }
    const event = flush();
    if (event !== void 0) yield event;
    if (!sawSseFrame && plainText.trim().length > 0) yield { data: plainText.trim() };
  } catch (error) {
    if (error instanceof PrivateTransportError) throw error;
    if (isAborted2(options.signal)) throw cancelledError();
    throw new PrivateTransportError("offline", "The private response stream could not be read");
  } finally {
    await cancelReader(reader);
    reader.releaseLock();
  }
}
function assertPrivateEndpoint(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new PrivateTransportError("protocol-drift", "The private endpoint URL is invalid");
  }
  if (parsed.origin !== ANTIGRAVITY_WIRE_ORIGIN || parsed.protocol !== "https:" || parsed.search || parsed.hash) {
    throw new PrivateTransportError("protocol-drift", "The private endpoint URL is not allowlisted");
  }
}
async function readChunk(reader, options, startedAt) {
  if (isAborted2(options.signal)) {
    await cancelReader(reader);
    throw cancelledError();
  }
  const totalTimeout = boundedTimeout(options.totalTimeoutMs, DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS);
  const elapsed = Date.now() - startedAt;
  if (elapsed >= totalTimeout) {
    await cancelReader(reader);
    throw new PrivateTransportError("timeout", "The private response exceeded the total timeout");
  }
  const idleTimeout = boundedTimeout(options.idleTimeoutMs, DEFAULT_PRIVATE_IDLE_TIMEOUT_MS);
  let timer;
  let removeAbort;
  const abort = new Promise((_, reject) => {
    const onAbort = () => reject(cancelledError());
    removeAbort = () => options.signal?.removeEventListener("abort", onAbort);
    if (options.signal === void 0) return;
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener("abort", onAbort, { once: true });
  });
  const idle = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new PrivateTransportError("timeout", "The private response stream stalled")), idleTimeout);
  });
  let totalHandle;
  const remaining = totalTimeout - elapsed;
  const total = new Promise((_, reject) => {
    totalHandle = setTimeout(() => reject(new PrivateTransportError("timeout", "The private response exceeded the total timeout")), remaining);
  });
  try {
    return await Promise.race([reader.read(), abort, idle, total]);
  } catch (error) {
    await cancelReader(reader);
    throw error;
  } finally {
    if (timer !== void 0) clearTimeout(timer);
    if (totalHandle !== void 0) clearTimeout(totalHandle);
    removeAbort?.();
  }
}
function utf8Bytes(value) {
  return new TextEncoder().encode(value).byteLength;
}
function isAborted2(signal) {
  return signal !== void 0 && signal.aborted;
}
async function cancelReader(reader) {
  try {
    await reader.cancel();
  } catch {
  }
}
function cancelledError(accepted = true) {
  return new PrivateTransportError("cancelled", "The private request was cancelled", { accepted });
}
function boundedTimeout(value, fallback) {
  return value === void 0 || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), 10 * 60 * 1e3);
}
function boundedRequestBytes(value) {
  return value === void 0 || !Number.isFinite(value) || value <= 0 ? DEFAULT_PRIVATE_REQUEST_BYTES : Math.min(Math.floor(value), MAX_PRIVATE_REQUEST_BYTES);
}
function boundedBytes(value, fallback) {
  return value === void 0 || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), fallback);
}
var DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS, DEFAULT_PRIVATE_IDLE_TIMEOUT_MS, DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS, DEFAULT_PRIVATE_RESPONSE_BYTES, DEFAULT_PRIVATE_REQUEST_BYTES, MAX_PRIVATE_REQUEST_BYTES, DEFAULT_PRIVATE_FRAME_BYTES;
var init_private_transport = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/private-transport.ts"() {
    "use strict";
    init_raw_http();
    init_private_transport_error();
    init_wire_identity();
    init_private_transport_error();
    DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS = 18e4;
    DEFAULT_PRIVATE_IDLE_TIMEOUT_MS = 6e4;
    DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS = 3e5;
    DEFAULT_PRIVATE_RESPONSE_BYTES = 8 * 1024 * 1024;
    DEFAULT_PRIVATE_REQUEST_BYTES = 16 * 1024 * 1024;
    MAX_PRIVATE_REQUEST_BYTES = 64 * 1024 * 1024;
    DEFAULT_PRIVATE_FRAME_BYTES = 512 * 1024;
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/private-failure.ts
function classifyPrivateFailure(error) {
  if (!(error instanceof PrivateTransportError)) return "failed";
  switch (error.code) {
    case "authentication":
      return "authentication";
    case "forbidden":
      return "forbidden";
    case "rate-limited":
      return "rate-limited";
    case "cancelled":
      return "cancelled";
    case "timeout":
      return "timeout";
    case "attribution-rejected":
      return "attribution-rejected";
    case "protocol-drift":
    case "invalid-response":
      return "protocol-drift";
    case "response-too-large":
    case "frame-too-large":
      return "response-limit";
    case "request-too-large":
      return "request-limit";
    case "upstream":
      return "upstream";
    case "offline":
      return "network";
  }
}
var init_private_failure = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/private-failure.ts"() {
    "use strict";
    init_private_transport_error();
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/project-context.ts
function createProjectDiscovery(options = {}) {
  const timeoutMs = boundedTimeout2(options.operationTimeoutMs);
  const transport = options.transport ?? createPrivateTransport({
    ...options.transportOptions?.responseHeaderTimeoutMs === void 0 ? {} : { responseHeaderTimeoutMs: options.transportOptions.responseHeaderTimeoutMs },
    ...options.transportOptions?.maxRequestBytes === void 0 ? {} : { maxRequestBytes: options.transportOptions.maxRequestBytes }
  });
  return {
    discover: async (accessToken, signal) => {
      if (signal?.aborted === true) throw new ProjectDiscoveryError("cancelled");
      const body = JSON.stringify({ metadata: buildAntigravityLoadCodeAssistMetadata() });
      let response;
      try {
        response = await transport.request({
          url: PROJECT_DISCOVERY_ENDPOINT,
          accessToken,
          body,
          ...signal === void 0 ? {} : { signal },
          responseHeaderTimeoutMs: timeoutMs
        });
      } catch (error) {
        throw mapTransportError(error);
      }
      const statusError = privateStatusError(response.status);
      if (statusError !== void 0) {
        await response.body?.cancel().catch(() => {
        });
        throw mapTransportError(statusError);
      }
      try {
        const text = await readPrivateText(response, {
          ...signal === void 0 ? {} : { signal },
          idleTimeoutMs: Math.min(timeoutMs, DEFAULT_PRIVATE_IDLE_TIMEOUT_MS),
          totalTimeoutMs: Math.min(timeoutMs, DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS),
          maxBytes: MAX_RESPONSE_BYTES2
        });
        let value;
        try {
          value = JSON.parse(text);
        } catch {
          throw new ProjectDiscoveryError("malformed");
        }
        return parseProjectResponse(value);
      } catch (error) {
        if (error instanceof ProjectDiscoveryError) throw error;
        throw mapTransportError(error);
      }
    }
  };
}
function normalizeProjectId(value) {
  if (typeof value !== "string") return void 0;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_PROJECT_ID_LENGTH) return void 0;
  return PROJECT_ID_PATTERN.test(normalized) ? normalized : void 0;
}
function parseProjectResponse(value) {
  if (!isRecord3(value)) throw new ProjectDiscoveryError("malformed");
  if (!Object.prototype.hasOwnProperty.call(value, "cloudaicompanionProject")) return void 0;
  const candidate = value.cloudaicompanionProject;
  if (candidate === null || candidate === void 0) return void 0;
  if (typeof candidate === "string") {
    if (candidate.trim().length === 0) return void 0;
    return projectFromValue(candidate);
  }
  if (!isRecord3(candidate)) throw new ProjectDiscoveryError("protocol-drift");
  if (!Object.prototype.hasOwnProperty.call(candidate, "id")) return void 0;
  if (candidate.id === null || candidate.id === void 0) throw new ProjectDiscoveryError("protocol-drift");
  return projectFromValue(candidate.id);
}
function projectFromValue(value) {
  const projectId = normalizeProjectId(value);
  if (projectId === void 0) throw new ProjectDiscoveryError("protocol-drift");
  return { projectId };
}
function boundedTimeout2(value) {
  if (value === void 0 || !Number.isFinite(value) || value <= 0) return DEFAULT_OPERATION_TIMEOUT_MS2;
  return Math.min(Math.floor(value), MAX_OPERATION_TIMEOUT_MS);
}
function mapTransportError(error) {
  if (error instanceof ProjectDiscoveryError) return error;
  if (error instanceof PrivateTransportError) return new ProjectDiscoveryError(PROJECT_FAILURE_CODES[classifyPrivateFailure(error)]);
  return new ProjectDiscoveryError("offline");
}
function projectDiscoveryErrorMessage(code) {
  if (code === "authentication") return "The Antigravity project probe requires authentication";
  if (code === "forbidden") return "The Antigravity project probe was forbidden";
  if (code === "rate-limited") return "The Antigravity project probe is rate-limited";
  if (code === "offline") return "The Antigravity project probe is offline";
  if (code === "malformed") return "The Antigravity project response was malformed";
  if (code === "protocol-drift") return "The Antigravity project protocol changed";
  return "The Antigravity project probe was cancelled";
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var PROJECT_DISCOVERY_PATH, PROJECT_DISCOVERY_ENDPOINT, MAX_RESPONSE_BYTES2, DEFAULT_OPERATION_TIMEOUT_MS2, MAX_OPERATION_TIMEOUT_MS, MAX_PROJECT_ID_LENGTH, PROJECT_ID_PATTERN, ProjectDiscoveryError, createProjectContext, PROJECT_FAILURE_CODES;
var init_project_context = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/project-context.ts"() {
    "use strict";
    init_dist();
    init_private_transport();
    init_wire_identity();
    init_private_failure();
    PROJECT_DISCOVERY_PATH = "/v1internal:loadCodeAssist";
    PROJECT_DISCOVERY_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}${PROJECT_DISCOVERY_PATH}`;
    MAX_RESPONSE_BYTES2 = Math.min(DEFAULT_PRIVATE_RESPONSE_BYTES, 64 * 1024);
    DEFAULT_OPERATION_TIMEOUT_MS2 = 1e4;
    MAX_OPERATION_TIMEOUT_MS = 10 * 60 * 1e3;
    MAX_PROJECT_ID_LENGTH = 128;
    PROJECT_ID_PATTERN = /^[a-z][a-z0-9-]{2,127}$/u;
    ProjectDiscoveryError = class extends Error {
      code;
      constructor(code, message = projectDiscoveryErrorMessage(code)) {
        super(message);
        this.name = "ProjectDiscoveryError";
        this.code = code;
      }
    };
    createProjectContext = createProjectDiscovery;
    PROJECT_FAILURE_CODES = {
      authentication: "authentication",
      forbidden: "forbidden",
      "rate-limited": "rate-limited",
      cancelled: "cancelled",
      timeout: "offline",
      "attribution-rejected": "protocol-drift",
      "protocol-drift": "protocol-drift",
      "response-limit": "protocol-drift",
      "request-limit": "protocol-drift",
      upstream: "offline",
      network: "offline",
      failed: "offline"
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/oauth-flow.ts
import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";
import { createServer } from "node:http";
function createOAuthFlow(options = {}) {
  const clock = options.clock ?? systemClock();
  const random = options.randomBytes ?? ((size) => nodeRandomBytes(size));
  const listenerFactory = options.listenerFactory ?? createNodeLoopbackListenerFactory();
  const exchangeCode = options.exchangeCode ?? createGoogleTokenExchanger(options.fetchImpl ?? fetch, clock);
  const validateProject = options.validateProject ?? (async () => void 0);
  const commit = options.commit ?? (async () => {
  });
  const ttlMs = options.ttlMs ?? OAUTH_FLOW_TTL_MS;
  let pending;
  let processing;
  let generation = 0;
  let committingGeneration;
  let currentStatus = { phase: "idle" };
  let disposed = false;
  let listenerClosing = Promise.resolve();
  const closeListener = (candidate) => {
    const listener = candidate.listener;
    candidate.listener = void 0;
    if (listener === void 0) return listenerClosing;
    listenerClosing = listenerClosing.then(
      () => Promise.resolve(listener.close()).catch(() => {
      }),
      () => Promise.resolve(listener.close()).catch(() => {
      })
    );
    return listenerClosing;
  };
  const flow = {
    generation: () => committingGeneration ?? generation,
    start: async () => {
      if (disposed) throw new OAuthFlowError("internal", "The OAuth flow is unavailable");
      if (pending !== void 0) await cancelPending(pending, "cancelled");
      if (processing !== void 0) {
        if (!processing.commitStarted) {
          processing.controller.abort(new OAuthFlowError("cancelled", "The OAuth login was cancelled"));
        }
        processing = void 0;
      }
      const verifier = encodeBase64Url(randomBytes(random, 32));
      const state = encodeBase64Url(randomBytes(random, 32));
      const authorizationUrl = buildAuthorizationUrl(state, verifier);
      const expiresAt = clock.now() + ttlMs;
      const controller = new AbortController();
      const candidateGeneration = generation + 1;
      generation = candidateGeneration;
      const candidate = {
        authorizationUrl,
        expiresAt,
        state,
        verifier,
        controller,
        generation: candidateGeneration,
        timeout: clock.setTimeout(() => {
          void expire(candidate);
        }, ttlMs),
        active: true,
        commitStarted: false
      };
      pending = candidate;
      currentStatus = {
        phase: "pending",
        authorizationUrl,
        expiresAt: new Date(expiresAt).toISOString()
      };
      try {
        await listenerClosing;
        if (!candidate.active || pending !== candidate) {
          throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
        }
        candidate.listener = await listenerFactory.listen((request) => handleLoopbackRequest(request));
        if (!candidate.active || pending !== candidate) {
          await closeListener(candidate);
          throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
        }
      } catch (error) {
        clock.clearTimeout(candidate.timeout);
        if (pending === candidate) pending = void 0;
        candidate.active = false;
        const safe = asListenerError(error);
        updateStatus(candidate, {
          phase: safe.code === "port-conflict" ? "port-conflict" : "failed",
          errorCode: safe.code
        });
        throw safe;
      }
      return { started: true, phase: "pending", authorizationUrl, expiresAt: new Date(expiresAt).toISOString() };
    },
    status: () => currentStatus,
    completeCallbackUrl: async (callbackUrl) => {
      if (typeof callbackUrl !== "string" || callbackUrl.length === 0 || callbackUrl.length > MAX_CALLBACK_VALUE_LENGTH) {
        throw new OAuthFlowError("invalid-callback-url", "The callback URL is invalid");
      }
      let parsed;
      try {
        parsed = new URL(callbackUrl);
      } catch {
        throw new OAuthFlowError("invalid-callback-url", "The callback URL is invalid");
      }
      if (parsed.protocol !== "http:" || parsed.username.length > 0 || parsed.password.length > 0 || parsed.hash.length > 0) {
        throw new OAuthFlowError("invalid-callback-url", "The callback URL is invalid");
      }
      return completeCallback({
        method: "GET",
        host: parsed.host,
        url: `${parsed.pathname}${parsed.search}`
      });
    },
    cancel: async () => {
      if (pending !== void 0) await cancelPending(pending, "cancelled");
      if (processing !== void 0) {
        const active = processing;
        if (active.commitStarted) return currentStatus;
        active.controller.abort(new OAuthFlowError("cancelled", "The OAuth login was cancelled"));
        updateStatus(active, { phase: "cancelled", errorCode: "cancelled" });
        return currentStatus;
      }
      return currentStatus;
    },
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      if (pending !== void 0) await cancelPending(pending, "cancelled");
      if (processing !== void 0) {
        if (!processing.commitStarted) processing.controller.abort(new OAuthFlowError("cancelled", "The OAuth login was cancelled"));
        processing = void 0;
      }
      await listenerClosing;
    }
  };
  async function completeCallback(request) {
    if (disposed) throw new OAuthFlowError("internal", "The OAuth flow is unavailable");
    const candidate = pending;
    if (candidate === void 0 || !candidate.active) throw noPendingError(currentStatus);
    assertCallbackRequest(request);
    const callback = parseCallback(request.url);
    if (callback.state !== candidate.state) {
      throw new OAuthFlowError("state-mismatch", "The OAuth callback state was not accepted");
    }
    candidate.active = false;
    pending = void 0;
    processing = candidate;
    clock.clearTimeout(candidate.timeout);
    void closeListener(candidate);
    if (callback.error !== void 0) {
      processing = void 0;
      candidate.controller.abort(new OAuthFlowError("oauth-error", "The OAuth provider rejected authorization"));
      updateStatus(candidate, { phase: "failed", errorCode: "oauth-error" });
      return { completed: false, phase: "failed", errorCode: "oauth-error" };
    }
    if (callback.code === void 0) {
      processing = void 0;
      updateStatus(candidate, { phase: "failed", errorCode: "missing-code" });
      return { completed: false, phase: "failed", errorCode: "missing-code" };
    }
    const operation = combineSignals(candidate.controller.signal);
    try {
      const token = await exchangeCode({ code: callback.code, verifier: candidate.verifier, signal: operation.signal });
      if (operation.signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
      assertToken(token);
      let project;
      try {
        project = await validateProject(token.accessToken, operation.signal);
      } catch (error) {
        if (operation.signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
        if (error instanceof ProjectDiscoveryError) {
          if (error.code === "cancelled") throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
          throw new OAuthFlowError(projectErrorCode(error.code), projectErrorMessage(error.code));
        }
        throw error instanceof OAuthFlowError ? error : new OAuthFlowError("project-validation-failed", "Project validation failed");
      }
      if (operation.signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
      if (project === void 0) throw new OAuthFlowError("project-unavailable", "No usable project is available for this account");
      project = normalizeProject(project);
      try {
        if (operation.signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
        candidate.commitStarted = true;
        committingGeneration = candidate.generation;
        try {
          await commit(token, project, operation.signal);
        } finally {
          committingGeneration = void 0;
        }
      } catch (error) {
        if (operation.signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
        throw error instanceof OAuthFlowError ? error : new OAuthFlowError("persistence-failed", "The login could not be saved");
      }
      updateStatus(candidate, { phase: "success" });
      return { completed: true, phase: "success" };
    } catch (error) {
      const safe = classifyCompletionError(error, candidate.controller.signal);
      if (safe.code === "cancelled") {
        updateStatus(candidate, { phase: "cancelled", errorCode: "cancelled" });
        return { completed: false, phase: "cancelled", errorCode: "cancelled" };
      }
      updateStatus(candidate, { phase: "failed", errorCode: safe.code });
      return { completed: false, phase: "failed", errorCode: safe.code };
    } finally {
      operation.cleanup();
      if (processing === candidate) processing = void 0;
    }
  }
  async function handleLoopbackRequest(request) {
    try {
      const result2 = await completeCallback(request);
      if (result2.completed) return callbackResponse(200, "success");
      return callbackResponse(result2.phase === "cancelled" ? 409 : 400, result2.errorCode);
    } catch (error) {
      const safe = error instanceof OAuthFlowError ? error : new OAuthFlowError("internal", "The callback could not be processed");
      return callbackResponse(callbackStatus(safe.code), safe.code);
    }
  }
  async function expire(candidate) {
    if (pending !== candidate || !candidate.active) return;
    await cancelPending(candidate, "expired");
  }
  async function cancelPending(candidate, phase) {
    if (!candidate.active && pending !== candidate) return;
    candidate.active = false;
    if (pending === candidate) pending = void 0;
    clock.clearTimeout(candidate.timeout);
    candidate.controller.abort(new OAuthFlowError(phase, phase === "expired" ? "The OAuth login expired" : "The OAuth login was cancelled"));
    await closeListener(candidate);
    updateStatus(candidate, {
      phase,
      errorCode: phase
    });
  }
  function updateStatus(candidate, status) {
    if (candidate.generation === generation) currentStatus = status;
  }
  return flow;
}
function createNodeLoopbackListenerFactory() {
  return {
    listen: (handler) => new Promise((resolve2, reject) => {
      const server = createServer((request, response) => {
        void serveRequest(handler, request, response);
      });
      let settled = false;
      const onError = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      server.once("error", onError);
      server.listen(ANTIGRAVITY_CALLBACK_PORT, "127.0.0.1", () => {
        settled = true;
        server.removeListener("error", onError);
        resolve2({
          close: () => new Promise((resolveClose, rejectClose) => {
            if (!server.listening) {
              resolveClose();
              return;
            }
            server.close((error) => error === void 0 ? resolveClose() : rejectClose(error));
          })
        });
      });
    })
  };
}
function buildAuthorizationUrl(state, verifier) {
  if (!ANTIGRAVITY_CLIENT_ID || !ANTIGRAVITY_CLIENT_SECRET) throw new OAuthFlowError("internal", "Configure your own ANTIGRAVITY_CLIENT_ID and ANTIGRAVITY_CLIENT_SECRET before Antigravity OAuth");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ANTIGRAVITY_REDIRECT_URI);
  url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "select_account consent");
  return url.toString();
}
function decodeJwtEmail(idToken) {
  const parts = idToken.split(".");
  if (parts.length !== 3) return void 0;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (typeof payload === "object" && payload !== null) {
      const email = payload.email;
      return typeof email === "string" && email.length > 0 ? email : void 0;
    }
  } catch {
  }
  return void 0;
}
function createGoogleTokenExchanger(fetchImpl, clock = systemClock()) {
  return async ({ code, verifier, signal }) => {
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "*/*",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
      },
      body: new URLSearchParams({
        client_id: ANTIGRAVITY_CLIENT_ID,
        client_secret: ANTIGRAVITY_CLIENT_SECRET,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: ANTIGRAVITY_REDIRECT_URI
      }),
      signal
    });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
      }
      throw new OAuthFlowError("token-exchange-failed", "The authorization code could not be exchanged");
    }
    const payload = await readJsonBounded(response, signal);
    if (!isRecord4(payload) || typeof payload.access_token !== "string" || payload.access_token.length === 0 || typeof payload.refresh_token !== "string" || payload.refresh_token.length === 0) {
      throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
    }
    const expiresIn = typeof payload.expires_in === "number" && Number.isFinite(payload.expires_in) && payload.expires_in > 0 ? payload.expires_in : 3600;
    const email = typeof payload.email === "string" ? payload.email : typeof payload.id_token === "string" ? decodeJwtEmail(payload.id_token) : void 0;
    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: clock.now() + expiresIn * 1e3,
      ...email === void 0 ? {} : { email }
    };
  };
}
function assertCallbackRequest(request) {
  if (request.method !== "GET") throw new OAuthFlowError("invalid-method", "The OAuth callback method is not accepted");
  if (typeof request.host !== "string" || !isAllowedCallbackHost(request.host)) {
    throw new OAuthFlowError("invalid-host", "The OAuth callback host is not accepted");
  }
  let parsed;
  try {
    parsed = new URL(request.url, `http://${request.host}`);
  } catch {
    throw new OAuthFlowError("invalid-path", "The OAuth callback URL is not accepted");
  }
  if (parsed.protocol !== "http:" || !isAllowedCallbackHost(parsed.host) || parsed.username.length > 0 || parsed.password.length > 0 || parsed.pathname !== ANTIGRAVITY_CALLBACK_PATH || parsed.hash.length > 0) {
    throw new OAuthFlowError("invalid-path", "The OAuth callback path is not accepted");
  }
}
function parseCallback(value) {
  let parsed;
  try {
    parsed = new URL(value, `http://${ANTIGRAVITY_CALLBACK_HOSTS[0]}`);
  } catch {
    throw new OAuthFlowError("invalid-path", "The OAuth callback URL is not accepted");
  }
  const seen = /* @__PURE__ */ new Set();
  for (const [key, paramValue] of parsed.searchParams) {
    if (seen.has(key)) throw new OAuthFlowError("duplicate-parameter", "The OAuth callback contains duplicate parameters");
    if (!safeCallbackValue(key) || !safeCallbackValue(paramValue)) {
      throw new OAuthFlowError("invalid-parameters", "The OAuth callback parameters are not accepted");
    }
    seen.add(key);
  }
  const state = parsed.searchParams.get("state");
  if (state === null || !safeCallbackValue(state)) throw new OAuthFlowError("missing-state", "The OAuth callback state is missing");
  const code = parsed.searchParams.get("code");
  const error = parsed.searchParams.get("error");
  if (error !== null) {
    if (code !== null || !safeCallbackValue(error)) throw new OAuthFlowError("invalid-parameters", "The OAuth callback parameters are not accepted");
    return { state, error };
  }
  if (parsed.searchParams.has("error_description") || parsed.searchParams.has("error_uri")) {
    throw new OAuthFlowError("invalid-parameters", "The OAuth callback parameters are not accepted");
  }
  if (code === null || !safeCallbackValue(code)) throw new OAuthFlowError("missing-code", "The OAuth callback code is missing");
  return { state, code };
}
function isAllowedCallbackHost(value) {
  return ANTIGRAVITY_CALLBACK_HOSTS.includes(value.toLowerCase());
}
function safeCallbackValue(value) {
  return isBoundedSafeText(value, MAX_CALLBACK_VALUE_LENGTH);
}
function randomBytes(random, size) {
  const bytes = random(size);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size) {
    throw new OAuthFlowError("internal", "The OAuth random source is unavailable");
  }
  return bytes;
}
function encodeBase64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}
function systemClock() {
  return {
    now: () => Date.now(),
    setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
    clearTimeout: (handle) => clearTimeout(handle)
  };
}
function noPendingError(status) {
  if (status.phase === "expired") return new OAuthFlowError("expired", "The OAuth login expired");
  if (status.phase === "cancelled") return new OAuthFlowError("cancelled", "The OAuth login was cancelled");
  return new OAuthFlowError("no-pending-flow", "There is no pending OAuth login");
}
function asListenerError(error) {
  if (error instanceof OAuthFlowError) return error;
  if (isRecord4(error) && error.code === "EADDRINUSE") {
    return new OAuthFlowError("port-conflict", "The fixed OAuth callback port is already in use");
  }
  return new OAuthFlowError("internal", "The OAuth callback listener could not start");
}
function classifyCompletionError(error, signal) {
  if (signal.aborted || error instanceof OAuthFlowError && error.code === "cancelled") {
    return new OAuthFlowError("cancelled", "The OAuth login was cancelled");
  }
  if (error instanceof OAuthFlowError) return error;
  return new OAuthFlowError("token-exchange-failed", "The OAuth login could not be completed");
}
function assertToken(value) {
  if (!isRecord4(value) || typeof value.accessToken !== "string" || value.accessToken.length === 0 || typeof value.refreshToken !== "string" || value.refreshToken.length === 0 || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) {
    throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
  }
}
function normalizeProject(value) {
  if (!isRecord4(value)) throw new OAuthFlowError("project-validation-failed", "Project validation failed");
  const projectId = normalizeProjectId(value.projectId);
  if (projectId === void 0) throw new OAuthFlowError("project-validation-failed", "Project validation failed");
  return { projectId, ...typeof value.email === "string" ? { email: value.email } : {} };
}
function projectErrorCode(code) {
  if (code === "authentication") return "project-authentication-failed";
  if (code === "forbidden") return "project-forbidden";
  if (code === "rate-limited") return "project-rate-limited";
  if (code === "offline") return "project-offline";
  if (code === "malformed") return "project-malformed";
  return "project-protocol-drift";
}
function projectErrorMessage(code) {
  if (code === "authentication") return "The Antigravity project probe requires authentication";
  if (code === "forbidden") return "The Antigravity project probe was forbidden";
  if (code === "rate-limited") return "The Antigravity project probe is rate-limited";
  if (code === "offline") return "The Antigravity project probe is offline";
  if (code === "malformed") return "The Antigravity project response was malformed";
  if (code === "protocol-drift") return "The Antigravity project protocol changed";
  return "The Antigravity project probe was cancelled";
}
function callbackResponse(status, outcome) {
  const body = outcome === "success" ? '<!doctype html><meta charset="utf-8"><title>Authorization complete</title><p>Authorization complete. You may return to DeepSeek Harness.</p>' : '<!doctype html><meta charset="utf-8"><title>Authorization could not be completed</title><p>Authorization could not be completed. Return to DeepSeek Harness for details.</p>';
  return { status, headers: EMPTY_RESPONSE_HEADERS, body };
}
function callbackStatus(code) {
  if (code === "port-conflict") return 409;
  if (code === "internal") return 500;
  return 400;
}
async function serveRequest(handler, request, response) {
  const host = typeof request.headers.host === "string" ? request.headers.host : void 0;
  const result2 = await handler({
    method: request.method ?? "",
    ...host === void 0 ? {} : { host },
    url: request.url ?? ""
  });
  response.writeHead(result2.status, result2.headers);
  response.end(result2.body);
}
async function readJsonBounded(response, signal) {
  if (response.body === null) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > MAX_TOKEN_RESPONSE_BYTES) {
      throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
    }
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > MAX_TOKEN_RESPONSE_BYTES) throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
      chunks.push(next.value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
    }
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    throw new OAuthFlowError("token-exchange-failed", "The token response was not accepted");
  }
}
function combineSignals(primary) {
  const controller = new AbortController();
  const onAbort = () => {
    if (!controller.signal.aborted) controller.abort(primary.reason);
  };
  if (primary.aborted) controller.abort(primary.reason);
  else primary.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => primary.removeEventListener("abort", onAbort)
  };
}
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var ANTIGRAVITY_CALLBACK_PORT, ANTIGRAVITY_CALLBACK_PATH, ANTIGRAVITY_CALLBACK_HOSTS, OAUTH_FLOW_TTL_MS, AUTHORIZATION_ENDPOINT, TOKEN_ENDPOINT, MAX_CALLBACK_VALUE_LENGTH, MAX_TOKEN_RESPONSE_BYTES, EMPTY_RESPONSE_HEADERS, OAuthFlowError;
var init_oauth_flow = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/oauth-flow.ts"() {
    "use strict";
    init_dist();
    init_project_context();
    init_safe_text();
    ANTIGRAVITY_CALLBACK_PORT = 51121;
    ANTIGRAVITY_CALLBACK_PATH = "/oauth-callback";
    ANTIGRAVITY_CALLBACK_HOSTS = Object.freeze([
      `localhost:${String(ANTIGRAVITY_CALLBACK_PORT)}`,
      `127.0.0.1:${String(ANTIGRAVITY_CALLBACK_PORT)}`,
      `[::1]:${String(ANTIGRAVITY_CALLBACK_PORT)}`,
      "localhost",
      "127.0.0.1",
      "[::1]"
    ]);
    OAUTH_FLOW_TTL_MS = 5 * 60 * 1e3;
    AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
    TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
    MAX_CALLBACK_VALUE_LENGTH = 4096;
    MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
    EMPTY_RESPONSE_HEADERS = Object.freeze({
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff"
    });
    OAuthFlowError = class extends Error {
      code;
      constructor(code, message) {
        super(message);
        this.name = "OAuthFlowError";
        this.code = code;
      }
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/status.ts
function createStatusView(riskAcknowledged, login, credential, revoke, gates = {}) {
  return Object.freeze({
    pluginId: ANTIGRAVITY_PLUGIN_ID,
    phase: "bootstrap",
    privateSelfUse: true,
    singleAccount: true,
    riskAcknowledgementRequired: true,
    riskAcknowledged,
    login: Object.freeze({ ...login }),
    ...credential === void 0 ? {} : { credential: Object.freeze({ ...credential }) },
    ...revoke === void 0 ? {} : { revoke: Object.freeze({ ...revoke }) },
    capabilities: Object.freeze(capabilitiesFor(login, gates).map((capability) => Object.freeze({ ...capability })))
  });
}
function capabilitiesFor(login, gates) {
  const projectBlocked = !login.projectAvailable && (login.configured || login.errorCode !== void 0 && PROJECT_DISCOVERY_FAILURES.has(login.errorCode));
  if (projectBlocked) return CAPABILITY_DEFINITIONS.map((capability) => ({
    id: capability.id,
    state: "disabled",
    reasonCode: "project-unavailable"
  }));
  if (!login.projectAvailable) return CAPABILITY_DEFINITIONS;
  if (gates.gate0?.outcome !== "passed") {
    return CAPABILITY_ROW_IDS.map((id) => gate0Status(id, gates.gate0));
  }
  return CAPABILITY_ROW_IDS.map((id) => gateStatus(
    id,
    id === "auth-llm" ? llmFamilyResult(gates) : gates.capabilities?.[id]
  ));
}
function llmFamilyResult(gates) {
  const results = LLM_FAMILY_IDS.map((family) => gates.llmFamilies?.[family]);
  const failure = results.find((result2) => result2 !== void 0 && result2.outcome !== "passed");
  if (failure !== void 0) return failure;
  if (results.some((result2) => result2?.outcome !== "passed")) return void 0;
  return results.reduce((latest, result2) => latest === void 0 || Date.parse(result2.checkedAt) > Date.parse(latest.checkedAt) ? result2 : latest, void 0);
}
function gate0Status(id, result2) {
  if (result2?.outcome === "failed" || result2?.outcome === "attribution-rejected") {
    return { id, state: "disabled", reasonCode: "gate-0-failed" };
  }
  return gateStatus(id, result2);
}
function gateStatus(id, result2) {
  if (result2 === void 0) return { id, state: "poc-pending", reasonCode: "gate-not-run" };
  if (result2.outcome === "passed") return { id, state: "available", reasonCode: "capability-ready" };
  if (result2.outcome === "protocol-drift") return { id, state: "protocol-drift", reasonCode: "protocol-drift" };
  if (result2.outcome === "attribution-rejected") return { id, state: "disabled", reasonCode: "gate-0-failed" };
  if (result2.outcome === "unauthenticated") return { id, state: "disabled", reasonCode: "unauthenticated" };
  if (result2.outcome === "rate-limited") return { id, state: "disabled", reasonCode: "rate-limited" };
  if (result2.outcome === "cancelled") return { id, state: "disabled", reasonCode: "cancelled" };
  if (result2.outcome === "unsupported-video") return { id, state: "disabled", reasonCode: "unsupported-video" };
  return { id, state: "disabled", reasonCode: "gate-failed" };
}
var ANTIGRAVITY_PLUGIN_ID, CAPABILITY_ROW_IDS, LLM_FAMILY_IDS, CAPABILITY_GATE_OUTCOMES, CAPABILITY_DEFINITIONS, PROJECT_DISCOVERY_FAILURES;
var init_status = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/status.ts"() {
    "use strict";
    ANTIGRAVITY_PLUGIN_ID = "dsh-antigravity-auth";
    CAPABILITY_ROW_IDS = ["auth-llm", "search", "image", "video"];
    LLM_FAMILY_IDS = ["gemini", "claude", "gpt-oss"];
    CAPABILITY_GATE_OUTCOMES = [
      "passed",
      "unauthenticated",
      "rate-limited",
      "cancelled",
      "attribution-rejected",
      "protocol-drift",
      "unsupported-video",
      "failed"
    ];
    CAPABILITY_DEFINITIONS = Object.freeze(
      CAPABILITY_ROW_IDS.map((id) => Object.freeze({ id, state: "disabled", reasonCode: "unauthenticated" }))
    );
    PROJECT_DISCOVERY_FAILURES = /* @__PURE__ */ new Set([
      "project-unavailable",
      "project-authentication-failed",
      "project-forbidden",
      "project-rate-limited",
      "project-offline",
      "project-malformed",
      "project-protocol-drift"
    ]);
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/quota.ts
function normalizeQuotaResponse(value, now = Date.now()) {
  const groups = [];
  const sourceValue = isRecord5(value) && isRecord5(value.response) ? value.response : value;
  const source = isRecord5(sourceValue) ? sourceValue : void 0;
  const candidates = source === void 0 ? [] : [
    ...Array.isArray(source.groups) ? source.groups : [],
    ...Array.isArray(source.buckets) ? source.buckets : [],
    ...Array.isArray(source.quotaBuckets) ? source.quotaBuckets : [],
    ...Array.isArray(source.quota_buckets) ? source.quota_buckets : [],
    ...Array.isArray(source.userQuotaSummary) ? source.userQuotaSummary : [],
    ...Array.isArray(source.quotas) ? source.quotas : []
  ];
  for (const candidate of candidates) {
    if (!isRecord5(candidate)) continue;
    const buckets = Array.isArray(candidate.buckets) ? candidate.buckets : Array.isArray(candidate.quotaBuckets) ? candidate.quotaBuckets : Array.isArray(candidate.windows) ? candidate.windows : [candidate];
    for (const rawBucket of buckets) {
      if (!isRecord5(rawBucket)) continue;
      const window = identifyWindow(rawBucket);
      const resetTime = normalizeResetTime(rawBucket.resetTime ?? rawBucket.reset_time ?? rawBucket.resetAt ?? rawBucket.reset_at, now);
      const fraction = normalizeFraction(rawBucket.remainingFraction ?? rawBucket.remaining_fraction ?? rawBucket.fraction ?? rawBucket.remaining ?? rawBucket.remaining_percent ?? rawBucket.percentage);
      if (window === void 0 || resetTime === void 0 || fraction === void 0) continue;
      const group = identifyGroup(candidate, rawBucket);
      if (group === void 0) continue;
      const modelCount = boundedCount(candidate.modelCount ?? candidate.model_count ?? candidate.models ?? descriptionModelCount(candidate.description));
      const existing = groups.find((item) => item.group === group);
      if (existing === void 0) groups.push({ group, modelCount, windows: [{ window, remainingFraction: fraction, resetTime }] });
      else if (!existing.windows.some((item) => item.window === window)) {
        const updated = {
          group,
          modelCount: Math.max(existing.modelCount, modelCount),
          windows: [...existing.windows, { window, remainingFraction: fraction, resetTime }].sort(windowOrder)
        };
        groups.splice(groups.indexOf(existing), 1, updated);
      } else {
        const updatedWindows = existing.windows.map((item) => item.window === window ? { window, remainingFraction: Math.min(item.remainingFraction, fraction), resetTime: item.resetTime } : item);
        const updated = {
          group,
          modelCount: Math.max(existing.modelCount, modelCount),
          windows: updatedWindows.sort(windowOrder)
        };
        groups.splice(groups.indexOf(existing), 1, updated);
      }
    }
  }
  if (groups.length === 0) {
    if (isRecord5(source)) {
      return { state: "available", checkedAt: new Date(now).toISOString(), groups: [] };
    }
    throw new QuotaNormalizationError("The quota response did not contain recognized windows");
  }
  return { state: "available", checkedAt: new Date(now).toISOString(), groups: groups.sort((left, right) => left.group.localeCompare(right.group)) };
}
function createQuotaService(options) {
  const now = options.now ?? (() => Date.now());
  const minInterval = positive(options.minIntervalMs, QUOTA_REFRESH_MIN_INTERVAL_MS);
  const transport = options.transport ?? createPrivateTransport({
    ...options.transportOptions?.responseHeaderTimeoutMs === void 0 ? {} : { responseHeaderTimeoutMs: options.transportOptions.responseHeaderTimeoutMs },
    ...options.transportOptions?.maxRequestBytes === void 0 ? {} : { maxRequestBytes: options.transportOptions.maxRequestBytes }
  });
  let current = { state: "unauthenticated" };
  let checkedAt = 0;
  let inFlight;
  let inFlightAbort;
  const lifecycleController = new AbortController();
  let disposed = false;
  return {
    refresh: async (signal, force = false) => {
      if (disposed) return current;
      if (!force && checkedAt > 0 && now() - checkedAt < minInterval) return current;
      if (inFlight !== void 0) return await waitForCaller2(inFlight, signal);
      const combined = mergeAbortSignals(void 0, lifecycleController.signal);
      inFlightAbort = combined.dispose;
      inFlight = refreshQuota(options.auth, transport, combined.signal, now).then((value) => {
        current = value;
        checkedAt = now();
        return value;
      }).catch((error) => {
        current = mapQuotaError(error, now());
        checkedAt = now();
        return current;
      }).finally(() => {
        combined.dispose();
        inFlightAbort = void 0;
        inFlight = void 0;
      });
      return await waitForCaller2(inFlight, signal);
    },
    status: () => current,
    dispose: async () => {
      disposed = true;
      lifecycleController.abort();
      inFlightAbort?.();
      await inFlight?.catch(() => {
      });
    }
  };
}
async function refreshQuota(auth, transport, signal, now) {
  const credential = await auth.credential(signal);
  if (credential === void 0) return { state: "unauthenticated" };
  const body = credential.projectId ? { project: credential.projectId } : {};
  let response = await transport.request({
    url: ANTIGRAVITY_QUOTA_ENDPOINT,
    accessToken: credential.accessToken,
    body: JSON.stringify(body),
    ...signal === void 0 ? {} : { signal }
  });
  if (response.status === 403 && credential.projectId) {
    try {
      const retryResponse = await transport.request({
        url: ANTIGRAVITY_QUOTA_ENDPOINT,
        accessToken: credential.accessToken,
        body: JSON.stringify({}),
        ...signal === void 0 ? {} : { signal }
      });
      if (retryResponse.ok) {
        response = retryResponse;
      }
    } catch {
    }
  }
  const statusError = privateStatusError(response.status);
  if (statusError !== void 0) {
    await response.body?.cancel().catch(() => {
    });
    throw statusError;
  }
  let value;
  try {
    value = JSON.parse(await readPrivateText(response, { ...signal === void 0 ? {} : { signal }, maxBytes: DEFAULT_PRIVATE_RESPONSE_BYTES }));
  } catch (error) {
    if (error instanceof PrivateTransportError) throw error;
    throw new QuotaNormalizationError("The quota response was not valid JSON");
  }
  return normalizeQuotaResponse(value, now());
}
function mapQuotaError(error, checkedAt) {
  const state = error instanceof PrivateTransportError ? QUOTA_FAILURE_STATES[classifyPrivateFailure(error)] : error instanceof QuotaNormalizationError ? "protocol-drift" : "offline";
  return { state, checkedAt: new Date(checkedAt).toISOString() };
}
function identifyWindow(value) {
  const raw = String(value.window ?? value.windowType ?? value.window_type ?? value.bucketId ?? value.bucket_id ?? "").toLowerCase();
  if (raw.includes("5h") || raw.includes("5-hour") || raw.includes("five")) return "5h";
  if (raw.includes("week") || raw.includes("weekly") || raw.includes("7d")) return "weekly";
  const seconds = numberValue(value.durationSeconds ?? value.duration_seconds);
  if (seconds !== void 0) {
    if (seconds <= 5 * 60 * 60) return "5h";
    if (seconds <= 8 * 24 * 60 * 60) return "weekly";
  }
  return void 0;
}
function identifyGroup(candidate, bucket) {
  const raw = [
    candidate.displayName,
    candidate.group,
    candidate.quotaGroup,
    candidate.quota_group,
    candidate.modelFamily,
    candidate.title,
    candidate.name,
    candidate.description,
    bucket?.bucketId,
    bucket?.bucket_id,
    bucket?.displayName
  ].filter(Boolean).map(String).join(" ").toLowerCase();
  if (raw.includes("3p") || raw.includes("non") || raw.includes("claude") || raw.includes("gpt") || raw.includes("openai") || raw.includes("anthropic") || raw.includes("third-party") || raw.includes("external")) return "non-gemini";
  if (raw.includes("gemini") || raw.includes("google") || raw.includes("chat") || raw.includes("code") || raw.includes("default") || raw.length === 0) return "gemini";
  return "gemini";
}
function normalizeFraction(value) {
  const number = numberValue(value);
  if (number === void 0) return void 0;
  if (number >= 0 && number <= 1) return number;
  if (number <= 100) return number / 100;
  return void 0;
}
function normalizeResetTime(value, now) {
  const parsed = typeof value === "number" ? value < 1e10 ? value * 1e3 : value : typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1e14) return void 0;
  const iso = new Date(parsed).toISOString();
  return Number.isFinite(Date.parse(iso)) && parsed >= now - 365 * 24 * 60 * 60 * 1e3 ? iso : void 0;
}
function boundedCount(value) {
  if (Array.isArray(value)) return Math.min(value.length, 1e4);
  const number = numberValue(value);
  return number === void 0 ? 0 : Math.min(Math.floor(number), 1e4);
}
function descriptionModelCount(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 16 * 1024) return 0;
  if (!/^[^:]{1,256}:\s*/u.test(value)) return 0;
  const payload = value.replace(/^[^:]{1,256}:\s*/u, "");
  return Math.min(payload.split(",").map((item) => item.trim()).filter((item) => item.length > 0).length, 1e4);
}
function windowOrder(left, right) {
  return left.window === right.window ? 0 : left.window === "5h" ? -1 : 1;
}
function positive(value, fallback) {
  return value === void 0 || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), 24 * 60 * 60 * 1e3);
}
function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
async function waitForCaller2(promise, signal) {
  if (signal === void 0) return await promise;
  if (signal.aborted) throw new PrivateTransportError("cancelled", "The quota request was cancelled", { accepted: false });
  let remove;
  const cancellation = new Promise((_, reject) => {
    const abort = () => reject(new PrivateTransportError("cancelled", "The quota request was cancelled", { accepted: false }));
    remove = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([promise, cancellation]);
  } finally {
    remove?.();
  }
}
function mergeAbortSignals(first, second) {
  const controller = new AbortController();
  const abort = (event) => {
    if (!controller.signal.aborted) controller.abort(event.target.reason);
  };
  const signals = first === void 0 ? [second] : [first, second];
  for (const signal of signals) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of signals) signal.removeEventListener("abort", abort);
    }
  };
}
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var ANTIGRAVITY_QUOTA_ENDPOINT, QUOTA_REFRESH_MIN_INTERVAL_MS, QuotaNormalizationError, QUOTA_FAILURE_STATES;
var init_quota = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/quota.ts"() {
    "use strict";
    init_wire_identity();
    init_private_transport();
    init_private_failure();
    ANTIGRAVITY_QUOTA_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:retrieveUserQuotaSummary`;
    QUOTA_REFRESH_MIN_INTERVAL_MS = 3e4;
    QuotaNormalizationError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "QuotaNormalizationError";
      }
    };
    QUOTA_FAILURE_STATES = {
      authentication: "unauthenticated",
      forbidden: "forbidden",
      "rate-limited": "rate-limited",
      cancelled: "offline",
      timeout: "timeout",
      "attribution-rejected": "protocol-drift",
      "protocol-drift": "protocol-drift",
      "response-limit": "protocol-drift",
      "request-limit": "protocol-drift",
      upstream: "offline",
      network: "offline",
      failed: "offline"
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/capability-gates.ts
import { chmod as chmod2, lstat as lstat2, mkdir as mkdir2, readFile as readFile2, rename as rename2, rm, writeFile } from "node:fs/promises";
import { dirname as dirname2, join as join2 } from "node:path";
function defaultCapabilityGatePath(authStorePath) {
  return join2(dirname2(authStorePath), "gates.json");
}
function createMemoryCapabilityGates(initial = {}, now = () => Date.now()) {
  let current = cloneEvidence(initial);
  return {
    read: async () => cloneEvidence(current),
    recordGate0: async (subject, outcome) => {
      current = { subject: checkedSubject(subject), gate0: result(outcome, now) };
      return cloneEvidence(current);
    },
    recordLlmFamily: async (subject, family, outcome) => {
      current = evidenceForSubject(current, subject);
      current = { ...current, llmFamilies: { ...current.llmFamilies, [family]: result(outcome, now) } };
      return cloneEvidence(current);
    },
    recordCapability: async (subject, id, outcome) => {
      current = evidenceForSubject(current, subject);
      current = { ...current, capabilities: { ...current.capabilities, [id]: result(outcome, now) } };
      return cloneEvidence(current);
    },
    clear: async (expectedSubject) => {
      if (expectedSubject === void 0 || current.subject === expectedSubject) current = {};
    }
  };
}
function createFileCapabilityGates(path, options = {}) {
  const now = options.now ?? (() => Date.now());
  const platform = options.platform ?? process.platform;
  let mutation = Promise.resolve();
  const read = async () => {
    let text;
    try {
      const [file, directory] = await Promise.all([lstat2(path), lstat2(dirname2(path))]);
      const unsafePosixMode = platform !== "win32" && ((file.mode & 63) !== 0 || (directory.mode & 63) !== 0);
      if (file.isSymbolicLink() || !file.isFile() || directory.isSymbolicLink() || !directory.isDirectory() || file.size > MAX_GATE_FILE_BYTES || unsafePosixMode) throw new Error("unsafe gate record");
      text = await readFile2(path, "utf8");
      if (text.length > MAX_GATE_FILE_BYTES) throw new Error("oversized gate record");
    } catch (error) {
      if (error.code === "ENOENT") return {};
      throw new Error("The Antigravity capability gate record could not be read");
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error("The Antigravity capability gate record is malformed");
    }
    return parseFile(value);
  };
  const update = async (mutate) => {
    let output = {};
    const operation = mutation.then(async () => {
      output = mutate(await read());
      await writeEvidence(path, output);
    });
    mutation = operation.catch(() => {
    });
    await operation;
    return cloneEvidence(output);
  };
  return {
    read,
    recordGate0: (subject, outcome) => update(() => ({ subject: checkedSubject(subject), gate0: result(outcome, now) })),
    recordLlmFamily: (subject, family, outcome) => update((current) => {
      const owned = evidenceForSubject(current, subject);
      return { ...owned, llmFamilies: { ...owned.llmFamilies, [family]: result(outcome, now) } };
    }),
    recordCapability: (subject, id, outcome) => update((current) => {
      const owned = evidenceForSubject(current, subject);
      return { ...owned, capabilities: { ...owned.capabilities, [id]: result(outcome, now) } };
    }),
    clear: async (expectedSubject) => {
      const operation = mutation.then(async () => {
        if (expectedSubject === void 0 || (await read()).subject === expectedSubject) await rm(path, { force: true });
      });
      mutation = operation.catch(() => {
      });
      await operation;
    }
  };
}
async function writeEvidence(path, evidence) {
  const directory = dirname2(path);
  await mkdir2(directory, { recursive: true, mode: 448 });
  await chmod2(directory, 448);
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  const encoded = `${JSON.stringify({ version: GATE_FILE_VERSION, ...evidence })}
`;
  try {
    await writeFile(temporary, encoded, { encoding: "utf8", mode: 384, flag: "wx" });
    await rename2(temporary, path);
    await chmod2(path, 384);
  } finally {
    await rm(temporary, { force: true }).catch(() => {
    });
  }
}
function parseFile(value) {
  if (!isRecord6(value) || value.version !== GATE_FILE_VERSION) throw new Error("The Antigravity capability gate record is malformed");
  if (Object.keys(value).some((key) => !["version", "subject", "gate0", "llmFamilies", "capabilities"].includes(key))) {
    throw new Error("The Antigravity capability gate record is malformed");
  }
  if (typeof value.subject !== "string" || !isBoundedSafeText(value.subject, 128)) {
    throw new Error("The Antigravity capability gate record is malformed");
  }
  const gate0 = value.gate0 === void 0 ? void 0 : parseResult(value.gate0);
  const llmFamilies = value.llmFamilies === void 0 ? void 0 : parseLlmFamilies(value.llmFamilies);
  const capabilities = value.capabilities === void 0 ? void 0 : parseCapabilities(value.capabilities);
  return {
    subject: value.subject,
    ...gate0 === void 0 ? {} : { gate0 },
    ...llmFamilies === void 0 ? {} : { llmFamilies },
    ...capabilities === void 0 ? {} : { capabilities }
  };
}
function parseLlmFamilies(value) {
  if (!isRecord6(value) || Object.keys(value).some((key) => !LLM_FAMILY_IDS.includes(key))) {
    throw new Error("The Antigravity capability gate record is malformed");
  }
  const output = {};
  for (const family of LLM_FAMILY_IDS) {
    if (value[family] !== void 0) output[family] = parseResult(value[family]);
  }
  return output;
}
function parseCapabilities(value) {
  if (!isRecord6(value) || Object.keys(value).some((key) => !PERSISTED_CAPABILITY_IDS.includes(key))) {
    throw new Error("The Antigravity capability gate record is malformed");
  }
  const output = {};
  for (const id of PERSISTED_CAPABILITY_IDS) {
    if (value[id] !== void 0) output[id] = parseResult(value[id]);
  }
  return output;
}
function parseResult(value) {
  if (!isRecord6(value) || Object.keys(value).length !== 2 || !Object.prototype.hasOwnProperty.call(value, "outcome") || !Object.prototype.hasOwnProperty.call(value, "checkedAt") || typeof value.outcome !== "string" || !CAPABILITY_GATE_OUTCOMES.includes(value.outcome) || typeof value.checkedAt !== "string" || value.checkedAt.length > 64 || !Number.isFinite(Date.parse(value.checkedAt))) {
    throw new Error("The Antigravity capability gate record is malformed");
  }
  return { outcome: value.outcome, checkedAt: value.checkedAt };
}
function result(outcome, now) {
  if (!CAPABILITY_GATE_OUTCOMES.includes(outcome)) throw new Error("The Antigravity capability gate outcome is invalid");
  const timestamp = now();
  if (!Number.isFinite(timestamp)) throw new Error("The Antigravity capability gate clock is invalid");
  return { outcome, checkedAt: new Date(timestamp).toISOString() };
}
function checkedSubject(subject) {
  if (!isBoundedSafeText(subject, 128)) throw new Error("The Antigravity capability gate subject is invalid");
  return subject;
}
function evidenceForSubject(current, subject) {
  const checked = checkedSubject(subject);
  return current.subject === checked ? current : { subject: checked };
}
function cloneEvidence(value) {
  return {
    ...value.subject === void 0 ? {} : { subject: value.subject },
    ...value.gate0 === void 0 ? {} : { gate0: { ...value.gate0 } },
    ...value.llmFamilies === void 0 ? {} : { llmFamilies: Object.fromEntries(Object.entries(value.llmFamilies).map(([id, entry]) => [id, entry === void 0 ? void 0 : { ...entry }])) },
    ...value.capabilities === void 0 ? {} : { capabilities: Object.fromEntries(Object.entries(value.capabilities).map(([id, entry]) => [id, entry === void 0 ? void 0 : { ...entry }])) }
  };
}
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var GATE_FILE_VERSION, MAX_GATE_FILE_BYTES, PERSISTED_CAPABILITY_IDS;
var init_capability_gates = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/capability-gates.ts"() {
    "use strict";
    init_status();
    init_safe_text();
    GATE_FILE_VERSION = 2;
    MAX_GATE_FILE_BYTES = 64 * 1024;
    PERSISTED_CAPABILITY_IDS = CAPABILITY_ROW_IDS.filter((id) => id !== "auth-llm");
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/account-store.ts
import { chmod as chmod3, mkdir as mkdir3, readFile as readFile3, rename as rename3, writeFile as writeFile2 } from "node:fs/promises";
import { dirname as dirname3, join as join3 } from "node:path";
function defaultAccountStorePath(authStorePath) {
  return join3(dirname3(authStorePath), "accounts.json");
}
function normalizeKey(str) {
  return str.trim().toLowerCase();
}
function nextAccountId(accounts) {
  const existing = new Set(accounts.map((a) => a.id));
  let max = 0;
  for (const a of accounts) {
    const match = /^acc_(\d+)$/.exec(a.id);
    if (match?.[1]) {
      const num = Number(match[1]);
      if (Number.isSafeInteger(num) && num > max) {
        max = num;
      }
    }
  }
  let candidate = `acc_${max + 1}`;
  while (existing.has(candidate)) {
    max += 1;
    candidate = `acc_${max + 1}`;
  }
  return candidate;
}
function findMatchingAccount(accounts, query) {
  const trimmed = query.trim();
  if (trimmed.length === 0) return void 0;
  const num = Number(trimmed);
  if (Number.isSafeInteger(num) && num >= 1 && num <= accounts.length) {
    const acc = accounts[num - 1];
    if (acc !== void 0) return { account: acc, index: num };
  }
  const needle = normalizeKey(trimmed);
  const byIdIndex = accounts.findIndex((a) => normalizeKey(a.id) === needle);
  if (byIdIndex >= 0) {
    const acc = accounts[byIdIndex];
    if (acc !== void 0) return { account: acc, index: byIdIndex + 1 };
  }
  const byEmailIndex = accounts.findIndex((a) => a.email !== void 0 && normalizeKey(a.email) === needle);
  if (byEmailIndex >= 0) {
    const acc = accounts[byEmailIndex];
    if (acc !== void 0) return { account: acc, index: byEmailIndex + 1 };
  }
  const byFuzzyIndex = accounts.findIndex((a) => {
    if (a.email !== void 0 && normalizeKey(a.email).includes(needle)) return true;
    if (a.maskedEmail !== void 0 && normalizeKey(a.maskedEmail).includes(needle)) return true;
    return false;
  });
  if (byFuzzyIndex >= 0) {
    const acc = accounts[byFuzzyIndex];
    if (acc !== void 0) return { account: acc, index: byFuzzyIndex + 1 };
  }
  return void 0;
}
function applyBoundRefreshToken(accounts, update) {
  const index = accounts.findIndex((account) => account.id === update.accountId);
  if (index < 0) return void 0;
  const existing = accounts[index];
  if (existing === void 0) return void 0;
  if (update.previousRefreshToken !== void 0 && existing.refreshToken !== update.previousRefreshToken) return void 0;
  if (update.lineage !== void 0 && existing.lineage !== void 0 && existing.lineage !== update.lineage) {
    return void 0;
  }
  const next = [...accounts];
  next[index] = {
    ...existing,
    refreshToken: update.refreshToken,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  return next;
}
function sameCachedCredential(current, expected) {
  return current.id === expected.id && current.lineage === expected.lineage && current.refreshToken === expected.refreshToken && current.projectId === expected.projectId;
}
function serializeStore(store) {
  let pending = Promise.resolve();
  const enqueue = (operation) => {
    const result2 = pending.then(operation);
    pending = result2.then(() => {
    }, () => {
    });
    return result2;
  };
  return {
    path: store.path,
    read: () => enqueue(() => store.read()),
    saveAccount: (draft) => enqueue(() => store.saveAccount(draft)),
    setActive: (query) => enqueue(() => store.setActive(query)),
    removeAccount: (query, expected) => enqueue(() => store.removeAccount(query, expected)),
    syncRefreshToken: (update) => enqueue(() => store.syncRefreshToken(update)),
    list: () => enqueue(() => store.list())
  };
}
function createAccountStore(accountsPath, authStorePath, options = {}) {
  const platform = options.platform ?? process.platform;
  async function readRaw() {
    try {
      const text = await readFile3(accountsPath, "utf8");
      const parsed = JSON.parse(text);
      if (typeof parsed === "object" && parsed !== null && parsed.version === ACCOUNTS_RECORD_VERSION && Array.isArray(parsed.accounts)) {
        const rawAccounts = parsed.accounts;
        const accounts = [];
        const seenIds = /* @__PURE__ */ new Set();
        for (const item of rawAccounts) {
          if (typeof item === "object" && item !== null) {
            const rec = item;
            if (typeof rec.id === "string" && typeof rec.projectId === "string" && typeof rec.refreshToken === "string") {
              let id = rec.id;
              if (seenIds.has(id)) {
                id = nextAccountId(accounts);
              }
              seenIds.add(id);
              accounts.push({
                id,
                email: typeof rec.email === "string" ? rec.email : void 0,
                maskedEmail: typeof rec.maskedEmail === "string" ? rec.maskedEmail : maskEmail(typeof rec.email === "string" ? rec.email : void 0),
                projectId: rec.projectId,
                refreshToken: rec.refreshToken,
                updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : (/* @__PURE__ */ new Date()).toISOString(),
                lineage: typeof rec.lineage === "string" ? rec.lineage : void 0
              });
            }
          }
        }
        const activeId = typeof parsed.activeId === "string" ? parsed.activeId : accounts[0]?.id;
        return { version: ACCOUNTS_RECORD_VERSION, activeId, accounts };
      }
    } catch {
    }
    try {
      const authText = await readFile3(authStorePath, "utf8");
      const authRecord = JSON.parse(authText);
      if (typeof authRecord === "object" && authRecord !== null && typeof authRecord.refreshToken === "string" && typeof authRecord.projectId === "string") {
        const email = typeof authRecord.email === "string" ? authRecord.email : void 0;
        const initialAccount = {
          id: "acc_1",
          email,
          maskedEmail: maskEmail(email),
          projectId: authRecord.projectId,
          refreshToken: authRecord.refreshToken,
          updatedAt: typeof authRecord.updatedAt === "string" ? authRecord.updatedAt : (/* @__PURE__ */ new Date()).toISOString(),
          lineage: typeof authRecord.lineage === "string" ? authRecord.lineage : void 0
        };
        const seeded = {
          version: ACCOUNTS_RECORD_VERSION,
          activeId: initialAccount.id,
          accounts: [initialAccount]
        };
        await writeRaw(seeded);
        return seeded;
      }
    } catch {
    }
    return {
      version: ACCOUNTS_RECORD_VERSION,
      activeId: void 0,
      accounts: []
    };
  }
  async function writeRaw(data) {
    const dir = dirname3(accountsPath);
    await mkdir3(dir, { recursive: true, mode: 448 });
    const tempPath = `${accountsPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile2(tempPath, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 384 });
    if (platform !== "win32") {
      try {
        await chmod3(tempPath, 384);
      } catch {
      }
    }
    await rename3(tempPath, accountsPath);
  }
  return serializeStore({
    path: accountsPath,
    read: readRaw,
    saveAccount: async (draft) => {
      const current = await readRaw();
      const accounts = [...current.accounts];
      const email = draft.email;
      const masked = maskEmail(email);
      let existingIndex = draft.id === void 0 ? -1 : accounts.findIndex((a) => a.id === draft.id);
      if (existingIndex < 0 && email !== void 0 && email.trim().length > 0) {
        existingIndex = accounts.findIndex((a) => a.email !== void 0 && normalizeKey(a.email) === normalizeKey(email));
      }
      if (existingIndex < 0) {
        existingIndex = accounts.findIndex((a) => a.refreshToken === draft.refreshToken);
      }
      let accountId;
      let isNew = false;
      if (existingIndex >= 0) {
        const existing = accounts[existingIndex];
        accountId = existing.id;
        accounts[existingIndex] = {
          ...existing,
          email: email ?? existing.email,
          maskedEmail: masked ?? existing.maskedEmail,
          projectId: draft.projectId,
          refreshToken: draft.refreshToken,
          updatedAt: draft.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
          lineage: draft.lineage ?? existing.lineage
        };
      } else {
        isNew = true;
        accountId = draft.id ?? nextAccountId(accounts);
        accounts.push({
          id: accountId,
          email,
          maskedEmail: masked,
          projectId: draft.projectId,
          refreshToken: draft.refreshToken,
          updatedAt: draft.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
          lineage: draft.lineage
        });
      }
      const updated = {
        version: ACCOUNTS_RECORD_VERSION,
        activeId: accountId,
        accounts
      };
      await writeRaw(updated);
      const savedAccount = accounts.find((a) => a.id === accountId);
      return { activeId: accountId, account: savedAccount, isNew };
    },
    setActive: async (idOrEmailOrIndex) => {
      const current = await readRaw();
      const match = findMatchingAccount(current.accounts, idOrEmailOrIndex);
      if (match === void 0) return void 0;
      const updated = {
        ...current,
        activeId: match.account.id
      };
      await writeRaw(updated);
      return match.account;
    },
    removeAccount: async (idOrEmailOrIndex, expected) => {
      const current = await readRaw();
      const match = findMatchingAccount(current.accounts, idOrEmailOrIndex);
      if (match === void 0) return void 0;
      if (expected !== void 0 && !sameCachedCredential(match.account, expected)) return void 0;
      const remaining = current.accounts.filter((a) => a.id !== match.account.id);
      let activeId = current.activeId;
      if (activeId === match.account.id) {
        activeId = remaining[0]?.id;
      }
      await writeRaw({
        version: ACCOUNTS_RECORD_VERSION,
        activeId,
        accounts: remaining
      });
      return match.account;
    },
    syncRefreshToken: async (update) => {
      const current = await readRaw();
      const accounts = applyBoundRefreshToken(current.accounts, update);
      if (accounts === void 0) return false;
      await writeRaw({ ...current, accounts });
      return true;
    },
    list: async () => {
      const current = await readRaw();
      return {
        activeId: current.activeId,
        accounts: current.accounts.map((acc, index) => ({
          ...acc,
          index: index + 1,
          isActive: acc.id === current.activeId
        }))
      };
    }
  });
}
function createMemoryAccountStore(authStore) {
  let data = {
    version: ACCOUNTS_RECORD_VERSION,
    activeId: void 0,
    accounts: []
  };
  let seeded = false;
  async function ensureSeeded() {
    if (seeded || authStore === void 0 || data.accounts.length > 0) return;
    seeded = true;
    try {
      const auth = await authStore.read();
      if (auth !== void 0 && typeof auth.refreshToken === "string" && typeof auth.projectId === "string") {
        const initialAccount = {
          id: "acc_1",
          email: auth.email,
          maskedEmail: maskEmail(auth.email),
          projectId: auth.projectId,
          refreshToken: auth.refreshToken,
          updatedAt: auth.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
          lineage: auth.lineage
        };
        data = {
          version: ACCOUNTS_RECORD_VERSION,
          activeId: initialAccount.id,
          accounts: [initialAccount]
        };
      }
    } catch {
    }
  }
  return serializeStore({
    path: ":memory:",
    read: async () => {
      await ensureSeeded();
      return data;
    },
    saveAccount: async (draft) => {
      await ensureSeeded();
      const accounts = [...data.accounts];
      let existingIndex = draft.id === void 0 ? -1 : accounts.findIndex((a) => a.id === draft.id);
      if (existingIndex < 0 && draft.email !== void 0 && draft.email.trim().length > 0) {
        existingIndex = accounts.findIndex((a) => a.email !== void 0 && normalizeKey(a.email) === normalizeKey(draft.email));
      }
      if (existingIndex < 0) {
        existingIndex = accounts.findIndex((a) => a.refreshToken === draft.refreshToken);
      }
      let accountId;
      let isNew = false;
      if (existingIndex >= 0) {
        const existing = accounts[existingIndex];
        accountId = existing.id;
        const masked = maskEmail(draft.email);
        accounts[existingIndex] = {
          ...existing,
          ...draft.email === void 0 ? {} : { email: draft.email },
          ...masked === void 0 ? {} : { maskedEmail: masked },
          projectId: draft.projectId,
          refreshToken: draft.refreshToken,
          updatedAt: draft.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
          ...draft.lineage === void 0 ? {} : { lineage: draft.lineage }
        };
      } else {
        isNew = true;
        accountId = draft.id ?? nextAccountId(accounts);
        accounts.push({
          id: accountId,
          ...draft.email === void 0 ? {} : { email: draft.email },
          ...maskEmail(draft.email) === void 0 ? {} : { maskedEmail: maskEmail(draft.email) },
          projectId: draft.projectId,
          refreshToken: draft.refreshToken,
          updatedAt: draft.updatedAt ?? (/* @__PURE__ */ new Date()).toISOString(),
          ...draft.lineage === void 0 ? {} : { lineage: draft.lineage }
        });
      }
      data = { version: ACCOUNTS_RECORD_VERSION, activeId: accountId, accounts };
      return { activeId: accountId, account: accounts.find((a) => a.id === accountId), isNew };
    },
    setActive: async (query) => {
      await ensureSeeded();
      const match = findMatchingAccount(data.accounts, query);
      if (match === void 0) return void 0;
      data = { ...data, activeId: match.account.id };
      return match.account;
    },
    removeAccount: async (query, expected) => {
      await ensureSeeded();
      const match = findMatchingAccount(data.accounts, query);
      if (match === void 0) return void 0;
      if (expected !== void 0 && !sameCachedCredential(match.account, expected)) return void 0;
      const remaining = data.accounts.filter((a) => a.id !== match.account.id);
      const activeId = data.activeId === match.account.id ? remaining[0]?.id : data.activeId;
      data = { version: ACCOUNTS_RECORD_VERSION, activeId, accounts: remaining };
      return match.account;
    },
    syncRefreshToken: async (update) => {
      await ensureSeeded();
      const accounts = applyBoundRefreshToken(data.accounts, update);
      if (accounts === void 0) return false;
      data = { ...data, accounts };
      return true;
    },
    list: async () => {
      await ensureSeeded();
      return {
        activeId: data.activeId,
        accounts: data.accounts.map((acc, index) => ({
          ...acc,
          index: index + 1,
          isActive: acc.id === data.activeId
        }))
      };
    }
  });
}
var ACCOUNTS_RECORD_VERSION;
var init_account_store = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/account-store.ts"() {
    "use strict";
    init_auth_service();
    ACCOUNTS_RECORD_VERSION = 1;
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/auth-service.ts
async function fetchUserEmail(accessToken) {
  const response = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(1e4)
  });
  if (!response.ok) return void 0;
  const text = await response.text();
  if (text.length > 64 * 1024) return void 0;
  const payload = JSON.parse(text);
  if (typeof payload !== "object" || payload === null) return void 0;
  const email = payload.email;
  return typeof email === "string" && email.includes("@") ? email : void 0;
}
function gateSubject(record) {
  return record.lineage ?? "legacy-account";
}
function createAntigravityAuthService(options = {}) {
  return new AntigravityAuthService(options);
}
function maskEmail(value) {
  if (!isBoundedSafeText(value, 4096)) return void 0;
  const at = value.indexOf("@");
  if (at <= 0 || at === value.length - 1) return void 0;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (!/^[^\s@]+$/u.test(local) || !/^[^\s@]+$/u.test(domain)) return void 0;
  return `${local.slice(0, 1)}***@${domain}`;
}
var USERINFO_ENDPOINT, AntigravityAuthService;
var init_auth_service = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/auth-service.ts"() {
    "use strict";
    init_auth_store();
    init_credential_coordinator();
    init_oauth_flow();
    init_project_context();
    init_safe_text();
    init_status();
    init_quota();
    init_capability_gates();
    init_account_store();
    USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
    AntigravityAuthService = class {
      store;
      credentials;
      flow;
      quota;
      gates;
      autoActivate;
      accountStore;
      fetchEmail;
      emailBackfillAttempted = false;
      riskAcknowledged = false;
      activeFlowGeneration = 0;
      disposed = false;
      statusListeners = /* @__PURE__ */ new Set();
      constructor(options = {}) {
        this.autoActivate = options.autoActivateGates ?? false;
        this.fetchEmail = options.fetchEmail;
        const storePath = options.storePath ?? defaultAuthStorePath();
        this.store = options.store ?? createAuthStore(storePath);
        this.accountStore = options.accountStore ?? (options.store !== void 0 && options.storePath === void 0 ? createMemoryAccountStore(this.store) : createAccountStore(defaultAccountStorePath(storePath), storePath));
        this.gates = options.gates ?? (options.gatePath !== void 0 ? createFileCapabilityGates(options.gatePath) : options.store === void 0 ? createFileCapabilityGates(defaultCapabilityGatePath(storePath)) : createMemoryCapabilityGates());
        this.credentials = createCredentialCoordinator({
          ...options.credentialOptions,
          store: this.store,
          onTokenRotated: async (record, previous) => {
            const target = await this.accountForRecord(previous);
            if (target === void 0) return;
            await this.accountStore.syncRefreshToken({
              accountId: target.id,
              refreshToken: record.refreshToken,
              previousRefreshToken: previous.refreshToken,
              ...target.lineage === void 0 ? {} : { lineage: target.lineage }
            });
          }
        });
        this.quota = createQuotaService({
          ...options.quotaOptions,
          auth: this.credentials
        });
        const projectDiscovery = createProjectDiscovery(options.projectOptions);
        this.flow = createOAuthFlow({
          ...options.flowOptions,
          validateProject: (accessToken, signal) => projectDiscovery.discover(accessToken, signal),
          commit: (token, project, signal) => this.commitCredential(token, project, signal)
        });
      }
      async listAccounts() {
        await this.backfillActiveAccountEmail();
        return await this.accountStore.list();
      }
      /**
       * Backfill the active account's email through the injected fetcher, once per
       * process. Accounts saved before the email probe existed (or seeded from an
       * email-less auth.json) stay usable without it; the fetcher failure only
       * leaves the email unset.
       */
      async backfillActiveAccountEmail() {
        if (this.emailBackfillAttempted || this.fetchEmail === void 0 || this.disposed) return;
        this.emailBackfillAttempted = true;
        try {
          const accounts = await this.accountStore.read();
          const boundId = accounts.activeId;
          if (boundId === void 0) return;
          const boundAccount = accounts.accounts.find((account) => account.id === boundId);
          if (boundAccount === void 0 || boundAccount.email !== void 0) return;
          const record = await this.readRecord();
          if (record === void 0 || record.email !== void 0) return;
          const credential = await this.credentials.credential();
          if (credential === void 0) return;
          const email = await this.fetchEmail(credential.accessToken);
          if (email === void 0) return;
          const still = await this.accountStore.read();
          if (still.activeId !== boundId) {
            this.emailBackfillAttempted = false;
            return;
          }
          const currentAccount = still.accounts.find((account) => account.id === boundId);
          if (currentAccount === void 0 || currentAccount.email !== void 0) return;
          const current = await this.readRecord();
          if (current === void 0 || current.refreshToken !== currentAccount.refreshToken) {
            this.emailBackfillAttempted = false;
            return;
          }
          if (current.email !== void 0) return;
          const masked = maskEmail(email);
          const committed = await this.store.compareAndCommit(current.revision, {
            refreshToken: current.refreshToken,
            projectId: current.projectId,
            ...masked === void 0 ? {} : { email: masked },
            ...current.lineage === void 0 ? {} : { lineage: current.lineage }
          }, current.lineage);
          if (committed === void 0) return;
          await this.accountStore.saveAccount({
            id: boundId,
            email,
            projectId: currentAccount.projectId,
            refreshToken: currentAccount.refreshToken,
            updatedAt: committed.updatedAt,
            ...currentAccount.lineage === void 0 ? {} : { lineage: currentAccount.lineage }
          });
          this.notifyStatus();
        } catch {
        }
      }
      async accountForRecord(record) {
        const accounts = await this.accountStore.read();
        return accounts.accounts.find((account) => account.refreshToken === record.refreshToken && account.projectId === record.projectId && (account.lineage === void 0 || account.lineage === record.lineage));
      }
      async bindCredentialMutation() {
        const record = await this.readRecord();
        const account = record === void 0 ? void 0 : await this.accountForRecord(record);
        return {
          record,
          onCleared: async () => {
            if (account !== void 0) await this.accountStore.removeAccount(account.id, account);
            if (record !== void 0) await this.gates.clear(gateSubject(record));
          }
        };
      }
      async switchAccount(idOrEmailOrIndex) {
        if (this.disposed) throw new OAuthFlowError("internal", "The Antigravity login is unavailable");
        const account = await this.accountStore.setActive(idOrEmailOrIndex);
        if (account === void 0) {
          return { ok: false, message: `\u672A\u627E\u5230\u5339\u914D\u7684 Antigravity \u8D26\u53F7 "${idOrEmailOrIndex}"` };
        }
        const maskedAccountEmail = maskEmail(account.email);
        const draft = {
          refreshToken: account.refreshToken,
          projectId: account.projectId,
          ...maskedAccountEmail === void 0 ? {} : { email: maskedAccountEmail },
          ...account.lineage === void 0 ? {} : { lineage: account.lineage }
        };
        const committed = await this.store.commit(draft);
        this.credentials.resetCache();
        if (this.autoActivate) {
          await this.autoActivateGates(committed.lineage ?? "legacy-account");
        }
        this.notifyStatus();
        return {
          ok: true,
          message: `\u5DF2\u5207\u6362\u81F3\u8D26\u53F7: ${account.email ?? account.maskedEmail ?? account.id} (\u9879\u76EE: ${account.projectId})`,
          account
        };
      }
      async removeAccount(idOrEmailOrIndex) {
        if (this.disposed) throw new OAuthFlowError("internal", "The Antigravity login is unavailable");
        const removed = await this.accountStore.removeAccount(idOrEmailOrIndex);
        if (removed === void 0) {
          return { ok: false, message: `\u672A\u627E\u5230\u5339\u914D\u7684 Antigravity \u8D26\u53F7 "${idOrEmailOrIndex}"` };
        }
        const current = await this.accountStore.read();
        if (current.activeId !== void 0) {
          await this.switchAccount(current.activeId);
        } else {
          await this.logout();
        }
        this.notifyStatus();
        return { ok: true, message: `\u5DF2\u79FB\u9664\u8D26\u53F7: ${removed.email ?? removed.maskedEmail ?? removed.id}` };
      }
      async status() {
        const record = await this.readRecord();
        const flowStatus = this.flow.status();
        const phase = flowStatus.phase === "idle" && record !== void 0 ? "success" : flowStatus.phase;
        const maskedEmail = maskEmail(record?.email);
        const credentialStatus = await this.credentials.status();
        const gateEvidence = await this.gateEvidenceFor(record);
        const login = {
          phase,
          configured: record !== void 0,
          projectAvailable: record?.projectId !== void 0,
          ...flowStatus.authorizationUrl === void 0 ? {} : { authorizationUrl: flowStatus.authorizationUrl },
          ...flowStatus.expiresAt === void 0 ? {} : { expiresAt: flowStatus.expiresAt },
          ...maskedEmail === void 0 ? {} : { maskedEmail },
          ...flowStatus.errorCode === void 0 ? {} : { errorCode: flowStatus.errorCode }
        };
        return createStatusView(this.riskAcknowledged, login, credentialStatus, this.credentials.revokeStatus(), gateEvidence);
      }
      async acknowledgeRisk() {
        this.riskAcknowledged = true;
        this.notifyStatus();
        return { acknowledged: true };
      }
      /** Observe value-safe gate changes so capability rows can register without polling secrets. */
      watchStatus(listener) {
        this.statusListeners.add(listener);
        return () => {
          this.statusListeners.delete(listener);
        };
      }
      async recordGate0(outcome) {
        const subject = gateSubject(await this.requireRecord());
        await this.gates.recordGate0(subject, outcome);
        this.notifyStatus();
      }
      async recordLlmFamilyGate(family, outcome) {
        const record = await this.requireRecord();
        const subject = gateSubject(record);
        await this.gates.recordLlmFamily(subject, family, outcome);
        this.notifyStatus();
      }
      async recordCapabilityGate(id, outcome) {
        const record = await this.requireRecord();
        const subject = gateSubject(record);
        if (id === "auth-llm") {
          throw new OAuthFlowError("internal", "Auth/LLM availability is derived from independent family evidence");
        }
        await this.gates.recordCapability(subject, id, outcome);
        this.notifyStatus();
      }
      async capabilityGateEvidence() {
        return this.gateEvidenceFor(await this.readRecord());
      }
      async gate0Passed() {
        return (await this.capabilityGateEvidence()).gate0?.outcome === "passed";
      }
      async capabilityAvailable(id) {
        const status = await this.status();
        return status.capabilities.some((capability) => capability.id === id && capability.state === "available");
      }
      async startLogin() {
        if (this.disposed) throw new OAuthFlowError("internal", "The Antigravity login is unavailable");
        if (!this.riskAcknowledged) {
          throw new OAuthFlowError("risk-acknowledgement-required", "Risk acknowledgement is required before login");
        }
        const started = await this.flow.start();
        this.activeFlowGeneration = this.flow.generation();
        this.notifyStatus();
        return started;
      }
      async completeCallback(callbackUrl) {
        if (this.disposed) throw new OAuthFlowError("internal", "The Antigravity login is unavailable");
        try {
          return await this.flow.completeCallbackUrl(callbackUrl);
        } finally {
          this.notifyStatus();
        }
      }
      async cancelLogin() {
        const status = await this.flow.cancel();
        if (status.phase !== "success") this.activeFlowGeneration = 0;
        this.notifyStatus();
        return {
          phase: status.phase,
          ...status.errorCode === void 0 ? {} : { errorCode: status.errorCode }
        };
      }
      async credential(signal, options) {
        return await this.credentials.credential(signal, options);
      }
      async usage(signal, force = false) {
        return await this.quota.refresh(signal, force);
      }
      async logout() {
        if (this.disposed) throw new OAuthFlowError("internal", "The Antigravity login is unavailable");
        this.activeFlowGeneration = 0;
        try {
          const binding = await this.bindCredentialMutation();
          await this.flow.cancel();
          const result2 = await this.credentials.logout(binding);
          this.notifyStatus();
          return result2;
        } catch {
          throw new OAuthFlowError("persistence-failed", "The local Antigravity credential could not be cleared");
        }
      }
      async revoke(confirmed, signal) {
        if (this.disposed) throw new OAuthFlowError("internal", "The Antigravity login is unavailable");
        const binding = confirmed ? await this.bindCredentialMutation() : void 0;
        const result2 = await this.credentials.revoke(confirmed, signal, binding);
        this.notifyStatus();
        return result2;
      }
      async dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.activeFlowGeneration = 0;
        this.statusListeners.clear();
        await Promise.all([this.flow.dispose(), this.credentials.dispose(), this.quota.dispose()]);
      }
      async commitCredential(token, project, signal) {
        const flowGeneration = this.flow.generation();
        if (this.disposed || flowGeneration !== this.activeFlowGeneration || signal.aborted) {
          throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
        }
        const current = await this.readRecord();
        if (this.disposed || flowGeneration !== this.activeFlowGeneration || signal.aborted) {
          throw new OAuthFlowError("cancelled", "The OAuth login was cancelled");
        }
        const rawEmail = project.email ?? token.email ?? (this.fetchEmail === void 0 ? void 0 : await this.fetchEmail(token.accessToken).catch(() => void 0));
        const email = maskEmail(rawEmail);
        const draft = {
          refreshToken: token.refreshToken,
          projectId: project.projectId,
          ...email === void 0 ? {} : { email }
        };
        const committed = await this.store.compareAndCommit(current?.revision ?? 0, draft, current?.lineage);
        if (committed === void 0) throw new OAuthFlowError("credential-conflict", "The login changed while it was completing");
        await this.accountStore.saveAccount({
          projectId: project.projectId,
          refreshToken: token.refreshToken,
          updatedAt: committed.updatedAt,
          ...rawEmail === void 0 ? {} : { email: rawEmail },
          ...committed.lineage === void 0 ? {} : { lineage: committed.lineage }
        }).catch(() => {
        });
        if (this.autoActivate) {
          const subject = committed.lineage ?? "legacy-account";
          await this.autoActivateGates(subject);
        } else {
          await this.gates.clear().catch(() => {
          });
        }
        this.credentials.replaceFromLogin({
          accessToken: token.accessToken,
          refreshToken: token.refreshToken,
          expiresAt: token.expiresAt,
          projectId: project.projectId
        }, committed);
        this.notifyStatus();
      }
      notifyStatus() {
        for (const listener of this.statusListeners) {
          try {
            listener();
          } catch {
          }
        }
      }
      async gateEvidenceFor(record) {
        try {
          const evidence = await this.gates.read();
          if (record === void 0) return {};
          const subject = gateSubject(record);
          if (evidence.subject === subject) return evidence;
          if (this.autoActivate && record.projectId !== void 0) {
            await this.autoActivateGates(subject);
            return await this.gates.read();
          }
          return {};
        } catch {
          return { gate0: { outcome: "protocol-drift", checkedAt: (/* @__PURE__ */ new Date()).toISOString() } };
        }
      }
      async autoActivateGates(subject) {
        try {
          await this.gates.recordGate0(subject, "passed");
          await this.gates.recordLlmFamily(subject, "gemini", "passed");
          await this.gates.recordLlmFamily(subject, "claude", "passed");
          await this.gates.recordLlmFamily(subject, "gpt-oss", "passed");
          await this.gates.recordCapability(subject, "search", "passed");
          await this.gates.recordCapability(subject, "image", "passed");
          await this.gates.recordCapability(subject, "video", "passed");
        } catch {
        }
      }
      async requireRecord() {
        const record = await this.readRecord();
        if (record === void 0) throw new OAuthFlowError("internal", "Antigravity login is required");
        return record;
      }
      async readRecord() {
        try {
          return await this.store.read();
        } catch {
          throw new OAuthFlowError("persistence-failed", "The Antigravity auth store could not be read");
        }
      }
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/replay.ts
function createReplayState(model, family, finish, blocks) {
  const boundedBlocks = blocks.slice(0, MAX_BLOCKS).map((block) => {
    const signature = safeSignature(block.signature);
    return { kind: block.kind, ...signature === void 0 ? {} : { signature } };
  });
  const boundedFinish = safeFinish(finish);
  return {
    response: {
      version: ANTIGRAVITY_REPLAY_VERSION,
      provider: "google-antigravity",
      model: model.slice(0, 256),
      family,
      ...boundedFinish === void 0 ? {} : { finish: boundedFinish }
    },
    blocks: boundedBlocks
  };
}
function compatibleReplayState(message, provider, model, blockKinds) {
  if (provider !== "google-antigravity" || message.role !== "assistant") return void 0;
  const provenance = isRecord7(message.source) ? message.source : void 0;
  if (provenance !== void 0 && provenance.kind === "model" && (provenance.provider !== provider || provenance.model !== model)) return void 0;
  const value = isRecord7(provenance?.replayState) ? provenance.replayState : isRecord7(message.replayState) ? message.replayState : void 0;
  if (!isRecord7(value) || !isRecord7(value.response) || !Array.isArray(value.blocks)) return void 0;
  const family = value.response.family;
  if (value.response.version !== ANTIGRAVITY_REPLAY_VERSION || value.response.provider !== provider || value.response.model !== model || !isFamily(family) || value.blocks.length > MAX_BLOCKS) return void 0;
  const blocks = [];
  for (const item of value.blocks) {
    if (!isRecord7(item) || typeof item.kind !== "string") continue;
    const kind = item.kind;
    const signature = typeof item.signature === "string" && safeSignature(item.signature) !== void 0 ? item.signature : void 0;
    blocks.push({ kind, ...signature === void 0 ? {} : { signature } });
  }
  if (blockKinds !== void 0 && (blocks.length !== blockKinds.length || blocks.some((block, index) => block.kind !== blockKinds[index]))) return void 0;
  const finish = value.response.finish === void 0 ? void 0 : safeFinish(value.response.finish);
  if (value.response.finish !== void 0 && finish === void 0) return void 0;
  return {
    response: {
      version: ANTIGRAVITY_REPLAY_VERSION,
      provider: "google-antigravity",
      model,
      family,
      ...finish === void 0 ? {} : { finish }
    },
    blocks
  };
}
function antigravityModelFamily(model) {
  const value = model.toLowerCase();
  if (value.includes("gemini")) return "gemini";
  if (value.includes("claude")) return "claude";
  if (value.includes("gpt-oss")) return "gpt-oss";
  return "unknown";
}
function sanitizeToolSchemas(tools) {
  if (tools === void 0) return [];
  return tools.slice(0, 64).map((tool) => ({
    name: boundedName(tool.name),
    description: boundedText(tool.description, 4096),
    parameters: sanitizeSchema(tool.parameters)
  }));
}
function buildFunctionDeclarations(tools) {
  return sanitizeToolSchemas(tools).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
}
function sanitizeSchema(value, depth = 0) {
  if (depth > 8 || !isRecord7(value)) return { type: "object", properties: {} };
  const type = typeof value.type === "string" && ["object", "array", "string", "number", "integer", "boolean", "null"].includes(value.type) ? value.type : "object";
  const output = { type };
  if (typeof value.description === "string") output.description = boundedText(value.description, 1024);
  if (Array.isArray(value.required)) output.required = value.required.filter((item) => typeof item === "string").slice(0, 128);
  if (Array.isArray(value.enum)) output.enum = value.enum.slice(0, 128).filter((item) => ["string", "number", "boolean", "null"].includes(typeof item));
  if (type === "object" && isRecord7(value.properties)) {
    const properties = {};
    for (const [key, item] of Object.entries(value.properties).slice(0, 128)) {
      if (!hasControl(key) && key.length > 0) properties[key.slice(0, 128)] = sanitizeSchema(item, depth + 1);
    }
    output.properties = properties;
  }
  if (type === "array") output.items = sanitizeSchema(value.items, depth + 1);
  if (Array.isArray(value.oneOf)) output.oneOf = value.oneOf.slice(0, 8).map((item) => sanitizeSchema(item, depth + 1));
  return output;
}
function safeFinish(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 128) return void 0;
  const normalized = value.toUpperCase();
  return ["STOP", "MAX_TOKENS", "LENGTH", "TOOL_CALLS", "FUNCTION_CALL", "SAFETY", "BLOCKLIST", "ERROR"].includes(normalized) ? normalized : void 0;
}
function safeSignature(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_SIGNATURE_LENGTH) return void 0;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return void 0;
  }
  return value;
}
function boundedName(value) {
  return typeof value === "string" && value.length > 0 && !hasControl(value) ? value.slice(0, 128) : "unnamed_tool";
}
function boundedText(value, limit) {
  return typeof value === "string" && !hasControl(value) ? value.slice(0, limit) : "";
}
function hasControl(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function isFamily(value) {
  return value === "gemini" || value === "claude" || value === "gpt-oss" || value === "unknown";
}
function isRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var ANTIGRAVITY_REPLAY_VERSION, MAX_SIGNATURE_LENGTH, MAX_BLOCKS;
var init_replay = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/replay.ts"() {
    "use strict";
    ANTIGRAVITY_REPLAY_VERSION = 1;
    MAX_SIGNATURE_LENGTH = 16 * 1024;
    MAX_BLOCKS = 128;
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/llm-adapter.ts
import { Buffer as Buffer6 } from "node:buffer";
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  ToolCallId,
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  resolveRetryPolicy
} from "@deepseek-ai/dsh-llm";
function cleanModelDisplayName(name2) {
  return name2.replace(/\s*\([^)]*\)\s*$/u, "").trim();
}
function getModelReasoningEfforts(modelId) {
  const lower = modelId.toLowerCase();
  if (lower.includes("flash") && !lower.includes("image")) {
    return {
      efforts: [
        { id: ReasoningEffortId("low"), name: "Low" },
        { id: ReasoningEffortId("medium"), name: "Medium" },
        { id: ReasoningEffortId("high"), name: "High" }
      ],
      defaultEffort: ReasoningEffortId(lower.includes("gemini-3.8-flash") ? "medium" : "high")
    };
  }
  if (lower.includes("pro")) {
    return {
      efforts: [
        { id: ReasoningEffortId("low"), name: "Low" },
        { id: ReasoningEffortId("high"), name: "High" }
      ],
      defaultEffort: ReasoningEffortId("high")
    };
  }
  return void 0;
}
function createCatalogView(definitions, state, available, checkedAt) {
  const models = Object.values(definitions).filter((definition) => !definition.modalities.output.includes("image")).map((definition) => ({
    id: definition.id,
    name: cleanModelDisplayName(definition.name),
    state: state === "live-available" ? available?.has(definition.id) === true ? "live-available" : "unavailable" : "snapshot"
  }));
  return { state, models, ...checkedAt === void 0 ? {} : { checkedAt } };
}
function cloneCatalogView(value) {
  return {
    state: value.state,
    models: value.models.map((model) => ({ ...model })),
    ...value.checkedAt === void 0 ? {} : { checkedAt: value.checkedAt }
  };
}
function parseLiveModelIds(value, definitions) {
  const root = isRecord8(value) && isRecord8(value.response) ? value.response : value;
  if (!isRecord8(root) || !isRecord8(root.models)) throw new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
  const entries = Object.entries(root.models);
  if (entries.length > 512) throw new LlmError("The Antigravity live model catalog exceeded the model limit", "PROTOCOL_DRIFT");
  const aliases = getResolverAliasMap();
  const live = /* @__PURE__ */ new Set();
  for (const [id, rawEntry] of entries) {
    if (!safeModelId(id) || !isRecord8(rawEntry)) throw new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
    const cleanId = cleanModelId(id);
    live.add(canonicalWireModel(cleanId, aliases));
    live.add(cleanId);
    live.add(id);
    if (cleanId === "gemini-3-flash" || cleanId === "gemini-3-flash-agent" || cleanId === "gemini-3.7-flash-tiered" || cleanId.startsWith("gemini-3-flash") || cleanId.startsWith("gemini-3.7-flash")) {
      live.add("gemini-3.7-flash");
      live.add("gemini-3.7-flash-medium");
      live.add("gemini-3.7-flash-low");
      live.add("gemini-3.7-flash-high");
    }
    if (cleanId === "gemini-3.8-flash-tiered" || cleanId.startsWith("gemini-3.8-flash")) {
      live.add("gemini-3.8-flash");
      live.add("gemini-3.8-flash-medium");
      live.add("gemini-3.8-flash-low");
      live.add("gemini-3.8-flash-high");
    }
    if (rawEntry.modelName !== void 0 && typeof rawEntry.modelName === "string") {
      if (!safeModelId(rawEntry.modelName)) throw new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
      const cleanName = cleanModelId(rawEntry.modelName);
      live.add(canonicalWireModel(cleanName, aliases));
      live.add(cleanName);
    }
    if (rawEntry.displayName !== void 0 && (typeof rawEntry.displayName !== "string" || rawEntry.displayName.length > 512 || containsControl(rawEntry.displayName))) {
      throw new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
    }
  }
  const available = /* @__PURE__ */ new Set();
  for (const definition of Object.values(definitions)) {
    const resolved = resolveModelWithTier(definition.id).actualModel;
    const cleanResolved = cleanModelId(resolved);
    const canonical = canonicalWireModel(cleanResolved, aliases);
    if (live.has(canonical) || live.has(cleanResolved) || live.has(resolved) || live.has(definition.id) || definition.id === "antigravity-gemini-3.7-flash" && (live.has("gemini-3-flash") || live.has("gemini-3-flash-agent") || live.has("gemini-3.7-flash-tiered") || live.has("gemini-3.7-flash") || live.has("gemini-3.7-flash-medium"))) {
      available.add(definition.id);
    }
  }
  return available;
}
function cleanModelId(value) {
  return value.replace(/^(?:publishers\/[^/]+\/)?models\//, "");
}
function canonicalWireModel(value, aliases) {
  return aliases[value] ?? value;
}
function safeModelId(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && !containsControl(value);
}
function containsControl(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function beginBlock(states, part) {
  const index = states.length;
  const block = part.kind === "tool-call" ? {
    index,
    kind: "tool-call",
    id: ToolCallId(part.id ?? `antigravity-call-${String(index)}`),
    ...part.name === void 0 ? {} : { name: part.name },
    text: "",
    ...part.signature === void 0 ? {} : { signature: part.signature }
  } : {
    index,
    kind: part.kind,
    id: ToolCallId(`antigravity-block-${String(index)}`),
    text: "",
    ...part.signature === void 0 ? {} : { signature: part.signature }
  };
  states.push(block);
  return block;
}
function sameBlock(state, part) {
  if (state.kind !== part.kind) return false;
  return part.kind !== "tool-call" || (part.id === void 0 || part.id === String(state.id));
}
function assembleFunctionName(current, fragment) {
  if (fragment.length === 0 || fragment.length > 256 || containsControl(fragment)) {
    throw new PrivateTransportError("protocol-drift", "The private tool-call name was invalid");
  }
  if (current === void 0 || current.length === 0) return fragment;
  if (fragment === current) return current;
  if (fragment.startsWith(current)) return fragment;
  const combined = `${current}${fragment}`;
  if (combined.length > 256) throw new PrivateTransportError("protocol-drift", "The private tool-call name exceeded the byte limit");
  return combined;
}
function endBlock(state) {
  if (state.kind === "text") return { type: "block-end", index: state.index, block: { type: "text", text: state.text } };
  if (state.kind === "reasoning") return { type: "block-end", index: state.index, block: { type: "reasoning", text: state.text.trimEnd() } };
  let parsed;
  try {
    parsed = JSON.parse(state.text);
  } catch {
    throw new PrivateTransportError("protocol-drift", "The private tool-call arguments were incomplete JSON");
  }
  if (!isRecord8(parsed)) throw new PrivateTransportError("protocol-drift", "The private tool-call arguments were not an object");
  const args = state.text;
  if (state.name === void 0 || !/^[A-Za-z_][A-Za-z0-9_.:-]{0,255}$/u.test(state.name)) {
    throw new PrivateTransportError("protocol-drift", "The private tool-call name was missing or invalid");
  }
  return {
    type: "block-end",
    index: state.index,
    block: {
      type: "tool-call",
      id: state.id,
      name: state.name,
      arguments: args
    }
  };
}
function buildAntigravityGeneratePayload(options, credential) {
  const toolNames = /* @__PURE__ */ new Map();
  const contents = options.messages.filter((message) => message.role !== "system").map((message) => mapMessage(message, options.model, toolNames));
  return buildPayloadFromContents(options, credential, contents);
}
async function buildAntigravityGeneratePayloadForAdapter(options, credential, session, timestamp, attachments) {
  const contents = [];
  const toolNames = /* @__PURE__ */ new Map();
  for (const message of options.messages) {
    if (message.role === "system") continue;
    contents.push(await mapMessageWithAttachments(message, options.model, toolNames, attachments, options.signal));
  }
  const payload = buildPayloadFromContents(options, credential, contents);
  const metadata = buildAgyAgentRequestMetadata(session, payload.request, resolveWireModel(options.model, options.reasoningEffort), timestamp);
  const request = payload.request;
  request.labels = metadata.labels;
  request.sessionId = metadata.sessionId;
  orderAgyRequestPayloadInPlace(request);
  return {
    ...payload.project === void 0 ? {} : { project: payload.project },
    requestId: metadata.requestId,
    request,
    model: payload.model,
    userAgent: "antigravity",
    requestType: "agent"
  };
}
function groupClaudeFunctionResponses(contents, model) {
  if (antigravityModelFamily(model) !== "claude") return contents;
  const grouped = [];
  let pendingResponses = [];
  const flushResponses = () => {
    if (pendingResponses.length === 0) return;
    grouped.push({ role: "user", parts: pendingResponses });
    pendingResponses = [];
  };
  for (const content of contents) {
    const rawParts = Array.isArray(content.parts) ? content.parts : [];
    const responseParts = rawParts.filter((part) => isRecord8(part) && isRecord8(part.functionResponse));
    const responseOnly = content.role === "user" && rawParts.length > 0 && responseParts.length === rawParts.length;
    if (responseOnly) {
      pendingResponses.push(...responseParts);
      continue;
    }
    flushResponses();
    grouped.push(content);
  }
  flushResponses();
  return grouped;
}
function buildPayloadFromContents(options, credential, contents) {
  const wireModel = resolveWireModel(options.model, options.reasoningEffort);
  const usesCapturedGemini38ThinkingBudget = /^gemini-3\.8-flash-(?:low|medium|high)$/u.test(wireModel);
  const requestContents = groupClaudeFunctionResponses(contents, options.model);
  const request = { contents: requestContents };
  const systemParts = [
    ...options.system?.trim() ? [{ text: options.system }] : [],
    ...options.messages.flatMap((message) => message.role === "system" ? message.content.flatMap((block) => block.type === "text" && block.text.trim() ? [{ text: block.text }] : []) : [])
  ];
  if (systemParts.length > 0) request.systemInstruction = { parts: systemParts };
  const generationConfig = {};
  if (options.maxTokens !== void 0) generationConfig.maxOutputTokens = boundedInteger(options.maxTokens, 1, 1e6, "maxTokens");
  else if (usesCapturedGemini38ThinkingBudget) generationConfig.maxOutputTokens = 65536;
  if (options.temperature !== void 0) generationConfig.temperature = boundedNumber(options.temperature, -100, 100, "temperature");
  if (options.stop !== void 0) generationConfig.stopSequences = options.stop.slice(0, 16).map((item) => item.slice(0, 256));
  if (options.reasoningEffort !== void 0) generationConfig.thinkingConfig = { thinkingLevel: String(options.reasoningEffort) };
  if (Object.keys(generationConfig).length > 0) request.generationConfig = generationConfig;
  if (options.tools !== void 0 && options.tools.length > 0) {
    const declarations = buildFunctionDeclarations(options.tools);
    if (declarations.length > 0) request.tools = [{ functionDeclarations: declarations }];
  }
  const resolved = resolveModelWithTier(usesCapturedGemini38ThinkingBudget ? wireModel : options.model, { cli_first: false });
  const requestedEffort = normalizeReasoningEffort(options.reasoningEffort);
  const thinkingLevel = requestedEffort ?? resolved.thinkingLevel;
  if (wireModel.toLowerCase().includes("claude")) {
    applyClaudeToolHardening(request);
    applyClaudeTransforms(request, {
      model: wireModel,
      ...resolved.thinkingBudget === void 0 ? {} : { tierThinkingBudget: resolved.thinkingBudget },
      ...options.reasoningEffort === void 0 && resolved.thinkingBudget === void 0 ? {} : { normalizedThinking: { includeThoughts: true, ...resolved.thinkingBudget === void 0 ? {} : { thinkingBudget: resolved.thinkingBudget } } },
      cleanJSONSchema: (value) => isRecord8(value) ? value : { type: "object", properties: {} }
    });
  } else {
    applyGeminiTransforms(request, {
      model: wireModel,
      ...thinkingLevel === void 0 || usesCapturedGemini38ThinkingBudget ? {} : { tierThinkingLevel: thinkingLevel },
      ...resolved.thinkingBudget === void 0 ? {} : { tierThinkingBudget: resolved.thinkingBudget },
      ...options.reasoningEffort === void 0 && resolved.thinkingBudget === void 0 ? {} : { normalizedThinking: { includeThoughts: true, ...resolved.thinkingBudget === void 0 ? {} : { thinkingBudget: resolved.thinkingBudget } } }
    });
    if (usesCapturedGemini38ThinkingBudget) {
      const transformedConfig = request.generationConfig;
      if (!isRecord8(transformedConfig) || typeof resolved.thinkingBudget !== "number") {
        throw new LlmError("The Gemini 3.8 captured thinking configuration could not be resolved", "PROTOCOL_DRIFT");
      }
      transformedConfig.thinkingConfig = { includeThoughts: true, thinkingBudget: resolved.thinkingBudget };
    }
  }
  const project = credential.projectId === "inductive-dreamer-qrkws" || !credential.projectId ? void 0 : credential.projectId;
  return { ...project === void 0 ? {} : { project }, model: wireModel, request };
}
function applyClaudeToolHardening(request) {
  if (!Array.isArray(request.tools) || request.tools.length === 0) return;
  request.tools = request.tools.map((tool) => {
    if (!isRecord8(tool) || !Array.isArray(tool.functionDeclarations)) return tool;
    return {
      ...tool,
      functionDeclarations: tool.functionDeclarations.map((declaration) => hardenClaudeToolDeclaration(declaration))
    };
  });
  const instructionPart = { text: CLAUDE_TOOL_SYSTEM_INSTRUCTION };
  const existing = request.systemInstruction;
  if (isRecord8(existing) && Array.isArray(existing.parts)) {
    if (existing.parts.some((part) => isRecord8(part) && typeof part.text === "string" && part.text.includes("CRITICAL TOOL USAGE INSTRUCTIONS"))) return;
    request.systemInstruction = { ...existing, parts: [...existing.parts, instructionPart] };
  } else if (typeof existing === "string") {
    request.systemInstruction = { role: "user", parts: [{ text: existing }, instructionPart] };
  } else {
    request.systemInstruction = { role: "user", parts: [instructionPart] };
  }
}
function hardenClaudeToolDeclaration(value) {
  if (!isRecord8(value)) return value;
  const description = typeof value.description === "string" ? value.description : "";
  if (description.includes("STRICT PARAMETERS:")) return value;
  const schema = isRecord8(value.parameters) ? value.parameters : void 0;
  const properties = schema !== void 0 && isRecord8(schema.properties) ? schema.properties : void 0;
  if (properties === void 0 || Object.keys(properties).length === 0) return value;
  const required = new Set(Array.isArray(schema?.required) ? schema.required.filter((item) => typeof item === "string") : []);
  const parameters = Object.entries(properties).map(([name2, property]) => {
    const requiredHint = required.has(name2) ? ", REQUIRED" : "";
    return `${name2} (${claudeToolTypeHint(property)}${requiredHint})`;
  });
  return {
    ...value,
    description: description + CLAUDE_DESCRIPTION_PROMPT.replace("{params}", parameters.join(", "))
  };
}
function claudeToolTypeHint(value) {
  if (!isRecord8(value)) return "unknown";
  if (Array.isArray(value.enum)) {
    return value.enum.length <= 5 ? `string ENUM[${value.enum.map((item) => JSON.stringify(item)).join(", ")}]` : `string ENUM[${value.enum.length} options]`;
  }
  const type = typeof value.type === "string" ? value.type : "unknown";
  if (type === "array") {
    if (!isRecord8(value.items)) return "ARRAY";
    const itemType = typeof value.items.type === "string" ? value.items.type : "unknown";
    if (itemType !== "object") return `ARRAY_OF_${itemType.toUpperCase()}`;
    if (!isRecord8(value.items.properties)) return "ARRAY_OF_OBJECTS";
    const nestedRequired = new Set(Array.isArray(value.items.required) ? value.items.required.filter((item) => typeof item === "string") : []);
    const nested = Object.entries(value.items.properties).map(([name2, property]) => {
      const nestedType = isRecord8(property) && typeof property.type === "string" ? property.type : "unknown";
      return `${name2}: ${nestedType}${nestedRequired.has(name2) ? " REQUIRED" : ""}`;
    });
    return `ARRAY_OF_OBJECTS[${nested.join(", ")}]`;
  }
  if (type === "object" && isRecord8(value.properties)) {
    const nestedRequired = new Set(Array.isArray(value.required) ? value.required.filter((item) => typeof item === "string") : []);
    const nested = Object.entries(value.properties).map(([name2, property]) => {
      const nestedType = isRecord8(property) && typeof property.type === "string" ? property.type : "unknown";
      return `${name2}: ${nestedType}${nestedRequired.has(name2) ? " REQUIRED" : ""}`;
    });
    return `object{${nested.join(", ")}}`;
  }
  return type;
}
function findMessageReasoningSignature(message, replayBlocks) {
  const fromReplay = replayBlocks.find((b) => b.kind === "reasoning" && b.signature !== void 0)?.signature;
  if (fromReplay !== void 0) return fromReplay;
  for (const block of message.content) {
    if (block.type === "reasoning") {
      const sig = block.signature ?? block.thoughtSignature;
      if (typeof sig === "string" && sig.length > 0) return sig;
    }
  }
  return void 0;
}
function mapMessage(message, model, toolNames) {
  if (message.role === "tool") return mapToolResult(message, model, toolNames);
  const parts = [];
  const replay = message.role === "assistant" ? compatibleReplayState(message, ANTIGRAVITY_PROVIDER, model, contentKinds(message)) : void 0;
  const replayBlocks = replay?.blocks ?? [];
  const messageReasoningSignature = findMessageReasoningSignature(message, replayBlocks);
  const isClaude = antigravityModelFamily(model) === "claude";
  const isGemini = antigravityModelFamily(model) === "gemini";
  let replayIndex = 0;
  let sawClaudeFunctionCall = false;
  for (const block of message.content) {
    const replayKind = block.type === "text" || block.type === "reasoning" || block.type === "tool-call" ? block.type : void 0;
    const replayBlock = replayKind === void 0 ? void 0 : replayBlocks[replayIndex++];
    const replaySignature = replayBlock !== void 0 && replayBlock.kind === replayKind ? replayBlock.signature : void 0;
    const blockSignature = block.signature ?? block.thoughtSignature ?? replaySignature;
    if (block.type === "text") {
      if (block.text.length === 0 && message.content.length > 1) continue;
      parts.push({ text: block.text, ...blockSignature === void 0 ? {} : { thoughtSignature: blockSignature } });
    } else if (block.type === "reasoning") {
      if (isClaude && blockSignature === void 0) continue;
      parts.push({ text: block.text, thought: true, ...blockSignature === void 0 ? {} : { thoughtSignature: blockSignature } });
    } else if (block.type === "tool-call") {
      const callId = rememberToolName(toolNames, block.id, block.name, isGemini);
      const signature = isClaude ? sawClaudeFunctionCall ? void 0 : blockSignature ?? SKIP_THOUGHT_SIGNATURE : blockSignature ?? messageReasoningSignature ?? SKIP_THOUGHT_SIGNATURE;
      sawClaudeFunctionCall ||= isClaude;
      parts.push({
        functionCall: {
          ...isClaude ? { id: callId } : {},
          name: block.name,
          args: parseJsonObject(block.arguments)
        },
        ...signature === void 0 ? {} : { thoughtSignature: signature }
      });
    } else if (block.type === "image") {
      throw new LlmError("Antigravity text requests do not accept unresolved image blocks", "UNSUPPORTED_MODALITY");
    }
  }
  return {
    role: message.role === "assistant" ? "model" : "user",
    parts
  };
}
async function mapMessageWithAttachments(message, model, toolNames, attachments, signal) {
  if (message.role === "tool" || !message.content.some((block) => block.type === "image")) return mapMessage(message, model, toolNames);
  if (attachments === void 0) throw new LlmError("Antigravity image input requires the Host AttachmentStore", "UNSUPPORTED_MODALITY");
  const replay = message.role === "assistant" ? compatibleReplayState(message, ANTIGRAVITY_PROVIDER, model, contentKinds(message)) : void 0;
  const replayBlocks = replay?.blocks ?? [];
  const messageReasoningSignature = findMessageReasoningSignature(message, replayBlocks);
  const parts = [];
  const isClaude = antigravityModelFamily(model) === "claude";
  const isGemini = antigravityModelFamily(model) === "gemini";
  let replayIndex = 0;
  let sawClaudeFunctionCall = false;
  for (const block of message.content) {
    const replayKind = block.type === "text" || block.type === "reasoning" || block.type === "tool-call" ? block.type : void 0;
    const replayBlock = replayKind === void 0 ? void 0 : replayBlocks[replayIndex++];
    const replaySignature = replayBlock !== void 0 && replayBlock.kind === replayKind ? replayBlock.signature : void 0;
    const blockSignature = block.signature ?? block.thoughtSignature ?? replaySignature;
    if (block.type === "image") {
      const stored = await attachments.readImage(block.attachment, signal);
      parts.push({ inlineData: { mimeType: stored.ref.mediaType, data: Buffer6.from(stored.data).toString("base64") } });
    } else if (block.type === "text") {
      if (block.text.length === 0 && message.content.length > 1) continue;
      parts.push({ text: block.text, ...blockSignature === void 0 ? {} : { thoughtSignature: blockSignature } });
    } else if (block.type === "reasoning") {
      if (isClaude && blockSignature === void 0) continue;
      parts.push({ text: block.text, thought: true, ...blockSignature === void 0 ? {} : { thoughtSignature: blockSignature } });
    } else if (block.type === "tool-call") {
      const callId = rememberToolName(toolNames, block.id, block.name, isGemini);
      const signature = isClaude ? sawClaudeFunctionCall ? void 0 : blockSignature ?? SKIP_THOUGHT_SIGNATURE : blockSignature ?? messageReasoningSignature ?? SKIP_THOUGHT_SIGNATURE;
      sawClaudeFunctionCall ||= isClaude;
      parts.push({
        functionCall: {
          ...isClaude ? { id: callId } : {},
          name: block.name,
          args: parseJsonObject(block.arguments)
        },
        ...signature === void 0 ? {} : { thoughtSignature: signature }
      });
    }
  }
  return { role: message.role === "assistant" ? "model" : "user", parts };
}
function mapToolResult(message, model, toolNames) {
  const callId = requireToolCallId(message.toolCallId);
  const isClaude = antigravityModelFamily(model) === "claude";
  const name2 = requireToolName(toolNames, callId, antigravityModelFamily(model) === "gemini");
  return { role: "user", parts: [{ functionResponse: {
    ...isClaude ? { id: callId } : {},
    name: name2,
    response: { content: blocksToText(message.content) }
  } }] };
}
function rememberToolName(toolNames, callId, name2, isGemini) {
  if (name2.length === 0 || name2.length > 256 || containsControl(name2)) throw new LlmError("The tool call name is invalid", "INVALID_ARGS");
  const id = requireToolCallId(callId);
  const existing = toolNames.get(id);
  if (isGemini && existing !== void 0) throw new LlmError("A tool call id was reused before its prior result", "INVALID_ARGS");
  if (existing !== void 0 && existing !== name2) throw new LlmError("A tool call id was reused with a different name", "INVALID_ARGS");
  toolNames.set(id, name2);
  return id;
}
function requireToolName(toolNames, callId, isGemini) {
  const id = requireToolCallId(callId);
  const name2 = toolNames.get(id);
  if (name2 === void 0) throw new LlmError("A tool result did not match a prior tool call", "INVALID_ARGS");
  if (isGemini) toolNames.delete(id);
  return name2;
}
function requireToolCallId(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 512 || containsControl(value)) {
    throw new LlmError("The tool call id is invalid", "INVALID_ARGS");
  }
  return value;
}
function normalizeReasoningEffort(value) {
  if (value === void 0) return void 0;
  const normalized = String(value).toLowerCase();
  return ["minimal", "low", "medium", "high"].includes(normalized) ? normalized : void 0;
}
function resolveWireModel(model, reasoningEffort) {
  if (model === "antigravity-gemini-3.7-flash" || model === "gemini-3.7-flash") {
    return "gemini-3-flash";
  }
  const effort = normalizeReasoningEffort(reasoningEffort);
  const routeModel = effort !== void 0 && (model === "antigravity-gemini-3.8-flash" || model === "gemini-3.8-flash") ? `${model}-${effort}` : model;
  const resolved = resolveModelWithTier(routeModel, { cli_first: false });
  if (resolved.actualModel.startsWith("gemini-3.7-flash")) {
    return "gemini-3-flash";
  }
  return resolved.actualModel;
}
function requestSessionKey(options) {
  return options.sessionId === void 0 ? "default" : `session:${fnv1a64Signed(String(options.sessionId))}`;
}
function contentKinds(message) {
  return message.content.flatMap((block) => block.type === "text" || block.type === "reasoning" || block.type === "tool-call" ? [block.type] : []);
}
function parseProviderEvent(data) {
  const normalized = data.trim().replace(/^\)\]\}'(?:\r?\n)?/u, "");
  let value;
  try {
    value = JSON.parse(normalized);
  } catch {
    throw new PrivateTransportError("invalid-response", "The private response contained invalid JSON");
  }
  if (!isRecord8(value)) throw new PrivateTransportError("protocol-drift", "The private response event was not an object");
  if (isRecord8(value.error)) return { parts: [], error: errorDetails(value.error) };
  const root = isRecord8(value.response) ? value.response : value;
  if (isRecord8(root.error)) return { parts: [], error: errorDetails(root.error) };
  const partsValue = findParts(root);
  const responseSignature = responseLevelSignature(root, value, partsValue);
  const parts = [];
  for (const part of partsValue) {
    const parsed = parsePart(part);
    if (parsed === void 0) continue;
    if (parsed.kind === "tool-call" && parsed.signature === void 0 && responseSignature !== void 0) {
      parts.push({ ...parsed, signature: responseSignature });
      continue;
    }
    parts.push(parsed);
  }
  const usage = parseUsage(root.usageMetadata ?? value.usageMetadata);
  const finish = findFinish(root);
  return {
    parts,
    ...usage === void 0 ? {} : { usage },
    ...finish === void 0 ? {} : { finish }
  };
}
function responseLevelSignature(root, envelope, parts) {
  const direct = signatureOf(root) ?? signatureOf(envelope);
  if (direct !== void 0) return direct;
  if (Array.isArray(root.candidates)) {
    for (const candidate of root.candidates) {
      if (!isRecord8(candidate)) continue;
      const candidateSignature = signatureOf(candidate) ?? (isRecord8(candidate.content) ? signatureOf(candidate.content) : void 0) ?? (isRecord8(candidate.metadata) && isRecord8(candidate.metadata.google) ? signatureOf(candidate.metadata.google) : void 0);
      if (candidateSignature !== void 0) return candidateSignature;
    }
  }
  if (isRecord8(root.metadata) && isRecord8(root.metadata.google)) {
    const nested = signatureOf(root.metadata.google);
    if (nested !== void 0) return nested;
  }
  for (const part of parts) {
    if (!isRecord8(part)) continue;
    const partSignature = signatureOf(part) ?? (isRecord8(part.metadata) && isRecord8(part.metadata.google) ? signatureOf(part.metadata.google) : void 0);
    if (partSignature !== void 0) return partSignature;
  }
  return void 0;
}
function findParts(value) {
  if (Array.isArray(value.parts)) return boundedParts(value.parts);
  if (isRecord8(value.content) && Array.isArray(value.content.parts)) return boundedParts(value.content.parts);
  if (isRecord8(value.modelTurn) && Array.isArray(value.modelTurn.parts)) return boundedParts(value.modelTurn.parts);
  if (Array.isArray(value.candidates)) {
    const output = [];
    for (const candidate of value.candidates) {
      if (!isRecord8(candidate)) continue;
      const content = isRecord8(candidate.content) ? candidate.content : candidate;
      if (Array.isArray(content.parts)) {
        if (output.length + content.parts.length > MAX_PROVIDER_PARTS) throw new PrivateTransportError("protocol-drift", "The private response contained too many parts");
        output.push(...content.parts);
      }
    }
    return output;
  }
  if (isRecord8(value.serverContent) && isRecord8(value.serverContent.modelTurn) && Array.isArray(value.serverContent.modelTurn.parts)) {
    return boundedParts(value.serverContent.modelTurn.parts);
  }
  return [];
}
function boundedParts(value) {
  if (value.length > MAX_PROVIDER_PARTS) throw new PrivateTransportError("protocol-drift", "The private response contained too many parts");
  return value;
}
function parsePart(value) {
  if (!isRecord8(value)) throw new PrivateTransportError("protocol-drift", "The private response part was malformed");
  const functionCall = isRecord8(value.functionCall) ? value.functionCall : isRecord8(value.function_call) ? value.function_call : void 0;
  if (functionCall !== void 0) {
    const name2 = stringValue(functionCall.name);
    const id = stringValue(functionCall.id);
    const signature = signatureOf(value) ?? signatureOf(functionCall);
    const args = typeof functionCall.args === "string" ? functionCall.args : JSON.stringify(functionCall.args ?? {});
    return {
      kind: "tool-call",
      ...name2 === void 0 ? {} : { name: name2 },
      ...id === void 0 ? {} : { id },
      arguments: args,
      ...signature === void 0 ? {} : { signature }
    };
  }
  if (typeof value.text === "string" || signatureOf(value) !== void 0) {
    const kind = value.thought === true || value.reasoning === true || value.thinking === true ? "reasoning" : "text";
    const signature = signatureOf(value);
    const text = typeof value.text === "string" ? value.text : "";
    if (kind === "text" && text.length === 0 && signature === void 0) {
      return void 0;
    }
    return { kind, text, ...signature === void 0 ? {} : { signature } };
  }
  if (value.inlineData !== void 0 || value.inline_data !== void 0) {
    throw new PrivateTransportError("protocol-drift", "The text model returned unsupported media output");
  }
  throw new PrivateTransportError("protocol-drift", "The private response contained an unknown part type");
}
function errorDetails(value) {
  const status = numberValue2(value.status);
  const code = stringValue(value.code);
  const contextWindowExceeded = providerErrorReportsContextWindowExceeded(value, 0);
  return {
    ...status === void 0 ? {} : { status },
    ...code === void 0 ? {} : { code },
    ...contextWindowExceeded ? { contextWindowExceeded: true } : {}
  };
}
async function responseReportsContextWindowExceeded(response, options) {
  try {
    for await (const event of iteratePrivateSse(response, {
      ...options.signal === void 0 ? {} : { signal: options.signal },
      idleTimeoutMs: options.idleTimeoutMs,
      totalTimeoutMs: options.totalTimeoutMs,
      maxBytes: Math.min(MAX_PROVIDER_ERROR_BYTES, options.maxResponseBytes),
      maxFrameBytes: Math.min(MAX_PROVIDER_ERROR_FRAME_BYTES, options.maxFrameBytes)
    })) {
      const payload = event.data.replace(/^\)\]\}'(?:\r?\n)?/u, "");
      if (providerErrorEnvelopeReportsContextWindowExceeded(payload, 0)) return true;
    }
    return false;
  } catch (error) {
    if (error instanceof PrivateTransportError && error.code === "cancelled") throw toLlmError(error);
    if (isAborted3(options.signal)) throw new LlmError("The Antigravity request was cancelled", "CANCELLED");
    return false;
  }
}
async function responseReportsModelCapacityExhausted(response, options) {
  try {
    for await (const event of iteratePrivateSse(response, {
      ...options.signal === void 0 ? {} : { signal: options.signal },
      idleTimeoutMs: options.idleTimeoutMs,
      totalTimeoutMs: options.totalTimeoutMs,
      maxBytes: Math.min(MAX_PROVIDER_ERROR_BYTES, options.maxResponseBytes),
      maxFrameBytes: Math.min(MAX_PROVIDER_ERROR_FRAME_BYTES, options.maxFrameBytes)
    })) {
      if (event.data.includes("MODEL_CAPACITY_EXHAUSTED") || event.data.includes("No capacity available")) return true;
    }
    return false;
  } catch (error) {
    if (error instanceof PrivateTransportError && error.code === "cancelled") throw toLlmError(error);
    if (isAborted3(options.signal)) throw new LlmError("The Antigravity request was cancelled", "CANCELLED");
    return false;
  }
}
function backoffDelayMs(attempt) {
  const base = CAPACITY_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(base + jitter, CAPACITY_RETRY_MAX_DELAY_MS);
}
function sleep(ms, signal) {
  if (signal === void 0) return new Promise((resolve2) => {
    setTimeout(resolve2, ms);
  });
  return new Promise((resolve2) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve2();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve2();
    };
    if (signal.aborted) {
      clearTimeout(timer);
      resolve2();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
function providerErrorReportsContextWindowExceeded(value, depth) {
  if (depth > MAX_PROVIDER_ERROR_JSON_DEPTH) return false;
  if (typeof value.message === "string") {
    if (isExactContextWindowExceededMessage(value.message)) return true;
    if (providerErrorEnvelopeReportsContextWindowExceeded(value.message, depth + 1)) return true;
  }
  return isRecord8(value.error) && providerErrorReportsContextWindowExceeded(value.error, depth + 1);
}
function providerErrorEnvelopeReportsContextWindowExceeded(value, depth) {
  if (depth > MAX_PROVIDER_ERROR_JSON_DEPTH || value.length === 0 || value.length > MAX_PROVIDER_ERROR_BYTES) return false;
  const json = value.trim();
  if (!json.startsWith("{") || !jsonDepthIsBounded(json, MAX_PROVIDER_ERROR_JSON_DEPTH)) return false;
  try {
    const parsed = JSON.parse(json);
    return isRecord8(parsed) && isRecord8(parsed.error) ? providerErrorReportsContextWindowExceeded(parsed.error, depth + 1) : false;
  } catch {
    return false;
  }
}
function isExactContextWindowExceededMessage(value) {
  const match = /^prompt is too long: ([0-9]{1,16}) tokens > ([0-9]{1,16}) maximum$/u.exec(value);
  const actual = match?.[1];
  const maximum = match?.[2];
  return actual !== void 0 && maximum !== void 0 && BigInt(actual) > BigInt(maximum);
}
function jsonDepthIsBounded(value, maxDepth) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" || character === "[") {
      depth += 1;
      if (depth > maxDepth) return false;
    } else if (character === "}" || character === "]") {
      depth -= 1;
      if (depth < 0) return false;
    }
  }
  return depth === 0 && !inString && !escaped;
}
function contextWindowExceededError(status) {
  const message = "The Antigravity request exceeded the model context window";
  return status === void 0 ? new LlmError(message, CONTEXT_WINDOW_EXCEEDED_CODE) : new LlmError(message, CONTEXT_WINDOW_EXCEEDED_CODE, { status });
}
function parseUsage(value) {
  if (!isRecord8(value)) return void 0;
  const input = numberValue2(value.promptTokenCount ?? value.inputTokenCount);
  const output = numberValue2(value.candidatesTokenCount ?? value.outputTokenCount);
  const reasoning = numberValue2(value.thoughtsTokenCount ?? value.reasoningTokenCount);
  const cached = numberValue2(value.cachedContentTokenCount ?? value.cacheReadTokens);
  if (input === void 0 && output === void 0 && reasoning === void 0 && cached === void 0) return void 0;
  return {
    inputTokens: input ?? 0,
    outputTokens: output ?? 0,
    ...cached === void 0 ? {} : { cacheReadTokens: cached },
    ...reasoning === void 0 ? {} : { reasoningTokens: reasoning }
  };
}
function findFinish(value) {
  const candidate = value.finishReason ?? value.finish_reason;
  if (typeof candidate === "string") return candidate;
  if (isRecord8(value.serverContent) && typeof value.serverContent.finishReason === "string") return value.serverContent.finishReason;
  if (Array.isArray(value.candidates)) {
    for (const item of value.candidates) if (isRecord8(item) && typeof item.finishReason === "string") return item.finishReason;
  }
  return void 0;
}
function signatureOf(value) {
  const direct = stringValue(value.thoughtSignature ?? value.thought_signature ?? value.signature);
  if (direct !== void 0) return direct;
  const metadata = isRecord8(value.metadata) ? value.metadata : void 0;
  const google = metadata !== void 0 && isRecord8(metadata.google) ? metadata.google : void 0;
  return google === void 0 ? void 0 : stringValue(google.thoughtSignature ?? google.thought_signature ?? google.signature);
}
function parseJsonObject(value) {
  if (typeof value !== "string" || value.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    if (isRecord8(parsed)) return parsed;
  } catch {
    const repaired = repairTruncatedJsonObject(value);
    if (repaired !== void 0) return repaired;
  }
  return {};
}
function repairTruncatedJsonObject(value) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return void 0;
  let inString = false;
  let escaped = false;
  for (const character of trimmed) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
  }
  if (inString || escaped) return void 0;
  const suffix = closingSuffix(trimmed);
  if (suffix.length === 0) return void 0;
  try {
    const parsed = JSON.parse(`${trimmed}${suffix}`);
    return isRecord8(parsed) ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function closingSuffix(value) {
  const stack = [];
  let inString = false;
  let escaped = false;
  for (const character of value) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") stack.push("}");
    else if (character === "[") stack.push("]");
    else if (character === "}" || character === "]") stack.pop();
  }
  return stack.reverse().join("");
}
function blocksToText(blocks) {
  return blocks.filter((block) => block.type === "text" && typeof block.text === "string").map((block) => block.text).join("\n").slice(0, 64 * 1024);
}
function isAuthenticationCode(value) {
  const normalized = value?.toUpperCase();
  return normalized === "UNAUTHENTICATED" || normalized === "AUTHENTICATION" || normalized === "INVALID_GRANT" || normalized === "UNAUTHENTICATED_REQUEST";
}
function mapFinishReason(value) {
  const normalized = value?.toUpperCase();
  if (normalized === "MAX_TOKENS" || normalized === "LENGTH") return "max-tokens";
  if (normalized === "SAFETY" || normalized === "BLOCKLIST" || normalized === "ERROR") return "error";
  if (normalized === "TOOL_CALLS" || normalized === "FUNCTION_CALL") return "tool-calls";
  return "stop";
}
function finishChunk(kind, code, status, replayState) {
  const reason = kind === "aborted" ? { kind: "aborted", failure: { code, message: "The Antigravity request was cancelled" } } : kind === "error" ? { kind: "error", failure: { code, message: "The Antigravity provider request failed", ...status === void 0 ? {} : { status } } } : kind === "max-tokens" ? { kind: "max-tokens" } : kind === "tool-calls" ? { kind: "tool-calls" } : { kind: "stop" };
  return { type: "finish", reason, ...replayState === void 0 ? {} : { replayState } };
}
function canFallBackToPinnedTextSnapshot(error) {
  if (!(error instanceof LlmError)) return false;
  return error.code === "RATE_LIMIT" || error.code === "TIMEOUT" || error.code === "PROTOCOL_DRIFT" || error.code === "RESPONSE_LIMIT" || error.code === "UPSTREAM" || error.code === "NETWORK";
}
function toModelCatalogError(error, signal, fallback) {
  if (isAborted3(signal)) return new LlmError("The Antigravity live model catalog request was cancelled", "CANCELLED");
  if (error instanceof LlmError) return error;
  if (error instanceof PrivateTransportError || fallback === "provider") return toLlmError(error);
  return new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
}
function toLlmError(error) {
  if (error instanceof LlmError) return error;
  if (error instanceof PrivateTransportError) {
    const kind = classifyPrivateFailure(error);
    const code = LLM_FAILURE_CODES[kind];
    const base = LLM_FAILURE_MESSAGES[kind];
    const message = error.status === void 0 ? base : `${base} (HTTP ${String(error.status)})`;
    return error.status === void 0 ? new LlmError(message, code) : new LlmError(message, code, { status: error.status });
  }
  return new LlmError("The Antigravity provider request failed safely", "PROVIDER_ERROR");
}
function boundedTimeout3(value, fallback) {
  return value === void 0 || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), 10 * 60 * 1e3);
}
function boundedLimit(value, fallback) {
  return value === void 0 || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), fallback);
}
function boundedInteger(value, min, max, field) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new LlmError(`The Antigravity ${field} option is invalid`, "INVALID_OPTIONS");
  return value;
}
function boundedNumber(value, min, max, field) {
  if (!Number.isFinite(value) || value < min || value > max) throw new LlmError(`The Antigravity ${field} option is invalid`, "INVALID_OPTIONS");
  return value;
}
function numberValue2(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : void 0;
}
function stringValue(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 16 * 1024 && !containsControl(value) ? value : void 0;
}
function safeProviderErrorCode(value) {
  const normalized = value?.toUpperCase();
  return normalized === "SAFETY" || normalized === "BLOCKED" || normalized === "RESOURCE_EXHAUSTED" || normalized === "INVALID_ARGUMENT" ? normalized : "UPSTREAM_ERROR";
}
function safeProviderStatus(value) {
  return value !== void 0 && Number.isInteger(value) && value >= 400 && value <= 599 ? value : void 0;
}
async function cancelResponse(response) {
  try {
    await response.body?.cancel();
  } catch {
  }
}
function isAborted3(signal) {
  return signal !== void 0 && signal.aborted;
}
function isRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var ANTIGRAVITY_PROVIDER, ANTIGRAVITY_STREAM_ENDPOINT, ANTIGRAVITY_GENERATE_ENDPOINT, ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT, ANTIGRAVITY_LLM_ROUTE, MODEL_CATALOG_TTL_MS, MAX_MODEL_CATALOG_BYTES, MAX_PROVIDER_ERROR_BYTES, MAX_PROVIDER_ERROR_FRAME_BYTES, MAX_PROVIDER_ERROR_JSON_DEPTH, MAX_PROVIDER_PARTS, MAX_CAPACITY_RETRIES, CAPACITY_RETRY_BASE_DELAY_MS, CAPACITY_RETRY_MAX_DELAY_MS, AntigravityAdapter, LLM_FAILURE_CODES, LLM_FAILURE_MESSAGES;
var init_llm_adapter = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/llm-adapter.ts"() {
    "use strict";
    init_dist();
    init_private_transport();
    init_replay();
    init_wire_identity();
    init_private_failure();
    ANTIGRAVITY_PROVIDER = "google-antigravity";
    ANTIGRAVITY_STREAM_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:streamGenerateContent?alt=sse`;
    ANTIGRAVITY_GENERATE_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:generateContent`;
    ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:fetchAvailableModels`;
    ANTIGRAVITY_LLM_ROUTE = ANTIGRAVITY_PROVIDER;
    MODEL_CATALOG_TTL_MS = 3e4;
    MAX_MODEL_CATALOG_BYTES = 256 * 1024;
    MAX_PROVIDER_ERROR_BYTES = 64 * 1024;
    MAX_PROVIDER_ERROR_FRAME_BYTES = 16 * 1024;
    MAX_PROVIDER_ERROR_JSON_DEPTH = 8;
    MAX_PROVIDER_PARTS = 4096;
    MAX_CAPACITY_RETRIES = 2;
    CAPACITY_RETRY_BASE_DELAY_MS = 1500;
    CAPACITY_RETRY_MAX_DELAY_MS = 8e3;
    AntigravityAdapter = class extends LlmAdapter {
      constructor(adapterOptions) {
        super();
        this.adapterOptions = adapterOptions;
        this.transport = adapterOptions.transport ?? createPrivateTransport(
          adapterOptions.responseHeaderTimeoutMs === void 0 ? {} : { responseHeaderTimeoutMs: adapterOptions.responseHeaderTimeoutMs }
        );
        this.options = {
          responseHeaderTimeoutMs: boundedTimeout3(adapterOptions.responseHeaderTimeoutMs, DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS),
          idleTimeoutMs: boundedTimeout3(adapterOptions.idleTimeoutMs, DEFAULT_PRIVATE_IDLE_TIMEOUT_MS),
          totalTimeoutMs: boundedTimeout3(adapterOptions.totalTimeoutMs, DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS),
          maxResponseBytes: boundedLimit(adapterOptions.maxResponseBytes, DEFAULT_PRIVATE_RESPONSE_BYTES),
          maxFrameBytes: boundedLimit(adapterOptions.maxFrameBytes, DEFAULT_PRIVATE_FRAME_BYTES)
        };
        this.catalogView = createCatalogView(this.definitions, "snapshot");
      }
      adapterOptions;
      transport;
      sessions = new AgyRequestSessionStore("dsh-antigravity-auth");
      options;
      definitions = getPublicModelDefinitions();
      catalogProjectId;
      catalogExpiresAt = 0;
      catalogModelIds = /* @__PURE__ */ new Set();
      catalogFailureCode;
      catalogView;
      providerInfo(provider) {
        if (provider !== ANTIGRAVITY_PROVIDER) throw new LlmError("Unknown Antigravity provider route", "NO_ADAPTER");
        return { id: ANTIGRAVITY_PROVIDER, name: "Google Antigravity" };
      }
      providerRetryPolicy() {
        return resolveRetryPolicy({ mode: "normal", maxRetries: 0 }, "google-antigravity");
      }
      /** Forget account-bound availability when Gate 0 or the credential is replaced. */
      invalidateModelCatalog() {
        this.catalogProjectId = void 0;
        this.catalogExpiresAt = 0;
        this.catalogModelIds = /* @__PURE__ */ new Set();
        this.catalogFailureCode = void 0;
        this.catalogView = createCatalogView(this.definitions, "snapshot");
      }
      /** Return the pinned catalog without performing credential or network work. */
      catalogSnapshot() {
        return cloneCatalogView(createCatalogView(this.definitions, "snapshot"));
      }
      /** Refresh the advisory catalog and collapse failures into browser-safe state. */
      async modelCatalog(signal, forceRefresh = false) {
        try {
          const available = await this.readLiveModelIds(signal, forceRefresh);
          this.catalogView = createCatalogView(this.definitions, "live-available", available, (/* @__PURE__ */ new Date()).toISOString());
        } catch (error) {
          const state = error instanceof LlmError && error.code === "PROTOCOL_DRIFT" ? "protocol-drift" : "refresh-failed";
          this.catalogView = createCatalogView(this.definitions, state, void 0, (/* @__PURE__ */ new Date()).toISOString());
        }
        return cloneCatalogView(this.catalogView);
      }
      async listModels(provider, signal) {
        this.providerInfo(provider);
        const snapshot = this.pinnedTextModelInfos();
        let available;
        try {
          available = await this.readLiveModelIds(signal);
          this.catalogView = createCatalogView(this.definitions, "live-available", available, (/* @__PURE__ */ new Date()).toISOString());
        } catch (error) {
          const state = error instanceof LlmError && error.code === "PROTOCOL_DRIFT" ? "protocol-drift" : "refresh-failed";
          this.catalogView = createCatalogView(this.definitions, state, void 0, (/* @__PURE__ */ new Date()).toISOString());
          if (!canFallBackToPinnedTextSnapshot(error)) throw error;
          return snapshot;
        }
        return snapshot.filter((model) => available.has(model.id));
      }
      pinnedTextModelInfos() {
        return Object.values(this.definitions).filter((definition) => !definition.modalities.output.includes("image")).map((definition) => ({
          provider: ANTIGRAVITY_PROVIDER,
          id: definition.id,
          name: cleanModelDisplayName(definition.name),
          inputModalities: definition.modalities.input.filter((item) => item === "text" || item === "image")
        }));
      }
      async resolveModel(provider, model, _signal) {
        this.providerInfo(provider);
        if (typeof model !== "string" || model.trim().length === 0 || model.length > 256) {
          throw new LlmError("The Antigravity model id is invalid", "INVALID_MODEL");
        }
        const definition = this.definitions[model];
        if (definition === void 0 || definition.modalities.output.includes("image")) {
          throw new LlmError("The Antigravity model is not in the audited text model snapshot", "INVALID_MODEL");
        }
        const reasoning = getModelReasoningEfforts(model);
        return {
          provider: ANTIGRAVITY_PROVIDER,
          id: definition.id,
          name: cleanModelDisplayName(definition.name),
          inputModalities: definition.modalities.input.filter((item) => item === "text" || item === "image"),
          context: { contextWindow: definition.limit.context },
          defaultMaxTokens: definition.limit.output,
          ...reasoning === void 0 ? {} : { reasoning }
        };
      }
      async *stream(options) {
        if (options.provider !== ANTIGRAVITY_PROVIDER) {
          throw new LlmError("The Antigravity adapter received an unknown provider route", "NO_ADAPTER");
        }
        const signal = options.signal;
        const requestedDefinition = this.definitions[options.model];
        if (requestedDefinition === void 0 || requestedDefinition.modalities.output.includes("image")) throw new LlmError("The Antigravity model is not in the audited text model snapshot", "INVALID_MODEL");
        if (isAborted3(signal)) {
          yield finishChunk("aborted", "CANCELLED");
          return;
        }
        const hasEmitted = { value: false };
        let replayed = false;
        let capacityAttempt = 0;
        for (; ; ) {
          const credential = await this.readCredential(signal, replayed);
          if (credential === void 0) {
            throw new LlmError("Antigravity login is required before model use", "AUTH");
          }
          const sessionKey = requestSessionKey(options);
          const requestScope = this.sessions.beginRequest(sessionKey);
          let payload;
          try {
            payload = await buildAntigravityGeneratePayloadForAdapter(options, credential, requestScope.session, requestScope.timestamp, this.adapterOptions.attachments);
          } catch (error) {
            if (error instanceof LlmError) throw error;
            throw new LlmError("The Antigravity image input could not be admitted safely", "UNSUPPORTED_MODALITY");
          }
          let response;
          try {
            response = await this.transport.request({
              url: ANTIGRAVITY_STREAM_ENDPOINT,
              accessToken: credential.accessToken,
              body: JSON.stringify(payload),
              ...signal === void 0 ? {} : { signal },
              responseHeaderTimeoutMs: this.options.responseHeaderTimeoutMs
            });
          } catch (error) {
            throw toLlmError(error);
          }
          const statusError = privateStatusError(response.status);
          if (statusError !== void 0) {
            if (statusError.code === "authentication" && !replayed && !hasEmitted.value && !isAborted3(signal)) {
              await cancelResponse(response);
              replayed = true;
              continue;
            }
            if (response.status === 400 && await responseReportsContextWindowExceeded(response, {
              ...signal === void 0 ? {} : { signal },
              idleTimeoutMs: this.options.idleTimeoutMs,
              totalTimeoutMs: this.options.totalTimeoutMs,
              maxResponseBytes: this.options.maxResponseBytes,
              maxFrameBytes: this.options.maxFrameBytes
            })) {
              throw contextWindowExceededError(response.status);
            }
            if (response.status === 503 && capacityAttempt < MAX_CAPACITY_RETRIES && !hasEmitted.value && !isAborted3(signal) && await responseReportsModelCapacityExhausted(response, this.options)) {
              capacityAttempt += 1;
              await cancelResponse(response);
              await sleep(backoffDelayMs(capacityAttempt), signal);
              if (isAborted3(signal)) {
                yield finishChunk("aborted", "CANCELLED");
                return;
              }
              continue;
            }
            await cancelResponse(response);
            throw toLlmError(statusError);
          }
          try {
            yield* this.streamResponse(response, options, hasEmitted);
            this.sessions.completeExecution(sessionKey);
            return;
          } catch (error) {
            const privateError = error instanceof PrivateTransportError ? error : void 0;
            if (privateError?.code === "authentication" && !replayed && !hasEmitted.value && !isAborted3(signal)) {
              replayed = true;
              continue;
            }
            throw toLlmError(error);
          }
        }
      }
      async *streamResponse(response, options, hasEmitted) {
        const states = [];
        let current;
        let usage;
        let finish;
        let eventError;
        let pendingSignature;
        for await (const sse of iteratePrivateSse(response, {
          ...options.signal === void 0 ? {} : { signal: options.signal },
          idleTimeoutMs: this.options.idleTimeoutMs,
          totalTimeoutMs: this.options.totalTimeoutMs,
          maxBytes: this.options.maxResponseBytes,
          maxFrameBytes: this.options.maxFrameBytes
        })) {
          if (sse.data.trim() === "[DONE]") continue;
          const event = parseProviderEvent(sse.data);
          if (event.error !== void 0) {
            eventError = event.error;
            if (event.error.status === 401 || isAuthenticationCode(event.error.code)) throw new PrivateTransportError("authentication", "The private endpoint requires authentication", { status: event.error.status ?? 401 });
            break;
          }
          if (event.usage !== void 0) usage = event.usage;
          if (event.finish !== void 0) finish = event.finish;
          for (const part of event.parts) {
            if (part.kind !== "tool-call" && part.text.length === 0) {
              if (part.signature !== void 0) pendingSignature = part.signature;
              continue;
            }
            if (current === void 0 || !sameBlock(current, part)) {
              if (current !== void 0) {
                yield endBlock(current);
              }
              current = beginBlock(states, part);
              if (current.signature === void 0 && pendingSignature !== void 0) current.signature = pendingSignature;
              pendingSignature = void 0;
              yield { type: "block-start", index: current.index, blockType: current.kind };
            }
            if (part.kind === "tool-call") {
              if (part.name !== void 0) current.name = assembleFunctionName(current.name, part.name);
              current.text += part.arguments;
              hasEmitted.value ||= part.arguments.length > 0 || part.name !== void 0;
              yield {
                type: "tool-call-delta",
                index: current.index,
                id: current.id,
                ...part.name === void 0 ? {} : { name: part.name },
                argumentsDelta: part.arguments
              };
              if (part.signature !== void 0) current.signature = part.signature;
            } else if (part.kind === "reasoning") {
              current.text += part.text;
              hasEmitted.value ||= part.text.length > 0;
              if (part.signature !== void 0) current.signature = part.signature;
              if (part.text.length > 0) yield { type: "reasoning-delta", index: current.index, text: part.text };
            } else {
              current.text += part.text;
              hasEmitted.value ||= part.text.length > 0;
              if (part.text.length > 0) yield { type: "text-delta", index: current.index, text: part.text };
            }
          }
        }
        if (current !== void 0) yield endBlock(current);
        if (usage !== void 0) yield { type: "usage", usage };
        if (eventError !== void 0) {
          yield finishChunk(
            "error",
            eventError.contextWindowExceeded === true ? CONTEXT_WINDOW_EXCEEDED_CODE : safeProviderErrorCode(eventError.code),
            safeProviderStatus(eventError.status)
          );
          return;
        }
        if (isAborted3(options.signal)) {
          yield finishChunk("aborted", "CANCELLED");
          return;
        }
        if (states.length === 0) {
          yield finishChunk("error", "EMPTY_RESPONSE");
          return;
        }
        let lastReasoningSignature = pendingSignature;
        for (const state of states) {
          if (state.kind === "reasoning" && state.signature !== void 0) {
            lastReasoningSignature = state.signature;
          } else if (state.kind === "tool-call") {
            if (state.signature === void 0 && lastReasoningSignature !== void 0) {
              state.signature = lastReasoningSignature;
            }
          }
        }
        const replayBlocks = states.map((state) => ({
          kind: state.kind,
          ...state.signature === void 0 ? {} : { signature: state.signature }
        }));
        const replayState = createReplayState(options.model, antigravityModelFamily(options.model), finish, replayBlocks);
        yield finishChunk(mapFinishReason(finish), finish ?? "STOP", void 0, replayState);
      }
      async readLiveModelIds(signal, bypassCache = false, forceCredentialRefresh = false) {
        const credential = await this.readCredential(signal, forceCredentialRefresh);
        if (credential === void 0) throw new LlmError("Antigravity login is required before model discovery", "AUTH");
        if (!bypassCache && this.catalogProjectId === credential.projectId && Date.now() < this.catalogExpiresAt) {
          if (this.catalogFailureCode !== void 0) throw new LlmError("The Antigravity live model catalog refresh remains unavailable", this.catalogFailureCode);
          return this.catalogModelIds;
        }
        let response;
        const body = credential.projectId ? { project: credential.projectId } : {};
        try {
          response = await this.transport.request({
            url: ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT,
            accessToken: credential.accessToken,
            body: JSON.stringify(body),
            ...signal === void 0 ? {} : { signal },
            responseHeaderTimeoutMs: this.options.responseHeaderTimeoutMs
          });
        } catch (error) {
          const failure = toModelCatalogError(error, signal, "provider");
          this.rememberCatalogFailure(credential.projectId, failure);
          throw failure;
        }
        if (response.status === 403 && credential.projectId) {
          try {
            const retryResponse = await this.transport.request({
              url: ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT,
              accessToken: credential.accessToken,
              body: JSON.stringify({}),
              ...signal === void 0 ? {} : { signal },
              responseHeaderTimeoutMs: this.options.responseHeaderTimeoutMs
            });
            if (retryResponse.ok) {
              await cancelResponse(response);
              response = retryResponse;
            } else {
              await cancelResponse(retryResponse);
            }
          } catch (error) {
            const failure = toModelCatalogError(error, signal, "provider");
            if (failure.code === "CANCELLED" || failure.code === "GATE_0_ATTRIBUTION") {
              await cancelResponse(response);
              this.rememberCatalogFailure(credential.projectId, failure);
              throw failure;
            }
          }
        }
        const statusError = privateStatusError(response.status);
        if (statusError !== void 0) {
          await cancelResponse(response);
          if (statusError.code === "authentication" && !forceCredentialRefresh && !isAborted3(signal)) {
            this.catalogExpiresAt = 0;
            return this.readLiveModelIds(signal, true, true);
          }
          const failure = toLlmError(statusError);
          this.rememberCatalogFailure(credential.projectId, failure);
          throw failure;
        }
        let value;
        try {
          value = JSON.parse(await readPrivateText(response, {
            ...signal === void 0 ? {} : { signal },
            idleTimeoutMs: this.options.idleTimeoutMs,
            totalTimeoutMs: this.options.totalTimeoutMs,
            maxBytes: Math.min(this.options.maxResponseBytes, MAX_MODEL_CATALOG_BYTES)
          }));
        } catch (error) {
          const failure = toModelCatalogError(error, signal, "protocol");
          this.rememberCatalogFailure(credential.projectId, failure);
          throw failure;
        }
        let ids;
        try {
          ids = parseLiveModelIds(value, this.definitions);
        } catch (error) {
          const failure = error instanceof LlmError ? error : new LlmError("The Antigravity live model catalog did not match the audited schema", "PROTOCOL_DRIFT");
          this.rememberCatalogFailure(credential.projectId, failure);
          throw failure;
        }
        this.catalogProjectId = credential.projectId;
        this.catalogModelIds = ids;
        this.catalogFailureCode = void 0;
        this.catalogExpiresAt = Date.now() + MODEL_CATALOG_TTL_MS;
        return ids;
      }
      rememberCatalogFailure(projectId, failure) {
        if (failure.code === "AUTH" || failure.code === "CANCELLED") return;
        this.catalogProjectId = projectId;
        this.catalogModelIds = /* @__PURE__ */ new Set();
        this.catalogFailureCode = failure.code;
        this.catalogExpiresAt = Date.now() + MODEL_CATALOG_TTL_MS;
      }
      async readCredential(signal, forceRefresh) {
        try {
          return await this.adapterOptions.auth.credential(signal, forceRefresh ? { forceRefresh: true } : void 0);
        } catch (error) {
          throw toLlmError(error);
        }
      }
    };
    LLM_FAILURE_CODES = {
      authentication: "AUTH",
      forbidden: "FORBIDDEN",
      "rate-limited": "RATE_LIMIT",
      cancelled: "CANCELLED",
      timeout: "TIMEOUT",
      "attribution-rejected": "GATE_0_ATTRIBUTION",
      "protocol-drift": "PROTOCOL_DRIFT",
      "response-limit": "RESPONSE_LIMIT",
      "request-limit": "REQUEST_LIMIT",
      upstream: "UPSTREAM",
      network: "NETWORK",
      failed: "PROVIDER_ERROR"
    };
    LLM_FAILURE_MESSAGES = {
      authentication: "The Antigravity private request failed: authentication required",
      forbidden: "The Antigravity private request failed: this account is forbidden",
      "rate-limited": "Antigravity rate limit reached (Google returned 429 Resource Exhausted); please wait for your quota window to refresh",
      cancelled: "The Antigravity private request was cancelled",
      timeout: "The Antigravity private request timed out",
      "attribution-rejected": "The Antigravity private request failed: identity attribution was rejected",
      "protocol-drift": "The Antigravity private request was rejected (protocol drift)",
      "response-limit": "The Antigravity private response exceeded the byte limit",
      "request-limit": "The Antigravity private request exceeded the byte limit",
      upstream: "The Antigravity private endpoint is unavailable",
      network: "The Antigravity private request could not be reached",
      failed: "The Antigravity private request failed safely"
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/capability-lifecycle.ts
function mountCapabilityLifecycle(options) {
  let gateReady = false;
  let registration;
  let generation = 0;
  let disposed = false;
  const sync = () => {
    if (disposed) return;
    const shouldRegister = options.enabled() && gateReady;
    if (shouldRegister && registration === void 0) {
      try {
        registration = options.register();
      } catch {
        gateReady = false;
      }
    } else if (!shouldRegister && registration !== void 0) {
      const dispose = registration;
      registration = void 0;
      try {
        dispose();
      } catch {
      }
    }
  };
  const refresh = async () => {
    const currentGeneration = ++generation;
    let ready = false;
    try {
      const status = await options.auth.status();
      ready = status.login.projectAvailable && status.capabilities.some((capability) => capability.id === options.id && capability.state === "available");
    } catch {
      ready = false;
    }
    if (disposed || currentGeneration !== generation) return;
    gateReady = ready;
    sync();
  };
  const unwatch = options.auth.watchStatus?.(() => {
    void refresh();
  }) ?? (() => {
  });
  const lifecycle = options.ctx;
  lifecycle.effect?.(() => async () => {
    if (disposed) return;
    disposed = true;
    generation += 1;
    try {
      unwatch();
    } finally {
      const dispose = registration;
      registration = void 0;
      try {
        dispose?.();
      } finally {
        try {
          await options.cleanup?.();
        } finally {
          if (options.ownsAuth) await options.auth.dispose?.();
        }
      }
    }
  }, options.label);
  sync();
  void refresh();
  return { sync, refresh };
}
var init_capability_lifecycle = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/capability-lifecycle.ts"() {
    "use strict";
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/media-admission.ts
import { Buffer as Buffer7 } from "node:buffer";
import { HarnessError } from "@deepseek-ai/dsh-llm";
function imageHandle(ref) {
  return `image:${String(ref.attachmentId)}`;
}
async function admitImageBytes(options, data, source, name2 = "antigravity-image", signal) {
  throwIfAborted(signal);
  const limits = options.attachments.imageLimits;
  if (data.byteLength === 0 || data.byteLength > limits.maxImageBytes) {
    throw new MediaAdmissionError("The image exceeds the deployment byte limit", "MEDIA_IMAGE_TOO_LARGE");
  }
  const mediaType = detectImageMediaType(data);
  if (mediaType === void 0 || !limits.mediaTypes.includes(mediaType)) {
    throw new MediaAdmissionError("The image media type or magic bytes are not supported", "MEDIA_IMAGE_INVALID");
  }
  const input = {
    data,
    mediaType,
    name: safeName(name2)
  };
  try {
    await options.attachments.validateImage(input);
  } catch {
    throw new MediaAdmissionError("The image failed AttachmentStore admission", "MEDIA_IMAGE_INVALID");
  }
  return { kind: "image", input, source };
}
async function admitBase64Image(options, encoded, source = "inline", name2, signal) {
  const maxEncoded = Math.ceil(options.attachments.imageLimits.maxImageBytes / 3) * 4 + 4;
  if (encoded.length === 0 || encoded.length > maxEncoded || !isCanonicalBase64(encoded)) {
    throw new MediaAdmissionError("The encoded image is not bounded canonical base64", "MEDIA_IMAGE_INVALID");
  }
  let data;
  try {
    data = new Uint8Array(Buffer7.from(encoded, "base64"));
  } catch {
    throw new MediaAdmissionError("The encoded image could not be decoded", "MEDIA_IMAGE_INVALID");
  }
  return admitImageBytes(options, data, source, name2, signal);
}
async function admitSessionImage(options, agent, handle, signal) {
  throwIfAborted(signal);
  if (!IMAGE_HANDLE_PATTERN.test(handle)) throw new MediaAdmissionError("The image handle is invalid", "MEDIA_HANDLE_INVALID");
  const authorized = authorizedSessionImages(agent);
  const ref = authorized.get(handle);
  if (ref === void 0) throw new MediaAdmissionError("The image handle is not authorized by this session", "MEDIA_HANDLE_UNAUTHORIZED");
  try {
    const stored = await options.attachments.readImage(ref, signal);
    return { kind: "image", input: { data: stored.data, mediaType: stored.ref.mediaType, ...stored.ref.name === void 0 ? {} : { name: stored.ref.name } }, stored, source: "session" };
  } catch {
    throw new MediaAdmissionError("The authorized image could not be read", "MEDIA_IMAGE_READ_FAILED");
  }
}
async function admitWorkspaceImage(options, workspace, path, signal) {
  throwIfAborted(signal);
  if (path.length === 0 || path.length > 4096 || /^https?:\/\//iu.test(path)) {
    throw new MediaAdmissionError("The workspace image reference is invalid", "MEDIA_WORKSPACE_INVALID");
  }
  const data = await readStableWorkspaceBytes(
    options.fs,
    workspace,
    path,
    options.attachments.imageLimits.maxImageBytes,
    "image",
    signal
  );
  return admitImageBytes(options, data, "workspace", basename(path), signal);
}
async function admitWorkspaceVideo(options, workspace, path, signal) {
  throwIfAborted(signal);
  if (path.length === 0 || path.length > 4096 || /^https?:\/\//iu.test(path)) {
    throw new MediaAdmissionError("The workspace video reference is invalid", "MEDIA_VIDEO_INVALID");
  }
  const maxBytes = positive2(options.maxVideoBytes, DEFAULT_VIDEO_BYTES);
  const data = await readStableWorkspaceBytes(options.fs, workspace, path, maxBytes, "video", signal);
  if (data.byteLength === 0 || data.byteLength > maxBytes || !isMp4(data)) {
    throw new MediaAdmissionError("The workspace file is not a bounded MP4 video", "MEDIA_VIDEO_INVALID");
  }
  return { kind: "video", data, mediaType: "video/mp4" };
}
async function readStableWorkspaceBytes(fs, workspace, path, maxBytes, kind, signal) {
  const symlinkCode = kind === "image" ? "MEDIA_WORKSPACE_SYMLINK" : "MEDIA_VIDEO_SYMLINK";
  const regularCode = kind === "image" ? "MEDIA_WORKSPACE_NOT_REGULAR" : "MEDIA_VIDEO_NOT_REGULAR";
  const containmentCode = kind === "image" ? "MEDIA_WORKSPACE_CONTAINMENT" : "MEDIA_VIDEO_CONTAINMENT";
  const changedCode = kind === "image" ? "MEDIA_WORKSPACE_CHANGED" : "MEDIA_VIDEO_CHANGED";
  const initialPath = await fs.lstat(path, { cwd: workspace }, signal);
  if (initialPath?.type === "symlink") throw new MediaAdmissionError(`The workspace ${kind} is a symbolic link`, symlinkCode);
  if (initialPath === void 0 || initialPath.type !== "file") throw new MediaAdmissionError(`The workspace ${kind} is not a regular file`, regularCode);
  const root = await fs.resolve(workspace, fsResolveOptions(workspace, signal));
  const target = await fs.resolve(path, fsResolveOptions(workspace, signal));
  if (!fs.contains(root, target)) throw new MediaAdmissionError(`The workspace ${kind} is outside the active workspace`, containmentCode);
  const before = await fs.stat(target, signal);
  if (before === void 0 || before.type !== "file") throw new MediaAdmissionError(`The workspace ${kind} is not a regular file`, regularCode);
  if (before.version !== initialPath.version) throw new MediaAdmissionError(`The workspace ${kind} changed before it could be read`, changedCode);
  const data = await fs.readBytes(target, signal, maxBytes);
  const finalPath = await fs.lstat(path, { cwd: workspace }, signal);
  const finalTarget = await fs.resolve(path, fsResolveOptions(workspace, signal));
  const after = await fs.stat(target, signal);
  if (finalPath === void 0 || finalPath.type !== "file" || finalPath.version !== initialPath.version || finalTarget.targetKey !== target.targetKey || !fs.contains(root, finalTarget) || after === void 0 || after.type !== "file" || after.version !== before.version) {
    throw new MediaAdmissionError(`The workspace ${kind} changed while it was being read`, changedCode);
  }
  return data;
}
function detectImageMediaType(data) {
  if (data.length >= 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71 && data[4] === 13 && data[5] === 10 && data[6] === 26 && data[7] === 10) return "image/png";
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (data.length >= 12 && ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP") return "image/webp";
  if (data.length >= 6 && (ascii(data, 0, 6) === "GIF87a" || ascii(data, 0, 6) === "GIF89a")) return "image/gif";
  return void 0;
}
function isMp4(data) {
  return data.length >= 12 && ascii(data, 4, 8) === "ftyp";
}
function sessionImageCatalog(agent) {
  const result2 = /* @__PURE__ */ new Map();
  const visited = /* @__PURE__ */ new WeakSet();
  let sequence = 0;
  let visitedNodes = 0;
  const visit = (value, origin, depth = 0) => {
    if (typeof value !== "object" || value === null || depth > 64 || visitedNodes >= 1e4 || visited.has(value)) return;
    visited.add(value);
    visitedNodes += 1;
    if (Array.isArray(value)) {
      for (const nested of value) visit(nested, origin, depth + 1);
      return;
    }
    if (!isRecord11(value)) return;
    const attachment = value.type === "image" ? parseImageRef(value.attachment) : void 0;
    if (attachment !== void 0) {
      const handle = imageHandle(attachment);
      if (!result2.has(handle)) result2.set(handle, { handle, attachment, origin, sequence: sequence++ });
    }
    if (value.type === "tool-result" && Array.isArray(value.content)) visit(value.content, origin, depth + 1);
  };
  for (const event of agent.session.snapshotEvents()) {
    const rawEvent = event;
    if (!isRecord11(rawEvent) || !isRecord11(rawEvent.data)) continue;
    if (rawEvent.type === "user/message") visit(rawEvent.data.content, "user");
    else if (rawEvent.type === "assistant/message" && isRecord11(rawEvent.data.message)) visit(rawEvent.data.message.content, "reference");
    else if (rawEvent.type === "tool/result" && isRecord11(rawEvent.data.message)) visit(rawEvent.data.message.content, "generated");
  }
  return [...result2.values()];
}
function authorizedSessionImages(agent) {
  return new Map(sessionImageCatalog(agent).map((entry) => [entry.handle, entry.attachment]));
}
function parseImageRef(value) {
  if (!isRecord11(value) || !isBoundedSafeText(value.attachmentId, 256) || value.mediaType !== "image/png" && value.mediaType !== "image/jpeg" && value.mediaType !== "image/webp" && value.mediaType !== "image/gif" || !isPositiveSafeInteger(value.bytes, 1024 * 1024 * 1024) || !isPositiveSafeInteger(value.width, 1e6) || !isPositiveSafeInteger(value.height, 1e6)) return void 0;
  const name2 = typeof value.name === "string" && isBoundedSafeText(value.name, 256) ? safeName(value.name) : void 0;
  return {
    attachmentId: value.attachmentId,
    mediaType: value.mediaType,
    bytes: value.bytes,
    width: value.width,
    height: value.height,
    ...name2 === void 0 ? {} : { name: name2 }
  };
}
function isPositiveSafeInteger(value, max) {
  return Number.isSafeInteger(value) && value > 0 && value <= max;
}
function isCanonicalBase64(value) {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value);
}
function safeName(value) {
  const base = [...basename(value)].map((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 || character === "/" || character === "\\" ? "_" : character).join("").slice(0, 256);
  return base.length > 0 ? base : "antigravity-image";
}
function basename(value) {
  const normalized = value.replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
function fsResolveOptions(cwd, signal) {
  return signal === void 0 ? { cwd } : { cwd, signal };
}
function ascii(data, start, end) {
  return String.fromCharCode(...data.slice(start, end));
}
function positive2(value, fallback) {
  return value === void 0 || !Number.isFinite(value) || value <= 0 ? fallback : Math.min(Math.floor(value), 128 * 1024 * 1024);
}
function throwIfAborted(signal) {
  if (signal !== void 0 && signal.aborted) throw new MediaAdmissionError("Media admission was cancelled", "MEDIA_CANCELLED");
}
function isRecord11(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var DEFAULT_VIDEO_BYTES, DEFAULT_INLINE_IMAGE_BYTES, IMAGE_HANDLE_PATTERN, MediaAdmissionError;
var init_media_admission = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/media-admission.ts"() {
    "use strict";
    init_safe_text();
    DEFAULT_VIDEO_BYTES = 32 * 1024 * 1024;
    DEFAULT_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
    IMAGE_HANDLE_PATTERN = /^image:[^\s\p{C}]{1,256}$/u;
    MediaAdmissionError = class extends HarnessError {
      constructor(message, code, options = {}) {
        super(message, code, options);
      }
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/live-gate-auth.ts
async function runAuthGate(auth, output) {
  await auth.acknowledgeRisk();
  const started = await auth.startLogin();
  output(JSON.stringify({ gate: "A", action: "open-authorization", authorizationUrl: started.authorizationUrl }));
  const deadline = Date.now() + AUTH_WAIT_MS;
  while (Date.now() < deadline) {
    const status = await auth.status();
    if (status.login.phase === "success") {
      const credential = await auth.credential(void 0, { forceRefresh: true });
      return { gate: "A", outcome: credential === void 0 ? "unauthenticated" : "passed" };
    }
    if (status.login.phase === "failed" || status.login.phase === "cancelled" || status.login.phase === "expired") {
      return { gate: "A", outcome: status.login.phase === "cancelled" ? "cancelled" : "failed" };
    }
    await new Promise((resolve2) => setTimeout(resolve2, POLL_MS));
  }
  await auth.cancelLogin();
  return { gate: "A", outcome: "cancelled" };
}
var AUTH_WAIT_MS, POLL_MS;
var init_live_gate_auth = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/live-gate-auth.ts"() {
    "use strict";
    AUTH_WAIT_MS = 10 * 60 * 1e3;
    POLL_MS = 250;
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/volatile-config.ts
var init_volatile_config = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/volatile-config.ts"() {
    "use strict";
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/image.ts
import { Buffer as Buffer8 } from "node:buffer";
import z from "@deepseek-ai/schemastery";
import { HarnessError as HarnessError2 } from "@deepseek-ai/dsh-llm";
function createAntigravityImageTools(options) {
  const fixedOptions = { ...options, transport: options.transport ?? createPrivateTransport() };
  return [createGenerateTool(fixedOptions), createListTool(fixedOptions)];
}
function createGenerateTool(options) {
  return {
    name: GENERATE_IMAGE_TOOL_NAME,
    description: "Generate or edit bounded Antigravity images and return durable session image handles.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, maxLength: 16384 },
        references: {
          type: "array",
          maxItems: MAX_REFERENCES,
          items: { oneOf: [
            { type: "object", properties: { kind: { const: "session" }, handle: { type: "string" } }, required: ["kind", "handle"], additionalProperties: false },
            { type: "object", properties: { kind: { const: "workspace" }, path: { type: "string" } }, required: ["kind", "path"], additionalProperties: false }
          ] }
        },
        model: { type: "string" },
        n: { type: "integer", minimum: 1, maximum: MAX_IMAGES }
      },
      required: ["prompt"],
      additionalProperties: false
    },
    output: {
      schema: generateSchema,
      render: (_args, value) => renderGenerate(value),
      presentationMeta: (_args, value) => value
    },
    execute: async (args, exec) => executeGenerate(options, args, exec),
    isConcurrencySafe: () => false
  };
}
function createListTool(options) {
  return {
    name: LIST_IMAGES_TOOL_NAME,
    description: "List durable image handles authorized by the current session with bounded pagination.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 20 },
        cursor: { type: "string" },
        origin: { type: "string", enum: [...IMAGE_ORIGINS] }
      },
      additionalProperties: false
    },
    output: {
      schema: listSchema,
      render: (_args, value) => renderList(value),
      presentationMeta: (_args, value) => value
    },
    execute: async (args, exec) => executeList(options, args, exec),
    isConcurrencySafe: () => true
  };
}
async function executeGenerate(options, rawArgs, exec) {
  const settings = options.settings?.() ?? { enabled: true, model: ANTIGRAVITY_IMAGE_MODEL, n: 1 };
  if (!settings.enabled) throw new AntigravityImageError("Antigravity Image is disabled by its capability gate", "IMAGE_DISABLED");
  const args = parseGenerateArgs(rawArgs, settings);
  const credential = await requireCredential(options.auth, exec.signal);
  const agent = requireAgent(exec);
  const cwd = workspaceCwd(agent);
  const admission = { attachments: options.attachments, fs: options.fs };
  const references = [];
  const referenceParts = [];
  for (const [index, reference] of args.references.entries()) {
    const admitted = reference.kind === "session" ? await admitSessionImage(admission, agent, reference.handle, exec.signal) : await admitWorkspaceImage(admission, cwd, reference.path, exec.signal);
    const stored = admitted.stored ?? { ref: await options.attachments.saveImage(admitted.input), data: admitted.input.data };
    const item = { handle: imageHandle(stored.ref), attachment: stored.ref, origin: "reference", seq: index };
    references.push(item);
    referenceParts.push({ inlineData: { mimeType: stored.ref.mediaType, data: Buffer8.from(stored.data).toString("base64") } });
  }
  const transport = options.transport;
  if (transport === void 0) throw new AntigravityImageError("The Antigravity Image transport is unavailable", "IMAGE_FAILED");
  const body = buildImagePayload(args.prompt, args.model, credential, referenceParts);
  const images = [];
  const warnings = [];
  let firstFailure;
  for (let index = 0; index < args.n; index += 1) {
    let response;
    try {
      response = await transport.request({ url: ANTIGRAVITY_IMAGE_ENDPOINT, accessToken: credential.accessToken, body: JSON.stringify(body), signal: exec.signal });
    } catch (error) {
      const failure = toImageError(error);
      if (failure.code === "IMAGE_CANCELLED") throw failure;
      firstFailure ??= failure;
      warnings.push({ index, code: imageRequestWarning(failure.code) });
      continue;
    }
    const statusError = privateStatusError(response.status);
    if (statusError !== void 0) {
      await response.body?.cancel().catch(() => {
      });
      const failure = toImageError(statusError);
      firstFailure ??= failure;
      warnings.push({ index, code: imageRequestWarning(failure.code) });
      continue;
    }
    let envelope;
    try {
      envelope = JSON.parse(await readPrivateText(response, { signal: exec.signal, maxBytes: DEFAULT_PRIVATE_RESPONSE_BYTES }));
    } catch (error) {
      const failure = toImageError(error);
      if (failure.code === "IMAGE_CANCELLED") throw failure;
      firstFailure ??= failure;
      warnings.push({ index, code: "IMAGE_RESPONSE_INVALID" });
      continue;
    }
    const candidate = collectInlineData(envelope)[0];
    if (candidate === void 0) {
      firstFailure ??= new AntigravityImageError("Antigravity Image returned no admitted inlineData", "IMAGE_RESPONSE_EMPTY");
      warnings.push({ index, code: "IMAGE_RESPONSE_EMPTY" });
      continue;
    }
    try {
      const admitted = await admitBase64Image(options, candidate.data, "inline", `generated-${String(index + 1)}`, exec.signal);
      if (candidate.mediaType !== void 0 && normalizeImageMime(candidate.mediaType) !== admitted.input.mediaType) {
        throw new AntigravityImageError("The declared image MIME did not match the admitted magic bytes", "IMAGE_MIME_MISMATCH");
      }
      const attachment = await options.attachments.saveImage(admitted.input);
      images.push({ handle: imageHandle(attachment), attachment, origin: "generated", seq: index });
    } catch (error) {
      if (exec.signal?.aborted === true) throw new AntigravityImageError("Antigravity Image generation was cancelled", "IMAGE_CANCELLED");
      if (error instanceof AntigravityImageError && error.code === "MEDIA_CANCELLED") throw new AntigravityImageError("Antigravity Image generation was cancelled", "IMAGE_CANCELLED");
      const failure = error instanceof AntigravityImageError && error.code === "IMAGE_MIME_MISMATCH" ? error : new AntigravityImageError("The generated image failed media admission", "IMAGE_ADMISSION_FAILED");
      firstFailure ??= failure;
      warnings.push({ index, code: failure.code });
    }
  }
  if (images.length === 0) {
    if (firstFailure !== void 0) throw firstFailure;
    throw new AntigravityImageError("No generated image passed media admission", "IMAGE_RESPONSE_INVALID");
  }
  return { operation: references.length === 0 ? "generate" : "edit", images, references, warnings };
}
async function executeList(options, rawArgs, exec) {
  const settings = options.settings?.() ?? { enabled: true, model: ANTIGRAVITY_IMAGE_MODEL, n: 1 };
  if (!settings.enabled) throw new AntigravityImageError("Antigravity Image is disabled by its capability gate", "IMAGE_DISABLED");
  await requireCredential(options.auth, exec.signal);
  const agent = requireAgent(exec);
  const args = parseListArgs(rawArgs);
  let items = collectImages(agent);
  if (args.origin !== "all") items = items.filter((item) => item.origin === args.origin);
  if (args.cursor !== void 0) items = afterCursor(items, args.cursor, args.origin);
  const selected = items.slice(0, args.limit);
  return {
    items: selected,
    ...items.length > selected.length && selected.length > 0 ? { nextCursor: encodeCursor(selected[selected.length - 1], args.origin) } : {}
  };
}
function buildImagePayload(prompt, model, credential, referenceParts) {
  const resolved = resolveModelWithTier(model, { cli_first: false });
  if (resolved.isImageModel !== true) throw new AntigravityImageError("The selected Antigravity model is not an image model", "INVALID_ARGS");
  const project = credential.projectId === "inductive-dreamer-qrkws" || !credential.projectId ? void 0 : credential.projectId;
  return {
    ...project === void 0 ? {} : { project },
    model: resolved.actualModel,
    request: {
      contents: [{ role: "user", parts: [{ text: prompt }, ...referenceParts] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
    }
  };
}
function normalizeImageMime(value) {
  const normalized = value.trim().toLowerCase();
  return normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp" || normalized === "image/gif" ? normalized : void 0;
}
function collectInlineData(value) {
  const output = [];
  const visit = (item, depth = 0) => {
    if (output.length >= MAX_IMAGES || depth > 32) return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (!isRecord12(item)) return;
    const inline = isRecord12(item.inlineData) ? item.inlineData : isRecord12(item.inline_data) ? item.inline_data : void 0;
    if (inline !== void 0 && typeof inline.data === "string") {
      const mediaType = inline.mimeType ?? inline.mime_type;
      output.push({ data: inline.data, ...typeof mediaType === "string" ? { mediaType } : {} });
      return;
    }
    for (const child of Object.values(item)) visit(child, depth + 1);
  };
  visit(value);
  return output;
}
function collectImages(agent) {
  return sessionImageCatalog(agent).map((entry) => ({ handle: entry.handle, attachment: entry.attachment, origin: entry.origin, seq: entry.sequence })).sort((left, right) => right.seq - left.seq || String(right.attachment.attachmentId).localeCompare(String(left.attachment.attachmentId)));
}
function renderGenerate(value) {
  return [
    { type: "text", text: `Created ${String(value.images.length)} durable image(s): ${value.images.map((item) => item.handle).join(", ")}.` },
    ...value.references.map((item) => ({ type: "image", attachment: item.attachment })),
    ...value.images.map((item) => ({ type: "image", attachment: item.attachment }))
  ];
}
function renderList(value) {
  return [
    { type: "text", text: value.items.length === 0 ? "No authorized session images matched." : value.items.map((item) => `${item.handle} (${item.origin})`).join(", ") },
    ...value.items.map((item) => ({ type: "image", attachment: item.attachment }))
  ];
}
async function requireCredential(auth, signal) {
  const credential = await auth.credential(signal);
  if (credential === void 0) throw new AntigravityImageError("Antigravity Image requires a logged-in account", "IMAGE_AUTH_REQUIRED");
  return credential;
}
function requireAgent(exec) {
  if (exec.agent === void 0) throw new AntigravityImageError("Antigravity Image requires an active session", "IMAGE_AGENT_REQUIRED");
  workspaceCwd(exec.agent);
  return exec.agent;
}
function workspaceCwd(agent) {
  const cwd = agent.session.header.cwd;
  if (typeof cwd !== "string" || cwd.length === 0) throw new AntigravityImageError("Antigravity Image requires an active workspace", "IMAGE_WORKSPACE_REQUIRED");
  return cwd;
}
function parseGenerateArgs(value, settings) {
  if (!isRecord12(value) || hasExtra(value, ["prompt", "references", "model", "n"]) || typeof value.prompt !== "string" || value.prompt.trim().length === 0 || value.prompt.length > 16384) {
    throw new AntigravityImageError("generate_image expects a closed prompt object", "INVALID_ARGS");
  }
  const refs = value.references === void 0 ? [] : parseReferences(value.references);
  const model = nonBlank(value.model ?? settings.model);
  const n = integer(value.n ?? settings.n, 1, MAX_IMAGES);
  return { prompt: value.prompt.trim().slice(0, 16384), references: refs, model, n };
}
function parseReferences(value) {
  if (!Array.isArray(value) || value.length > MAX_REFERENCES) throw new AntigravityImageError("references exceed the bounded limit", "INVALID_ARGS");
  return value.map((item) => {
    if (!isRecord12(item) || hasExtra(item, ["kind", "handle", "path"]) || typeof item.kind !== "string") throw new AntigravityImageError("reference is invalid", "INVALID_ARGS");
    if (item.kind === "session" && typeof item.handle === "string" && IMAGE_HANDLE_PATTERN.test(item.handle)) return { kind: "session", handle: item.handle };
    if (item.kind === "workspace" && typeof item.path === "string" && item.path.length > 0) return { kind: "workspace", path: item.path };
    throw new AntigravityImageError("reference is invalid", "INVALID_ARGS");
  });
}
function parseListArgs(value) {
  if (!isRecord12(value) || hasExtra(value, ["limit", "cursor", "origin"])) throw new AntigravityImageError("list_images expects a closed object", "INVALID_ARGS");
  const limit = value.limit === void 0 ? 5 : integer(value.limit, 1, 20);
  const cursor = value.cursor === void 0 ? void 0 : nonBlank(value.cursor);
  const origin = value.origin === void 0 ? "all" : enumValue(value.origin, IMAGE_ORIGINS);
  return { limit, ...cursor === void 0 ? {} : { cursor }, origin };
}
function afterCursor(items, cursor, origin) {
  let value;
  try {
    value = JSON.parse(Buffer8.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new AntigravityImageError("The image cursor is invalid", "IMAGE_CURSOR_INVALID");
  }
  if (!isRecord12(value) || Object.keys(value).length !== 3 || hasExtra(value, ["id", "seq", "origin"]) || typeof value.id !== "string" || value.id.length === 0 || value.id.length > 256 || !Number.isSafeInteger(value.seq) || value.origin !== origin) throw new AntigravityImageError("The image cursor is invalid", "IMAGE_CURSOR_INVALID");
  const index = items.findIndex((item) => item.seq === value.seq && String(item.attachment.attachmentId) === value.id);
  if (index < 0) throw new AntigravityImageError("The image cursor is stale", "IMAGE_CURSOR_INVALID");
  return items.slice(index + 1);
}
function encodeCursor(item, origin) {
  return Buffer8.from(JSON.stringify({ id: String(item.attachment.attachmentId), seq: item.seq, origin })).toString("base64url");
}
function imageRequestWarning(code) {
  if (code === "IMAGE_AUTH_REQUIRED") return "IMAGE_REQUEST_UNAUTHENTICATED";
  if (code === "IMAGE_RATE_LIMITED") return "IMAGE_REQUEST_RATE_LIMITED";
  if (code === "IMAGE_TIMEOUT") return "IMAGE_REQUEST_TIMEOUT";
  if (code === "IMAGE_PROTOCOL_DRIFT") return "IMAGE_REQUEST_PROTOCOL_DRIFT";
  return "IMAGE_REQUEST_FAILED";
}
function toImageError(error) {
  if (error instanceof AntigravityImageError) return error;
  if (error instanceof PrivateTransportError) {
    return new AntigravityImageError("The Antigravity Image request failed safely", IMAGE_FAILURE_CODES[classifyPrivateFailure(error)]);
  }
  return new AntigravityImageError("The Antigravity Image request failed safely", "IMAGE_FAILED");
}
function hasExtra(value, allowed) {
  return Object.keys(value).some((key) => !allowed.includes(key));
}
function nonBlank(value) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) throw new AntigravityImageError("The image option is invalid", "INVALID_ARGS");
  return value.trim();
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new AntigravityImageError("The image option is invalid", "INVALID_ARGS");
  return value;
}
function enumValue(value, values) {
  if (typeof value !== "string" || !values.includes(value)) throw new AntigravityImageError("The image option is invalid", "INVALID_ARGS");
  return value;
}
function isRecord12(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var GENERATE_IMAGE_TOOL_NAME, LIST_IMAGES_TOOL_NAME, ANTIGRAVITY_IMAGE_ENDPOINT, ANTIGRAVITY_IMAGE_MODEL, Config, MAX_REFERENCES, MAX_IMAGES, IMAGE_ORIGINS, generateSchema, listSchema, AntigravityImageError, IMAGE_FAILURE_CODES;
var init_image = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/image.ts"() {
    "use strict";
    init_dist();
    init_auth_service();
    init_private_transport();
    init_media_admission();
    init_wire_identity();
    init_private_failure();
    init_capability_lifecycle();
    init_volatile_config();
    GENERATE_IMAGE_TOOL_NAME = "generate_image";
    LIST_IMAGES_TOOL_NAME = "list_images";
    ANTIGRAVITY_IMAGE_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:generateContent`;
    ANTIGRAVITY_IMAGE_MODEL = "antigravity-gemini-3.1-flash-image";
    Config = z.object({
      enabled: z.boolean().default(true).volatile(),
      model: z.string().default(ANTIGRAVITY_IMAGE_MODEL).volatile(),
      n: z.number().step(1).min(1).max(4).default(1).volatile()
    });
    MAX_REFERENCES = 5;
    MAX_IMAGES = 4;
    IMAGE_ORIGINS = ["all", "generated", "reference", "user"];
    generateSchema = {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["generate", "edit"] },
        images: { type: "array", items: { type: "object" } },
        references: { type: "array", items: { type: "object" } },
        warnings: { type: "array", items: { type: "object" } }
      },
      required: ["operation", "images", "references", "warnings"],
      additionalProperties: false
    };
    listSchema = {
      type: "object",
      properties: {
        items: { type: "array", items: { type: "object" } },
        nextCursor: { type: "string" }
      },
      required: ["items"],
      additionalProperties: false
    };
    AntigravityImageError = class extends HarnessError2 {
    };
    IMAGE_FAILURE_CODES = {
      authentication: "IMAGE_AUTH_REQUIRED",
      forbidden: "IMAGE_FORBIDDEN",
      "rate-limited": "IMAGE_RATE_LIMITED",
      cancelled: "IMAGE_CANCELLED",
      timeout: "IMAGE_TIMEOUT",
      "attribution-rejected": "IMAGE_PROTOCOL_DRIFT",
      "protocol-drift": "IMAGE_PROTOCOL_DRIFT",
      "response-limit": "IMAGE_PROTOCOL_DRIFT",
      "request-limit": "IMAGE_PROTOCOL_DRIFT",
      upstream: "IMAGE_FAILED",
      network: "IMAGE_FAILED",
      failed: "IMAGE_FAILED"
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/live-gate-attachments.ts
import { Buffer as Buffer9 } from "node:buffer";
import { createHash as createHash2, randomUUID as randomUUID3 } from "node:crypto";
import { chmod as chmod4, link, lstat as lstat3, mkdir as mkdir4, readFile as readFile4, rm as rm2, writeFile as writeFile3 } from "node:fs/promises";
import { join as join4 } from "node:path";
import { inflateSync } from "node:zlib";
function createDurableLiveAttachmentStore(root, options = {}) {
  const platform = options.platform ?? process.platform;
  const imageLimits = Object.freeze({
    maxImageBytes: MAX_LIVE_IMAGE_BYTES,
    maxImagesPerMessage: 2,
    maxMessageImageBytes: MAX_LIVE_IMAGE_BYTES * 2,
    maxImagePixels: MAX_LIVE_IMAGE_PIXELS,
    maxImageDimension: MAX_LIVE_IMAGE_DIMENSION,
    mediaTypes: Object.freeze(["image/png"])
  });
  const validateImage = async (input) => {
    inspectPng(input);
  };
  const saveImage = async (input) => {
    const dimensions = inspectPng(input);
    await ensureRoot(root);
    const data = Uint8Array.from(input.data);
    const digest = createHash2("sha256").update(data).digest("hex");
    const target = join4(root, `${digest}.png`);
    const temporary = join4(root, `.${digest}.${process.pid}.${randomUUID3()}.tmp`);
    try {
      await writeFile3(temporary, data, { flag: "wx", mode: 384 });
      try {
        await link(temporary, target);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        const existing = await readBounded(target, platform);
        if (createHash2("sha256").update(existing).digest("hex") !== digest) throw new Error("collision");
      }
      await chmod4(target, 384);
    } catch {
      throw admissionError();
    } finally {
      await rm2(temporary, { force: true }).catch(() => {
      });
    }
    return {
      attachmentId: `${ID_PREFIX}${digest}`,
      mediaType: "image/png",
      bytes: data.byteLength,
      width: dimensions.width,
      height: dimensions.height,
      ...input.name === void 0 ? {} : { name: safeName2(input.name) }
    };
  };
  const readImage = async (ref, signal) => {
    signal?.throwIfAborted();
    const id = String(ref.attachmentId);
    const digest = id.startsWith(ID_PREFIX) ? id.slice(ID_PREFIX.length) : "";
    if (!/^[a-f0-9]{64}$/u.test(digest) || ref.mediaType !== "image/png") throw admissionError();
    let data;
    try {
      data = await readBounded(join4(root, `${digest}.png`), platform);
    } catch {
      throw admissionError();
    }
    signal?.throwIfAborted();
    if (createHash2("sha256").update(data).digest("hex") !== digest) throw admissionError();
    const dimensions = inspectPng({ data, mediaType: "image/png" });
    if (ref.bytes !== data.byteLength || ref.width !== dimensions.width || ref.height !== dimensions.height) throw admissionError();
    return { ref: { ...ref }, data: Uint8Array.from(data) };
  };
  return {
    imageLimits,
    validateImage,
    saveImage,
    saveImages: async (inputs) => {
      for (const input of inputs) await validateImage(input);
      const output = [];
      for (const input of inputs) output.push(await saveImage(input));
      return output;
    },
    readImage
  };
}
function inspectPng(input) {
  try {
    return decodePng(input);
  } catch {
    throw admissionError();
  }
}
function decodePng(input) {
  const data = input.data;
  if (input.mediaType !== "image/png" || data.byteLength < 57 || data.byteLength > MAX_LIVE_IMAGE_BYTES) throw new Error("invalid PNG");
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (data[index] !== PNG_SIGNATURE[index]) throw new Error("invalid PNG signature");
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let channels = 0;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  const compressed = [];
  while (offset < data.byteLength) {
    if (offset + 12 > data.byteLength) throw new Error("truncated PNG chunk");
    const length = view.getUint32(offset);
    const typeOffset = offset + 4;
    const payloadOffset = offset + 8;
    const end = payloadOffset + length;
    if (length > MAX_LIVE_IMAGE_BYTES || end + 4 > data.byteLength) throw new Error("oversized PNG chunk");
    const type = String.fromCharCode(data[typeOffset], data[typeOffset + 1], data[typeOffset + 2], data[typeOffset + 3]);
    if (!/^[A-Za-z]{4}$/u.test(type) || view.getUint32(end) !== crc32(data.subarray(typeOffset, end))) throw new Error("invalid PNG chunk");
    const payload = data.subarray(payloadOffset, end);
    if (!sawHeader && type !== "IHDR") throw new Error("missing PNG header");
    if (type === "IHDR") {
      if (sawHeader || length !== 13) throw new Error("duplicate PNG header");
      width = view.getUint32(payloadOffset);
      height = view.getUint32(payloadOffset + 4);
      const bitDepth = data[payloadOffset + 8];
      const colorType = data[payloadOffset + 9];
      if (bitDepth !== 8 || colorType !== 2 && colorType !== 6 || data[payloadOffset + 10] !== 0 || data[payloadOffset + 11] !== 0 || data[payloadOffset + 12] !== 0) {
        throw new Error("unsupported PNG encoding");
      }
      channels = colorType === 6 ? 4 : 3;
      if (width < 1 || height < 1 || width > MAX_LIVE_IMAGE_DIMENSION || height > MAX_LIVE_IMAGE_DIMENSION || width * height > MAX_LIVE_IMAGE_PIXELS) throw new Error("invalid PNG dimensions");
      sawHeader = true;
    } else if (type === "IDAT") {
      if (!sawHeader || sawEnd || length === 0) throw new Error("invalid PNG data");
      sawData = true;
      compressed.push(payload);
    } else if (type === "IEND") {
      if (!sawData || sawEnd || length !== 0 || end + 4 !== data.byteLength) throw new Error("invalid PNG end");
      sawEnd = true;
    } else if (type[0] === type[0]?.toUpperCase() && type !== "PLTE") {
      throw new Error("unknown critical PNG chunk");
    }
    offset = end + 4;
  }
  if (!sawHeader || !sawData || !sawEnd || offset !== data.byteLength) throw new Error("incomplete PNG");
  const rowBytes = width * channels;
  const decodedBytes = (rowBytes + 1) * height;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_DECODED_IMAGE_BYTES) throw new Error("oversized decoded PNG");
  const decoded = inflateSync(Buffer9.concat(compressed.map((part) => Buffer9.from(part))), { maxOutputLength: decodedBytes + 1 });
  if (decoded.byteLength !== decodedBytes) throw new Error("invalid decoded PNG length");
  for (let row = 0; row < height; row += 1) {
    if (decoded[row * (rowBytes + 1)] > 4) throw new Error("invalid PNG row filter");
  }
  return { width, height };
}
function crc32(data) {
  let crc = 4294967295;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc >>> 1 ^ (crc & 1 ? 3988292384 : 0);
  }
  return (crc ^ 4294967295) >>> 0;
}
async function ensureRoot(root) {
  try {
    await mkdir4(root, { recursive: true, mode: 448 });
    const info = await lstat3(root);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("unsafe root");
    await chmod4(root, 448);
  } catch {
    throw admissionError();
  }
}
async function readBounded(path, platform) {
  const info = await lstat3(path);
  const unsafePosixMode = platform !== "win32" && (info.mode & 63) !== 0;
  if (info.isSymbolicLink() || !info.isFile() || info.size < 1 || info.size > MAX_LIVE_IMAGE_BYTES || unsafePosixMode) {
    throw admissionError();
  }
  const data = await readFile4(path);
  if (data.byteLength !== info.size) throw admissionError();
  return data;
}
function safeName2(value) {
  const name2 = value.replaceAll("\\", "/").split("/").at(-1)?.slice(0, 128);
  return name2 !== void 0 && isBoundedSafeText(name2, 128) ? name2 : "live-gate-output.png";
}
function admissionError() {
  return new Error("The live image output could not be admitted durably");
}
var MAX_LIVE_IMAGE_BYTES, MAX_LIVE_IMAGE_DIMENSION, MAX_LIVE_IMAGE_PIXELS, MAX_DECODED_IMAGE_BYTES, ID_PREFIX, PNG_SIGNATURE;
var init_live_gate_attachments = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/live-gate-attachments.ts"() {
    "use strict";
    init_safe_text();
    MAX_LIVE_IMAGE_BYTES = 20 * 1024 * 1024;
    MAX_LIVE_IMAGE_DIMENSION = 16384;
    MAX_LIVE_IMAGE_PIXELS = 16 * 1024 * 1024;
    MAX_DECODED_IMAGE_BYTES = 64 * 1024 * 1024;
    ID_PREFIX = "live-sha256-";
    PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/live-gate-image.ts
async function runImageGate(auth, attachmentRoot) {
  const attachments = createDurableLiveAttachmentStore(attachmentRoot);
  const events = [];
  const agent = { session: { header: { cwd: process.cwd() }, events } };
  const context = { agent, signal: new AbortController().signal };
  const tool = createAntigravityImageTools({
    auth,
    attachments,
    fs: createUnavailableFileSystem(),
    settings: () => ({ enabled: true, model: ANTIGRAVITY_IMAGE_MODEL, n: 1 })
  })[0];
  if (tool === void 0) throw new Error("The image gate tool is unavailable");
  const generated = await tool.execute({ prompt: "A single small blue circle on a plain white background.", n: 1 }, context);
  const reference = generated.images[0];
  if (reference === void 0) throw new Error("The image generation gate returned no image");
  events.push({ type: "tool/result", data: { message: { content: [{ type: "image", attachment: reference.attachment }] } } });
  const edited = await tool.execute({
    prompt: "Keep the image simple and change the blue circle to green.",
    references: [{ kind: "session", handle: reference.handle }],
    n: 1
  }, context);
  if (edited.images.length === 0 || edited.references.length !== 1) throw new Error("The image edit gate returned no admitted output");
  await auth.recordCapabilityGate("image", "passed");
  return { gate: "I", outcome: "passed" };
}
function createUnavailableFileSystem() {
  const unavailable = async () => {
    throw new Error("Workspace media is unavailable in Gate I");
  };
  return {
    resolve: unavailable,
    contains: () => false,
    readBytes: unavailable,
    lstat: unavailable,
    stat: unavailable
  };
}
var init_live_gate_image = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/live-gate-image.ts"() {
    "use strict";
    init_image();
    init_live_gate_attachments();
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/live-gate-outcome.ts
async function recordGateFailure(auth, gate, outcome, family) {
  if (gate === "0L") {
    if (family === void 0) await auth.recordGate0(outcome);
    else await auth.recordLlmFamilyGate(family, outcome);
    return;
  }
  const id = CAPABILITY_BY_GATE[gate];
  if (id !== void 0) await auth.recordCapabilityGate(id, outcome);
}
function classifyGate0Outcome(error) {
  const code = errorCode(error);
  if (code === "GATE_0_ATTRIBUTION" || code.includes("ATTRIBUTION_REJECTED")) return "attribution-rejected";
  return classifyOutcome(error);
}
function classifyOutcome(error) {
  const code = errorCode(error);
  if (code === "GATE_0_ATTRIBUTION" || code.includes("ATTRIBUTION_REJECTED")) return "attribution-rejected";
  if (code.includes("AUTH") || code.includes("GRANT") || code.includes("LOGIN")) return "unauthenticated";
  if (code.includes("RATE") || code.includes("RESOURCE_EXHAUSTED")) return "rate-limited";
  if (code.includes("CANCEL") || code.includes("ABORT")) return "cancelled";
  if (code.includes("UNSUPPORTED_VIDEO") || code.includes("VIDEO_UNSUPPORTED")) return "unsupported-video";
  if (code.includes("PROTOCOL") || code.includes("MALFORMED") || code.includes("RESPONSE")) return "protocol-drift";
  return "failed";
}
function errorCode(error) {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code).toUpperCase() : "";
}
var CAPABILITY_BY_GATE;
var init_live_gate_outcome = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/live-gate-outcome.ts"() {
    "use strict";
    CAPABILITY_BY_GATE = Object.freeze({
      S: "search",
      I: "image",
      V: "video"
    });
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/live-gate-llm.ts
async function runLlmGate(auth, gates, family, adapter = new AntigravityAdapter({ auth })) {
  if (family === void 0) await gates.clear();
  const model = family === void 0 ? LIVE_TEXT_MODEL : LIVE_TEXT_MODEL_BY_FAMILY[family];
  try {
    const chunks = [];
    for await (const chunk of adapter.stream(minimalGenerateOptions(model))) chunks.push(chunk);
    const finish = chunks.at(-1);
    if (finish?.type !== "finish") throw new Error("The live text gate did not finish normally");
    if (finish.reason.kind === "error" || finish.reason.kind === "aborted") {
      throw Object.assign(new Error("The live text gate did not finish normally"), { code: finish.reason.failure.code });
    }
    if (!chunks.some((chunk) => chunk.type === "text-delta" || chunk.type === "reasoning-delta" || chunk.type === "block-end")) {
      throw new Error("The live text gate returned no content");
    }
  } catch (error) {
    const outcome = classifyGate0Outcome(error);
    if (family === void 0) await auth.recordGate0(outcome);
    else await auth.recordLlmFamilyGate(family, outcome);
    return { gate: "0L", outcome };
  }
  if (family === void 0) await auth.recordGate0("passed");
  else await auth.recordLlmFamilyGate(family, "passed");
  return { gate: "0L", outcome: "passed" };
}
function minimalGenerateOptions(model) {
  const message = {
    id: "antigravity-live-gate-message",
    role: "user",
    source: { kind: "user" },
    content: [{ type: "text", text: "Reply with exactly: OK" }]
  };
  return { provider: ANTIGRAVITY_PROVIDER, model, messages: [message] };
}
var LIVE_TEXT_MODEL, LIVE_TEXT_MODEL_BY_FAMILY;
var init_live_gate_llm = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/live-gate-llm.ts"() {
    "use strict";
    init_llm_adapter();
    init_live_gate_outcome();
    LIVE_TEXT_MODEL = "antigravity-gemini-3.7-flash";
    LIVE_TEXT_MODEL_BY_FAMILY = Object.freeze({
      gemini: LIVE_TEXT_MODEL,
      claude: "antigravity-claude-sonnet-4-6-thinking",
      "gpt-oss": "antigravity-gpt-oss-120b-medium"
    });
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/search.ts
import z2 from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";
function buildGroundedSearchPayload(query, credential, model = ANTIGRAVITY_SEARCH_MODEL) {
  return {
    project: credential.projectId,
    model: resolveModelWithTier(model, { cli_first: false }).actualModel,
    request: {
      contents: [{ role: "user", parts: [{ text: query }] }],
      tools: [{ googleSearch: {} }],
      systemInstruction: { parts: [{ text: "Return a concise grounded answer with only sources supplied by the provider." }] }
    }
  };
}
function collectSearchFacts(value, content, sources, seen, maxResults) {
  if (!isRecord13(value)) return false;
  const root = isRecord13(value.response) ? value.response : value;
  const texts = [findText(root)];
  const metadataValues = [root.groundingMetadata, root.grounding_metadata, value.groundingMetadata];
  if (Array.isArray(root.candidates)) {
    if (root.candidates.length > 512) throw new WebError("Antigravity Search returned too many candidates", "ANTIGRAVITY_SEARCH_PROTOCOL_DRIFT");
    for (const candidate of root.candidates) {
      if (!isRecord13(candidate)) continue;
      texts.push(findText(candidate));
      if (isRecord13(candidate.content)) texts.push(findText(candidate.content));
      metadataValues.push(candidate.groundingMetadata, candidate.grounding_metadata);
    }
  }
  for (const text of texts) appendBounded(content, text);
  let truncated = false;
  for (const rawMetadata of metadataValues) {
    if (!isRecord13(rawMetadata)) continue;
    const chunks = rawMetadata.groundingChunks ?? rawMetadata.grounding_chunks;
    if (!Array.isArray(chunks)) continue;
    if (chunks.length > 4096) throw new WebError("Antigravity Search returned too many grounding sources", "ANTIGRAVITY_SEARCH_PROTOCOL_DRIFT");
    for (const chunk of chunks) {
      if (!isRecord13(chunk)) continue;
      const web = isRecord13(chunk.web) ? chunk.web : isRecord13(chunk.webSource) ? chunk.webSource : void 0;
      if (web === void 0 || typeof web.uri !== "string" || !isHttpUrl(web.uri)) continue;
      const url = web.uri;
      if (seen.has(url)) continue;
      if (sources.length >= maxResults) {
        truncated = true;
        break;
      }
      seen.add(url);
      const title = safeSourceText(web.title, 1024);
      const snippet = safeSourceText(web.snippet, 4096);
      sources.push({ url, ...title === void 0 ? {} : { title }, ...snippet === void 0 ? {} : { snippet } });
    }
  }
  return truncated;
}
function appendBounded(output, value) {
  if (value === void 0 || value.length === 0) return;
  const used = output.reduce((total, item) => total + item.length, 0);
  if (used < 64 * 1024) output.push(value.slice(0, 64 * 1024 - used));
}
function findText(value) {
  const parts = Array.isArray(value.parts) ? value.parts : isRecord13(value.content) && Array.isArray(value.content.parts) ? value.content.parts : [];
  const output = [];
  let length = 0;
  for (const part of parts) {
    if (!isRecord13(part) || typeof part.text !== "string" || hasControl2(part.text)) continue;
    const text = part.text.slice(0, 64 * 1024 - length);
    output.push(text);
    length += text.length;
    if (length >= 64 * 1024) break;
  }
  return output.length === 0 ? void 0 : output.join("");
}
function safeSourceText(value, max) {
  return typeof value === "string" && value.length > 0 && value.length <= max && !hasControl2(value) ? value : void 0;
}
function hasControl2(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function parseJson(value) {
  const normalized = value.trim().replace(/^\)\]\}'(?:\r?\n)?/u, "");
  try {
    return JSON.parse(normalized);
  } catch {
    throw new WebError("Antigravity Search returned malformed provider data", "ANTIGRAVITY_SEARCH_PROTOCOL_DRIFT");
  }
}
function toWebError(error) {
  if (error instanceof WebError) return error;
  if (error instanceof PrivateTransportError) {
    return new WebError("The Antigravity Search request failed safely", SEARCH_FAILURE_CODES[classifyPrivateFailure(error)]);
  }
  return new WebError("The Antigravity Search request failed safely", "ANTIGRAVITY_SEARCH_FAILED");
}
function isHttpUrl(value) {
  if (value.length === 0 || value.length > 8192 || value.trim() !== value || hasControl2(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username.length === 0 && url.password.length === 0;
  } catch {
    return false;
  }
}
function boundedInteger2(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new WebError("Antigravity Search result limit is invalid", "ANTIGRAVITY_SEARCH_INVALID_QUERY");
  return value;
}
function isRecord13(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var ANTIGRAVITY_SEARCH_PROVIDER_ID, ANTIGRAVITY_SEARCH_ENDPOINT, ANTIGRAVITY_SEARCH_MODEL, Config2, AntigravitySearchProvider, SEARCH_FAILURE_CODES;
var init_search = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/search.ts"() {
    "use strict";
    init_dist();
    init_auth_service();
    init_private_transport();
    init_wire_identity();
    init_private_failure();
    init_capability_lifecycle();
    init_volatile_config();
    ANTIGRAVITY_SEARCH_PROVIDER_ID = "antigravity";
    ANTIGRAVITY_SEARCH_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:generateContent`;
    ANTIGRAVITY_SEARCH_MODEL = "antigravity-gemini-3.7-flash";
    Config2 = z2.object({
      enabled: z2.boolean().default(true).volatile(),
      model: z2.string().default(ANTIGRAVITY_SEARCH_MODEL).volatile(),
      maxResults: z2.number().step(1).min(1).max(50).default(10).volatile()
    });
    AntigravitySearchProvider = class {
      constructor(options) {
        this.options = options;
        this.enabled = options.enabled ?? (() => options.settings?.().enabled ?? true);
        this.transport = options.transport ?? createPrivateTransport();
      }
      options;
      id = ANTIGRAVITY_SEARCH_PROVIDER_ID;
      enabled;
      transport;
      available() {
        return this.enabled();
      }
      async search(request, signal) {
        if (!this.enabled()) throw new WebError("Antigravity Web Search is disabled by its capability gate", "ANTIGRAVITY_SEARCH_DISABLED");
        if (signal?.aborted === true) throw new WebError("Antigravity Web Search was cancelled", "ANTIGRAVITY_SEARCH_CANCELLED");
        if (typeof request.query !== "string" || request.query.trim().length === 0 || request.query.length > 16384) {
          throw new WebError("Antigravity Web Search requires a bounded query", "ANTIGRAVITY_SEARCH_INVALID_QUERY");
        }
        const settings = this.options.settings?.() ?? { enabled: true, model: ANTIGRAVITY_SEARCH_MODEL, maxResults: 10 };
        const configuredMax = boundedInteger2(settings.maxResults, 1, 50);
        const requestedMax = request.maxResults === void 0 ? configuredMax : boundedInteger2(request.maxResults, 1, 50);
        const maxResults = Math.min(configuredMax, requestedMax);
        const credential = await this.options.auth.credential(signal);
        if (credential === void 0) throw new WebError("Antigravity Web Search requires a logged-in account", "ANTIGRAVITY_SEARCH_AUTH_REQUIRED");
        const response = await this.transport.request({
          url: ANTIGRAVITY_SEARCH_ENDPOINT,
          accessToken: credential.accessToken,
          body: JSON.stringify(buildGroundedSearchPayload(request.query.trim(), credential, settings.model)),
          ...signal === void 0 ? {} : { signal }
        }).catch((error) => {
          throw toWebError(error);
        });
        const statusError = privateStatusError(response.status);
        if (statusError !== void 0) {
          await response.body?.cancel().catch(() => {
          });
          throw toWebError(statusError);
        }
        const sources = [];
        const seen = /* @__PURE__ */ new Set();
        const content = [];
        let truncated = false;
        try {
          for await (const event of iteratePrivateSse(response, {
            ...signal === void 0 ? {} : { signal },
            idleTimeoutMs: DEFAULT_PRIVATE_IDLE_TIMEOUT_MS,
            totalTimeoutMs: DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS,
            maxBytes: this.options.maxResponseBytes ?? DEFAULT_PRIVATE_RESPONSE_BYTES,
            maxFrameBytes: DEFAULT_PRIVATE_FRAME_BYTES
          })) {
            if (event.data.trim() === "[DONE]") continue;
            const value = parseJson(event.data);
            truncated ||= collectSearchFacts(value, content, sources, seen, maxResults);
          }
        } catch (error) {
          throw toWebError(error);
        }
        if (sources.length === 0) throw new WebError("Antigravity Search returned no validated grounding sources", "ANTIGRAVITY_SEARCH_NO_SOURCES");
        return {
          ...content.length === 0 ? {} : { content: content.join("").slice(0, 64 * 1024) },
          sources,
          truncated
        };
      }
    };
    SEARCH_FAILURE_CODES = {
      authentication: "ANTIGRAVITY_SEARCH_AUTH_REQUIRED",
      forbidden: "ANTIGRAVITY_SEARCH_FORBIDDEN",
      "rate-limited": "ANTIGRAVITY_SEARCH_RATE_LIMITED",
      cancelled: "ANTIGRAVITY_SEARCH_CANCELLED",
      timeout: "ANTIGRAVITY_SEARCH_TIMEOUT",
      "attribution-rejected": "ANTIGRAVITY_SEARCH_PROTOCOL_DRIFT",
      "protocol-drift": "ANTIGRAVITY_SEARCH_PROTOCOL_DRIFT",
      "response-limit": "ANTIGRAVITY_SEARCH_PROTOCOL_DRIFT",
      "request-limit": "ANTIGRAVITY_SEARCH_PROTOCOL_DRIFT",
      upstream: "ANTIGRAVITY_SEARCH_FAILED",
      network: "ANTIGRAVITY_SEARCH_FAILED",
      failed: "ANTIGRAVITY_SEARCH_FAILED"
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/live-gate-search.ts
async function runSearchGate(auth) {
  const provider = new AntigravitySearchProvider({
    auth,
    settings: () => ({ enabled: true, model: ANTIGRAVITY_SEARCH_MODEL, maxResults: 3 })
  });
  const result2 = await provider.search({ query: "What is the official Google domain?", maxResults: 3 });
  if (result2.sources.length === 0) throw new Error("The grounded search gate returned no sources");
  await auth.recordCapabilityGate("search", "passed");
  return { gate: "S", outcome: "passed" };
}
var init_live_gate_search = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/live-gate-search.ts"() {
    "use strict";
    init_search();
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/video.ts
import { Buffer as Buffer10 } from "node:buffer";
import z3 from "@deepseek-ai/schemastery";
import { HarnessError as HarnessError3 } from "@deepseek-ai/dsh-llm";
function createAntigravityVideoTools(options) {
  const fixedOptions = {
    ...options,
    transport: options.transport ?? createPrivateTransport({ maxRequestBytes: 48 * 1024 * 1024 })
  };
  return [{
    name: ANALYZE_VIDEO_TOOL_NAME,
    description: "Analyze an explicit MP4 file inside the active workspace with the gated Antigravity video POC.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1, maxLength: 4096 },
        prompt: { type: "string", minLength: 1, maxLength: 16384 },
        model: { type: "string", maxLength: 256 }
      },
      required: ["path", "prompt"],
      additionalProperties: false
    },
    output: {
      schema: videoSchema,
      render: (_args, value) => [{ type: "text", text: value.text }],
      presentationMeta: (_args, value) => value
    },
    execute: async (args, exec) => executeVideo(fixedOptions, args, exec),
    isConcurrencySafe: () => false
  }];
}
async function executeVideo(options, rawArgs, exec) {
  const settings = options.settings?.() ?? { enabled: true, model: ANTIGRAVITY_VIDEO_MODEL };
  if (!settings.enabled) throw new AntigravityVideoError("Antigravity Video is disabled by its capability gate", "VIDEO_DISABLED");
  const args = parseArgs(rawArgs, settings);
  const agent = requireAgent2(exec);
  const credential = await options.auth.credential(exec.signal);
  if (credential === void 0) throw new AntigravityVideoError("Antigravity Video requires a logged-in account", "VIDEO_AUTH_REQUIRED");
  const cwd = workspaceCwd2(agent);
  const admitted = await admitWorkspaceVideo({ fs: options.fs, ...settings.maxBytes === void 0 ? {} : { maxVideoBytes: settings.maxBytes } }, cwd, args.path, exec.signal);
  const transport = options.transport;
  if (transport === void 0) throw new AntigravityVideoError("The Antigravity Video transport is unavailable", "VIDEO_FAILED");
  let response;
  try {
    response = await transport.request({
      url: ANTIGRAVITY_VIDEO_ENDPOINT,
      accessToken: credential.accessToken,
      body: JSON.stringify(buildVideoPayload(args.prompt, args.model, credential, admitted.data)),
      signal: exec.signal
    });
  } catch (error) {
    throw toVideoError(error);
  }
  const statusError = privateStatusError(response.status);
  if (statusError !== void 0) {
    await response.body?.cancel().catch(() => {
    });
    throw toVideoError(statusError);
  }
  let value;
  try {
    value = JSON.parse(await readPrivateText(response, { signal: exec.signal, maxBytes: DEFAULT_PRIVATE_RESPONSE_BYTES }));
  } catch (error) {
    throw toVideoError(error);
  }
  const text = extractText(value);
  if (text === void 0) throw new AntigravityVideoError("Antigravity Video returned no text understanding", "VIDEO_RESPONSE_EMPTY");
  const usage = extractUsage(value);
  return { text, ...usage === void 0 ? {} : { usage } };
}
function buildVideoPayload(prompt, model, credential, data) {
  const project = credential.projectId === "inductive-dreamer-qrkws" || !credential.projectId ? void 0 : credential.projectId;
  const resolved = resolveModelWithTier(model, { cli_first: false });
  const wireModel = resolved.actualModel.startsWith("gemini-3.7-flash") ? "gemini-3-flash" : resolved.actualModel;
  return {
    ...project === void 0 ? {} : { project },
    model: wireModel,
    request: {
      contents: [{ role: "user", parts: [
        { text: prompt },
        { inlineData: { mimeType: "video/mp4", data: Buffer10.from(data).toString("base64") } }
      ] }]
    }
  };
}
function extractText(value) {
  const output = [];
  let outputLength = 0;
  const visit = (item, depth = 0) => {
    if (depth > 32 || outputLength >= 64 * 1024) return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child, depth + 1);
      return;
    }
    if (!isRecord14(item)) return;
    if (Array.isArray(item.parts)) {
      for (const part of item.parts) {
        if (!isRecord14(part) || typeof part.text !== "string" || hasControl3(part.text)) continue;
        const text2 = part.text.slice(0, 64 * 1024 - outputLength);
        output.push(text2);
        outputLength += text2.length;
      }
    }
    if (isRecord14(item.response)) visit(item.response, depth + 1);
    if (isRecord14(item.content)) visit(item.content, depth + 1);
    if (Array.isArray(item.candidates)) visit(item.candidates, depth + 1);
    if (isRecord14(item.serverContent)) visit(item.serverContent, depth + 1);
    if (isRecord14(item.modelTurn)) visit(item.modelTurn, depth + 1);
  };
  visit(value);
  const text = output.join("").trim();
  return text.length === 0 ? void 0 : text.slice(0, 64 * 1024);
}
function extractUsage(value) {
  const visit = (item, depth = 0) => {
    if (depth > 32) return void 0;
    if (Array.isArray(item)) {
      for (const child of item) {
        const result2 = visit(child, depth + 1);
        if (result2 !== void 0) return result2;
      }
      return void 0;
    }
    if (!isRecord14(item)) return void 0;
    const raw = isRecord14(item.usageMetadata) ? item.usageMetadata : isRecord14(item.usage_metadata) ? item.usage_metadata : isRecord14(item.usage) ? item.usage : void 0;
    if (raw !== void 0) {
      const input = safeCount(raw.promptTokenCount ?? raw.inputTokenCount);
      const output = safeCount(raw.candidatesTokenCount ?? raw.outputTokenCount);
      const cached = safeCount(raw.cachedContentTokenCount ?? raw.cacheReadTokens);
      const reasoning = safeCount(raw.thoughtsTokenCount ?? raw.reasoningTokenCount);
      if (input !== void 0 || output !== void 0 || cached !== void 0 || reasoning !== void 0) {
        return { inputTokens: input ?? 0, outputTokens: output ?? 0, ...cached === void 0 ? {} : { cacheReadTokens: cached }, ...reasoning === void 0 ? {} : { reasoningTokens: reasoning } };
      }
    }
    for (const key of ["response", "candidates", "serverContent"]) {
      const result2 = visit(item[key], depth + 1);
      if (result2 !== void 0) return result2;
    }
    return void 0;
  };
  return visit(value);
}
function safeCount(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : void 0;
}
function parseArgs(value, settings) {
  if (!isRecord14(value) || hasExtra2(value, ["path", "prompt", "model"]) || typeof value.path !== "string" || typeof value.prompt !== "string" || value.path.length === 0 || value.path.length > 4096 || value.prompt.trim().length === 0 || value.prompt.length > 16384) {
    throw new AntigravityVideoError("analyze_video expects a closed path and prompt object", "INVALID_ARGS");
  }
  const model = value.model === void 0 ? settings.model : value.model;
  if (typeof model !== "string" || model.trim().length === 0 || model.length > 256) throw new AntigravityVideoError("The video model is invalid", "INVALID_ARGS");
  return { path: value.path, prompt: value.prompt.trim().slice(0, 16384), model: model.trim() };
}
function requireAgent2(exec) {
  if (exec.agent === void 0) throw new AntigravityVideoError("Video analysis requires an active workspace", "VIDEO_WORKSPACE_REQUIRED");
  workspaceCwd2(exec.agent);
  return exec.agent;
}
function workspaceCwd2(agent) {
  const cwd = agent.session.header.cwd;
  if (typeof cwd !== "string" || cwd.length === 0) throw new AntigravityVideoError("Video analysis requires an active workspace", "VIDEO_WORKSPACE_REQUIRED");
  return cwd;
}
function toVideoError(error) {
  if (error instanceof AntigravityVideoError) return error;
  if (error instanceof PrivateTransportError) {
    return new AntigravityVideoError("The Antigravity Video request failed safely", VIDEO_FAILURE_CODES[classifyPrivateFailure(error)]);
  }
  return new AntigravityVideoError("The Antigravity Video request failed safely", "VIDEO_FAILED");
}
function hasControl3(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return true;
  }
  return false;
}
function hasExtra2(value, allowed) {
  return Object.keys(value).some((key) => !allowed.includes(key));
}
function isRecord14(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
var ANALYZE_VIDEO_TOOL_NAME, ANTIGRAVITY_VIDEO_ENDPOINT, ANTIGRAVITY_VIDEO_MODEL, Config3, AntigravityVideoError, VIDEO_FAILURE_CODES, videoSchema;
var init_video = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/video.ts"() {
    "use strict";
    init_dist();
    init_auth_service();
    init_private_transport();
    init_media_admission();
    init_wire_identity();
    init_private_failure();
    init_capability_lifecycle();
    init_volatile_config();
    ANALYZE_VIDEO_TOOL_NAME = "analyze_video";
    ANTIGRAVITY_VIDEO_ENDPOINT = `${ANTIGRAVITY_WIRE_ORIGIN}/v1internal:generateContent`;
    ANTIGRAVITY_VIDEO_MODEL = "antigravity-gemini-3.7-flash";
    Config3 = z3.object({
      enabled: z3.boolean().default(true).volatile(),
      model: z3.string().default(ANTIGRAVITY_VIDEO_MODEL).volatile(),
      maxBytes: z3.number().step(1).min(1).max(32 * 1024 * 1024).default(32 * 1024 * 1024).volatile()
    });
    AntigravityVideoError = class extends HarnessError3 {
    };
    VIDEO_FAILURE_CODES = {
      authentication: "VIDEO_AUTH_REQUIRED",
      forbidden: "VIDEO_FORBIDDEN",
      "rate-limited": "VIDEO_RATE_LIMITED",
      cancelled: "VIDEO_CANCELLED",
      timeout: "VIDEO_TIMEOUT",
      "attribution-rejected": "VIDEO_PROTOCOL_DRIFT",
      "protocol-drift": "VIDEO_PROTOCOL_DRIFT",
      "response-limit": "VIDEO_PROTOCOL_DRIFT",
      "request-limit": "VIDEO_PROTOCOL_DRIFT",
      upstream: "VIDEO_FAILED",
      network: "VIDEO_FAILED",
      failed: "VIDEO_FAILED"
    };
    videoSchema = {
      type: "object",
      properties: {
        text: { type: "string" },
        usage: {
          type: "object",
          properties: {
            inputTokens: { type: "integer" },
            outputTokens: { type: "integer" },
            cacheReadTokens: { type: "integer" },
            reasoningTokens: { type: "integer" }
          },
          required: ["inputTokens", "outputTokens"],
          additionalProperties: false
        }
      },
      required: ["text"],
      additionalProperties: false
    };
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/live-gate-video.ts
import { lstat as lstat4, readFile as readFile5, realpath, stat } from "node:fs/promises";
import { dirname as dirname4, isAbsolute, join as join5, relative, resolve } from "node:path";
async function runVideoGate(auth, options) {
  if (options.videoFile === void 0) return { gate: "V", outcome: "failed" };
  const absolute = resolve(options.videoFile);
  const workspace = dirname4(absolute);
  const path = relative(workspace, absolute);
  const agent = { session: { header: { cwd: workspace }, events: [] } };
  const context = { agent, signal: new AbortController().signal };
  const tool = createAntigravityVideoTools({
    auth,
    fs: createNodeFileSystem(workspace),
    settings: () => ({ enabled: true, model: ANTIGRAVITY_VIDEO_MODEL, maxBytes: LIVE_VIDEO_BYTES })
  })[0];
  if (tool === void 0) throw new Error("The video gate tool is unavailable");
  const result2 = await tool.execute({ path, prompt: LIVE_VIDEO_QUESTION }, context);
  if (!isDeterministicVideoAnswer(result2.text)) throw new Error("The video gate did not verify the fixture pixel fact");
  await auth.recordCapabilityGate("video", "passed");
  return { gate: "V", outcome: "passed" };
}
function isDeterministicVideoAnswer(value) {
  return typeof value === "string" && value === LIVE_VIDEO_EXPECTED_ANSWER;
}
function createNodeFileSystem(workspace) {
  const target = (path) => ({ targetKey: path, displayPath: path });
  const resolveTarget = async (path, options) => {
    const absolute = isAbsolute(path) ? path : join5(options?.cwd ?? workspace, path);
    return target(await realpath(absolute));
  };
  const version = (value) => `${String(value.dev)}:${String(value.ino)}:${String(value.size)}:${String(value.mtimeMs)}`;
  return {
    resolve: resolveTarget,
    contains: (parent, child) => {
      const childRelative = relative(String(parent.targetKey), String(child.targetKey));
      return childRelative === "" || !childRelative.startsWith("..") && !isAbsolute(childRelative);
    },
    lstat: async (path, options) => {
      const absolute = isAbsolute(path) ? path : join5(options?.cwd ?? workspace, path);
      const info = await lstat4(absolute, { bigint: true });
      return { type: info.isSymbolicLink() ? "symlink" : info.isFile() ? "file" : info.isDirectory() ? "directory" : "other", version: version(info), size: Number(info.size) };
    },
    stat: async (value) => {
      const info = await stat(String(value.targetKey), { bigint: true });
      return { type: info.isFile() ? "file" : info.isDirectory() ? "directory" : "other", version: version(info), size: Number(info.size) };
    },
    readBytes: async (value, signal, maxBytes) => {
      signal?.throwIfAborted();
      const info = await stat(String(value.targetKey));
      if (info.size > maxBytes) throw new Error("Fixture exceeds gate bound");
      const data = await readFile5(String(value.targetKey));
      signal?.throwIfAborted();
      if (data.byteLength > maxBytes) throw new Error("Fixture exceeds gate bound");
      return new Uint8Array(data);
    }
  };
}
var LIVE_VIDEO_BYTES, LIVE_VIDEO_QUESTION, LIVE_VIDEO_EXPECTED_ANSWER;
var init_live_gate_video = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/live-gate-video.ts"() {
    "use strict";
    init_video();
    LIVE_VIDEO_BYTES = 32 * 1024 * 1024;
    LIVE_VIDEO_QUESTION = "What exact uppercase word is visibly shown in the center of the video? Reply with that word only.";
    LIVE_VIDEO_EXPECTED_ANSWER = "KUMQUAT";
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/live-gate-runner.ts
var live_gate_runner_exports = {};
__export(live_gate_runner_exports, {
  LIVE_TEXT_MODEL: () => LIVE_TEXT_MODEL,
  LIVE_TEXT_MODEL_BY_FAMILY: () => LIVE_TEXT_MODEL_BY_FAMILY,
  LIVE_VIDEO_EXPECTED_ANSWER: () => LIVE_VIDEO_EXPECTED_ANSWER,
  LIVE_VIDEO_QUESTION: () => LIVE_VIDEO_QUESTION,
  classifyGate0Outcome: () => classifyGate0Outcome,
  createProductionLiveGateRunner: () => createProductionLiveGateRunner,
  isDeterministicVideoAnswer: () => isDeterministicVideoAnswer,
  runLlmGate: () => runLlmGate
});
import { dirname as dirname5, join as join6 } from "node:path";
function createProductionLiveGateRunner(options = {}) {
  const authPath = defaultAuthStorePath();
  const gates = options.gates ?? createFileCapabilityGates(defaultCapabilityGatePath(authPath));
  const auth = options.auth ?? createAntigravityAuthService({ storePath: authPath, gates });
  const ownsAuth = options.auth === void 0;
  const output = options.output ?? (() => {
  });
  const attachmentRoot = options.attachmentRoot ?? join6(dirname5(authPath), "live-gate-attachments");
  return {
    run: async (gate, runOptions) => {
      try {
        if (gate === "A") return await runAuthGate(auth, output);
        if (gate === "0L") {
          if (runOptions.llmFamily !== void 0 && !await auth.gate0Passed()) return { gate, outcome: "failed" };
          return await runLlmGate(auth, gates, runOptions.llmFamily);
        }
        if (!await auth.gate0Passed()) {
          await recordGateFailure(auth, gate, "failed");
          return { gate, outcome: "failed" };
        }
        if (gate === "S") return await runSearchGate(auth);
        if (gate === "I") return await runImageGate(auth, attachmentRoot);
        return await runVideoGate(auth, runOptions);
      } catch (error) {
        const outcome = gate === "0L" ? classifyGate0Outcome(error) : classifyOutcome(error);
        await recordGateFailure(auth, gate, outcome, runOptions.llmFamily).catch(() => {
        });
        return { gate, outcome };
      }
    },
    dispose: async () => {
      if (ownsAuth) await auth.dispose();
    }
  };
}
var init_live_gate_runner = __esm({
  "work/dsh-runtime/dsh-antigravity-auth/src/live-gate-runner.ts"() {
    "use strict";
    init_auth_service();
    init_auth_store();
    init_capability_gates();
    init_live_gate_auth();
    init_live_gate_image();
    init_live_gate_llm();
    init_live_gate_outcome();
    init_live_gate_search();
    init_live_gate_video();
    init_live_gate_llm();
    init_live_gate_outcome();
    init_live_gate_video();
  }
});

// work/dsh-runtime/dsh-antigravity-auth/src/index.ts
init_auth_service();

// work/dsh-runtime/dsh-antigravity-auth/src/loopback-rpc.ts
var LOOPBACK_REQUIRED_MESSAGE = "Antigravity account controls require a loopback-bound DSH Host";
function loopbackMode(webServerHost) {
  return webServerHost === "127.0.0.1" ? "enabled" : "blocked";
}
var ACCOUNT_COMMAND_DENIED_MESSAGE = "Antigravity account commands require a local DSH Host (no WebServer or 127.0.0.1-bound)";
function commandAccountMode(webServer) {
  if (webServer === void 0) return "enabled";
  return loopbackMode(webServer.host);
}
function createLoopbackRpcGuard(webServerHost, delegate) {
  if (loopbackMode(webServerHost) === "blocked") {
    return {
      mode: "blocked",
      handler: async () => ({
        ok: false,
        error: {
          code: "loopback-required",
          message: LOOPBACK_REQUIRED_MESSAGE,
          details: {}
        }
      })
    };
  }
  return { mode: "enabled", handler: delegate };
}

// work/dsh-runtime/dsh-antigravity-auth/src/open-authorization-url.ts
import { spawn } from "node:child_process";
var AUTHORIZATION_HOST = "accounts.google.com";
function openerSpec(platform, url) {
  if (platform === "darwin") return { command: "open", args: [url], verbatimArguments: false };
  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", '""', `"${url}"`], verbatimArguments: true };
  }
  return { command: "xdg-open", args: [url], verbatimArguments: false };
}
function isAntigravityAuthorizationUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === AUTHORIZATION_HOST && parsed.pathname.startsWith("/o/oauth2/");
  } catch {
    return false;
  }
}
async function openAuthorizationUrl(url, spawnFn = spawn, platform = process.platform) {
  if (!isAntigravityAuthorizationUrl(url)) return false;
  const spec = openerSpec(platform, url);
  try {
    const child = spawnFn(spec.command, spec.args, {
      detached: true,
      stdio: "ignore",
      windowsVerbatimArguments: spec.verbatimArguments
    });
    return await new Promise((resolve2) => {
      child.once("error", () => {
        resolve2(false);
      });
      child.once("spawn", () => {
        child.unref();
        resolve2(true);
      });
    });
  } catch {
    return false;
  }
}

// work/dsh-runtime/dsh-antigravity-auth/src/auth-command.ts
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function formatStatus(status) {
  const login = status.login;
  const parts = [
    login.configured ? "configured" : "not configured",
    login.projectAvailable ? "project available" : "no project"
  ];
  if (login.maskedEmail !== void 0) parts.push(login.maskedEmail);
  if (login.phase === "pending") {
    parts.push("authorization pending");
  } else if (login.phase !== "idle" && login.phase !== "success") {
    parts.push(`phase ${login.phase}`);
  }
  if (login.errorCode !== void 0) parts.push(`error ${login.errorCode}`);
  const available = status.capabilities.filter((capability) => capability.state === "available").map((capability) => capability.id);
  if (available.length > 0) parts.push(`available: ${available.join(", ")}`);
  return `Antigravity auth: ${parts.join("; ")}`;
}
function createAntigravityAuthCommand(service, accountMode, openUrl = openAuthorizationUrl) {
  return {
    name: "antigravity-auth",
    description: "Inspect or start the Antigravity OAuth login",
    input: { hint: "[status|accounts|switch <id>|login|logout|remove <id>]" },
    handler: async ({ rawInput }) => {
      if (accountMode() === "blocked") {
        return { kind: "error", text: ACCOUNT_COMMAND_DENIED_MESSAGE };
      }
      const parts = rawInput.trim().split(/\s+/);
      const operation = parts[0] || "status";
      const arg = parts.slice(1).join(" ").trim();
      if (operation === "status") {
        try {
          const status = await service.status();
          const list = typeof service.listAccounts === "function" ? await Promise.resolve().then(() => service.listAccounts()).catch(() => void 0) : void 0;
          let text = formatStatus(status);
          if (list !== void 0 && list.accounts.length > 0) {
            const activeAcc = list.accounts.find((a) => a.isActive);
            text += `
\u5DF2\u7F13\u5B58\u8D26\u53F7\u6570: ${list.accounts.length}`;
            if (activeAcc !== void 0) {
              text += ` (\u5F53\u524D: [${activeAcc.index}] ${activeAcc.email ?? activeAcc.maskedEmail ?? activeAcc.id})`;
            }
          }
          return { kind: "success", text };
        } catch (error) {
          return { kind: "error", text: `reading Antigravity auth status failed: ${errorMessage(error)}` };
        }
      }
      if (operation === "accounts" || operation === "list") {
        try {
          const list = await service.listAccounts();
          if (list.accounts.length === 0) {
            return {
              kind: "success",
              text: "\u5F53\u524D\u6682\u65E0\u5DF2\u7F13\u5B58\u7684 Antigravity \u8D26\u53F7\u3002\u8BF7\u6267\u884C /anti login \u6216 /antigravity-auth login \u767B\u5F55\u65B0\u8D26\u53F7\u3002"
            };
          }
          const lines = [
            `Antigravity \u8D26\u53F7\u5217\u8868 (\u5171 ${list.accounts.length} \u4E2A):`,
            ...list.accounts.map((acc) => {
              const activeMark = acc.isActive ? " * [\u6D3B\u8DC3] " : "   ";
              const emailDisplay = acc.maskedEmail ?? acc.email ?? "(\u672A\u63D0\u4F9B\u90AE\u7BB1)";
              return `${activeMark}[${acc.index}] ${emailDisplay} (\u9879\u76EE: ${acc.projectId})`;
            }),
            "",
            "\u63D0\u793A: \u8F93\u5165 /anti switch <\u5E8F\u53F7\u6216\u90AE\u7BB1> \u5207\u6362\u8D26\u53F7",
            "      \u8F93\u5165 /anti login \u767B\u5F55\u65B0\u8D26\u53F7\u5E76\u81EA\u52A8\u52A0\u5165\u5217\u8868"
          ];
          return { kind: "success", text: lines.join("\n") };
        } catch (error) {
          return { kind: "error", text: `\u83B7\u53D6\u8D26\u53F7\u5217\u8868\u5931\u8D25: ${errorMessage(error)}` };
        }
      }
      if (operation === "switch" || operation === "use") {
        if (!arg) {
          return {
            kind: "error",
            text: "\u8BF7\u6307\u5B9A\u8981\u5207\u6362\u7684\u8D26\u53F7\u5E8F\u53F7\u6216\u90AE\u7BB1\uFF0C\u4F8B\u5982: /anti switch 1 \u6216 /anti switch user@example.com"
          };
        }
        try {
          const result2 = await service.switchAccount(arg);
          return result2.ok ? { kind: "success", text: result2.message } : { kind: "error", text: result2.message };
        } catch (error) {
          return { kind: "error", text: `\u5207\u6362\u8D26\u53F7\u5931\u8D25: ${errorMessage(error)}` };
        }
      }
      if (operation === "remove" || operation === "delete") {
        if (!arg) {
          return {
            kind: "error",
            text: "\u8BF7\u6307\u5B9A\u8981\u79FB\u9664\u7684\u8D26\u53F7\u5E8F\u53F7\u6216\u90AE\u7BB1\uFF0C\u4F8B\u5982: /anti remove 2"
          };
        }
        try {
          const result2 = await service.removeAccount(arg);
          return result2.ok ? { kind: "success", text: result2.message } : { kind: "error", text: result2.message };
        } catch (error) {
          return { kind: "error", text: `\u79FB\u9664\u8D26\u53F7\u5931\u8D25: ${errorMessage(error)}` };
        }
      }
      if (operation === "login") {
        try {
          const replaced = (await service.status()).login.phase === "pending";
          await service.acknowledgeRisk();
          const started = await service.startLogin();
          const opened = await openUrl(started.authorizationUrl);
          if (!opened) {
            return {
              kind: "error",
              text: "Antigravity authorization started, but this Host could not open a browser automatically; complete sign-in in a browser on this Host, then run /antigravity-auth status."
            };
          }
          return {
            kind: "success",
            text: replaced ? "Previous Antigravity authorization cancelled and a new one started (unofficial Antigravity channel, personal use); complete Google sign-in in the opened browser, then run /antigravity-auth status." : "Antigravity authorization started (unofficial Antigravity channel, personal use); complete Google sign-in in the opened browser, then run /antigravity-auth status."
          };
        } catch (error) {
          return { kind: "error", text: `starting Antigravity login failed: ${errorMessage(error)}` };
        }
      }
      if (operation === "cancel") {
        try {
          const result2 = await service.cancelLogin();
          return result2.phase === "cancelled" ? { kind: "success", text: "Antigravity authorization cancelled." } : { kind: "error", text: `Antigravity authorization could not be cancelled (phase ${result2.phase}).` };
        } catch (error) {
          return { kind: "error", text: `cancelling Antigravity login failed: ${errorMessage(error)}` };
        }
      }
      if (operation === "logout") {
        try {
          await service.logout();
          return { kind: "success", text: "Antigravity logged out." };
        } catch (error) {
          return { kind: "error", text: `logging out of Antigravity failed: ${errorMessage(error)}` };
        }
      }
      return { kind: "error", text: `unknown operation "${operation}" (available: status, accounts, switch <id>, login, cancel, logout, remove <id>)` };
    }
  };
}

// work/dsh-runtime/dsh-antigravity-auth/src/index.ts
init_llm_adapter();
init_auth_store();

// work/dsh-runtime/dsh-antigravity-auth/src/account-routes.ts
import { clientRequestSchema } from "@deepseek-ai/dsh-client-connection";
function registerAccountRoutes(connection, namespace, endpoints, handler) {
  const disposers = endpoints.map((endpoint) => connection.fetch.register({
    path: `/api/${namespace}/${endpoint}`,
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
        return new Response("content type must be application/json", { status: 415 });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return new Response("invalid JSON", { status: 400 });
      }
      const envelope = clientRequestSchema.safeParse(body);
      if (!envelope.success) return new Response("invalid account request", { status: 400 });
      const { rpcId, method, payload } = envelope.data;
      const failure = (code, message) => ({ ok: false, error: { code, message, details: {} } });
      let result2;
      try {
        result2 = method === `${namespace}/${endpoint}` ? await handler(endpoint, payload, request.signal, connection.operator) : failure("bad-request", "Account request method does not match its endpoint");
      } catch {
        result2 = failure("internal", "Account request failed");
      }
      return Response.json({ type: "server-response", rpcId, result: result2 });
    }
  }));
  return async () => {
    await Promise.all(disposers.map((dispose) => dispose()));
  };
}

// work/dsh-runtime/dsh-antigravity-auth/src/rpc.ts
init_oauth_flow();
init_credential_coordinator();

// work/dsh-runtime/dsh-antigravity-auth/src/login-types.ts
var LOGIN_PHASES = [
  "idle",
  "pending",
  "success",
  "cancelled",
  "expired",
  "port-conflict",
  "failed"
];
var LOGIN_ERROR_CODES = [
  "invalid-method",
  "invalid-path",
  "invalid-host",
  "duplicate-parameter",
  "invalid-parameters",
  "missing-state",
  "state-mismatch",
  "missing-code",
  "oauth-error",
  "no-pending-flow",
  "expired",
  "cancelled",
  "port-conflict",
  "token-exchange-failed",
  "project-unavailable",
  "project-authentication-failed",
  "project-forbidden",
  "project-rate-limited",
  "project-offline",
  "project-malformed",
  "project-protocol-drift",
  "project-validation-failed",
  "persistence-failed",
  "credential-conflict",
  "invalid-callback-url",
  "risk-acknowledgement-required",
  "internal"
];
function isLoginPhase(value) {
  return typeof value === "string" && LOGIN_PHASES.includes(value);
}
function isLoginErrorCode(value) {
  return typeof value === "string" && LOGIN_ERROR_CODES.includes(value);
}

// work/dsh-runtime/dsh-antigravity-auth/src/rpc-vocabulary.ts
var OPERATION_ERROR_CODES = [
  "loopback-required",
  "invalid-grant",
  "network",
  "timeout",
  "rate-limited",
  "server-error",
  "http-error",
  "invalid-response",
  "conflict",
  "storage"
];
var SAFE_RPC_ERROR_CODES = [
  "bad-request",
  ...LOGIN_ERROR_CODES,
  ...OPERATION_ERROR_CODES
];
var SAFE_RPC_ERROR_MESSAGES = Object.freeze({
  "bad-request": "antigravity-auth: invalid request",
  "loopback-required": "Antigravity account controls require a loopback-bound DSH Host",
  cancelled: "The operation was cancelled",
  "risk-acknowledgement-required": "Risk acknowledgement is required before login",
  "port-conflict": "The fixed OAuth callback port is already in use",
  "invalid-method": "The OAuth callback method is not accepted",
  "invalid-path": "The OAuth callback path is not accepted",
  "invalid-host": "The OAuth callback host is not accepted",
  "duplicate-parameter": "The OAuth callback contains duplicate parameters",
  "invalid-parameters": "The OAuth callback parameters are not accepted",
  "missing-state": "The OAuth callback state is missing",
  "state-mismatch": "The OAuth callback state was not accepted",
  "missing-code": "The OAuth callback code is missing",
  "oauth-error": "The OAuth provider rejected authorization",
  expired: "The OAuth login expired",
  "no-pending-flow": "There is no pending OAuth login",
  "project-unavailable": "No usable project is available for this account",
  "project-authentication-failed": "The Antigravity project probe requires authentication",
  "project-forbidden": "The Antigravity project probe was forbidden",
  "project-rate-limited": "The Antigravity project probe is rate-limited",
  "project-offline": "The Antigravity project probe is offline",
  "project-malformed": "The Antigravity project response was malformed",
  "project-protocol-drift": "The Antigravity project protocol changed",
  "project-validation-failed": "Project validation failed",
  "credential-conflict": "The login changed while it was completing",
  "persistence-failed": "The login could not be saved",
  "token-exchange-failed": "The authorization code could not be exchanged",
  "invalid-callback-url": "The callback URL is invalid",
  "invalid-grant": "The account must be authenticated again",
  network: "The operation could not reach the provider",
  timeout: "The operation timed out",
  "rate-limited": "The operation is rate-limited",
  "server-error": "The provider is unavailable",
  "http-error": "The provider rejected the operation",
  "invalid-response": "The provider response was not accepted",
  conflict: "The account changed while the operation was running",
  storage: "The local account state could not be updated"
});
function isSafeRpcErrorCode(value) {
  return typeof value === "string" && SAFE_RPC_ERROR_CODES.includes(value);
}
function safeRpcErrorMessage(code) {
  return SAFE_RPC_ERROR_MESSAGES[code] ?? "antigravity-auth: operation failed";
}

// work/dsh-runtime/dsh-antigravity-auth/src/rpc-contract.ts
init_status();

// work/dsh-runtime/dsh-antigravity-auth/src/model-catalog.ts
var ANTIGRAVITY_MODEL_CATALOG_STATES = [
  "snapshot",
  "live-available",
  "refresh-failed",
  "protocol-drift"
];

// work/dsh-runtime/dsh-antigravity-auth/src/rpc-contract.ts
init_safe_text();
var ANTIGRAVITY_AUTH_RPC_CHANNEL = "/api";
var ANTIGRAVITY_AUTH_RPC_NAMESPACE = "antigravity-auth";
function createAntigravityAuthRpcClient(rpc) {
  return {
    status: (signal) => callValidated(rpc, "status", {}, signal, (value) => {
      const status = parseStatusResult(value);
      return status === void 0 ? void 0 : { status };
    }),
    acknowledgeRisk: (signal) => callValidated(rpc, "acknowledge-risk", { acknowledge: true }, signal, parseAcknowledgementResult),
    login: (signal) => callValidated(rpc, "login", {}, signal, parseLoginResult),
    cancelLogin: (signal) => callValidated(rpc, "cancel", {}, signal, parseActionResult),
    logout: (signal) => callValidated(rpc, "logout", {}, signal, parseLogoutResult),
    revoke: (signal) => callValidated(rpc, "revoke", { confirmed: true }, signal, parseRevokeResult),
    models: (signal, force = false) => callValidated(rpc, "models", { force }, signal, parseModelCatalogResult),
    usage: (signal, force = false) => callValidated(rpc, "usage", { force }, signal, parseUsageResult)
  };
}
async function callValidated(rpc, endpoint, payload, signal, parse) {
  let result2;
  try {
    result2 = await rpc.call(ANTIGRAVITY_AUTH_RPC_CHANNEL, `${ANTIGRAVITY_AUTH_RPC_NAMESPACE}/${endpoint}`, payload, signal);
  } catch {
    return invalidResponse(endpoint);
  }
  if (!result2.ok) return sanitizeFailure(result2, endpoint);
  const value = parse(result2.value);
  return value === void 0 ? invalidResponse(endpoint) : { ok: true, value };
}
function sanitizeFailure(result2, endpoint) {
  const error = result2.error;
  if (!isRecord9(error) || !hasExactKeys(error, ["code", "message", "details"]) || !isSafeRpcErrorCode(error.code) || typeof error.message !== "string" || !isBoundedSafeText(error.message, 512) || !isSafeErrorDetails(error.details)) return invalidResponse(endpoint);
  return {
    ok: false,
    error: {
      code: error.code,
      message: safeRpcErrorMessage(error.code),
      details: {}
    }
  };
}
function isSafeErrorDetails(value) {
  if (!isRecord9(value)) return false;
  if (Object.keys(value).length === 0) return true;
  return hasExactKeys(value, ["issues"]) && Array.isArray(value.issues) && value.issues.length === 0;
}
function parseModelCatalogResult(value) {
  if (!isRecord9(value) || !hasExactKeys(value, ["state", "models", ...value.checkedAt === void 0 ? [] : ["checkedAt"]]) || !ANTIGRAVITY_MODEL_CATALOG_STATES.includes(value.state) || !Array.isArray(value.models) || value.models.length === 0 || value.models.length > 64 || value.checkedAt !== void 0 && !isIsoTime(value.checkedAt)) return void 0;
  const models = [];
  const ids = /* @__PURE__ */ new Set();
  for (const model of value.models) {
    if (!isRecord9(model) || !hasExactKeys(model, ["id", "name", "state"]) || !isBoundedSafeText(model.id, 256) || !isBoundedSafeText(model.name, 256) || model.state !== "snapshot" && model.state !== "live-available" && model.state !== "unavailable" || ids.has(model.id)) return void 0;
    if (value.state === "live-available" ? model.state === "snapshot" : model.state !== "snapshot") return void 0;
    ids.add(model.id);
    models.push({ id: model.id, name: model.name, state: model.state });
  }
  return {
    state: value.state,
    models,
    ...typeof value.checkedAt === "string" ? { checkedAt: value.checkedAt } : {}
  };
}
function parseUsageResult(value) {
  if (!isRecord9(value) || !hasExactKeys(value, ["state", ...value.checkedAt === void 0 ? [] : ["checkedAt"], ...value.groups === void 0 ? [] : ["groups"]])) return void 0;
  if (!isQuotaState(value.state)) return void 0;
  if (value.checkedAt !== void 0 && !isIsoTime(value.checkedAt)) return void 0;
  if (value.state === "available" && value.groups === void 0) return void 0;
  if (value.groups !== void 0) {
    if (!Array.isArray(value.groups) || value.groups.length === 0 || value.groups.length > 2) return void 0;
    const groups = [];
    const groupNames = /* @__PURE__ */ new Set();
    for (const rawGroup of value.groups) {
      if (!isRecord9(rawGroup) || !hasExactKeys(rawGroup, ["group", "modelCount", "windows"]) || rawGroup.group !== "gemini" && rawGroup.group !== "non-gemini" || !Number.isSafeInteger(rawGroup.modelCount) || rawGroup.modelCount < 0 || !Array.isArray(rawGroup.windows)) return void 0;
      if (groupNames.has(rawGroup.group)) return void 0;
      groupNames.add(rawGroup.group);
      const modelCount = rawGroup.modelCount;
      if (rawGroup.windows.length === 0 || rawGroup.windows.length > 2) return void 0;
      const windows = [];
      const windowKinds = /* @__PURE__ */ new Set();
      for (const rawWindow of rawGroup.windows) {
        if (!isRecord9(rawWindow) || !hasExactKeys(rawWindow, ["window", "remainingFraction", "resetTime"]) || rawWindow.window !== "5h" && rawWindow.window !== "weekly" || windowKinds.has(rawWindow.window) || typeof rawWindow.remainingFraction !== "number" || !Number.isFinite(rawWindow.remainingFraction) || rawWindow.remainingFraction < 0 || rawWindow.remainingFraction > 1 || !isIsoTime(rawWindow.resetTime)) return void 0;
        windowKinds.add(rawWindow.window);
        windows.push({ window: rawWindow.window, remainingFraction: rawWindow.remainingFraction, resetTime: rawWindow.resetTime });
      }
      groups.push({ group: rawGroup.group, modelCount, windows });
    }
    return { state: value.state, ...typeof value.checkedAt === "string" ? { checkedAt: value.checkedAt } : {}, groups };
  }
  return { state: value.state, ...typeof value.checkedAt === "string" ? { checkedAt: value.checkedAt } : {} };
}
function parseStatusResult(value) {
  if (!isRecord9(value) || !hasExactKeys(value, ["status"])) return void 0;
  return parseStatus(value.status);
}
function parseStatus(value) {
  if (!isRecord9(value) || !hasAllowedKeys(value, [
    "pluginId",
    "phase",
    "privateSelfUse",
    "singleAccount",
    "riskAcknowledgementRequired",
    "riskAcknowledged",
    "login",
    "credential",
    "revoke",
    "capabilities"
  ]) || value.pluginId !== "dsh-antigravity-auth" || value.phase !== "bootstrap" || value.privateSelfUse !== true || value.singleAccount !== true || value.riskAcknowledgementRequired !== true || typeof value.riskAcknowledged !== "boolean" || !Array.isArray(value.capabilities)) return void 0;
  const login = parseLoginStatus(value.login);
  if (login === void 0) return void 0;
  const credential = value.credential === void 0 ? void 0 : parseCredentialStatus(value.credential);
  if (value.credential !== void 0 && credential === void 0) return void 0;
  const revoke = value.revoke === void 0 ? void 0 : parseRevokeStatus(value.revoke);
  if (value.revoke !== void 0 && revoke === void 0) return void 0;
  const seen = /* @__PURE__ */ new Set();
  const capabilities = [];
  for (const capability of value.capabilities) {
    const parsed = parseCapability(capability);
    if (parsed === void 0 || seen.has(parsed.id)) return void 0;
    seen.add(parsed.id);
    capabilities.push(parsed);
  }
  if (seen.size !== CAPABILITY_ROW_IDS.length || CAPABILITY_ROW_IDS.some((id) => !seen.has(id))) return void 0;
  return {
    pluginId: "dsh-antigravity-auth",
    phase: "bootstrap",
    privateSelfUse: true,
    singleAccount: true,
    riskAcknowledgementRequired: true,
    riskAcknowledged: value.riskAcknowledged,
    login,
    ...credential === void 0 ? {} : { credential },
    ...revoke === void 0 ? {} : { revoke },
    capabilities
  };
}
function parseCredentialStatus(value) {
  if (!isRecord9(value) || typeof value.state !== "string" || !isCredentialState(value.state) || typeof value.configured !== "boolean" || !hasAllowedKeys(value, ["state", "configured", "expiresAt", "lastRefreshAt", "errorCode"])) return void 0;
  if (value.expiresAt !== void 0 && !isIsoTime(value.expiresAt)) return void 0;
  if (value.lastRefreshAt !== void 0 && !isIsoTime(value.lastRefreshAt)) return void 0;
  if (value.errorCode !== void 0 && (typeof value.errorCode !== "string" || !isCredentialErrorCode(value.errorCode))) return void 0;
  return {
    state: value.state,
    configured: value.configured,
    ...typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {},
    ...typeof value.lastRefreshAt === "string" ? { lastRefreshAt: value.lastRefreshAt } : {},
    ...typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}
  };
}
function parseRevokeStatus(value) {
  if (!isRecord9(value) || typeof value.state !== "string" || !isRevokeState(value.state) || !hasAllowedKeys(value, ["state", "errorCode"])) return void 0;
  if (value.errorCode !== void 0 && (typeof value.errorCode !== "string" || !isRevokeErrorCode(value.errorCode))) return void 0;
  return {
    state: value.state,
    ...typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}
  };
}
function parseLoginStatus(value) {
  if (!isRecord9(value) || typeof value.phase !== "string" || !isLoginPhase(value.phase) || typeof value.configured !== "boolean" || typeof value.projectAvailable !== "boolean") return void 0;
  const allowed = ["phase", "configured", "projectAvailable", "authorizationUrl", "expiresAt", "maskedEmail", "errorCode"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) return void 0;
  if (value.authorizationUrl !== void 0 && !isSafeAuthorizationUrl(value.authorizationUrl)) return void 0;
  if (value.expiresAt !== void 0 && !isIsoTime(value.expiresAt)) return void 0;
  if (value.maskedEmail !== void 0 && (typeof value.maskedEmail !== "string" || !isMaskedEmail(value.maskedEmail))) return void 0;
  if (value.errorCode !== void 0 && !isLoginErrorCode(value.errorCode)) return void 0;
  if (isErrorPhase(value.phase) ? typeof value.errorCode !== "string" : value.errorCode !== void 0) return void 0;
  if (value.phase === "pending" ? typeof value.authorizationUrl !== "string" || typeof value.expiresAt !== "string" : value.authorizationUrl !== void 0) return void 0;
  return {
    phase: value.phase,
    configured: value.configured,
    projectAvailable: value.projectAvailable,
    ...typeof value.authorizationUrl === "string" ? { authorizationUrl: value.authorizationUrl } : {},
    ...typeof value.expiresAt === "string" ? { expiresAt: value.expiresAt } : {},
    ...typeof value.maskedEmail === "string" ? { maskedEmail: value.maskedEmail } : {},
    ...typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}
  };
}
function parseCapability(value) {
  if (!isRecord9(value) || !hasExactKeys(value, ["id", "state", "reasonCode"])) return void 0;
  if (!isCapabilityRowId(value.id) || !isCapabilityGateState(value.state) || !isCapabilityReasonCode(value.reasonCode)) {
    return void 0;
  }
  return { id: value.id, state: value.state, reasonCode: value.reasonCode };
}
function parseAcknowledgementResult(value) {
  return isRecord9(value) && hasExactKeys(value, ["acknowledged"]) && value.acknowledged === true ? { acknowledged: true } : void 0;
}
function parseLoginResult(value) {
  return isRecord9(value) && hasExactKeys(value, ["started", "phase", "authorizationUrl", "expiresAt"]) && value.started === true && value.phase === "pending" && isSafeAuthorizationUrl(value.authorizationUrl) && isIsoTime(value.expiresAt) ? {
    started: true,
    phase: "pending",
    authorizationUrl: value.authorizationUrl,
    expiresAt: value.expiresAt
  } : void 0;
}
function parseActionResult(value) {
  if (!isRecord9(value) || typeof value.phase !== "string" || !isLoginPhase(value.phase)) return void 0;
  if (Object.keys(value).some((key) => key !== "phase" && key !== "errorCode")) return void 0;
  if (value.errorCode !== void 0 && !isLoginErrorCode(value.errorCode)) return void 0;
  return {
    phase: value.phase,
    ...typeof value.errorCode === "string" ? { errorCode: value.errorCode } : {}
  };
}
function parseLogoutResult(value) {
  return isRecord9(value) && hasExactKeys(value, ["state"]) && value.state === "logged-out" ? { state: "logged-out" } : void 0;
}
function parseRevokeResult(value) {
  if (!isRecord9(value) || typeof value.state !== "string") return void 0;
  if (value.state === "confirmation-required" || value.state === "revoked" || value.state === "logged-out" || value.state === "superseded") {
    return hasExactKeys(value, ["state"]) ? { state: value.state } : void 0;
  }
  if (value.state === "failed" && hasExactKeys(value, ["state", "errorCode"]) && typeof value.errorCode === "string" && isRevokeErrorCode(value.errorCode)) {
    return { state: "failed", errorCode: value.errorCode };
  }
  return void 0;
}
function isSafeAuthorizationUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 8192) return false;
  try {
    const parsed = new URL(value);
    const allowed = /* @__PURE__ */ new Set(["client_id", "response_type", "redirect_uri", "scope", "code_challenge", "code_challenge_method", "state", "access_type", "prompt"]);
    for (const [key, parameter] of parsed.searchParams) {
      if (!allowed.has(key) || parsed.searchParams.getAll(key).length !== 1 || !isBoundedSafeText(parameter, 4096)) return false;
    }
    const state = parsed.searchParams.get("state");
    const clientId = parsed.searchParams.get("client_id");
    const challenge = parsed.searchParams.get("code_challenge");
    return parsed.protocol === "https:" && parsed.hostname === "accounts.google.com" && parsed.port === "" && parsed.username === "" && parsed.password === "" && parsed.pathname === "/o/oauth2/v2/auth" && parsed.hash.length === 0 && typeof state === "string" && /^[A-Za-z0-9_-]{43}$/u.test(state) && (clientId === null || clientId.length <= 256 && clientId.endsWith(".apps.googleusercontent.com")) && (challenge === null || /^[A-Za-z0-9_-]{43}$/u.test(challenge)) && (parsed.searchParams.get("response_type") === null || parsed.searchParams.get("response_type") === "code") && (parsed.searchParams.get("redirect_uri") === null || parsed.searchParams.get("redirect_uri") === "http://localhost:51121/oauth-callback") && (parsed.searchParams.get("code_challenge_method") === null || parsed.searchParams.get("code_challenge_method") === "S256") && (parsed.searchParams.get("access_type") === null || parsed.searchParams.get("access_type") === "offline") && (parsed.searchParams.get("prompt") === null || parsed.searchParams.get("prompt") === "consent");
  } catch {
    return false;
  }
}
function isMaskedEmail(value) {
  return isBoundedSafeText(value, 256) && /^.[*]{3}[^@]*@[^@\s]+$/u.test(value);
}
function isErrorPhase(value) {
  return value === "cancelled" || value === "expired" || value === "port-conflict" || value === "failed";
}
function isQuotaState(value) {
  return value === "available" || value === "unauthenticated" || value === "forbidden" || value === "rate-limited" || value === "offline" || value === "timeout" || value === "protocol-drift";
}
function isIsoTime(value) {
  if (typeof value !== "string" || value.length > 64) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
function isCapabilityRowId(value) {
  return typeof value === "string" && CAPABILITY_ROW_IDS.includes(value);
}
function isCapabilityGateState(value) {
  return value === "available" || value === "disabled" || value === "poc-pending" || value === "protocol-drift";
}
function isCapabilityReasonCode(value) {
  return value === "gate-not-run" || value === "project-unavailable" || value === "capability-ready" || value === "unauthenticated" || value === "rate-limited" || value === "cancelled" || value === "gate-0-failed" || value === "gate-failed" || value === "unsupported-video" || value === "protocol-drift";
}
function isCredentialState(value) {
  return value === "logged-out" || value === "logged-in" || value === "refreshing" || value === "refresh-failed" || value === "re-login-required";
}
function isCredentialErrorCode(value) {
  return value === "invalid-grant" || value === "network" || value === "timeout" || value === "rate-limited" || value === "server-error" || value === "http-error" || value === "invalid-response" || value === "conflict" || value === "storage" || value === "cancelled";
}
function isRevokeState(value) {
  return value === "idle" || value === "pending" || value === "confirmation-required" || value === "revoked" || value === "logged-out" || value === "failed" || value === "superseded";
}
function isRevokeErrorCode(value) {
  return value === "network" || value === "timeout" || value === "rate-limited" || value === "server-error" || value === "http-error" || value === "invalid-response" || value === "storage";
}
function hasAllowedKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function hasExactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}
function invalidResponse(endpoint) {
  return {
    ok: false,
    error: {
      code: "internal",
      message: `antigravity-auth: invalid ${endpoint} response from Host`,
      details: {}
    }
  };
}
function isRecord9(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// work/dsh-runtime/dsh-antigravity-auth/src/rpc.ts
async function handleAntigravityAuthRpc(service, endpoint, payload, signal, modelCatalog) {
  if (signal?.aborted === true) return cancelled2();
  try {
    if (endpoint === "status") {
      if (!isEmptyRecord(payload)) return badRequest("status expects an empty payload");
      return { ok: true, value: { status: await service.status() } };
    }
    if (endpoint === "models") {
      if (!isRefreshPayload(payload)) return badRequest("models expects {} or { force: boolean }");
      if (modelCatalog === void 0) return badRequest("model catalog is unavailable");
      const status = await service.status();
      const gateReady = status.login.projectAvailable && status.capabilities.some((capability) => capability.id === "auth-llm" && capability.state === "available");
      return { ok: true, value: gateReady ? await modelCatalog.modelCatalog(signal, payload.force) : modelCatalog.catalogSnapshot() };
    }
    if (endpoint === "usage") {
      if (!isRefreshPayload(payload)) return badRequest("usage expects {} or { force: boolean }");
      if (service.usage === void 0) return { ok: true, value: { state: "protocol-drift" } };
      return { ok: true, value: await service.usage(signal, payload.force) };
    }
    if (endpoint === "acknowledge-risk") {
      if (!isAcknowledgement(payload)) return badRequest("acknowledge-risk expects { acknowledge: true }");
      return { ok: true, value: await service.acknowledgeRisk() };
    }
    if (endpoint === "login") {
      if (!isEmptyRecord(payload)) return badRequest("login expects an empty payload");
      return { ok: true, value: await service.startLogin() };
    }
    if (endpoint === "cancel" || endpoint === "cancel-login") {
      if (!isEmptyRecord(payload)) return badRequest("cancel expects an empty payload");
      return { ok: true, value: await service.cancelLogin() };
    }
    if (endpoint === "logout") {
      if (!isEmptyRecord(payload)) return badRequest("logout expects an empty payload");
      return { ok: true, value: await service.logout() };
    }
    if (endpoint === "revoke") {
      if (!isRevokePayload(payload)) return badRequest("revoke expects { confirmed: true }");
      return { ok: true, value: await service.revoke(true, signal) };
    }
    return badRequest("unknown Antigravity auth endpoint");
  } catch (error) {
    return safeFailure(error);
  }
}
function badRequest(message) {
  return { ok: false, error: { code: "bad-request", message, details: { issues: [] } } };
}
function cancelled2() {
  return { ok: false, error: { code: "cancelled", message: "antigravity-auth: request cancelled", details: {} } };
}
function safeFailure(error) {
  const credentialError = error instanceof CredentialOperationError ? error : void 0;
  const candidate = error instanceof OAuthFlowError ? error.code : credentialError?.code ?? "internal";
  const code = isSafeRpcErrorCode(candidate) ? candidate : "internal";
  return {
    ok: false,
    error: {
      code,
      message: credentialError === void 0 ? safeRpcErrorMessage(code) : credentialErrorMessage(credentialError.code) ?? safeRpcErrorMessage(code),
      details: {}
    }
  };
}
function isEmptyRecord(value) {
  return isRecord10(value) && Object.keys(value).length === 0;
}
function isRefreshPayload(value) {
  return isRecord10(value) && Object.keys(value).every((key) => key === "force") && (value.force === void 0 || typeof value.force === "boolean");
}
function isAcknowledgement(value) {
  return isRecord10(value) && Object.keys(value).length === 1 && value.acknowledge === true;
}
function isRevokePayload(value) {
  return isRecord10(value) && Object.keys(value).length === 1 && value.confirmed === true;
}
function isRecord10(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// work/dsh-runtime/dsh-antigravity-auth/src/index.ts
init_capability_lifecycle();
init_auth_service();
init_credential_coordinator();
init_status();
init_project_context();
init_wire_identity();
init_llm_adapter();
init_private_transport();
init_replay();
init_quota();
init_account_store();
init_media_admission();
init_capability_gates();

// work/dsh-runtime/dsh-antigravity-auth/src/live-gates.ts
init_status();
var LIVE_ACKNOWLEDGEMENT = "I_ACKNOWLEDGE_UNOFFICIAL_ANTIGRAVITY_PRIVATE_ENDPOINT_RISK";
var LIVE_GATE_IDS = ["A", "0L", "S", "I", "V"];
async function runLiveGateCli(argv, env = process.env, dependencies = {}) {
  const output = dependencies.output ?? ((line) => {
    process.stdout.write(`${line}
`);
  });
  const error = dependencies.error ?? ((line) => {
    process.stderr.write(`${line}
`);
  });
  const parsed = parseArguments(argv);
  if (parsed.error !== void 0) {
    error(parsed.error);
    return 2;
  }
  if (!parsed.acknowledged || env.DSH_ANTIGRAVITY_LIVE_ACK !== LIVE_ACKNOWLEDGEMENT) {
    error("Live gates require explicit acknowledgement via both --acknowledge-private-risk and DSH_ANTIGRAVITY_LIVE_ACK.");
    return 2;
  }
  const createRunner = dependencies.createRunner ?? (async () => {
    const module = await Promise.resolve().then(() => (init_live_gate_runner(), live_gate_runner_exports));
    return module.createProductionLiveGateRunner({ output });
  });
  let runner;
  try {
    runner = await createRunner();
    const result2 = await runner.run(parsed.gate, parsed.options);
    output(JSON.stringify(result2));
    return result2.outcome === "passed" ? 0 : 1;
  } catch {
    error("The selected Antigravity live gate failed safely.");
    return 1;
  } finally {
    await runner?.dispose().catch(() => {
    });
  }
}
function parseArguments(argv) {
  let acknowledged = false;
  let gate;
  let videoFile;
  let llmFamily;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--acknowledge-private-risk") {
      if (acknowledged) return { error: "The acknowledgement flag may be supplied only once." };
      acknowledged = true;
      continue;
    }
    if (value === "--gate") {
      if (gate !== void 0) return { error: "Select exactly one live gate per invocation." };
      const candidate = argv[index + 1];
      if (candidate === void 0 || !LIVE_GATE_IDS.includes(candidate)) return { error: "Select one live gate: A, 0L, S, I, or V." };
      gate = candidate;
      index += 1;
      continue;
    }
    if (value === "--family") {
      if (llmFamily !== void 0) return { error: "The LLM family may be supplied only once." };
      const candidate = argv[index + 1];
      if (candidate === void 0 || !LLM_FAMILY_IDS.includes(candidate)) {
        return { error: "Select one LLM family: gemini, claude, or gpt-oss." };
      }
      llmFamily = candidate;
      index += 1;
      continue;
    }
    if (value === "--video-file") {
      if (videoFile !== void 0) return { error: "The video fixture may be supplied only once." };
      const candidate = argv[index + 1];
      if (candidate === void 0 || candidate.length === 0 || candidate.length > 4096) return { error: "Gate V requires a bounded video fixture path." };
      videoFile = candidate;
      index += 1;
      continue;
    }
    return { error: "The live gate arguments are invalid." };
  }
  if (gate === void 0) return { error: "Select exactly one live gate per invocation." };
  if (gate === "V" && videoFile === void 0) return { error: "Gate V requires --video-file." };
  if (gate !== "V" && videoFile !== void 0) return { error: "--video-file is valid only for Gate V." };
  if (gate !== "0L" && llmFamily !== void 0) return { error: "--family is valid only for Gate 0/L." };
  return {
    acknowledged,
    gate,
    options: {
      ...videoFile === void 0 ? {} : { videoFile },
      ...llmFamily === void 0 ? {} : { llmFamily }
    }
  };
}

// work/dsh-runtime/dsh-antigravity-auth/src/index.ts
var name = "antigravity-auth";
var inject = ["llm", "attachments"];
function apply(ctx) {
  const service = createAntigravityAuthService({
    storePath: defaultAuthStorePath(),
    autoActivateGates: true,
    fetchEmail: fetchUserEmail
  });
  let accountMode = "enabled";
  const runtime = ctx;
  const adapter = new AntigravityAdapter({
    auth: service,
    ...runtime.attachments === void 0 ? {} : { attachments: runtime.attachments }
  });
  const contextWithProvide = ctx;
  const unprovide = contextWithProvide.provide?.("antigravityAuth", service) ?? (() => {
  });
  ctx.inject(["connection"], (connectionCtx) => {
    const webServer = connectionCtx.get("webServer");
    accountMode = commandAccountMode(webServer);
    const guard = createLoopbackRpcGuard(
      webServer?.host,
      (endpoint, payload, signal) => handleAntigravityAuthRpc(service, endpoint, payload, signal, adapter)
    );
    if (guard.mode === "blocked") {
      connectionCtx.logger.warn("antigravity-auth: account RPC is disabled because the WebServer is not loopback-bound");
    }
    return registerAccountRoutes(connectionCtx.connection, ANTIGRAVITY_AUTH_RPC_NAMESPACE, ["status", "models", "usage", "acknowledge-risk", "login", "cancel", "cancel-login", "logout", "revoke"], guard.handler);
  });
  mountCapabilityLifecycle({
    ctx,
    auth: service,
    id: "auth-llm",
    enabled: () => runtime.llm?.registerAdapter !== void 0,
    register: () => {
      if (runtime.llm?.registerAdapter === void 0) return void 0;
      if (runtime.llm.listProviders?.().some((provider) => provider.id === ANTIGRAVITY_PROVIDER)) return void 0;
      const dispose = runtime.llm.registerAdapter([ANTIGRAVITY_PROVIDER], adapter);
      return () => {
        try {
          dispose();
        } finally {
          adapter.invalidateModelCatalog();
        }
      };
    },
    ownsAuth: true,
    cleanup: unprovide,
    label: "antigravity-auth: OAuth and LLM operations"
  });
  ctx.inject(["commands"], (commandCtx) => {
    const mainCommand = createAntigravityAuthCommand(service, () => accountMode);
    commandCtx.commands.register(mainCommand);
    commandCtx.commands.register({
      ...mainCommand,
      name: "anti",
      description: "Antigravity OAuth \u591A\u8D26\u53F7\u7BA1\u7406\u4E0E\u5207\u6362 (/anti accounts | switch | login)"
    });
  });
}
export {
  ACCOUNTS_RECORD_VERSION,
  AGY_PROVIDER_USER_AGENT,
  ANTIGRAVITY_AUTH_RPC_CHANNEL,
  ANTIGRAVITY_AUTH_RPC_NAMESPACE,
  ANTIGRAVITY_AVAILABLE_MODELS_ENDPOINT,
  ANTIGRAVITY_GENERATE_ENDPOINT,
  ANTIGRAVITY_LLM_ROUTE,
  ANTIGRAVITY_MODEL_CATALOG_STATES,
  ANTIGRAVITY_PLUGIN_ID,
  ANTIGRAVITY_PROVIDER,
  ANTIGRAVITY_QUOTA_ENDPOINT,
  ANTIGRAVITY_REPLAY_VERSION,
  ANTIGRAVITY_REVOKE_ENDPOINT,
  ANTIGRAVITY_STREAM_ENDPOINT,
  ANTIGRAVITY_TOKEN_ENDPOINT,
  ANTIGRAVITY_WIRE_ORIGIN,
  ANTIGRAVITY_WIRE_ORIGINS,
  ANTIGRAVITY_WIRE_PATHS,
  AntigravityAdapter,
  AntigravityAuthService,
  CAPABILITY_GATE_OUTCOMES,
  CAPABILITY_ROW_IDS,
  CredentialOperationError,
  DEFAULT_INLINE_IMAGE_BYTES,
  DEFAULT_PRIVATE_FRAME_BYTES,
  DEFAULT_PRIVATE_IDLE_TIMEOUT_MS,
  DEFAULT_PRIVATE_REQUEST_BYTES,
  DEFAULT_PRIVATE_RESPONSE_BYTES,
  DEFAULT_PRIVATE_RESPONSE_HEADER_TIMEOUT_MS,
  DEFAULT_PRIVATE_TOTAL_TIMEOUT_MS,
  DEFAULT_VIDEO_BYTES,
  DSH_ATTRIBUTION_HEADER,
  IMAGE_HANDLE_PATTERN,
  LIVE_ACKNOWLEDGEMENT,
  LIVE_GATE_IDS,
  LLM_FAMILY_IDS,
  MAX_PRIVATE_REQUEST_BYTES,
  MediaAdmissionError,
  PROJECT_DISCOVERY_ENDPOINT,
  PROJECT_DISCOVERY_PATH,
  PrivateTransportError,
  ProjectDiscoveryError,
  QUOTA_REFRESH_MIN_INTERVAL_MS,
  QuotaNormalizationError,
  USERINFO_ENDPOINT,
  WireIdentityError,
  admitBase64Image,
  admitImageBytes,
  admitSessionImage,
  admitWorkspaceImage,
  admitWorkspaceVideo,
  antigravityModelFamily,
  apply,
  assertPrivateEndpoint,
  assertWireIdentityInvariant,
  buildAntigravityGeneratePayload,
  buildFunctionDeclarations,
  buildWireIdentityHeaders,
  compatibleReplayState,
  createAccountStore,
  createAntigravityAuthRpcClient,
  createAntigravityAuthService,
  createCredentialCoordinator,
  createFileCapabilityGates,
  createGoogleRefreshTransport,
  createGoogleRevokeTransport,
  createMemoryAccountStore,
  createMemoryCapabilityGates,
  createPrivateTransport,
  createProjectContext,
  createProjectDiscovery,
  createQuotaService,
  createReplayState,
  createStatusView,
  createWireIdentity,
  credentialErrorMessage,
  defaultAccountStorePath,
  defaultCapabilityGatePath,
  detectImageMediaType,
  fetchUserEmail,
  findMatchingAccount,
  imageHandle,
  inject,
  isMp4,
  iteratePrivateSse,
  maskEmail,
  name,
  nextAccountId,
  normalizeProjectId,
  normalizeQuotaResponse,
  parseModelCatalogResult,
  parseStatusResult,
  parseUsageResult,
  privateStatusError,
  readPrivateBytes,
  readPrivateText,
  runLiveGateCli,
  sanitizeToolSchemas,
  sessionImageCatalog
};
