/**
 * Frame proxy: serves the project's dev server on a local port so pages can be framed by the canvas.
 *  - strips X-Frame-Options and CSP frame-ancestors (dev-only, nothing is changed in the project)
 *  - rewrites Host/Origin/Referer and redirect Locations so frameworks see a same-origin request
 *  - forwards WebSocket upgrades so hot reload keeps working
 *  - injects /__canvas_frame.js into HTML pages (full-page height + error reporting)
 */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HELPER_PATH = "/__canvas_frame.js";
const HELPER = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "frame-helper.js"), "utf8");
export const HELPER_TAG = `<script src="${HELPER_PATH}" data-project-canvas></script>`;

export function serveHelper(req, res) {
  if (!req.url.startsWith(HELPER_PATH)) return false;
  res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
  res.end(HELPER);
  return true;
}

function stripFrameAncestors(v) {
  if (!v) return v;
  const list = Array.isArray(v) ? v : [v];
  const out = list
    .map((s) => s.split(";").map((d) => d.trim()).filter((d) => d && !/^frame-ancestors\b/i.test(d)).join("; "))
    .filter(Boolean);
  return out.length ? out : undefined;
}

/** Inject the helper tag into a streamed HTML response right after <head>. */
export function injectingWriter(res) {
  let injected = false;
  let buf = Buffer.alloc(0);
  const flush = (force) => {
    const s = buf.toString("latin1");
    const m = s.match(/<head\b[^>]*>/i);
    let idx = -1;
    if (m) idx = m.index + m[0].length;
    else if (force || buf.length > 256 * 1024) {
      const b = s.match(/<body\b[^>]*>/i) || s.match(/<html\b[^>]*>/i);
      idx = b ? b.index + b[0].length : s.match(/^\s*<!doctype[^>]*>/i)?.[0].length ?? 0;
    }
    if (idx < 0) return;
    res.write(Buffer.concat([buf.subarray(0, idx), Buffer.from(HELPER_TAG), buf.subarray(idx)]));
    buf = Buffer.alloc(0);
    injected = true;
  };
  return {
    write(chunk) {
      if (injected) return res.write(chunk);
      buf = Buffer.concat([buf, chunk]);
      flush(false);
    },
    end() {
      if (!injected) flush(true);
      res.end();
    },
  };
}

export function createFrameProxy({ getTarget, onStatus }) {
  const server = http.createServer((req, res) => {
    if (serveHelper(req, res)) return;
    let target;
    try { target = new URL(getTarget()); } catch { res.writeHead(502); return res.end("No dev server URL configured"); }
    const self = `http://${req.headers.host}`;
    const headers = { ...req.headers, host: target.host, "accept-encoding": "identity" };
    if (headers.origin) headers.origin = target.origin;
    if (headers.referer) headers.referer = headers.referer.replace(self, target.origin);
    const isDoc = req.headers["sec-fetch-dest"] === "iframe" || req.headers["sec-fetch-dest"] === "document";
    const t0 = Date.now();

    const preq = http.request(
      { hostname: target.hostname, port: target.port || 80, method: req.method, path: req.url, headers },
      (pres) => {
        const h = { ...pres.headers };
        delete h["x-frame-options"];
        for (const k of ["content-security-policy", "content-security-policy-report-only"]) {
          const v = stripFrameAncestors(h[k]);
          if (v) h[k] = v; else delete h[k];
        }
        if (h.location?.startsWith(target.origin)) h.location = self + h.location.slice(target.origin.length);
        const html = /text\/html/i.test(h["content-type"] || "") && req.method !== "HEAD" && (!h["content-encoding"] || h["content-encoding"] === "identity");
        if (isDoc) onStatus?.({ path: req.url, status: pres.statusCode, ms: Date.now() - t0, location: h.location });
        if (!html) {
          res.writeHead(pres.statusCode, h);
          return pres.pipe(res);
        }
        delete h["content-length"];
        res.writeHead(pres.statusCode, h);
        const w = injectingWriter(res);
        pres.on("data", (c) => w.write(c));
        pres.on("end", () => w.end());
        pres.on("error", () => res.end());
      },
    );
    preq.on("error", (err) => {
      if (isDoc) onStatus?.({ path: req.url, status: 0, error: err.code || err.message });
      if (res.headersSent) return res.end();
      res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head>${HELPER_TAG}</head><body style="font:14px system-ui;padding:32px;color:#5b6578;background:#fff">
        <p style="font-size:18px;color:#1c2230;margin:0 0 8px">Can't reach the dev server</p>
        <p style="margin:0">${target.origin} isn't answering (${err.code || "error"}). Start it, then this page reloads on its own.</p>
        <script>setTimeout(()=>location.reload(),4000)</script></body></html>`);
    });
    req.pipe(preq);
  });

  // WebSockets (Next.js / Vite / Astro hot reload)
  server.on("upgrade", (req, socket, head) => {
    let target;
    try { target = new URL(getTarget()); } catch { return socket.destroy(); }
    const up = net.connect(Number(target.port || 80), target.hostname, () => {
      const lines = [];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        let v = req.rawHeaders[i + 1];
        if (/^host$/i.test(k)) v = target.host;
        if (/^origin$/i.test(k)) v = target.origin;
        lines.push(`${k}: ${v}`);
      }
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`);
      if (head?.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on("error", () => socket.destroy());
    socket.on("error", () => up.destroy());
  });
  return server;
}
