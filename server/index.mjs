#!/usr/bin/env node
/**
 * Loupe server — zero dependencies.
 * Usage: node server/index.mjs --project <path> [--port 4777] [--open]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { scanProject, writeManifest, loadConfig, saveConfig, CANVAS_DIR } from "./scan/index.mjs";
import { IGNORE_DIRS } from "./scan/fsutil.mjs";
import { gitStatus, ship, aiMessage, heuristicMessage } from "./git.mjs";
import { createFrameProxy, serveHelper, HELPER_TAG } from "./proxy.mjs";
import { createSnapshotStore, computeChangedAt } from "./snapshots.mjs";
import { createChannelHub } from "./channel.mjs";
import { createChangelog } from "./changelog.mjs";
import { buildScope } from "../scripts/scope.mjs";
import { remember } from "./registry.mjs";
import { createShooter } from "./shooter.mjs";
import { createAgents } from "./agents.mjs";
import { createHistory } from "./history.mjs";
import { createComments } from "./comments.mjs";
import { createConceptEngine } from "./conceptgen.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "..", "app", "dist");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
    return acc;
  }, []),
);
const ROOT = path.resolve(args.project || process.cwd());
const VERSION = JSON.parse(fs.readFileSync(path.resolve(HERE, "..", ".claude-plugin", "plugin.json"), "utf8")).version;
const STATE_FILE = path.join(ROOT, CANVAS_DIR, "state.json");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm", ".txt": "text/plain" };

/* ---------------- state ---------------- */
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch { return {}; }
}
function writeState(patch) {
  const next = { ...readState(), ...patch, updatedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

let manifest = null;
let lastSig = "";
const snapshots = createSnapshotStore(ROOT, { keepOld: (key, prev) => keepAsBefore(key, prev) });
const history = createHistory({ root: ROOT, log: (m) => console.log(`[loupe] ${m}`) });
const shooter = createShooter({ log: (m) => console.log(`[loupe] ${m}`) });
let refreshAt = 0; // "Refresh all snapshots" from settings
let siteUrl = null; // static server for plain-HTML projects
let proxyUrl = null; // frame proxy in front of the dev server
const frameStatus = {}; // path -> { status, ms, error } for the last page load seen by the proxy
function rescan(reason = "") {
  try {
    const m = scanProject(ROOT);
    if (m.devUrl === "/__site" && siteUrl) m.devUrl = siteUrl;
    // Frames load through the proxy (or the static server for plain HTML) unless turned off
    m.frameUrl = m.devUrl === siteUrl ? siteUrl : loadConfig(ROOT).proxy === false || !proxyUrl ? m.devUrl : proxyUrl;
    m.changedAt = computeChangedAt(ROOT, m);
    m.changedAt["*"] = Math.max(m.changedAt["*"] || 0, refreshAt);
    const sig = JSON.stringify({ ...m, scannedAt: 0, scanMs: 0 });
    manifest = m;
    if (sig !== lastSig) {
      lastSig = sig;
      writeManifest(ROOT, m);
      broadcast("manifest", m);
      remember(ROOT, { name: m.project.name, framework: m.project.framework, mode: m.mode, views: m.views.length });
      refreshSelection();
      if (reason) console.log(`[loupe] rescanned (${reason}) · ${m.views.length} views`);
    }
  } catch (e) {
    console.error("[loupe] scan failed:", e);
  }
}

/** Build the full selection record the hooks read. */
function selectionRecord(sel) {
  if (!sel || !manifest) return null;
  if (sel.kind === "component") {
    const c = manifest.designSystem.components.find((x) => x.id === sel.id);
    if (!c) return null;
    return { kind: "component", id: c.id, name: c.name, file: c.file, files: [c.file], usedBy: c.usedBy };
  }
  if (sel.kind === "elements") {
    const v = manifest.views.find((x) => x.id === sel.viewId);
    const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // Pair each element with the section component it sits in (server components have no client-side name)
    const elements = (Array.isArray(sel.elements) ? sel.elements.slice(0, 20) : []).map((e) => {
      const known = (v?.codeSections || []).find((c) => norm(c.name) === norm(e.component));
      const bySection = (v?.codeSections || []).find((c) => e.section && (norm(e.section).includes(norm(c.name)) || norm(c.name).includes(norm(e.section))));
      const code = known || bySection;
      return code ? { ...e, component: code.name, componentFile: code.file } : e;
    });
    if (!v || !elements.length) return null;
    // Component files for elements whose component the scanner knows (design-system components)
    const compFiles = elements
      .map((e) => manifest.designSystem.components.find((c) => c.name === e.component || c.exports?.includes(e.component))?.file)
      .filter(Boolean);
    const codeFiles = elements.map((e) => e.componentFile).filter(Boolean);
    return {
      kind: "elements", id: `${v.id}::elements`, viewId: v.id, viewName: v.name, route: v.route, url: v.url,
      name: elements.length === 1 ? `${elements[0].kind}${elements[0].text ? ` “${elements[0].text.slice(0, 30)}”` : ""}` : `${elements.length} elements`,
      file: v.file, files: [...new Set([v.file, ...codeFiles, ...compFiles, ...(v.files || [])].filter(Boolean))], sharedFiles: v.sharedFiles,
      elements,
    };
  }
  if (sel.kind === "section") {
    const [viewId, idx] = String(sel.id).split("::");
    const v = manifest.views.find((x) => x.id === viewId);
    // Sections come from the snapshot of the device the canvas shows (live layer first, then wireframe)
    const device = sel.device === "mobile" ? "mobile" : "desktop";
    const snap = [`${viewId}|${device}|live`, `${viewId}|${device}|wireframe`].map((k) => snapshots.index[k]).find((x) => x?.sections?.length)
      || Object.entries(snapshots.index).find(([k, x]) => k.startsWith(`${viewId}|`) && x?.sections?.length)?.[1];
    // Picked on the live page (Focus): use what the page reported if the snapshot doesn't have it
    const live = sel.live && typeof sel.live === "object" ? { name: String(sel.live.name || "").slice(0, 120), heading: sel.live.heading ? String(sel.live.heading).slice(0, 120) : null, tag: String(sel.live.tag || "section").slice(0, 20), id: sel.live.id ? String(sel.live.id).slice(0, 120) : null, component: sel.live.component ? String(sel.live.component).slice(0, 120) : null, top: Number(sel.live.top) || 0, height: Number(sel.live.height) || 0 } : null;
    const snapSec = snap?.sections?.[Number(idx)];
    const sec = live && (!snapSec || snapSec.name !== live.name) ? live : snapSec;
    if (!v || !sec) return null;
    const code = matchCodeSection(v, sec === live ? (sel.liveList || [live]) : snap.sections, sec === live && !sel.liveList ? 0 : Number(idx));
    // The section's own component plus the page file (where it's placed); everything else asks first
    const files = [...new Set([...(code ? [code.file] : []), v.file].filter(Boolean))];
    return {
      kind: "section", id: sel.id, device, name: sec.name, viewId: v.id, viewName: v.name, route: v.route, url: v.url,
      heading: sec.heading, tag: sec.tag, domId: sec.id, component: code?.name || sec.component || null,
      componentFile: code?.file || null, file: v.file, files, sharedFiles: v.sharedFiles,
      position: { index: Number(idx), of: sec === live ? (sel.liveList?.length ?? Number(idx) + 1) : snap.sections.length, top: sec.top, height: sec.height },
    };
  }
  const v = manifest.views.find((x) => x.id === sel.id);
  if (!v) return null;
  return { kind: "view", id: v.id, name: v.name, route: v.route, url: v.url, file: v.file, files: v.files, sharedFiles: v.sharedFiles };
}
/** Pair a section found in the rendered page with a section component from the page's code. */
function matchCodeSection(view, sections, idx) {
  const code = view.codeSections || [];
  const sec = sections[idx];
  if (!sec || !code.length) return null;
  const norm = (x) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const byName = code.find((c) => [sec.component, sec.id, sec.name].some((n) => n && (norm(n) === norm(c.name) || norm(n).includes(norm(c.name)))));
  if (byName) return byName;
  // Same count (ignoring header/nav/footer from the layout): match by order
  const body = sections.map((s, i) => [s, i]).filter(([s]) => !["header", "nav", "footer"].includes(s.tag));
  if (body.length === code.length) { const pos = body.findIndex(([, i]) => i === idx); return pos >= 0 ? code[pos] : null; }
  return null;
}

function refreshSelection() {
  const st = readState();
  if (!st.selection) return;
  const rec = selectionRecord(st.selection);
  writeState({ selection: rec });
  broadcast("state", readState());
}

/* ---------------- SSE ---------------- */
const clients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

/* ---------------- prompts from the canvas ---------------- */
function scopeLabel(sel) {
  if (!sel) return "Whole project";
  if (sel.kind === "section" || sel.kind === "elements") return `${sel.name} on ${sel.viewName}`;
  return sel.name;
}
/** Where design concepts for this selection are previewed: which page, and what to swap on it. */
function previewInfo(sel) {
  const viewId = sel?.kind === "view" ? sel.id : sel?.viewId;
  const v = manifest.views.find((x) => x.id === viewId) || (!sel || sel.kind === "component" ? manifest.views.find((x) => x.route === "/") || manifest.views[0] : null);
  if (!v) return null;
  return {
    viewId: v.id, url: v.url, device: sel?.device === "mobile" || manifest.viewport === "mobile" ? "mobile" : "desktop",
    section: sel?.kind === "section" ? sel.position?.index ?? null : null,
    selectors: sel?.kind === "elements" ? sel.elements.map((e) => e.selector) : [],
  };
}
const changelog = createChangelog({ root: ROOT, broadcast: (e, d) => broadcast(e, d), history, onClosed: (e) => shootAfter(e) });

const comments = createComments({ root: ROOT, broadcast: (e, d) => broadcast(e, d) });



/* ---------------- before/after pictures of each change ---------------- */
const shotDevice = () => (manifest?.viewport === "mobile" ? "mobile" : "desktop");
/** Views a change touched; a change to global styles counts for the first few pages */
function viewsOf(entry) {
  const ids = new Set();
  let global = false;
  for (const f of entry.files || []) { const r = viewsForFile(f); r.views.forEach((v) => ids.add(v)); global ||= r.global; }
  if (!ids.size && global) manifest?.views.filter((v) => v.url && !v.dynamic).slice(0, 3).forEach((v) => ids.add(v.id));
  return [...ids].slice(0, 4);
}
/** A snapshot is being replaced: keep the old one if it shows a page before a change */
function keepAsBefore(key, prev) {
  const [viewId, device, layer] = key.split("|");
  if (layer !== "live" || device !== shotDevice()) return false;
  const want = changelog.recent((e) => !e.shots?.[viewId]?.before && prev.at <= e.at && viewsOf(e).includes(viewId));
  if (!want.length) return false;
  const name = snapshots.archive(prev.file);
  if (!name) return false;
  for (const e of want) changelog.update(e.id, (x) => ({ shots: { ...x.shots, [viewId]: { ...x.shots?.[viewId], before: name, h: prev.h, w: prev.w } } }));
  return true;
}
/** When a change is done, take fresh pictures of the pages it touched */
async function shootAfter(entry) {
  const base = manifest?.frameUrl || manifest?.devUrl;
  if (!base || !shooter.available()) return;
  await new Promise((r) => setTimeout(r, 1500)); // let the dev server reload
  const device = shotDevice();
  for (const viewId of viewsOf(entry)) {
    const view = manifest?.views.find((v) => v.id === viewId);
    if (!view?.url || view.dynamic) continue;
    const key = `${viewId}|${device}|live`;
    try {
      const at = Date.now();
      const shot = await shooter.shoot({ key, url: base.replace(/\/$/, "") + (view.url.startsWith("/") ? view.url : "/" + view.url), device, wire: false });
      const put = snapshots.put({ key, at, ...shot });
      const name = snapshots.archive(put.file, { copy: true });
      if (name) changelog.update(entry.id, (x) => ({ shots: { ...x.shots, [viewId]: { ...x.shots?.[viewId], after: name, device, h: put.h, w: put.w } } }));
      broadcast("snapshots", snapshots.index);
    } catch {}
  }
}
// History pictures no change refers to any more
setTimeout(() => {
  const keep = new Set();
  for (const e of changelog.list()) for (const s of Object.values(e.shots || {})) { if (s.before) keep.add(s.before); if (s.after) keep.add(s.after); }
  snapshots.prune(keep);
}, 5000).unref?.();
const keyOf = (c) => c?.session || (c ? `conn:${c.id}` : null);
const hub = createChannelHub({
  root: ROOT,
  onEvent: (type, p, c) => {
    if (type === "delivered" && keyOf(c)) {
      const apply = p.mode === "apply";
      changelog.start(keyOf(c), { source: "canvas", promptId: p.id, prompt: apply ? p.parentText || p.text : p.text, detail: apply ? p.text : null, scope: p.scope, mode: p.mode });
    }
    if (type === "reply") { changelog.summary(p.id, p.reply); comments.promptDone(p.id, p.reply); }
    if (type === "failed" || type === "cancelled") comments.promptFailed(p.id);
    if (type === "waiting" && c) { changelog.close(keyOf(c)); changelog.close(`conn:${c.id}`); }
  },
  broadcast: (e, d) => broadcast(e, d),
  scopeFor: (given) => {
    const sel = given === undefined ? readState().selection : given;
    return { label: scopeLabel(sel), scope: buildScope(sel, manifest), info: previewInfo(sel) };
  },
  isBusy: (session) => [...agents.values()].some((a) => a.session === session),
});

// Concepts are sketched by Loupe itself, 4 at once, unless the project turns it off
const conceptEngine = createConceptEngine({
  root: ROOT, shooter, hub,
  pageUrl: (info) => { const base = manifest?.frameUrl || manifest?.devUrl; return base && info?.url ? base.replace(/\/$/, "") + (info.url.startsWith("/") ? info.url : "/" + info.url) : null; },
  model: () => loadConfig(ROOT).conceptModel || "sonnet",
  log: (m) => console.log(`[loupe] ${m}`),
});
// The setting is read on every request, so changing it applies straight away
hub.setConceptEngine({ ...conceptEngine, available: () => loadConfig(ROOT).fastConcepts !== false && conceptEngine.available() });

/* ---------------- Claude Code sessions Loupe runs itself ---------------- */
const claudes = createAgents({
  root: ROOT, hub, broadcast: (e, d) => broadcast(e, d),
  model: () => loadConfig(ROOT).sessionModel || "sonnet",
  recordActivity: (ev) => recordActivity(ev),
  serverUrl: () => readState().url,
  log: (m) => console.log(`[loupe] claude: ${m}`),
});
/** Files behind the selected page, so a prompt about it goes to the session that knows it */
function selectionFiles() {
  const sel = readState().selection;
  const id = sel?.kind === "view" ? sel.id : sel?.viewId;
  const v = manifest?.views.find((x) => x.id === id);
  return v ? [v.file, ...(v.files || [])].filter(Boolean) : [];
}

/* ---------------- watcher ---------------- */
let timer = null;
function startWatcher() {
  const onChange = (_e, file) => {
    if (!file) return;
    const f = String(file).split(path.sep).join("/");
    const top = f.split("/")[0];
    if (IGNORE_DIRS.has(top) && !(top === ".canvas" && f.endsWith("config.json"))) return;
    if (f.split("/").some((s) => IGNORE_DIRS.has(s) && s !== ".canvas")) return;
    clearTimeout(timer);
    timer = setTimeout(() => { rescan(f); pushGit(); }, 350);
  };
  try {
    fs.watch(ROOT, { recursive: true }, onChange);
  } catch (e) {
    console.warn("[loupe] recursive watch unavailable, polling every 3s", e.message);
    setInterval(() => rescan(), 3000);
  }
}
let gitTimer = null;
function pushGit() {
  clearTimeout(gitTimer);
  gitTimer = setTimeout(async () => broadcast("git", await gitStatus(ROOT)), 600);
}

/* ---------------- http helpers ---------------- */
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
  });
}
function serveFile(res, file, fallback, reqPath) {
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      if (reqPath && !reqPath.endsWith("/")) { res.writeHead(301, { Location: reqPath + "/" }); return res.end(); }
      return serveFile(res, path.join(file, "index.html"), fallback);
    }
    if (err) return fallback ? serveFile(res, fallback) : send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
    fs.createReadStream(file).pipe(res);
  });
}
function safeJoin(base, p) {
  const full = path.normalize(path.join(base, decodeURIComponent(p)));
  return full.startsWith(base) ? full : null;
}

