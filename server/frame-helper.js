/* Project Canvas frame helper. Injected into pages shown on the canvas (via the local proxy).
 * - Reports the page's full content height to the canvas (for "Full page" frames)
 * - Freezes vh/svh/dvh/lvh units at the normal viewport height before the frame is stretched,
 *   so "100vh" heroes keep their real size instead of growing with the frame.
 * - Reports runtime errors and the current path.
 * Does nothing when the page isn't inside a frame. */
(() => {
  if (window.__projectCanvasFrame || window.parent === window) return;
  window.__projectCanvasFrame = true;

  const post = (msg) => { try { window.parent.postMessage({ source: "project-canvas", ...msg }, "*"); } catch {} };
  const VH = /(-?\d*\.?\d+)(?:d|s|l)?vh\b/g;
  let full = false;
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

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.source !== "project-canvas-host") return;
    if (d.type === "fullpage") {
      if (d.on) enableFull();
      else { full = false; lastH = 0; }
    }
  });

  const start = () => {
    try {
      new ResizeObserver(report).observe(document.documentElement);
      if (document.body) new ResizeObserver(report).observe(document.body);
      new MutationObserver((muts) => {
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
