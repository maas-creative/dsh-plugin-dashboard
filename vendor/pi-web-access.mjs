// Adapted web execution belongs to Scrum; see pi-web-access-provenance.json.
// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/tools.ts
import { homedir } from "node:os";
import { join as join2 } from "node:path";
import { Type } from "typebox";

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/cache.ts
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/constants.ts
var MAX_INLINE_CHARS = 3e4;
var MAX_FETCH_BYTES = 2e6;
var MAX_SEARCH_BODY_BYTES = 2e6;
var MAX_REDIRECTS = 10;
var MAX_QUERIES = 4;
var MAX_URLS = 20;
var MAX_DOMAIN_FILTERS = 20;
var MAX_QUERY_CHARS = 500;
var MAX_URL_CHARS = 2048;
var FETCH_TIMEOUT_MS = 3e4;
var SEARCH_TIMEOUT_MS = 3e4;
var CACHE_TTL_MS = 60 * 60 * 1e3;
var CACHE_MAX_ENTRIES = 128;
var CACHE_MAX_BYTES = 128 * 1024 * 1024;
var FIND_MAX_CHARS = 2e4;
var CONCURRENT_FETCHES = 3;
var USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0";
var EXA_MCP_URL = "https://mcp.exa.ai/mcp";
var DDG_SEARCH_URL = "https://html.duckduckgo.com/html/";

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/cache.ts
var DEFAULT_LIMITS = {
  ttlMs: CACHE_TTL_MS,
  maxEntries: CACHE_MAX_ENTRIES,
  maxBytes: CACHE_MAX_BYTES
};
function createCache(dir, limits = {}) {
  const resolved = { ...DEFAULT_LIMITS, ...limits };
  ensureDir(dir);
  function store(partial) {
    ensureDir(dir);
    prune();
    const record = {
      id: partial.id ?? randomUUID(),
      createdAt: partial.createdAt ?? Date.now(),
      kind: partial.kind,
      queries: partial.queries,
      pages: partial.pages
    };
    const path = fileFor(record.id);
    const body = JSON.stringify(record);
    writeFileSync(path, body, { encoding: "utf8", mode: 384 });
    chmodSync(path, 384);
    prune();
    return record;
  }
  function get(id) {
    prune();
    if (!isSafeId(id)) return void 0;
    const path = fileFor(id);
    let raw;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      return void 0;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || parsed.id !== id) return void 0;
      if (Date.now() - parsed.createdAt > resolved.ttlMs) {
        rmSync(path, { force: true });
        return void 0;
      }
      return parsed;
    } catch {
      return void 0;
    }
  }
  function prune() {
    const entries = listEntries().sort((a, b) => a.createdAt - b.createdAt);
    const now = Date.now();
    let bytes = 0;
    const keep = [];
    for (const entry of entries) {
      if (now - entry.createdAt > resolved.ttlMs) {
        rmSync(entry.path, { force: true });
        continue;
      }
      keep.push(entry);
      bytes += entry.bytes;
    }
    while (keep.length > resolved.maxEntries || bytes > resolved.maxBytes) {
      const oldest = keep.shift();
      if (!oldest) break;
      rmSync(oldest.path, { force: true });
      bytes -= oldest.bytes;
    }
  }
  function fileFor(id) {
    if (!isSafeId(id)) throw new Error(`Invalid cache id: ${id}`);
    return join(dir, `${id}.json`);
  }
  prune();
  function listEntries() {
    let names;
    try {
      names = readdirSync(dir);
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -5);
      if (!isSafeId(id)) continue;
      const path = join(dir, name);
      try {
        const stat = statSync(path);
        out.push({ id, path, createdAt: stat.mtimeMs, bytes: stat.size });
      } catch {
      }
    }
    return out;
  }
  return { dir, store, get, prune };
}
function isSafeId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}
function sliceText(text, offset = 0, limit = MAX_INLINE_CHARS) {
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INLINE_CHARS) {
    throw new Error(`limit must be an integer from 1 to ${MAX_INLINE_CHARS}`);
  }
  if (offset > text.length) throw new Error(`offset ${offset} is out of range (0-${text.length})`);
  const end = Math.min(offset + limit, text.length);
  return {
    text: text.slice(offset, end),
    offset,
    limit,
    contentLength: text.length,
    nextOffset: end < text.length ? end : null,
    truncated: end < text.length
  };
}
function findPassages(text, needles, mode = "case-insensitive") {
  const matches = [];
  let remaining = FIND_MAX_CHARS;
  for (const needle of needles) {
    if (!needle) continue;
    const found = locate(text, needle, mode);
    if (found.length === 0) {
      const line = `No matches for ${JSON.stringify(needle)}`;
      if (line.length <= remaining) {
        matches.push(line);
        remaining -= line.length;
      }
      continue;
    }
    for (const hit of found) {
      const line = `match ${JSON.stringify(needle)} @${hit.index}: ${hit.context}`;
      if (line.length > remaining) {
        matches.push("\u2026 find output truncated");
        remaining = 0;
        break;
      }
      matches.push(line);
      remaining -= line.length + 1;
    }
    if (remaining <= 0) break;
  }
  return matches.join("\n") || "No matches";
}
function selectStoredText(record, options) {
  if (options.url !== void 0 || options.urlIndex !== void 0) {
    const page = pickPage(record.pages, options.url, options.urlIndex);
    return { label: page.finalUrl || page.url, text: page.content || page.error || "" };
  }
  if (options.query !== void 0 || options.queryIndex !== void 0) {
    const query = pickQuery(record.queries, options.query, options.queryIndex);
    return { label: query.query, text: formatQuery(query) };
  }
  if (record.pages.length === 1) {
    const page = record.pages[0];
    return { label: page.finalUrl || page.url, text: page.content || page.error || "" };
  }
  const listing = [
    `kind: ${record.kind}`,
    `queries (${record.queries.length}):`,
    ...record.queries.map((query, index) => `  [${index}] ${query.query} (${query.hits.length} hits${query.error ? `; error: ${query.error}` : ""})`),
    `pages (${record.pages.length}):`,
    ...record.pages.map((page, index) => `  [${index}] ${page.finalUrl || page.url}${page.error ? ` error=${page.error}` : ` chars=${page.content.length}`}`),
    "Pass urlIndex or queryIndex to get_search_content."
  ].join("\n");
  return { label: record.id, text: listing };
}
function formatQuery(query) {
  const lines = [`# ${query.query}`, `provider: ${query.provider}`];
  if (query.error) lines.push(`error: ${query.error}`);
  if (query.answer) lines.push("", query.answer);
  if (query.hits.length > 0) {
    lines.push("", "Sources:");
    for (const [index, hit] of query.hits.entries()) {
      lines.push(`${index + 1}. ${hit.title} \u2014 ${hit.url}`);
      if (hit.snippet) lines.push(`   ${hit.snippet}`);
    }
  }
  return lines.join("\n");
}
function formatRecordForModel(record, inlineLimit = MAX_INLINE_CHARS) {
  const parts = [`responseId: ${record.id}`];
  for (const query of record.queries) parts.push(formatQuery(query));
  for (const page of record.pages) {
    const body = page.error || page.content;
    parts.push(`# ${page.title || page.url}
URL: ${page.finalUrl || page.url}

${body}`);
  }
  const joined = parts.join("\n\n");
  if (joined.length <= inlineLimit) return joined;
  const marker = `

[truncated; get_search_content responseId=${record.id}]`;
  return `${joined.slice(0, inlineLimit)}${marker}`;
}
function pickPage(pages, url, urlIndex) {
  if (urlIndex !== void 0) {
    if (!Number.isInteger(urlIndex) || urlIndex < 0 || urlIndex >= pages.length) {
      throw new Error(`urlIndex ${urlIndex} is out of range (0-${Math.max(pages.length - 1, 0)})`);
    }
    return pages[urlIndex];
  }
  const match = pages.find((page) => page.url === url || page.finalUrl === url);
  if (!match) throw new Error(`No stored page for url ${url}`);
  return match;
}
function pickQuery(queries, query, queryIndex) {
  if (queryIndex !== void 0) {
    if (!Number.isInteger(queryIndex) || queryIndex < 0 || queryIndex >= queries.length) {
      throw new Error(`queryIndex ${queryIndex} is out of range (0-${Math.max(queries.length - 1, 0)})`);
    }
    return queries[queryIndex];
  }
  const match = queries.find((item) => item.query === query);
  if (!match) throw new Error(`No stored query ${JSON.stringify(query)}`);
  return match;
}
function locate(text, needle, mode) {
  const hits = [];
  const folded = mode === "exact" ? text : text.toLowerCase();
  const foldMap = [];
  if (folded.length !== text.length) {
    let offset = 0;
    for (const char of text) {
      for (let j = 0; j < char.toLowerCase().length; j++) foldMap.push(offset + Math.min(j, char.length - 1));
      offset += char.length;
    }
  }
  const normalized = mode === "fuzzy" ? collapseWithMap(folded) : void 0;
  const hay = normalized?.text ?? folded;
  const find = mode === "fuzzy" ? collapse(needle.toLowerCase()) : mode === "exact" ? needle : needle.toLowerCase();
  let from = 0;
  while (from < hay.length) {
    const index = hay.indexOf(find, from);
    if (index < 0) break;
    const start = normalized?.map[index] ?? index;
    const end = normalized?.map[index + find.length - 1] ?? index + find.length - 1;
    const originalIndex = foldMap[start] ?? start;
    const originalEnd = foldMap[end] ?? end;
    hits.push({ index: originalIndex, context: contextAround(text, originalIndex, originalEnd - originalIndex + 1) });
    from = index + Math.max(find.length, 1);
    if (hits.length >= 20) break;
  }
  return hits;
}
function collapse(value) {
  return collapseWithMap(value).text;
}
function collapseWithMap(value) {
  const chars = [];
  const map = [];
  let prevSpace = false;
  for (let i = 0; i < value.length; i++) {
    const space = /\s/.test(value[i]);
    if (space) {
      if (!prevSpace && chars.length > 0) {
        chars.push(" ");
        map.push(i);
      }
      prevSpace = true;
      continue;
    }
    chars.push(value[i]);
    map.push(i);
    prevSpace = false;
  }
  return { text: chars.join(""), map };
}
function contextAround(text, index, length) {
  const start = Math.max(0, index - 80);
  const end = Math.min(text.length, index + length + 80);
  return `${start > 0 ? "\u2026" : ""}${text.slice(start, end).replace(/\s+/g, " ")}${end < text.length ? "\u2026" : ""}`;
}
function ensureDir(dir) {
  mkdirSync(dir, { recursive: true, mode: 448 });
  chmodSync(dir, 448);
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/html.ts
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
var turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-"
});
function htmlToReadable(html, url) {
  const { document } = parseHTML(html);
  let base = url;
  try {
    base = new URL(document.querySelector("base[href]")?.getAttribute("href") ?? url, url).href;
  } catch {
  }
  for (const [selector, attribute] of [["a[href],area[href]", "href"], ["img[src],source[src]", "src"]]) {
    for (const element of document.querySelectorAll(selector)) {
      const value = element.getAttribute(attribute);
      if (!value || value.startsWith("#")) continue;
      try {
        element.setAttribute(attribute, new URL(value, base).href);
      } catch {
      }
    }
  }
  let article = null;
  try {
    article = new Readability(document, { charThreshold: 80 }).parse();
  } catch {
    article = null;
  }
  const title = article?.title?.trim() || document.querySelector("title")?.textContent?.trim() || url;
  const contentHtml = article?.content || document.body?.innerHTML || html;
  const content = turndown.turndown(contentHtml).trim();
  return { title, content };
}
function decodeDdgUrl(href) {
  try {
    const link = new URL(href, DDG_SEARCH_URL);
    const destination = link.searchParams.get("uddg") ?? link.href;
    const url = new URL(destination);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
function parseDdgHtml(html) {
  const { document } = parseHTML(html);
  const hits = [];
  for (const container of document.querySelectorAll(".result")) {
    if (container.classList.contains("result--ad")) continue;
    const anchor = container.querySelector(".result__a");
    const title = anchor?.textContent?.trim() ?? "";
    const href = anchor?.getAttribute("href")?.trim() ?? "";
    const url = href ? decodeDdgUrl(href) : null;
    if (!title || !url) continue;
    const snippet = container.querySelector(".result__snippet")?.textContent?.trim() ?? "";
    hits.push({ title, url, snippet });
  }
  return hits;
}
function parseExaMcpBody(body) {
  const events = body.replace(/\r\n?/g, "\n").split("\n\n").map((event) => event.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n")).filter(Boolean);
  let sawContent = false;
  for (const payload of events.length > 0 ? events : [body]) {
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    if (parsed.error) throw new Error(parsed.error.message || "Exa MCP error");
    const result = parsed.result;
    const texts = Array.isArray(result?.content) ? result.content.filter((item) => item?.type === "text" && typeof item.text === "string").map((item) => item.text.trim()).filter(Boolean) : [];
    if (result?.isError) throw new Error(texts.join("\n") || "Exa MCP returned an error");
    if (texts.length === 0) continue;
    sawContent = true;
    const parsedBlocks = texts.map(parseExaText).filter((hits) => hits !== void 0);
    if (parsedBlocks.length > 0) return parsedBlocks.flat();
  }
  throw new Error(sawContent ? "Exa MCP returned no parseable results" : "Exa MCP returned empty content");
}
function parseExaText(payloadText) {
  try {
    const json = JSON.parse(payloadText);
    if (Array.isArray(json?.results)) {
      return json.results.flatMap((result) => {
        const url = httpUrl(result?.url);
        return url ? [{
          title: typeof result?.title === "string" ? result.title.trim() || url : url,
          url,
          snippet: snippetFromExa(result?.text, result?.highlights)
        }] : [];
      });
    }
  } catch {
  }
  const blocks = payloadText.split(/(?=^Title: )/m).filter((block) => block.trim().length > 0);
  const hits = [];
  for (const block of blocks) {
    const title = block.match(/^Title: (.+)/m)?.[1]?.trim() ?? "";
    const url = httpUrl(block.match(/^URL: (.+)/m)?.[1]);
    if (!url) continue;
    let snippet = "";
    const textStart = block.indexOf("\nText: ");
    if (textStart >= 0) snippet = block.slice(textStart + 7).replace(/\n---\s*$/, "").trim();
    hits.push({ title: title || url, url, snippet: snippet.replace(/\s+/g, " ").trim().slice(0, 500) });
  }
  return hits.length > 0 ? hits : void 0;
}
function httpUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value.trim() : null;
  } catch {
    return null;
  }
}
function snippetFromExa(text, highlights) {
  if (typeof text === "string" && text.trim()) return text.replace(/\s+/g, " ").trim().slice(0, 500);
  if (Array.isArray(highlights)) {
    const parts = highlights.filter((item) => typeof item === "string");
    if (parts.length > 0) return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 500);
  }
  return "";
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/network/transport.ts
import http from "node:http";
import https from "node:https";
import net2 from "node:net";
import { addAbortSignal, pipeline, Readable } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/network/policy.ts
import { lookup as dnsLookup } from "node:dns/promises";
import net from "node:net";
var METADATA_HOSTS = /* @__PURE__ */ new Set(["metadata.google.internal", "metadata.internal", "metadata"]);
function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}
function looksLikeNonCanonicalIp(hostname) {
  return /^(?:\d+|0x[0-9a-f]+)(?:\.(?:\d+|0x[0-9a-f]+)){0,3}$/i.test(hostname);
}
function ipv4ToInt(parts) {
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}
function inCidr(ip, baseParts, bits) {
  const base = ipv4ToInt(baseParts);
  const mask = bits === 0 ? 0 : 4294967295 << 32 - bits >>> 0;
  return (ip & mask) === (base & mask);
}
function isBlockedIPv4(address) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const ip = ipv4ToInt(parts);
  return inCidr(ip, [0, 0, 0, 0], 8) || inCidr(ip, [10, 0, 0, 0], 8) || inCidr(ip, [100, 64, 0, 0], 10) || inCidr(ip, [127, 0, 0, 0], 8) || inCidr(ip, [169, 254, 0, 0], 16) || inCidr(ip, [172, 16, 0, 0], 12) || inCidr(ip, [192, 0, 0, 0], 24) || inCidr(ip, [192, 0, 2, 0], 24) || inCidr(ip, [192, 88, 99, 0], 24) || inCidr(ip, [192, 168, 0, 0], 16) || inCidr(ip, [198, 18, 0, 0], 15) || inCidr(ip, [198, 51, 100, 0], 24) || inCidr(ip, [203, 0, 113, 0], 24) || inCidr(ip, [224, 0, 0, 0], 4) || inCidr(ip, [240, 0, 0, 0], 4);
}
function parseIPv6(address) {
  let input = address;
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const ipv4 = input.slice(lastColon + 1);
    if (net.isIP(ipv4) !== 4) return null;
    const octets = ipv4.split(".").map((part) => Number(part));
    input = `${input.slice(0, lastColon)}:${(octets[0] << 8 | octets[1]).toString(16)}:${(octets[2] << 8 | octets[3]).toString(16)}`;
  }
  const pieces = input.split("::");
  if (pieces.length > 2) return null;
  const left = pieces[0] ? pieces[0].split(":") : [];
  const right = pieces.length === 2 && pieces[1] ? pieces[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (pieces.length === 1 && missing !== 0) return null;
  if (pieces.length === 2 && missing < 0) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((part) => {
    if (!/^[0-9a-f]{1,4}$/i.test(part)) return -1;
    return parseInt(part, 16);
  });
  return groups.length === 8 && groups.every((group) => group >= 0 && group <= 65535) ? groups : null;
}
function ipv4FromGroups(hi, lo) {
  return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
}
function isBlockedIPv6(address) {
  const groups = parseIPv6(address);
  if (!groups) return true;
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true;
  if ((groups[0] & 65024) === 64512) return true;
  if ((groups[0] & 65472) === 65152) return true;
  if ((groups[0] & 65472) === 65216) return true;
  if ((groups[0] & 65280) === 65280) return true;
  if (groups[0] === 8193 && groups[1] === 3512) return true;
  if (groups[0] === 8193 && groups[1] === 2 && groups[2] === 0) return true;
  if (groups[0] === 8193 && groups[1] === 0) return true;
  if (groups[0] === 256 && groups[1] === 0) return true;
  if (groups[0] === 16383 && (groups[1] & 61440) === 0) return true;
  if (groups[0] === 24320) return true;
  if (groups[0] === 100 && groups[1] === 65435) return true;
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 65535;
  if (mapped) return isBlockedIPv4(ipv4FromGroups(groups[6], groups[7]));
  const translatable = groups.slice(0, 4).every((group) => group === 0) && groups[4] === 65535 && groups[5] === 0;
  if (translatable) return true;
  if (groups.slice(0, 6).every((group) => group === 0)) return isBlockedIPv4(ipv4FromGroups(groups[6], groups[7]));
  if (groups[0] === 8194) return isBlockedIPv4(ipv4FromGroups(groups[1], groups[2]));
  return false;
}
function isBlockedAddress(address) {
  const normalized = normalizeHostname(address);
  const version = net.isIP(normalized);
  if (version === 4) return isBlockedIPv4(normalized);
  if (version === 6) return isBlockedIPv6(normalized);
  return true;
}
async function resolvePinnedTarget(rawUrl, options = {}) {
  options.signal?.throwIfAborted();
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${String(rawUrl)}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS URLs can be fetched");
  }
  if (url.username || url.password) {
    throw new Error("URLs with credentials are blocked");
  }
  const hostname = normalizeHostname(url.hostname);
  if (!hostname) throw new Error("URL must include a hostname");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || METADATA_HOSTS.has(hostname)) {
    throw new Error(`Blocked internal hostname: ${hostname}`);
  }
  if (looksLikeNonCanonicalIp(hostname) && net.isIP(hostname) !== 4) {
    throw new Error(`Blocked non-canonical IP hostname: ${hostname}`);
  }
  const family = net.isIP(hostname);
  if (family) {
    if (isBlockedAddress(hostname)) throw new Error(`Blocked internal address: ${hostname}`);
    return { url, address: { address: hostname, family } };
  }
  let addresses;
  try {
    addresses = await withAbort(
      () => (options.lookup ?? ((host) => dnsLookup(host, { all: true, verbatim: true })))(hostname),
      options.signal
    );
  } catch (err) {
    options.signal?.throwIfAborted();
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to resolve ${hostname}: ${message}`);
  }
  if (addresses.length === 0) throw new Error(`Failed to resolve ${hostname}: no addresses returned`);
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) throw new Error(`Blocked internal address for ${hostname}: ${address}`);
  }
  return { url, address: addresses[0] };
}
async function withAbort(operation, signal) {
  signal?.throwIfAborted();
  if (!signal) return operation();
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return operation();
      }),
      aborted
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/network/transport.ts
var NULL_BODY_STATUSES = /* @__PURE__ */ new Set([204, 205, 304]);
function pinnedConnectOptions(url, address) {
  const isHttps = url.protocol === "https:";
  return {
    protocol: url.protocol,
    hostname: address.address,
    port: url.port ? Number(url.port) : isHttps ? 443 : 80,
    path: `${url.pathname}${url.search}`,
    family: address.family === 6 ? 6 : 4,
    servername: isHttps && !net2.isIP(normalizeHostname(url.hostname)) ? normalizeHostname(url.hostname) : void 0,
    headers: { host: url.host }
  };
}
async function cancelBody(response) {
  try {
    await response.body?.cancel();
  } catch {
  }
}
function responseBody(res, headers, signal) {
  const encodings = (headers.get("content-encoding") ?? "").toLowerCase().split(",").map((item) => item.trim()).filter((item) => item && item !== "identity");
  if (encodings.length > 3) throw new Error("Too many content encodings (max 3)");
  for (const encoding of encodings) {
    if (!["gzip", "deflate", "br"].includes(encoding)) throw new Error(`Unsupported content encoding: ${encoding}`);
  }
  let stream = res;
  if (encodings.length > 0) {
    const decoders = encodings.reverse().map((encoding) => encoding === "gzip" ? createGunzip() : encoding === "deflate" ? createInflate() : createBrotliDecompress());
    stream = decoders[decoders.length - 1];
    pipeline([res, ...decoders], () => {
    });
    headers.delete("content-encoding");
    headers.delete("content-length");
  }
  if (signal) addAbortSignal(signal, stream);
  return Readable.toWeb(stream, {
    strategy: { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength }
  });
}
async function pinnedFetch(url, address, init = {}) {
  init.signal?.throwIfAborted();
  const isHttps = url.protocol === "https:";
  const lib = isHttps ? https : http;
  const method = (init.method ?? "GET").toUpperCase();
  if (["CONNECT", "TRACE", "TRACK"].includes(method)) throw new Error(`Unsupported request method: ${method}`);
  const headers = new Headers(init.headers);
  headers.set("Host", url.host);
  if (!headers.has("accept-encoding")) headers.set("Accept-Encoding", "gzip, deflate, br");
  const outgoing = {};
  headers.forEach((value, key) => {
    outgoing[key] = value;
  });
  const connect = pinnedConnectOptions(url, address);
  return new Promise((resolve, reject) => {
    const req = lib.request({
      ...connect,
      method,
      headers: { ...connect.headers, ...outgoing },
      signal: init.signal ?? void 0
    }, (res) => {
      try {
        const status = res.statusCode;
        if (status === void 0 || !Number.isInteger(status) || status < 200 || status > 599) {
          throw new Error(`Unsupported HTTP status: ${status ?? "missing"}`);
        }
        const respHeaders = new Headers();
        for (const [key, value] of Object.entries(res.headersDistinct ?? res.headers)) {
          if (value === void 0) continue;
          const values = Array.isArray(value) ? value : [value];
          for (const item of values) {
            if (item !== void 0) respHeaders.append(key, item);
          }
        }
        const nullBody = method === "HEAD" || NULL_BODY_STATUSES.has(status);
        const response = new Response(nullBody ? null : responseBody(res, respHeaders, init.signal), {
          status,
          statusText: res.statusMessage ?? "",
          headers: respHeaders
        });
        if (nullBody) res.destroy();
        resolve(response);
      } catch (err) {
        res.destroy();
        req.destroy();
        reject(err);
      }
    });
    req.once("upgrade", (res, socket) => {
      socket.destroy();
      reject(new Error(`Unsupported HTTP upgrade (status ${res.statusCode ?? "missing"})`));
    });
    req.on("error", reject);
    const body = init.body;
    if (body == null) {
      req.end();
      return;
    }
    if (typeof body === "string" || body instanceof Uint8Array) {
      req.end(body);
      return;
    }
    req.destroy(new Error("Unsupported request body"));
  });
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/network/body.ts
async function readTextLimited(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await cancelBody(response);
    throw new Error(`Response too large (${declared} bytes)`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) throw new Error(`Response too large (>${maxBytes} bytes)`);
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  } catch (err) {
    try {
      await reader.cancel();
    } catch {
    }
    throw err;
  } finally {
    reader.releaseLock();
  }
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/network/fetch.ts
var REDIRECT_STATUSES = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
async function fetchRemoteUrl(url, init = {}, options = {}) {
  const fetchImpl = options.fetch;
  const pin = options.pinnedFetch ?? pinnedFetch;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const signal = init.signal ?? options.signal;
  const validateOptions = { ...options, signal };
  let current = await resolvePinnedTarget(url, validateOptions);
  let requestInit = { ...init, signal };
  for (let redirects = 0; redirects <= maxRedirects; redirects++) {
    signal?.throwIfAborted();
    const response = fetchImpl ? await fetchImpl(current.url, { ...requestInit, redirect: "manual" }) : await pin(current.url, current.address, { ...requestInit, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: current.url, address: current.address };
    const location = response.headers.get("location");
    if (!location) return { response, finalUrl: current.url, address: current.address };
    if (redirects === maxRedirects) {
      await cancelBody(response);
      throw new Error(`Too many redirects fetching ${current.url.toString()}`);
    }
    await cancelBody(response);
    const next = await resolvePinnedTarget(new URL(location, current.url), validateOptions);
    const headers = new Headers(requestInit.headers);
    headers.delete("host");
    if (next.url.origin !== current.url.origin) {
      for (const name of ["authorization", "proxy-authorization", "cookie", "cookie2"]) headers.delete(name);
    }
    const method = (requestInit.method ?? "GET").toUpperCase();
    if (response.status === 303 && method !== "GET" && method !== "HEAD" || (response.status === 301 || response.status === 302) && method === "POST") {
      const { body: _body, ...nextInit } = requestInit;
      requestInit = { ...nextInit, method: "GET" };
      for (const name of ["content-length", "content-type", "content-encoding", "content-language", "content-location", "transfer-encoding"]) headers.delete(name);
    }
    requestInit = { ...requestInit, headers };
    current = next;
  }
  throw new Error(`Too many redirects fetching ${current.url.toString()}`);
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/utils.ts
function normalizeList(single, multiple, label, maxLength, maxItems) {
  const raw = Array.isArray(multiple) ? multiple : single !== void 0 ? [single] : [];
  const out = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > maxLength) throw new Error(`${label} too long (max ${maxLength} characters)`);
    if (!out.includes(trimmed)) out.push(trimmed);
    if (out.length >= maxItems) break;
  }
  return out;
}
function withTimeout(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/pages.ts
var TEXT_TYPES = /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|xhtml\+xml))/i;
function normalizeUrls(url, urls) {
  return normalizeList(url, urls, "URL", MAX_URL_CHARS, MAX_URLS);
}
function normalizeMode(value) {
  if (value === void 0 || value === null || value === "readable") return "readable";
  if (value === "raw") return value;
  throw new Error(`Invalid mode ${JSON.stringify(value)}. Use readable or raw.`);
}
async function fetchPages(urls, options = {}) {
  options.signal?.throwIfAborted();
  return mapPool(urls, CONCURRENT_FETCHES, (url) => fetchPage(url, options));
}
async function fetchPage(url, options = {}) {
  const mode = options.mode ?? "readable";
  try {
    const { response, finalUrl } = await fetchRemoteUrl(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
        "User-Agent": USER_AGENT
      },
      signal: withTimeout(options.signal, FETCH_TIMEOUT_MS)
    }, {
      fetch: options.fetch,
      lookup: options.lookup
    });
    if (options.signal?.aborted) {
      await cancelBody(response);
      options.signal.throwIfAborted();
    }
    const contentType = response.headers.get("content-type") || "";
    const page = { url, finalUrl: finalUrl.toString(), title: "", content: "", contentType };
    if (!response.ok) {
      await cancelBody(response);
      options.signal?.throwIfAborted();
      return { ...page, error: `HTTP ${response.status} ${response.statusText}`.trim() };
    }
    if (isBinaryType(contentType)) {
      await cancelBody(response);
      options.signal?.throwIfAborted();
      return { ...page, error: `Unsupported content type: ${contentType || "unknown"}` };
    }
    const text = await readTextLimited(response, options.maxBytes ?? MAX_FETCH_BYTES);
    options.signal?.throwIfAborted();
    if (mode === "raw" || !isHtml(contentType, text)) {
      return { ...page, content: text };
    }
    const readable = htmlToReadable(text, page.finalUrl);
    return { ...page, title: readable.title, content: readable.content };
  } catch (err) {
    options.signal?.throwIfAborted();
    return {
      url,
      finalUrl: url,
      title: "",
      content: "",
      contentType: "",
      error: err instanceof Error ? err.message || err.name : String(err) || "Unknown error"
    };
  }
}
function isBinaryType(contentType) {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!type) return false;
  if (TEXT_TYPES.test(type)) return false;
  if (type === "application/octet-stream") return true;
  return type.startsWith("image/") || type.startsWith("audio/") || type.startsWith("video/") || type === "application/pdf";
}
function isHtml(contentType, body) {
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.includes("html")) return true;
  if (type && !type.startsWith("text/")) return false;
  return /<html[\s>]|<body[\s>]|<article[\s>]/i.test(body.slice(0, 4096));
}
async function mapPool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) || 0 }, () => worker()));
  return out;
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/search/filters.ts
function normalizeDomainFilters(domainFilter) {
  const filters = { allowed: [], blocked: [] };
  let count = 0;
  for (const raw of domainFilter ?? []) {
    if (count >= MAX_DOMAIN_FILTERS) break;
    const blocked = raw.trim().startsWith("-");
    const domain = normalizeDomain(blocked ? raw.trim().slice(1) : raw);
    if (!domain) continue;
    const target = blocked ? filters.blocked : filters.allowed;
    if (!target.includes(domain)) {
      target.push(domain);
      count += 1;
    }
  }
  return filters;
}
function matchesDomainFilters(url, filters) {
  let hostname;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return false;
  }
  if (filters.allowed.length > 0 && !filters.allowed.some((domain) => hostMatches(hostname, domain))) return false;
  return !filters.blocked.some((domain) => hostMatches(hostname, domain));
}
function applyDomainFilter(hits, domainFilter) {
  const filters = normalizeDomainFilters(domainFilter);
  return hits.filter((hit) => matchesDomainFilters(hit.url, filters));
}
function buildDomainQuery(query, domainFilter) {
  const { allowed, blocked } = normalizeDomainFilters(domainFilter);
  const parts = [query];
  if (allowed.length === 1) parts.push(`site:${allowed[0]}`);
  else if (allowed.length > 1) parts.push(`(${allowed.map((domain) => `site:${domain}`).join(" OR ")})`);
  parts.push(...blocked.map((domain) => `-site:${domain}`));
  return parts.join(" ");
}
function normalizeDomain(value) {
  let input = value.trim().toLowerCase();
  if (!input) return null;
  try {
    const parsed = input.includes("://") ? new URL(input) : new URL(`https://${input}`);
    input = parsed.hostname;
  } catch {
    input = input.split("/")[0]?.split(":")[0] ?? "";
  }
  input = input.replace(/^\.+|\.+$/g, "");
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(input) ? input : null;
}
function hostMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/search/shared.ts
function normalizeCount(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 5;
  return Math.max(1, Math.min(20, Math.floor(value)));
}
function hitsToAnswer(hits) {
  if (hits.length === 0) return "No results matched this query and its filters.";
  return hits.map((hit) => hit.snippet ? `${hit.snippet}
Source: ${hit.title} (${hit.url})` : `Source: ${hit.title} (${hit.url})`).join("\n\n");
}
async function requestSearchText(url, init, options) {
  const signal = withTimeout(options.signal, SEARCH_TIMEOUT_MS);
  try {
    const response = options.fetch ? await options.fetch(url, { ...init, signal }) : (await fetchRemoteUrl(url, { ...init, signal })).response;
    const body = await readTextLimited(response, MAX_SEARCH_BODY_BYTES);
    signal.throwIfAborted();
    return { response, body };
  } catch (err) {
    signal.throwIfAborted();
    throw err;
  }
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/search/duckduckgo.ts
async function searchDuckDuckGo(query, options = {}) {
  options.signal?.throwIfAborted();
  const numResults = normalizeCount(options.numResults);
  const url = new URL(DDG_SEARCH_URL);
  url.searchParams.set("q", buildDomainQuery(query, options.domainFilter));
  if (options.recencyFilter) url.searchParams.set("df", { day: "d", week: "w", month: "m", year: "y" }[options.recencyFilter]);
  const { response, body } = await requestSearchText(url, {
    method: "GET",
    headers: {
      Accept: "text/html",
      "User-Agent": USER_AGENT
    }
  }, options);
  if (!response.ok) throw new Error(`DuckDuckGo search error ${response.status}: ${body.slice(0, 300)}`);
  const parsed = parseDdgHtml(body);
  if (parsed.length === 0) throw new Error("DuckDuckGo returned no parseable results");
  const hits = applyDomainFilter(parsed, options.domainFilter).slice(0, numResults);
  return { query, provider: "duckduckgo", answer: hitsToAnswer(hits), hits };
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/search/exa.ts
async function searchExa(query, options = {}) {
  options.signal?.throwIfAborted();
  const numResults = normalizeCount(options.numResults);
  const queryWithDomains = buildDomainQuery(query, options.domainFilter);
  const mcpQuery = options.recencyFilter ? `${queryWithDomains} ${options.recencyFilter === "day" ? "past 24 hours" : `past ${options.recencyFilter}`}` : queryWithDomains;
  const { response, body } = await requestSearchText(`${EXA_MCP_URL}?tools=web_search_exa`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "x-exa-source": "@kvidzibo/pi-web-access"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "web_search_exa", arguments: { query: mcpQuery, numResults } }
    })
  }, options);
  if (!response.ok) {
    if (response.status === 429) throw new Error(`Exa MCP rate limit (429): ${body.slice(0, 200)}`);
    throw new Error(`Exa MCP error ${response.status}: ${body.slice(0, 300)}`);
  }
  const hits = applyDomainFilter(parseExaMcpBody(body), options.domainFilter).slice(0, numResults);
  return { query, provider: "exa", answer: hitsToAnswer(hits), hits };
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/search/index.ts
function normalizeQueries(query, queries) {
  return normalizeList(query, queries, "Query", MAX_QUERY_CHARS, MAX_QUERIES);
}
function normalizeProvider(value) {
  if (value === void 0 || value === null || value === "auto") return "auto";
  if (value === "exa" || value === "duckduckgo") return value;
  throw new Error(`Unsupported provider ${JSON.stringify(value)}. Use auto, exa, or duckduckgo.`);
}
function normalizeRecency(value) {
  if (value === void 0 || value === null) return void 0;
  if (value === "day" || value === "week" || value === "month" || value === "year") return value;
  throw new Error(`Invalid recencyFilter ${JSON.stringify(value)}`);
}
async function searchQueries(queries, provider, options = {}) {
  const results = [];
  for (const query of queries) {
    options.signal?.throwIfAborted();
    try {
      results.push(await searchOne(query, provider, options));
    } catch (err) {
      options.signal?.throwIfAborted();
      results.push({ query, provider, answer: "", hits: [], error: errorMessage(err) });
    }
  }
  return results;
}
async function searchOne(query, provider, options) {
  if (provider === "exa") return searchExa(query, options);
  if (provider === "duckduckgo") return searchDuckDuckGo(query, options);
  try {
    return await searchExa(query, options);
  } catch (err) {
    options.signal?.throwIfAborted();
    if (isTimeout(err)) throw err;
    const exaError = errorMessage(err);
    try {
      const fallback = await searchDuckDuckGo(query, options);
      fallback.answer = `${fallback.answer}

[fallback: Exa failed: ${exaError}]`;
      return fallback;
    } catch (fallbackErr) {
      options.signal?.throwIfAborted();
      if (isTimeout(fallbackErr)) throw fallbackErr;
      const ddgError = errorMessage(fallbackErr);
      return {
        query,
        provider: "auto",
        answer: "",
        hits: [],
        error: `Exa failed: ${exaError}; DuckDuckGo failed: ${ddgError}`
      };
    }
  }
}
function isTimeout(err) {
  return err instanceof Error && err.name === "TimeoutError";
}
function errorMessage(err) {
  return err instanceof Error ? err.message || err.name : String(err) || "Unknown error";
}

