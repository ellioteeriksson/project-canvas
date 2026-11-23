#!/usr/bin/env node
/**
 * Loupe home: every project you've opened Loupe in, and a way to open each one's canvas.
 * Used by the Loupe app for macOS, and on its own:  node server/hub.mjs [--port 4700] [--open]
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { list, forget, remember, thumbnail, loadManifest } from "./registry.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "index.mjs");
const DIST = path.resolve(HERE, "..", "app", "dist");
const VERSION = JSON.parse(fs.readFileSync(path.resolve(HERE, "..", ".claude-plugin", "plugin.json"), "utf8")).version;

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".json": "application/json" };
const send = (res, code, body, type = "application/json") => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(type === "application/json" ? JSON.stringify(body) : body);
};
const readBody = (req) => new Promise((resolve) => {
  let b = ""; req.on("data", (c) => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } });
});
const readState = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, ".canvas", "state.json"), "utf8")); } catch { return {}; } };
const alive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

/** Is this project's canvas server up? Asks the server itself, since pids get reused. */
async function running(root) {
  const st = readState(root);
  if (!st.url || !alive(st.pid)) return null;
  const sum = await fetch(`${st.url}/api/summary`, { signal: AbortSignal.timeout(700) }).then((r) => r.ok ? r.json() : null).catch(() => null);
  if (sum && sum.root === root) return { url: st.url, ...sum };
  // A canvas from before /api/summary existed
  const old = await fetch(`${st.url}/api/state`, { signal: AbortSignal.timeout(700) }).then((r) => r.json()).catch(() => null);
  return old && old.root === root ? { url: st.url, version: old.version, chats: 0, live: false, working: 0, waiting: 0 } : null;
}

let extraEnv = {};
function defaultSpawn(root) {
  const env = { ...process.env, ...extraEnv };
  // Inside the Electron app, run the server with the app's own Node
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = "1";
  fs.mkdirSync(path.join(root, ".canvas"), { recursive: true });
  const log = fs.openSync(path.join(root, ".canvas", "server.log"), "a");
  const child = spawn(process.execPath, [SERVER, "--project", root], { env, detached: true, stdio: ["ignore", log, log] });
  child.unref();
  return child;
}

/** The command line a process runs, to tell canvases the app started from ones a terminal started */
function commandOf(pid) {
  try { return execFileSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 3000 }).trim(); } catch { return ""; }
}
/** A canvas server a Loupe app started (its Node is the app's own binary), not one from a terminal */
const fromOldApp = (pid) => /\.app(\.old)?\/Contents\/MacOS\//.test(commandOf(pid));

/**
 * Canvases an older Loupe app started keep running from the old app's files and keep reading your
 * project folders. macOS keeps one access answer per app, so the old and new copies take turns
 * asking for Documents access. Stop them (unless a session Loupe runs in them is mid-task: then
 * once it's done); a terminal chat connected to one just reconnects to the new canvas.
 */
async function stopOutdated() {
  if (!process.versions.electron) return;
  for (const p of list()) {
    const up = await running(p.root).catch(() => null);
    if (!up || up.version === VERSION || up.managedBusy) continue;
    const { pid } = readState(p.root);
    if (pid && fromOldApp(pid)) try { process.kill(pid, "SIGTERM"); } catch {}
  }
}

/** Open a project's canvas, starting its server if it isn't running. Resolves to its URL. */
async function openProject(root, spawnServer) {
  const up = await running(root);
  if (up && up.version === VERSION) return up.url;
  // An older canvas for this project gives way to the new one
  if (up) { const { pid } = readState(root); if (pid) try { process.kill(pid, "SIGTERM"); } catch {} await new Promise((r) => setTimeout(r, 400)); }
  spawnServer(root);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const st = readState(root);
    if (st.url && st.version === VERSION && alive(st.pid)) {
      const ok = await fetch(`${st.url}/api/state`, { signal: AbortSignal.timeout(500) }).then((r) => r.ok).catch(() => false);
      if (ok) return st.url;
    }
  }
  let tail = "";
  try { tail = fs.readFileSync(path.join(root, ".canvas", "server.log"), "utf8").split("\n").filter(Boolean).slice(-3).join(" "); } catch {}
  throw new Error(tail || "The canvas didn't start in time.");
}

