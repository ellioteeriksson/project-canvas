/* Project Canvas frame helper. Injected into pages shown on the canvas (via the local proxy).
 * - Reports the page's full content height to the canvas (for "Full page" frames)
 * - Freezes vh/svh/dvh/lvh units at the normal viewport height before the frame is stretched,
 *   so "100vh" heroes keep their real size instead of growing with the frame.
 * - Reports runtime errors and the current path.
 * - Renders the whole page to an image (the static snapshots shown on the canvas).
 * Does nothing when the page isn't inside a frame.
 * Source: app/helper/frame-helper.js, bundled into server/frame-helper.js by `npm run build`. */
import { domToWebp } from "modern-screenshot";

(() => {
  if (window.__projectCanvasFrame || window.parent === window) return;
  window.__projectCanvasFrame = true;

  const post = (msg) => { try { window.parent.postMessage({ source: "project-canvas", ...msg }, "*"); } catch {} };
  const VH = /(-?\d*\.?\d+)(?:d|s|l)?vh\b/g;
  let full = false;
  let wire = false;
  let lastMutation = Date.now();
  let frozenVH = null;
  let lastH = 0;
  let timer = 0;

  const freezeValue = (v) => v.replace(VH, (_, n) => `${(parseFloat(n) * frozenVH) / 100}px`);

  function freezeRules(rules) {
    for (const r of rules) {
      try {
        const st = r.style;
        if (st) {
          for (let i = 0; i < st.length; i++) {
            const p = st[i];
            const v = st.getPropertyValue(p);
            if (v && v.includes("vh")) st.setProperty(p, freezeValue(v), st.getPropertyPriority(p));
          }
        }
        if (r.cssRules) freezeRules(r.cssRules);
      } catch {}
    }
  }

  function freezeAll() {
    if (frozenVH == null) return;
    for (const sheet of document.styleSheets) {
      try { freezeRules(sheet.cssRules); } catch {} // cross-origin sheets (fonts) can't be read
    }
    for (const el of document.querySelectorAll('[style*="vh"]')) {
      const s = el.getAttribute("style");
      if (s) el.setAttribute("style", freezeValue(s));
    }
  }

  function contentHeight() {
    const body = document.body;
    if (!body) return 0;
    let bottom = 0;
    for (const el of body.children) {
      const cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.display === "none") continue;
      const r = el.getBoundingClientRect();
      bottom = Math.max(bottom, r.bottom + window.scrollY + (parseFloat(cs.marginBottom) || 0));
    }
    const bcs = getComputedStyle(body);
    bottom += (parseFloat(bcs.paddingBottom) || 0) + (parseFloat(bcs.marginBottom) || 0);
    if (bottom < 10) bottom = Math.max(document.documentElement.scrollHeight, body.scrollHeight);
    return Math.ceil(Math.max(bottom, frozenVH || 0));
  }

  function report() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!full) return;
      const h = contentHeight();
      if (Math.abs(h - lastH) > 2) {
        lastH = h;
        post({ type: "height", h });
      }
    }, 120);
  }

  function enableFull() {
    if (frozenVH == null) frozenVH = window.innerHeight;
    full = true;
    freezeAll();
    lastH = 0;
    report();
    // Late styles (route changes, HMR, CSS-in-JS) get frozen too
    setTimeout(() => { freezeAll(); report(); }, 600);
    setTimeout(() => { freezeAll(); report(); }, 2000);
  }

  /* ---------- Wireframe layer ---------- */
  const WIRE_CSS = `
html.pc-wire, html.pc-wire body { background: #fff !important; }
html.pc-wire *, html.pc-wire *::before, html.pc-wire *::after {
  background-color: transparent !important; background-image: none !important;
  box-shadow: none !important; text-shadow: none !important; border-color: #cfd5dd !important;
  color: transparent !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important;
  text-decoration-line: underline !important; text-decoration-style: solid !important;
  text-decoration-color: #d3d9e1 !important; text-decoration-thickness: .62em !important;
  text-underline-offset: -.5em !important; text-decoration-skip-ink: none !important;
  transition: none !important; animation: none !important;
}
html.pc-wire :is(h1, h2, h3, h4, h5, h6, h1 *, h2 *, h3 *, h4 *, h5 *, h6 *) { text-decoration-color: #a9b2bf !important; }
html.pc-wire :is(a, a *) { text-decoration-color: #b4c3e6 !important; }
html.pc-wire :is(button, [role="button"], input, select, textarea, summary) { outline: 1.5px solid #8d98a8 !important; outline-offset: 0 !important; border-radius: 6px; }
html.pc-wire :is(header, nav, main, section, article, aside, footer, form) { outline: 1px dashed #c3cad4 !important; outline-offset: -1px !important; }
html.pc-wire :is(img, picture, video, canvas, svg, iframe, object, embed) { filter: grayscale(1) contrast(0) brightness(1.5) !important; outline: 1px solid #c3cad4 !important; outline-offset: -1px !important; }
html.pc-wire [data-pc-bg] { background-color: #e7eaef !important; }
html.pc-wire ::placeholder { color: transparent !important; }`;

  function markBackgrounds() {
    const els = document.querySelectorAll("body *");
    for (let i = 0; i < els.length && i < 8000; i++) {
      const el = els[i];
      if (el.hasAttribute("data-pc-bg")) continue;
      const bg = getComputedStyle(el).backgroundImage;
      if (bg && bg !== "none" && /url\(/.test(bg)) el.setAttribute("data-pc-bg", "");
    }
  }
  let wireTimer = 0;
  function setWire(on) {
    wire = on;
    let style = document.getElementById("pc-wire-style");
    if (on) {
      document.documentElement.classList.remove("pc-wire");
      markBackgrounds(); // read real backgrounds before the wireframe hides them
      if (!style) {
        style = document.createElement("style");
        style.id = "pc-wire-style";
        style.textContent = WIRE_CSS;
        (document.head || document.documentElement).appendChild(style);
      }
      document.documentElement.classList.add("pc-wire");
    } else {
      document.documentElement.classList.remove("pc-wire");
    }
  }

  /* ---------- Snapshots ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DEV_OVERLAYS = new Set(["NEXTJS-PORTAL", "VITE-ERROR-OVERLAY", "ASTRO-DEV-TOOLBAR", "ASTRO-DEV-OVERLAY"]);

  async function settle() {
    try { await document.fonts?.ready; } catch {}
    const pending = [...document.images].filter((i) => !i.complete);
    await Promise.race([
      Promise.all(pending.map((i) => new Promise((r) => { i.addEventListener("load", r, { once: true }); i.addEventListener("error", r, { once: true }); }))),
      sleep(4000),
    ]);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await sleep(200);
  }

  // Scroll through once so scroll-triggered reveals and lazy images run, then back to the top
  async function revealAll() {
    const step = Math.max(300, Math.round(window.innerHeight * 0.85));
    const end = Math.min(contentHeight() || document.documentElement.scrollHeight, 16000);
    for (let y = step; y < end; y += step) { window.scrollTo(0, y); await sleep(110); }
    window.scrollTo(0, end);
    await sleep(250);
    window.scrollTo(0, 0);
    await sleep(350);
  }

  let snapping = false;
  async function snapshot(id, maxW) {
    if (snapping) return;
    snapping = true;
    try {
      if (frozenVH == null) frozenVH = window.innerHeight;
      await settle();
      await revealAll();
      await settle();
      const h = Math.min(Math.max(contentHeight(), window.innerHeight), 16000);
      const w = window.innerWidth;
      const scale = Math.min(1, (maxW || 720) / w);
      const bg = getComputedStyle(document.body || document.documentElement).backgroundColor;
      const dataUrl = await domToWebp(document.documentElement, {
        width: w,
        height: h,
        scale,
        quality: 0.82,
        backgroundColor: bg && bg !== "rgba(0, 0, 0, 0)" ? bg : getComputedStyle(document.documentElement).backgroundColor || "#ffffff",
        style: { height: `${h}px`, minHeight: `${h}px`, overflow: "visible" },
        timeout: 20000,
        filter: (node) => !(node instanceof Element) || (!DEV_OVERLAYS.has(node.tagName) && !node.hasAttribute("data-project-canvas")),
        fetch: { requestInit: { cache: "force-cache" } },
      });
      post({ type: "snapshot", id, dataUrl, h, w });
    } catch (err) {
      post({ type: "snapshot-error", id, message: String(err?.message || err).slice(0, 300) });
    } finally {
      snapping = false;
    }
  }

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.source !== "project-canvas-host") return;
    if (d.type === "snapshot") snapshot(d.id, d.maxW);
    if (d.type === "fullpage") {
      if (d.on) enableFull();
      else { full = false; lastH = 0; }
    }
    if (d.type === "wireframe") setWire(!!d.on);
    // The canvas asks after an agent edit: did the page update itself (hot reload) since then?
    if (d.type === "query-mutation") post({ type: "mutation", at: lastMutation, id: d.id });
  });

  const start = () => {
    try {
      new ResizeObserver(report).observe(document.documentElement);
      if (document.body) new ResizeObserver(report).observe(document.body);
      new MutationObserver((muts) => {
        if (muts.some((m) => !(m.target.id === "pc-wire-style"))) lastMutation = Date.now();
        if (wire) { clearTimeout(wireTimer); wireTimer = setTimeout(() => setWire(true), 150); }
        if (!full) return;
        if (muts.some((m) => [...m.addedNodes].some((n) => n.nodeName === "STYLE" || n.nodeName === "LINK"))) setTimeout(() => { freezeAll(); report(); }, 50);
        report();
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch {}
    window.addEventListener("load", report);
    post({ type: "ready", path: location.pathname + location.search });
  };

  window.addEventListener("error", (e) => post({ type: "error", message: String(e.message || "Error").slice(0, 300) }));
  window.addEventListener("unhandledrejection", (e) => post({ type: "error", message: String(e.reason?.message || e.reason || "Unhandled rejection").slice(0, 300) }));

  // SPA navigations inside an interactive frame
  for (const k of ["pushState", "replaceState"]) {
    const orig = history[k];
    history[k] = function (...a) { const r = orig.apply(this, a); post({ type: "navigate", path: location.pathname + location.search }); report(); return r; };
  }
  window.addEventListener("popstate", () => post({ type: "navigate", path: location.pathname + location.search }));

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
