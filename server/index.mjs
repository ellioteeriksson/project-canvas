#!/usr/bin/env node
/**
 * Project Canvas server — zero dependencies.
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "..", "app", "dist");

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
    return acc;
  }, []),
);
const ROOT = path.resolve(args.project || process.cwd());
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
let siteUrl = null; // static server for plain-HTML projects
let proxyUrl = null; // frame proxy in front of the dev server
const frameStatus = {}; // path -> { status, ms, error } for the last page load seen by the proxy
function rescan(reason = "") {
  try {
    const m = scanProject(ROOT);
    if (m.devUrl === "/__site" && siteUrl) m.devUrl = siteUrl;
    // Frames load through the proxy (or the static server for plain HTML) unless turned off
    m.frameUrl = m.devUrl === siteUrl ? siteUrl : loadConfig(ROOT).proxy === false || !proxyUrl ? m.devUrl : proxyUrl;
    const sig = JSON.stringify({ ...m, scannedAt: 0, scanMs: 0 });
    manifest = m;
    if (sig !== lastSig) {
      lastSig = sig;
      writeManifest(ROOT, m);
      broadcast("manifest", m);
      refreshSelection();
      if (reason) console.log(`[canvas] rescanned (${reason}) · ${m.views.length} views`);
    }
  } catch (e) {
    console.error("[canvas] scan failed:", e);
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
  const v = manifest.views.find((x) => x.id === sel.id);
  if (!v) return null;
  return { kind: "view", id: v.id, name: v.name, route: v.route, url: v.url, file: v.file, files: v.files, sharedFiles: v.sharedFiles };
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
    console.warn("[canvas] recursive watch unavailable, polling every 3s", e.message);
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
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => { clients.delete(res); clearInterval(ping); });
    gitStatus(ROOT).then((g) => res.write(`event: git\ndata: ${JSON.stringify(g)}\n\n`));
    return;
  }
  if (p === "/api/manifest") return send(res, 200, manifest);
  if (p === "/api/state") return send(res, 200, readState());

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
  if (!fs.existsSync(ROOT)) { console.error(`[canvas] project not found: ${ROOT}`); process.exit(1); }
  const prev = readState();
  if (prev.pid && prev.pid !== process.pid && pidAlive(prev.pid) && prev.url) {
    // A live pid isn't enough (pids get reused): ask the server itself
    const running = await fetch(`${prev.url}/api/state`, { signal: AbortSignal.timeout(1200) })
      .then((r) => r.json()).then((st) => st.root === ROOT).catch(() => false);
    if (running) {
      console.log(`[canvas] already running for this project → ${prev.url}`);
      process.exit(0);
    }
  }
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    console.error("[canvas] UI build missing. Run: npm --prefix \"" + path.resolve(HERE, "..", "app") + "\" install && npm --prefix \"" + path.resolve(HERE, "..", "app") + "\" run build");
    process.exit(1);
  }
  const port = await freePort(Number(args.port) || 4777);
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
    writeState({ pid: process.pid, port, url, root: ROOT, selection: prev.selection ? selectionRecord(prev.selection) : null });
    console.log(`[canvas] ${manifest.project.name} (${manifest.project.framework}, ${manifest.mode}) · ${manifest.views.length} views`);
    console.log(`[canvas] open ${url}`);
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