async function projects() {
  const all = list();
  return Promise.all(all.map(async (p) => {
    const up = await running(p.root);
    const thumb = thumbnail(p.root);
    let thumbAt = 0; try { thumbAt = thumb ? fs.statSync(thumb).mtimeMs : 0; } catch {}
    return {
      root: p.root, name: up?.name || p.name || path.basename(p.root), framework: p.framework, mode: p.mode,
      views: up?.views ?? p.views ?? 0, lastOpened: p.lastOpened,
      thumb: thumb ? `/api/hub/thumb?root=${encodeURIComponent(p.root)}&v=${Math.round(thumbAt)}` : null,
      running: !!up, url: up?.url ?? null, chats: up?.chats ?? 0, live: !!up?.live, working: up?.working ?? 0, waiting: up?.waiting ?? 0,
    };
  }));
}

export function createHub({ spawnServer = defaultSpawn } = {}) {
  let index = null;
  const indexHtml = () => {
    if (index) return index;
    const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
    return (index = html.replace("<head>", `<head><script>window.__LOUPE_HUB__ = ${JSON.stringify({ version: VERSION })}</script><title>Loupe</title>`));
  };
  return http.createServer(async (req, res) => {
    try {
      const host = (req.headers.host || "").split(":")[0];
      if (!["localhost", "127.0.0.1"].includes(host)) return send(res, 403, { error: "forbidden" });
      const origin = req.headers.origin;
      if (req.method !== "GET" && origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return send(res, 403, { error: "forbidden" });
      const url = new URL(req.url, "http://localhost");
      const p = url.pathname;

      if (p === "/api/hub/projects") return send(res, 200, { version: VERSION, projects: await projects() });
      if (p === "/api/hub/thumb") {
        const root = url.searchParams.get("root");
        if (!list().some((x) => x.root === root)) return send(res, 404, "", "text/plain");
        const f = thumbnail(root);
        if (!f) return send(res, 404, "", "text/plain");
        res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream", "Cache-Control": "max-age=31536000" });
        return fs.createReadStream(f).pipe(res);
      }
      if (req.method === "POST" && p === "/api/hub/open") {
        const { root } = await readBody(req);
        if (!list().some((x) => x.root === root)) return send(res, 404, { error: "Not one of your Loupe projects." });
        try { return send(res, 200, { url: await openProject(root, spawnServer) }); }
        catch (e) { return send(res, 500, { error: String(e.message || e) }); }
      }
      if (req.method === "POST" && p === "/api/hub/add") {
        const b = await readBody(req);
        const root = path.resolve(String(b.root || "").replace(/^~(?=$|\/)/, process.env.HOME || "~"));
        if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return send(res, 400, { error: "That folder doesn't exist." });
        const m = loadManifest(root);
        let name = m?.project?.name;
        if (!name) try { name = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name; } catch {}
        remember(root, { name: name || path.basename(root) });
        return send(res, 200, { root });
      }
      if (req.method === "POST" && p === "/api/hub/forget") {
        const { root } = await readBody(req);
        forget(root);
        return send(res, 200, { ok: true });
      }
      if (req.method === "POST" && p === "/api/hub/stop") {
        const { root } = await readBody(req);
        if (!list().some((x) => x.root === root)) return send(res, 404, { error: "Not one of your Loupe projects." });
        const st = readState(root);
        if (st.pid && await running(root)) try { process.kill(st.pid, "SIGTERM"); } catch {}
        return send(res, 200, { ok: true });
      }

      // The app itself
      const rel = p === "/" ? "index.html" : p.replace(/^\/+/, "");
      const file = path.join(DIST, rel);
      if (!file.startsWith(DIST)) return send(res, 403, "", "text/plain");
      if (rel !== "index.html" && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream", "Cache-Control": rel.startsWith("assets/") ? "max-age=31536000, immutable" : "no-store" });
        return fs.createReadStream(file).pipe(res);
      }
      return send(res, 200, indexHtml(), "text/html; charset=utf-8");
    } catch (e) {
      send(res, 500, { error: String(e?.message || e) });
    }
  });
}

export function freePort(start) {
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

/** Start the home server; resolves to its URL */
export async function startHub({ port = 4700, spawnServer, env } = {}) {
  if (env) extraEnv = env;
  const p = await freePort(port);
  const server = createHub({ spawnServer });
  await new Promise((r) => server.listen(p, "127.0.0.1", r));
  setTimeout(() => stopOutdated().catch(() => {}), 3000).unref?.();
  setInterval(() => stopOutdated().catch(() => {}), 30_000).unref?.();
  return { url: `http://localhost:${p}`, server };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true] : null).filter(Boolean));
  const { url } = await startHub({ port: Number(args.port) || 4700 });
  console.log(`[loupe] home → ${url}`);
  if (args.open) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    spawn(opener, process.platform === "win32" ? ["/c", "start", url] : [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  }
}
