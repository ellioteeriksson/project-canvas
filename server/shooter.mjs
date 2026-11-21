/**
 * Real page screenshots for the canvas snapshots, taken by a headless Chrome (or Edge, Brave,
 * Chromium) already on this machine, over the DevTools protocol. 2× pixel density, the browser's
 * own rendering: fonts, filters, video frames and WebGL come out as they look in a browser.
 * No dependencies: a small WebSocket client is included. With no browser found, `available()` is
 * false and the canvas falls back to drawing snapshots inside its frames.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";

const DEVICES = { desktop: { w: 1440, h: 900, mobile: false, dpr: 2 }, mobile: { w: 390, h: 844, mobile: true, dpr: 3 } };
const MAX_PX = 16000; // WebP's limit is 16383 px a side
const PARALLEL = 2;
const IDLE_MS = 3 * 60_000;

export function findBrowser() {
  if (process.env.LOUPE_CHROME && fs.existsSync(process.env.LOUPE_CHROME)) return process.env.LOUPE_CHROME;
  const home = os.homedir();
  const mac = (app, bin = app) => [`/Applications/${app}.app/Contents/MacOS/${bin}`, `${home}/Applications/${app}.app/Contents/MacOS/${bin}`];
  const candidates = process.platform === "darwin" ? [
    ...mac("Google Chrome"), ...mac("Google Chrome Canary"), ...mac("Chromium"), ...mac("Microsoft Edge"), ...mac("Brave Browser"),
    ...mac("Google Chrome for Testing"),
  ] : process.platform === "win32" ? [
    `${process.env["PROGRAMFILES"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env["PROGRAMFILES(X86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env["PROGRAMFILES"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ] : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "brave-browser"].map((b) => {
    try { return execFileSync("which", [b], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
  });
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  // Playwright's browsers, if the person has them
  const caches = process.platform === "darwin" ? [`${home}/Library/Caches/ms-playwright`] : [`${home}/.cache/ms-playwright`];
  for (const dir of caches) {
    let entries = [];
    try { entries = fs.readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse(); } catch { continue; }
    for (const e of entries) {
      const inner = process.platform === "darwin"
        ? ["chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]
        : ["chrome-linux64/chrome", "chrome-linux/chrome"];
      for (const i of inner) if (fs.existsSync(path.join(dir, e, i))) return path.join(dir, e, i);
    }
  }
  return null;
}

/* ---------- a minimal WebSocket client (text frames, as the DevTools protocol uses) ---------- */
function connectWS(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = crypto.randomBytes(16).toString("base64");
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": key } });
    req.on("error", reject);
    req.on("response", (res) => reject(new Error(`WebSocket upgrade refused (${res.statusCode})`)));
    req.on("upgrade", (_res, socket, head) => {
      socket.setNoDelay(true);
      const handlers = { message: () => {}, close: () => {} };
      let buf = head?.length ? Buffer.from(head) : Buffer.alloc(0);
      let parts = [];
      const send = (text, opcode = 1) => {
        const data = Buffer.from(text);
        const mask = crypto.randomBytes(4);
        const len = data.length;
        const header = len < 126 ? Buffer.from([0x80 | opcode, 0x80 | len])
          : len < 65536 ? Buffer.from([0x80 | opcode, 0x80 | 126, len >> 8, len & 255])
          : (() => { const h = Buffer.alloc(10); h[0] = 0x80 | opcode; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(len), 2); return h; })();
        for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
        socket.write(Buffer.concat([header, mask, data]));
      };
      socket.on("data", (chunk) => {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        for (;;) {
          if (buf.length < 2) return;
          const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          const maskKey = masked ? buf.subarray(off, off + 4) : null;
          if (masked) off += 4;
          if (buf.length < off + len) return;
          let payload = buf.subarray(off, off + len);
          if (maskKey) { payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3]; }
          buf = buf.subarray(off + len);
          if (op === 8) { socket.end(); return; }
          if (op === 9) { send(payload.toString(), 10); continue; }
          if (op === 1 || op === 2 || op === 0) {
            parts.push(Buffer.from(payload));
            if (fin) { const msg = Buffer.concat(parts).toString("utf8"); parts = []; handlers.message(msg); }
          }
        }
      });
      socket.on("close", () => handlers.close());
      socket.on("error", () => handlers.close());
      resolve({ send: (t) => send(t), on: (ev, fn) => { handlers[ev] = fn; }, close: () => socket.destroy() });
    });
    req.end();
  });
}