// outputs/dashboard-app/node_modules/@kvidzibo/pi-web-access/src/tools.ts
var cache = createCache(join2(homedir(), ".pi", "agent", "web-access-cache"));
function webAccess(pi) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web via keyless Exa MCP, with DuckDuckGo HTML fallback. Returns cited snippets. No curator UI. provider auto|exa|duckduckgo only.",
    promptSnippet: "Use web_search for current facts. Prefer queries[] with 2-4 varied angles. Omit provider unless overriding.",
    promptGuidelines: [
      "Use web_search for current facts. Prefer queries[] with 2-4 varied angles over one query.",
      "After web_search, use get_search_content with the returned responseId to page stored hits or fetched pages."
    ],
    parameters: Type.Object({
      query: Type.Optional(Type.String({ maxLength: MAX_QUERY_CHARS, description: "Single search query. For research, prefer queries[]." })),
      queries: Type.Optional(Type.Array(Type.String({ maxLength: MAX_QUERY_CHARS }), { maxItems: MAX_QUERIES, description: "Multiple queries searched in sequence." })),
      numResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Results per query (default 5, max 20)" })),
      includeContent: Type.Optional(Type.Boolean({ description: "Also fetch readable content for result URLs" })),
      recencyFilter: Type.Optional(Type.String({ description: "day, week, month, or year" })),
      domainFilter: Type.Optional(Type.Array(Type.String({ maxLength: 253 }), { maxItems: MAX_DOMAIN_FILTERS, description: "Limit to domains; prefix with - to exclude" })),
      provider: Type.Optional(Type.String({ description: "auto (default), exa, or duckduckgo" }))
    }),
    async execute(_id, params, signal, onUpdate) {
      try {
        const queries = normalizeQueries(params.query, params.queries);
        if (queries.length === 0) fail("No query provided. Use query or queries.");
        const provider = normalizeProvider(params.provider);
        const recencyFilter = normalizeRecency(params.recencyFilter);
        onUpdate?.({ content: [{ type: "text", text: `Searching ${queries.length} quer${queries.length === 1 ? "y" : "ies"} via ${provider}...` }] });
        const results = await searchQueries(queries, provider, {
          numResults: normalizeCount(params.numResults),
          recencyFilter,
          domainFilter: Array.isArray(params.domainFilter) ? params.domainFilter.filter((item) => typeof item === "string") : void 0,
          signal
        });
        const pages = params.includeContent === true ? await fetchPages(
          uniqueUrls(results.flatMap((result) => result.hits.map((hit) => hit.url))).slice(0, MAX_URLS),
          { signal }
        ) : [];
        signal?.throwIfAborted();
        const record = cache.store({ kind: "search", queries: results, pages });
        const failed = results.every((result) => result.error !== void 0 && result.hits.length === 0);
        if (failed) fail(formatRecordForModel(record));
        return {
          content: [{ type: "text", text: formatRecordForModel(record) }],
          details: { responseId: record.id, queries: results, pageCount: pages.length }
        };
      } catch (err) {
        fail(err);
      }
    }
  });
  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description: "Fetch HTTP(S) URL(s) from this machine and extract readable markdown. mode raw returns the textual body. Local SSRF gate blocks private/loopback/link-local/special-use IPs and pins DNS to the connecting socket. No GitHub clone, video, PDF, or hosted scrapers.",
    promptSnippet: "Use fetch_content to read a page as markdown. Use mode raw for exact textual HTTP bodies.",
    promptGuidelines: [
      "Use fetch_content to read public HTTP(S) pages. Do not use it for localhost or private IPs.",
      "After fetch_content, use get_search_content with responseId to page or search the stored full text."
    ],
    parameters: Type.Object({
      url: Type.Optional(Type.String({ maxLength: MAX_URL_CHARS, description: "Single URL to fetch" })),
      urls: Type.Optional(Type.Array(Type.String({ maxLength: MAX_URL_CHARS }), { maxItems: MAX_URLS, description: "Multiple URLs (parallel)" })),
      mode: Type.Optional(Type.String({ description: "readable (default) or raw." }))
    }),
    async execute(_id, params, signal, onUpdate) {
      try {
        const urls = normalizeUrls(params.url, params.urls);
        if (urls.length === 0) fail("No URL provided.");
        const mode = normalizeMode(params.mode);
        onUpdate?.({ content: [{ type: "text", text: `Fetching ${urls.length} URL(s)...` }] });
        const pages = await fetchPages(urls, { mode, signal });
        signal?.throwIfAborted();
        const record = cache.store({ kind: "fetch", queries: [], pages });
        const failed = pages.every((page) => page.error !== void 0);
        if (failed) fail(formatRecordForModel(record));
        return {
          content: [{ type: "text", text: formatRecordForModel(record) }],
          details: { responseId: record.id, pages: pages.map((page) => ({ url: page.url, finalUrl: page.finalUrl, error: page.error, chars: page.content.length })) }
        };
      } catch (err) {
        fail(err);
      }
    }
  });
  pi.registerTool({
    name: "get_search_content",
    label: "Get Search Content",
    description: "Retrieve stored content from a previous web_search or fetch_content call via responseId. Cache dir ~/.pi/agent/web-access-cache; entries expire after 1 hour and are pruned on extension load and on store/get.",
    promptSnippet: "Use get_search_content after web_search or fetch_content to page or findText in stored content.",
    promptGuidelines: [
      "Use get_search_content with a responseId from web_search or fetch_content. Use findText to locate passages. Do not combine findText with offset or limit."
    ],
    parameters: Type.Object({
      responseId: Type.String({ description: "The responseId from web_search or fetch_content" }),
      query: Type.Optional(Type.String({ description: "Get content for this query" })),
      queryIndex: Type.Optional(Type.Integer({ minimum: 0, description: "Get content for query at index" })),
      url: Type.Optional(Type.String({ description: "Get content for this URL" })),
      urlIndex: Type.Optional(Type.Integer({ minimum: 0, description: "Get content for URL at index" })),
      offset: Type.Optional(Type.Integer({ minimum: 0, description: "Character offset (default 0). Not with findText." })),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_INLINE_CHARS, description: `Max characters to return (default and max ${MAX_INLINE_CHARS}). Not with findText.` })),
      findText: Type.Optional(Type.Union([
        Type.String({ minLength: 1, maxLength: 500 }),
        Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { minItems: 1, maxItems: 10 })
      ], { description: "Text or texts to find. Cannot combine with offset or limit." })),
      findMode: Type.Optional(Type.String({ description: "exact, case-insensitive (default), or fuzzy. Requires findText." }))
    }),
    async execute(_id, params) {
      try {
        if (params.findText !== void 0 && (params.offset !== void 0 || params.limit !== void 0)) {
          fail("findText cannot be combined with offset or limit.");
        }
        if (params.findMode !== void 0 && params.findText === void 0) {
          fail("findMode requires findText.");
        }
        const record = cache.get(String(params.responseId));
        if (!record) fail(`No stored results for responseId ${params.responseId}.`);
        const selected = selectStoredText(record, {
          query: optionalString(params.query),
          queryIndex: optionalInt(params.queryIndex),
          url: optionalString(params.url),
          urlIndex: optionalInt(params.urlIndex)
        });
        if (params.findText !== void 0) {
          const needles = Array.isArray(params.findText) ? params.findText : [params.findText];
          const mode = normalizeFindMode(params.findMode);
          return {
            content: [{ type: "text", text: findPassages(selected.text, needles.filter((item) => typeof item === "string"), mode) }],
            details: { responseId: record.id, label: selected.label, findMode: mode }
          };
        }
        const sliced = sliceText(selected.text, optionalInt(params.offset) ?? 0, optionalInt(params.limit) ?? MAX_INLINE_CHARS);
        return {
          content: [{ type: "text", text: sliced.text }],
          details: { responseId: record.id, label: selected.label, ...sliced }
        };
      } catch (err) {
        fail(err);
      }
    }
  });
}
function fail(error) {
  if (error instanceof Error && error.message) throw error;
  throw new Error(error instanceof Error ? error.name : String(error) || "Unknown error");
}
function uniqueUrls(urls) {
  return [...new Set(urls)];
}
function optionalString(value) {
  return typeof value === "string" ? value : void 0;
}
function optionalInt(value) {
  return typeof value === "number" && Number.isInteger(value) ? value : void 0;
}
function normalizeFindMode(value) {
  if (value === void 0 || value === null || value === "case-insensitive") return "case-insensitive";
  if (value === "exact" || value === "fuzzy") return value;
  throw new Error(`Invalid findMode ${JSON.stringify(value)}`);
}
export {
  webAccess as default, fetchRemoteUrl
};