/* ---------------- routes ---------------- */
async function handle(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = url.pathname;

  // Only answer to localhost names (blocks DNS-rebinding pages from reaching the API)
  if (p.startsWith("/api/") && !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(String(req.headers.host || ""))) return send(res, 403, { error: "forbidden" });
  // Same-origin guard for mutating requests (server only listens on 127.0.0.1 too)
  if (req.method !== "GET") {
    const origin = req.headers.origin;
    if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return send(res, 403, { error: "forbidden" });
  }

  if (p === "/api/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`event: manifest\ndata: ${JSON.stringify(manifest)}\n\n`);
    res.write(`event: state\ndata: ${JSON.stringify(readState())}\n\n`);
    res.write(`event: frames\ndata: ${JSON.stringify(frameStatus)}\n\n`);
    res.write(`event: activity\ndata: ${JSON.stringify(activityList())}\n\n`);
    res.write(`event: snapshots\ndata: ${JSON.stringify(snapshots.index)}\n\n`);
    res.write(`event: chat\ndata: ${JSON.stringify(hub.summary())}\n\n`);
    res.write(`event: agents\ndata: ${JSON.stringify(claudes.list())}\n\n`);
    res.write(`event: comments\ndata: ${JSON.stringify(comments.list())}\n\n`);
    res.write(`event: changelog\ndata: ${JSON.stringify(changelog.list())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => { clients.delete(res); clearInterval(ping); });
    gitStatus(ROOT).then((g) => res.write(`event: git\ndata: ${JSON.stringify(g)}\n\n`));
    return;
  }
  if (p === "/api/manifest") return send(res, 200, manifest);
  // A short status for the Loupe app's home screen
  if (p === "/api/summary") {
    const chat = hub.summary();
    const open = chat.conns.filter((c) => c.status !== "offline");
    return send(res, 200, {
      root: ROOT, version: VERSION, name: manifest?.project.name, views: manifest?.views.length ?? 0,
      chats: open.length, live: open.some((c) => c.status === "live" || c.status === "listening"),
      working: activityList().length, waiting: chat.permissions.length,
      // sessions this server runs itself that are mid-task (they'd be cut off if it stopped)
      managedBusy: claudes.list().filter((x) => x.state === "working" || x.state === "waiting").length,
    });
  }
  if (p === "/api/snapshot" && req.method === "POST") {
    const body = await readBody(req);
    try {
      snapshots.put(body);
      broadcast("snapshots", snapshots.index);
      refreshSelection();
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 400, { error: String(e.message) });
    }
  }
  // Snapshots taken by a real browser in the background (sharp, 2×); the canvas falls back to
  // drawing them in its frames when no browser is installed
  if (p === "/api/snapshot/engine") return send(res, 200, { engine: shooter.available() ? "browser" : "frame", browser: shooter.browser });
  if (p === "/api/snapshot/render" && req.method === "POST") {
    const b = await readBody(req);
    const view = manifest?.views.find((v) => v.id === b.viewId);
    const base = manifest?.frameUrl || manifest?.devUrl;
    if (!view?.url || !base) return send(res, 404, { error: "No page to capture" });
    if (!shooter.available()) return send(res, 501, { error: "No browser for snapshots" });
    const device = b.device === "mobile" ? "mobile" : "desktop";
    const layer = b.layer === "wireframe" ? "wireframe" : "live";
    const key = `${view.id}|${device}|${layer}`;
    const at = Number(b.at) || Date.now();
    try {
      const shot = await shooter.shoot({ key, url: base.replace(/\/$/, "") + (view.url.startsWith("/") ? view.url : "/" + view.url), device, wire: layer === "wireframe" });
      const entry = snapshots.put({ key, at, ...shot });
      broadcast("snapshots", snapshots.index);
      refreshSelection();
      return send(res, 200, { ok: true, entry });
    } catch (e) {
      const msg = String(e?.message || e);
      return send(res, msg === "superseded" ? 409 : 500, { error: msg });
    }
  }
  if (p === "/api/snapshots/refresh" && req.method === "POST") {
    refreshAt = Date.now();
    lastSig = "";
    rescan("refresh snapshots");
    return send(res, 200, { ok: true });
  }
  if (p.startsWith("/api/snapshots/")) {
    const file = snapshots.filePath(p.slice("/api/snapshots/".length));
    if (!file || !fs.existsSync(file)) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "Content-Type": file.endsWith(".png") ? "image/png" : file.endsWith(".jpg") ? "image/jpeg" : "image/webp", "Cache-Control": "public, max-age=31536000, immutable" });
    return fs.createReadStream(file).pipe(res);
  }
  if (p === "/api/activity" && req.method === "POST") {
    recordActivity(await readBody(req));
    return send(res, 200, { ok: true });
  }
  /* prompts: MCP server (one per Claude Code chat) and hooks */
  if (p === "/api/channel/stream") return hub.stream(req, res, url);
  if (req.method === "POST" && p.startsWith("/api/channel/")) {
    const b = await readBody(req);
    const r = {
      "/api/channel/waiting": () => hub.waiting(b.conn, b.waiting),
      "/api/channel/ack": () => hub.ack(b.conn, b.id, b.via),
      "/api/channel/requeue": () => hub.requeue(b.conn, b.id),
      "/api/channel/reply": () => hub.reply(b.conn, b.id, b.text),
      "/api/channel/permission": () => hub.permissionRequest(b.conn, b),
      "/api/channel/claim": () => hub.claim(b),
      "/api/channel/concepts": () => hub.concepts(b.conn, b.id, b.concepts),
      "/api/channel/findings": () => hub.findings(b.conn, b.id, b.findings),
      "/api/channel/stop-listening": () => hub.stopListening(b.conn),
    }[p];
    return r ? send(res, 200, r()) : send(res, 404, { error: "unknown" });
  }
  /* prompts: canvas UI */
  if (req.method === "POST" && p === "/api/prompt") {
    const b = await readBody(req);
    // "auto": Loupe picks among its own sessions (the one that worked on this page, else a free one)
    if (b.conn === "auto") b.conn = claudes.pick(selectionFiles());
    delete b.extra;
    const r = hub.submit(b);
    return send(res, r.ok ? 200 : 400, r);
  }
  /* Claude Code sessions Loupe runs */
  if (p === "/api/managed" && req.method === "GET") return send(res, 200, { available: claudes.available(), sessions: claudes.list(), previous: claudes.previous() });
  if (p === "/api/managed/transcript") return send(res, 200, { events: claudes.transcript(url.searchParams.get("id")) });
  if (req.method === "POST" && p.startsWith("/api/managed/")) {
    const b = await readBody(req);
    if (p === "/api/managed/permission") return send(res, 200, await claudes.permission(b.conn, b));
    if (p === "/api/managed/ensure") {
      // Opening a project in the app: make sure one of Loupe's own sessions is running (terminal chats don't count)
      if (claudes.list().length || !claudes.available()) return send(res, 200, { ok: true, started: false, available: claudes.available() });
      const prev = b.resume !== false ? claudes.previous()[0] : null;
      const r = claudes.start({ resume: prev?.claudeSession, label: prev?.label });
      return send(res, r.ok ? 200 : 400, { ...r, started: r.ok });
    }
    const r = {
      "/api/managed/start": () => claudes.start({ label: b.label, resume: b.resume }),
      "/api/managed/say": () => claudes.say(b.id, b.text),
      "/api/managed/interrupt": () => claudes.interrupt(b.id),
      "/api/managed/stop": () => claudes.stop(b.id),
    }[p];
    if (!r) return send(res, 404, { error: "unknown" });
    const out = r();
    return send(res, out.ok === false ? 400 : 200, out);
  }
  if (req.method === "POST" && p === "/api/prompt/cancel") return send(res, 200, hub.cancel((await readBody(req)).id));
  if (req.method === "POST" && p === "/api/prompt/clear") return send(res, 200, hub.clear());
  if (req.method === "POST" && p === "/api/concepts/choose") { const r = hub.choose(await readBody(req)); return send(res, r.ok ? 200 : 400, r); }
  if (req.method === "POST" && p === "/api/concepts/again") { const r = hub.again(await readBody(req)); return send(res, r.ok ? 200 : 400, r); }
  /* helper buddy: house rules and link checks */
  if (p === "/api/rules" && req.method === "GET") {
    const f = path.join(ROOT, ".canvas", "rules.md");
    return send(res, 200, { exists: fs.existsSync(f), text: fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "" });
  }
  if (p === "/api/rules" && req.method === "POST") {
    const b = await readBody(req);
    fs.mkdirSync(path.join(ROOT, ".canvas"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, ".canvas", "rules.md"), String(b.text ?? "").slice(0, 50_000));
    return send(res, 200, { ok: true });
  }
  if (p === "/api/check-links" && req.method === "POST") {
    const b = await readBody(req);
    const base = (manifest.frameUrl || manifest.devUrl || "").replace(/\/$/, "");
    const paths = [...new Set((b.paths || []).map(String))].filter((x) => x.startsWith("/")).slice(0, 150);
    const out = {};
    let i = 0;
    const worker = async () => {
      while (i < paths.length) {
        const q = paths[i++];
        try {
          const r = await fetch(base + q, { redirect: "follow", signal: AbortSignal.timeout(8000) });
          out[q] = r.status;
          r.body?.cancel?.();
        } catch (e) { out[q] = 0; }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    return send(res, 200, { base, statuses: out });
  }
  if (req.method === "POST" && p === "/api/audit/rules") { const r = hub.rulesCheck(await readBody(req)); return send(res, r.ok ? 200 : 400, r); }
  if (req.method === "POST" && p === "/api/changelog/clear") return send(res, 200, changelog.clear());
  /* comments on the canvas */
  if (p === "/api/comments" && req.method === "GET") return send(res, 200, { comments: comments.list() });
  if (req.method === "POST" && p.startsWith("/api/comments/")) {
    const b = await readBody(req);
    if (p === "/api/comments/send") {
      // One prompt per page, scoped to that page (or the section, for a single comment)
      const list = (b.ids || []).map((id) => comments.get(id)).filter((c) => c && c.status !== "resolved" && c.status !== "sent");
      if (!list.length) return send(res, 400, { error: "Pick a comment to send" });
      const byView = new Map();
      for (const c of list) byView.set(c.viewId, [...(byView.get(c.viewId) || []), c]);
      const out = [];
      for (const group of byView.values()) {
        const { text, body } = comments.promptFor(group);
        const one = group.length === 1 ? group[0] : null;
        let sel = null;
        try { sel = one?.section ? selectionRecord({ kind: "section", id: `${one.viewId}::${one.section.index}`, device: one.device }) : selectionRecord({ kind: "view", id: group[0].viewId }); } catch {}
        let conn = b.conn;
        if (!conn || conn === "auto") { const v = manifest?.views.find((x) => x.id === group[0].viewId); conn = claudes.pick(v ? [v.file, ...(v.files || [])].filter(Boolean) : []); }
        const r = hub.submit({ text, conn, selection: sel, extra: { body } });
        if (!r.ok) return send(res, 400, r);
        comments.sent(group.map((c) => c.id), r.prompt.id);
        out.push(r.prompt);
      }
      return send(res, 200, { ok: true, prompts: out });
    }
    const r = { "/api/comments/add": () => comments.add(b), "/api/comments/update": () => comments.update(b), "/api/comments/delete": () => comments.remove(b.id) }[p]?.();
    if (!r) return send(res, 404, { error: "unknown" });
    return send(res, r.ok ? 200 : 400, r);
  }
  /* version history */
  if (p === "/api/history/diff") {
    const e = changelog.get(url.searchParams.get("entry"));
    if (!e?.before || !e?.after) return send(res, 404, { error: "No saved versions for this change" });
    const files = await history.changed(e.before, e.after);
    const own = files.filter((f) => !e.files?.length || e.files.includes(f.file));
    return send(res, 200, { files: own.length ? own : files, diff: await history.diff(e.before, e.after, (own.length ? own : files).map((f) => f.file)) });
  }
  if (req.method === "POST" && p === "/api/history/undo") {
    const b = await readBody(req);
    const e = changelog.get(b.entry);
    if (!e?.before || !e?.after) return send(res, 404, { error: "Loupe has no saved version from before this change." });
    const r = await history.undo({ before: e.before, after: e.after, label: e.prompt, force: !!b.force });
    if (r.ok) {
      changelog.update(e.id, { undone: Date.now() });
      changelog.add({ source: "loupe", kind: "undo", undoOf: e.id, prompt: `Undo: ${e.prompt || "a change"}`, files: r.files, after: r.version, before: e.after, summary: `Put ${r.files.length} file${r.files.length === 1 ? "" : "s"} back the way ${r.files.length === 1 ? "it was" : "they were"} before this change.` });
    }
    return send(res, r.ok || r.conflict ? 200 : 400, r);
  }
  if (req.method === "POST" && p === "/api/history/restore") {
    const b = await readBody(req);
    const e = changelog.get(b.entry);
    const id = b.point === "before" ? e?.before : e?.after;
    if (!id) return send(res, 404, { error: "Loupe has no saved version for that point." });
    const when = new Date(b.point === "before" ? e.at : e.endAt || e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    const r = await history.restore({ id, label: `${b.point === "before" ? "before" : "after"} “${e.prompt || "a change"}”` });
    if (r.ok && r.files.length) changelog.add({ source: "loupe", kind: "restore", prompt: `Restored the project to ${b.point === "before" ? "before" : "after"} “${String(e.prompt || "a change").slice(0, 80)}” (${when})`, files: r.files, before: r.undoPoint, after: r.version, summary: `${r.files.length} file${r.files.length === 1 ? "" : "s"} changed back.` });
    return send(res, r.ok ? 200 : 400, r);
  }
  if (req.method === "POST" && p === "/api/listen/stop") return send(res, 200, hub.stopListening((await readBody(req)).conn));
  if (req.method === "POST" && p === "/api/permission") { const b = await readBody(req); return send(res, 200, hub.verdict(b.request_id, b.behavior)); }

  if (p === "/api/state") return send(res, 200, { ...readState(), version: VERSION });

  if (p === "/api/selection" && req.method === "POST") {
    const body = await readBody(req);
    const rec = body && body.id ? selectionRecord(body) : null;
    const st = writeState({ selection: rec });
    broadcast("state", st);
    return send(res, 200, st);
  }

  if (p === "/api/config" && req.method === "POST") {
    const patch = await readBody(req);
    const cfg = loadConfig(ROOT);
    for (const [k, v] of Object.entries(patch)) {
      if (v && typeof v === "object" && !Array.isArray(v) && cfg[k] && typeof cfg[k] === "object") cfg[k] = { ...cfg[k], ...v };
      else cfg[k] = v;
      // allow deleting keys inside maps with null
      if (cfg[k] && typeof cfg[k] === "object" && !Array.isArray(cfg[k])) for (const kk of Object.keys(cfg[k])) if (cfg[k][kk] === null) delete cfg[k][kk];
    }
    saveConfig(ROOT, cfg);
    rescan("config");
    return send(res, 200, { ok: true, config: cfg });
  }
  if (p === "/api/rescan" && req.method === "POST") { lastSig = ""; rescan("manual"); return send(res, 200, manifest); }

  if (p === "/api/git/status") return send(res, 200, await gitStatus(ROOT));
  if (p === "/api/git/message" && req.method === "POST") {
    const body = await readBody(req);
    if (body.ai) return send(res, 200, await aiMessage(ROOT, manifest));
    return send(res, 200, { message: heuristicMessage(await gitStatus(ROOT), manifest), source: "heuristic" });
  }
  if (p === "/api/git/ship" && req.method === "POST") {
    const body = await readBody(req);
    const result = await ship(ROOT, body);
    pushGit();
    return send(res, result.ok ? 200 : 400, result);
  }


  // Canvas UI
  const file = safeJoin(DIST, p === "/" ? "/index.html" : p);
  return serveFile(res, file, path.join(DIST, "index.html"));
}

/* ---------------- agent activity ---------------- */
// key -> { key, session, label, phase, file, command, views, global, since, last }
const agents = new Map();
const GLOBAL_FILE = /(^|\/)(layout|template|globals?|root|app|_app|_document|tailwind\.config|next\.config|astro\.config|vite\.config)\.[a-z]+$|\.(css|scss)$/i;

/** Which views does a file belong to? Global files (layouts, global CSS, configs) touch every view. */
function viewsForFile(rel) {
  if (!rel || !manifest || rel.startsWith("..")) return { views: [], global: false };
  const views = new Set();
  for (const v of manifest.views) if (v.file === rel || v.files?.includes(rel) || v.sharedFiles?.includes(rel)) views.add(v.id);
  for (const c of manifest.designSystem.components) if (c.file === rel) c.usedBy.forEach((id) => views.add(id));
  const global = !views.size && GLOBAL_FILE.test(rel);
  return { views: [...views], global };
}

function activityList() {
  return [...agents.values()].map(({ timer, ...a }) => a);
}
let activityTimer = null;
function pushActivity() {
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => broadcast("activity", activityList()), 40);
}

function recordActivity(ev) {
  hub.activity(ev);
  if (ev.phase === "hello") return;
  if (ev.session && !ev.agent) {
    if (ev.prompt && !/^\/(loupe|canvas)/.test(ev.prompt)) changelog.start(ev.session, { source: "chat", prompt: ev.prompt });
    if (ev.phase === "done") { changelog.close(ev.session); hub.connKeys(ev.session).forEach((k) => changelog.close(k)); }
  }
  if (ev.phase === "edited" && ev.session) changelog.edited([ev.session, ...hub.connKeys(ev.session)], ev.file);
  const key = ev.agent || ev.session;
  const now = Date.now();
  if (ev.phase === "done") {
    // Main session stopped: clear it and its subagents. Subagent stopped: clear just that one.
    for (const [k, a] of agents) if (k === key || (!ev.subagent && a.session === ev.session)) agents.delete(k);
    pushActivity();
    return;
  }
  const prev = agents.get(key);
  const sel = readState().selection;
  const mapped = ev.file ? viewsForFile(ev.file) : null;
  const a = {
    key,
    session: ev.session,
    label: ev.agentType ? ev.agentType : "Claude",
    sub: !!ev.agent,
    phase: ev.phase === "edited" ? "editing" : ev.phase,
    file: ev.file ?? (ev.phase === "thinking" ? null : prev?.file ?? null),
    command: ev.command ?? null,
    // While thinking, the agent works on the selected view (or the whole project)
    views: mapped ? mapped.views : ev.phase === "thinking" ? (sel?.kind === "view" ? [sel.id] : sel?.usedBy ?? []) : prev?.views ?? [],
    global: mapped ? mapped.global : ev.phase === "thinking" ? !sel : prev?.global ?? false,
    since: prev && prev.phase === ev.phase ? prev.since : now,
    last: now,
  };
  agents.set(key, a);
  if (ev.phase === "edited") broadcast("edited", { file: ev.file, views: a.views, global: a.global, at: now });
  pushActivity();
  hub.push();
}

// Forget agents that went quiet without a Stop event (crash, cancelled turn)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [k, a] of agents) if (now - a.last > 120_000) { agents.delete(k); changed = true; }
  if (changed) { pushActivity(); hub.push(); }
}, 10_000).unref();

let statusTimer = null;
function recordStatus({ path: p, status, ms, error }) {
  frameStatus[p] = { status, ms, error, at: Date.now() };
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => broadcast("frames", frameStatus), 150);
}

/* ---------------- boot ---------------- */
function freePort(start) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const s = net.createServer();
      s.once("error", () => tryPort(port + 1));
      s.once("listening", () => s.close(() => resolve(port)));
      s.listen(port, "127.0.0.1");
    };
    tryPort(start);
  });
}

async function main() {
  if (!fs.existsSync(ROOT)) { console.error(`[loupe] project not found: ${ROOT}`); process.exit(1); }
  const prev = readState();
  if (prev.pid && prev.pid !== process.pid && pidAlive(prev.pid) && prev.url) {
    // A live pid isn't enough (pids get reused): ask the server itself
    const running = await fetch(`${prev.url}/api/state`, { signal: AbortSignal.timeout(1200) })
      .then((r) => r.json()).then((st) => (st.root === ROOT ? st : null)).catch(() => null);
    if (running && running.version === VERSION) {
      console.log(`[loupe] already running for this project → ${prev.url}`);
      process.exit(0);
    }
    if (running) {
      // An older version is still serving this project: replace it so updates take effect
      console.log(`[loupe] replacing canvas server ${running.version || "0.1.x"} (pid ${prev.pid}) with ${VERSION}`);
      try { process.kill(prev.pid, "SIGTERM"); } catch {}
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const still = await fetch(`${prev.url}/api/state`, { signal: AbortSignal.timeout(300) }).then(() => true).catch(() => false);
        if (!still) break;
      }
    }
  }
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    console.error("[loupe] UI build missing. Run: npm --prefix \"" + path.resolve(HERE, "..", "app") + "\" install && npm --prefix \"" + path.resolve(HERE, "..", "app") + "\" run build");
    process.exit(1);
  }
  const port = await freePort(Number(args.port) || prev.port || 4777);
  // Plain HTML projects get their own static origin so root-relative links work inside frames
  const probe = scanProject(ROOT);
  if (probe.devUrl === "/__site") {
    const sitePort = await freePort(port + 1);
    http.createServer((req, res) => {
      if (serveHelper(req, res)) return;
      const u = new URL(req.url, "http://localhost");
      let file = safeJoin(ROOT, u.pathname);
      if (!file || file.includes(`${path.sep}${CANVAS_DIR}`)) return send(res, 403, "forbidden", "text/plain");
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
        if (!u.pathname.endsWith("/")) { res.writeHead(301, { Location: u.pathname + "/" }); return res.end(); }
        file = path.join(file, "index.html");
      }
      if (/\.html?$/i.test(file) && fs.existsSync(file)) {
        const html = fs.readFileSync(file, "utf8");
        const m = html.match(/<head\b[^>]*>/i);
        const out = m ? html.slice(0, m.index + m[0].length) + HELPER_TAG + html.slice(m.index + m[0].length) : HELPER_TAG + html;
        recordStatus({ path: u.pathname, status: 200, ms: 0 });
        return send(res, 200, out, "text/html; charset=utf-8");
      }
      if (/\.html?$/i.test(file)) recordStatus({ path: u.pathname, status: 404, ms: 0 });
      serveFile(res, file, null, u.pathname);
    }).listen(sitePort, "127.0.0.1");
    siteUrl = `http://localhost:${sitePort}`;
  } else {
    const proxyPort = await freePort(port + 2);
    createFrameProxy({ getTarget: () => manifest?.devUrl || probe.devUrl, onStatus: recordStatus }).listen(proxyPort, "127.0.0.1");
    proxyUrl = `http://localhost:${proxyPort}`;
  }
  rescan();
  const server = http.createServer((req, res) => handle(req, res).catch((e) => send(res, 500, { error: String(e?.message || e) })));
  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}`;
    writeState({ pid: process.pid, port, url, root: ROOT, version: VERSION, selection: prev.selection ? selectionRecord(prev.selection) : null });
    remember(ROOT, { name: manifest.project.name, framework: manifest.project.framework, mode: manifest.mode, views: manifest.views.length });
    console.log(`[loupe] v${VERSION} · ${manifest.project.name} (${manifest.project.framework}, ${manifest.mode}) · ${manifest.views.length} views`);
    console.log(`[loupe] open ${url}`);
    if (args.open) {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
      const a = process.platform === "win32" ? ["/c", "start", url] : [url];
      spawn(opener, a, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
    }
  });
  startWatcher();
  const stop = () => { writeState({ pid: null }); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
main();