/* ---------- the browser ---------- */
export function createShooter({ log = () => {} } = {}) {
  const exe = findBrowser();
  let browser = null; // { proc, ws, call, onEvent, dir }
  let starting = null;
  let idleTimer = null;
  let active = 0;
  const queue = [];

  async function launch() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "loupe-shots-"));
    const proc = spawn(exe, [
      "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${dir}`,
      "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--disable-background-networking",
      "--disable-sync", "--hide-scrollbars", "--mute-audio", "--force-color-profile=srgb", "--disable-features=Translate,MediaRouter",
      "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    const wsUrl = await new Promise((resolve, reject) => {
      let err = "";
      const t = setTimeout(() => reject(new Error("The browser didn't start in time")), 20_000);
      proc.stderr.on("data", (d) => {
        err += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
        if (m) { clearTimeout(t); resolve(m[1]); }
      });
      proc.on("exit", (code) => { clearTimeout(t); reject(new Error(`The browser quit (${code}): ${err.slice(-300)}`)); });
    });
    proc.stderr.removeAllListeners("data");
    proc.stderr.resume();
    const ws = await connectWS(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = new Set();
    ws.on("message", (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else if (m.method) for (const l of listeners) l(m);
    });
    const b = {
      proc, ws, dir,
      call: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
      }),
      listen: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    };
    ws.on("close", () => {
      for (const p of pending.values()) p.reject(new Error("The browser closed"));
      pending.clear();
      if (browser === b) browser = null;
    });
    proc.on("exit", () => { if (browser === b) browser = null; try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
    log(`snapshots: using ${path.basename(exe)}`);
    return b;
  }

  async function getBrowser() {
    if (browser) return browser;
    if (!starting) starting = launch().then((b) => (browser = b)).finally(() => { starting = null; });
    return starting;
  }

  function stop() {
    clearTimeout(idleTimer);
    if (browser) { try { browser.ws.close(); } catch {} try { browser.proc.kill(); } catch {} browser = null; }
  }
  const bumpIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!active) stop(); }, IDLE_MS); idleTimer.unref?.(); };
  process.on("exit", stop);

  async function shootOnce({ url, device = "desktop", wire = false }) {
    const dev = DEVICES[device] || DEVICES.desktop;
    const b = await getBrowser();
    const { targetId } = await b.call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await b.call("Target.attachToTarget", { targetId, flatten: true });
    const call = (m, p) => b.call(m, p, sessionId);
    const waitFor = (method, ms) => new Promise((resolve) => {
      const t = setTimeout(() => { off(); resolve(false); }, ms);
      const off = b.listen((m) => { if (m.sessionId === sessionId && m.method === method) { clearTimeout(t); off(); resolve(true); } });
    });
    try {
      await call("Page.enable");
      await call("Page.addScriptToEvaluateOnNewDocument", { source: "window.__LOUPE_SHOT__ = true;" });
      await call("Emulation.setDeviceMetricsOverride", { width: dev.w, height: dev.h, deviceScaleFactor: dev.dpr, mobile: dev.mobile });
      if (dev.mobile) await call("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      const loaded = waitFor("Page.loadEventFired", 30_000);
      const nav = await call("Page.navigate", { url });
      if (nav.errorText) throw new Error(`Couldn't load the page (${nav.errorText})`);
      await loaded;
      const evaluate = async (expression) => {
        const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description?.split("\n")[0] || "Script error");
        return r.result.value;
      };
      // The helper comes in through Loupe's proxy; without it, a plain full-page shot
      let helper = false;
      for (let i = 0; i < 40 && !helper; i++) { helper = await evaluate("!!window.__loupeShot"); if (!helper) await new Promise((r) => setTimeout(r, 100)); }
      const prep = helper
        ? await evaluate(`window.__loupeShot.prepare(${JSON.stringify({ wire, minWait: 1200 })})`)
        : { h: Math.min(await evaluate("Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)"), MAX_PX), sections: [] };
      let h = Math.max(dev.h, Math.round(prep.h));
      // Grow the browser to the whole page; frozen viewport heights keep 100vh sections the same
      await call("Emulation.setDeviceMetricsOverride", { width: dev.w, height: h, deviceScaleFactor: dev.dpr, mobile: dev.mobile });
      if (helper) h = Math.max(dev.h, Math.round(await evaluate("window.__loupeShot.settleTall()")));
      else await new Promise((r) => setTimeout(r, 400));
      const scale = Math.min(1, MAX_PX / (h * dev.dpr), MAX_PX / (dev.w * dev.dpr));
      const shot = await call("Page.captureScreenshot", { format: "webp", quality: 92, clip: { x: 0, y: 0, width: dev.w, height: h, scale }, captureBeyondViewport: false, fromSurface: true });
      return { dataUrl: `data:image/webp;base64,${shot.data}`, w: dev.w, h, sections: prep.sections || [], engine: "browser" };
    } finally {
      b.call("Target.closeTarget", { targetId }).catch(() => {});
    }
  }

  function pump() {
    while (active < PARALLEL && queue.length) {
      const job = queue.shift();
      active++;
      shootOnce(job.args).then(job.resolve, job.reject).finally(() => { active--; bumpIdle(); pump(); });
    }
  }

  return {
    browser: exe ? path.basename(exe) : null,
    available: () => !!exe,
    /** Screenshot a page: resolves to { dataUrl, w, h, sections } */
    shoot: (args) => new Promise((resolve, reject) => {
      if (!exe) return reject(new Error("No Chrome, Edge, Brave or Chromium found"));
      // A newer request for the same frame replaces one still waiting
      const dup = queue.findIndex((q) => q.args.key && q.args.key === args.key);
      if (dup >= 0) queue.splice(dup, 1)[0].reject(new Error("superseded"));
      queue.push({ args, resolve, reject });
      pump();
    }),
    stop,
  };
}
