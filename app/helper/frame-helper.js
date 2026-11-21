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
  // A grayscale wireframe: blocks become gray fills, images become crossed boxes,
  // text becomes gray bars, buttons gray pills, icons gray silhouettes.
  const IMG_X_SRC = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect width="100" height="100" fill="#d6d6d6"/><path d="M0 0L100 100M100 0L0 100" stroke="#bdbdbd" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>')}`;
  const IMG_X = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none"><rect width="100" height="100" fill="#d6d6d6"/><path d="M0 0L100 100M100 0L0 100" stroke="#bdbdbd" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>')}")`;
  const WIRE_CSS = `
html.pc-wire, html.pc-wire body { background: #fff !important; }
html.pc-wire *, html.pc-wire *::before, html.pc-wire *::after {
  background-color: transparent !important; background-image: none !important;
  box-shadow: none !important; text-shadow: none !important; border-color: #d9d9d9 !important;
  color: transparent !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important;
  text-decoration-line: underline !important; text-decoration-style: solid !important;
  text-decoration-color: #cfcfcf !important; text-decoration-thickness: .6em !important;
  text-underline-offset: -.48em !important; text-decoration-skip-ink: none !important;
  outline: none !important; transition: none !important; animation: none !important; filter: none !important; backdrop-filter: none !important;
}
html.pc-wire :is(h1, h2, h3, h4, h5, h6, h1 *, h2 *, h3 *, h4 *, h5 *, h6 *) { text-decoration-color: #a3a3a3 !important; }
html.pc-wire [data-pc-fill] { background-color: #f2f2f2 !important; }
html.pc-wire [data-pc-fill] [data-pc-fill] { background-color: #e8e8e8 !important; }
html.pc-wire [data-pc-fill] [data-pc-fill] [data-pc-fill] { background-color: #dedede !important; }
html.pc-wire [data-pc-bg] { background: #d6d6d6 ${IMG_X.replace("url(", "url(")} center / 100% 100% no-repeat !important; }
html.pc-wire :is(header, footer, section) { box-shadow: inset 0 -1px 0 #e3e3e3 !important; }
html.pc-wire :is(button, [role="button"], input[type="submit"], input[type="button"], a[class*="btn"], a[class*="button"]) {
  background-color: #d4d4d4 !important; border-color: #d4d4d4 !important;
}
html.pc-wire :is(button, [role="button"], a[class*="btn"], a[class*="button"]) :is(*), html.pc-wire :is(button, [role="button"]) { text-decoration-color: #9e9e9e !important; }
html.pc-wire :is(input:not([type="submit"]):not([type="button"]), textarea, select) { background-color: #fff !important; border: 1px solid #bdbdbd !important; }
html.pc-wire img { content: ${IMG_X} !important; object-fit: fill !important; }
html.pc-wire :is(video, canvas, iframe, object, embed) { filter: grayscale(1) contrast(0) brightness(1.55) !important; }
html.pc-wire svg { filter: grayscale(1) brightness(0) invert(.74) !important; }
html.pc-wire ::placeholder { color: transparent !important; }`;

  function markBackgrounds() {
    const page = getComputedStyle(document.body || document.documentElement).backgroundColor;
    const els = document.querySelectorAll("body *");
    for (let i = 0; i < els.length && i < 8000; i++) {
      const el = els[i];
      if (el.hasAttribute("data-pc-bg") || el.hasAttribute("data-pc-fill")) continue;
      const cs = getComputedStyle(el);
      const bg = cs.backgroundImage;
      if (bg && bg !== "none" && /url\(/.test(bg)) { el.setAttribute("data-pc-bg", ""); continue; }
      const c = cs.backgroundColor;
      const alpha = /rgba?\(([^)]+)\)/.exec(c)?.[1].split(",")[3];
      const visible = c && c !== "transparent" && (alpha === undefined || parseFloat(alpha) > 0.06);
      if ((visible && c !== page) || (bg && /gradient/.test(bg))) el.setAttribute("data-pc-fill", "");
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

  /* ---------- Sections ---------- */
  const SKIP_COMPONENT = /^(SegmentViewNode|SegmentViewStateNode|.*Segment.*|ScrollAndFocusHandler|InnerScrollAndFocusHandler|HotReload|ReactDevOverlay|AppRouter|ServerRoot|Head|Html|Body|Fragment|Suspense|Section|Container|Box|Wrapper|Div|Main|Layout|RootLayout|Root|Provider|.*Provider|.*Boundary|AnimatePresence|Motion.*|Link|LinkComponent|Image|Img|.*Router|.*Handler|ClientPageRoot|ClientSegmentRoot|RenderFromTemplateContext|HTTPAccessFallback.*|Redirect.*|LoadingBoundary|Slot|Page|.*Page|App)$/;
  function componentName(el) {
    const k = Object.keys(el).find((x) => x.startsWith("__reactFiber$"));
    let f = k ? el[k] : null;
    for (let i = 0; f && i < 40; i++, f = f.return) {
      const t = f.type;
      const n = typeof t === "function" ? t.displayName || t.name : t && typeof t === "object" ? t.displayName || t.render?.name || t.type?.name : null;
      if (n && /^[A-Z]/.test(n) && !SKIP_COMPONENT.test(n)) return n;
    }
    return null;
  }
  const humanize = (s) => s.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).trim();
  function detectSections() {
    const minH = 48;
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.height >= minH && r.width >= window.innerWidth * 0.5; };
    const outermost = (list) => list.filter((el) => !list.some((o) => o !== el && o.contains(el)));
    let list = outermost([...document.querySelectorAll("header, nav, section, footer, [data-section]")].filter(vis));
    // A wrapper <section> holding several sections is split into its children
    for (let pass = 0; pass < 3; pass++) {
      list = list.flatMap((el) => {
        const inner = outermost([...el.querySelectorAll("section, [data-section]")].filter((x) => x !== el && vis(x)));
        return inner.length >= 2 ? inner : [el];
      });
    }
    if (list.length < 2) {
      let c = document.querySelector("main") || document.body;
      for (let i = 0; i < 10; i++) { const kids = [...c.children].filter(vis); if (kids.length === 1) c = kids[0]; else break; }
      list = [...c.children].filter(vis);
    }
    list = list.filter((el) => getComputedStyle(el).position !== "fixed");
    const out = list
      .map((el) => {
        const r = el.getBoundingClientRect();
        const heading = el.querySelector("h1, h2, h3, [role=heading]")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 80) || null;
        const tag = el.tagName.toLowerCase();
        const label = el.getAttribute("data-section") || el.getAttribute("aria-label") || (el.id ? humanize(el.id) : null);
        const o = {
          name: label || heading || (tag === "header" ? "Header" : tag === "footer" ? "Footer" : tag === "nav" ? "Navigation" : null),
          heading,
          tag,
          id: el.id || null,
          component: componentName(el),
          top: Math.round(r.top + window.scrollY),
          height: Math.round(r.height),
        };
        Object.defineProperty(o, "el", { value: el, enumerable: false });
        return o;
      })
      .sort((a, b) => a.top - b.top);
    // A component name shared by most sections is the page itself, not a section component
    const counts = {};
    out.forEach((x) => x.component && (counts[x.component] = (counts[x.component] || 0) + 1));
    out.forEach((x, i) => {
      if (x.component && counts[x.component] >= 3) x.component = null;
      if (!x.name) x.name = x.component ? humanize(x.component) : `Section ${i + 1}`;
    });
    return out.slice(0, 60);
  }

  /* ---------- Element picking ---------- */
  let picking = false;
  let hoverEl = null;
  let chosen = [];
  const layer = () => {
    let l = document.getElementById("pc-pick-layer");
    if (!l) {
      l = document.createElement("div");
      l.id = "pc-pick-layer";
      l.setAttribute("data-project-canvas", "");
      l.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
      document.body.appendChild(l);
    }
    return l;
  };
  const box = (el, cls, label) => {
    const r = el.getBoundingClientRect();
    const b = document.createElement("div");
    b.className = cls;
    b.style.cssText = `position:absolute;left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px;box-sizing:border-box;pointer-events:none;` +
      (cls === "pc-hover" ? "outline:2px solid #0d99ff;background:rgba(13,153,255,.08);" : "outline:2px solid #0d99ff;background:rgba(13,153,255,.16);");
    if (label) {
      const t = document.createElement("div");
      t.textContent = label;
      t.style.cssText = "position:absolute;left:-2px;bottom:100%;margin-bottom:2px;background:#0d99ff;color:#fff;font:500 11px/1.4 ui-sans-serif,system-ui,sans-serif;padding:1px 6px;border-radius:3px;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis;";
      if (r.top < 22) { t.style.bottom = "auto"; t.style.top = "100%"; t.style.marginTop = "2px"; }
      b.appendChild(t);
    }
    return b;
  };
  function kindOf(el) {
    const t = el.tagName;
    if (t === "BUTTON" || el.getAttribute("role") === "button" || (t === "INPUT" && /submit|button/.test(el.type))) return "button";
    if (t === "A") return "link";
    if (/^H[1-6]$/.test(t)) return "heading";
    if (/^(IMG|PICTURE|SVG|VIDEO|CANVAS|svg)$/.test(t)) return "image";
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t)) return "field";
    if (/^(SECTION|HEADER|FOOTER|NAV|MAIN|ARTICLE|ASIDE)$/.test(t) || el.hasAttribute("data-section")) return "section";
    if (/^(P|SPAN|LI|LABEL|BLOCKQUOTE|STRONG|EM|SMALL|FIGCAPTION|DT|DD)$/.test(t)) return "text";
    return "block";
  }
  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && el !== document.body && parts.length < 6) {
      let s = el.tagName.toLowerCase();
      if (el.id) { parts.unshift(`${s}#${CSS.escape(el.id)}`); break; }
      const cls = [...el.classList].filter((c) => !/^(css-|sc-|jsx-|_)|[0-9a-f]{5,}|__/.test(c)).slice(0, 2);
      if (cls.length) s += "." + cls.map((c) => CSS.escape(c)).join(".");
      const sib = el.parentElement ? [...el.parentElement.children].filter((x) => x.tagName === el.tagName) : [];
      if (sib.length > 1) s += `:nth-of-type(${sib.indexOf(el) + 1})`;
      parts.unshift(s);
      el = el.parentElement;
    }
    return parts.join(" > ");
  }
  function sectionOf(el) {
    const s = el.closest("section, header, footer, nav, [data-section]");
    if (!s) return null;
    const heading = s.querySelector("h1, h2, h3")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 60);
    return s.getAttribute("data-section") || s.getAttribute("aria-label") || (s.id ? humanize(s.id) : null) || heading ||
      ({ HEADER: "Header", FOOTER: "Footer", NAV: "Navigation" })[s.tagName] || null;
  }
  function describe(el) {
    const r = el.getBoundingClientRect();
    const text = (el.innerText || el.getAttribute("alt") || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || "")
      .replace(/\s+/g, " ").trim().slice(0, 140);
    return {
      kind: kindOf(el), tag: el.tagName.toLowerCase(), id: el.id || null, selector: cssPath(el), text: text || null,
      href: el.getAttribute("href"), component: componentName(el), section: sectionOf(el),
      top: Math.round(r.top + scrollY), left: Math.round(r.left + scrollX), width: Math.round(r.width), height: Math.round(r.height),
      html: el.outerHTML.replace(/\s+/g, " ").slice(0, 280),
    };
  }
  const labelFor = (el) => {
    const k = kindOf(el);
    const t = (el.innerText || el.getAttribute("alt") || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 40);
    return `${k}${el.id ? " #" + el.id : ""}${t ? " · " + t : ""}`;
  };
  function drawPick() {
    const l = layer();
    l.replaceChildren(...chosen.filter((c) => c.isConnected).map((c, i) => box(c, "pc-chosen", `${i + 1}`)), ...(hoverEl ? [box(hoverEl, "pc-hover", labelFor(hoverEl))] : []));
  }
  const ignore = (el) => !el || el === document.documentElement || el === document.body || el.closest?.("[data-project-canvas]");
  function onMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (ignore(el) || el === hoverEl) return;
    hoverEl = el;
    drawPick();
  }
  function onClick(e) {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.type !== "click" || ignore(hoverEl)) return;
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    if (add) chosen = chosen.includes(hoverEl) ? chosen.filter((c) => c !== hoverEl) : [...chosen, hoverEl];
    else chosen = [hoverEl];
    drawPick();
    post({ type: "picked", elements: chosen.map(describe) });
  }
  function onKey(e) {
    if (!picking) return;
    if (e.key === "Escape") { e.preventDefault(); post({ type: "pick-done" }); }
    if (e.key === "ArrowUp" && hoverEl?.parentElement && !ignore(hoverEl.parentElement)) { e.preventDefault(); hoverEl = hoverEl.parentElement; drawPick(); }
    if (e.key === "ArrowDown" && hoverEl?.firstElementChild) { e.preventDefault(); hoverEl = hoverEl.firstElementChild; drawPick(); }
  }
  const BLOCK = ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "submit", "dblclick", "contextmenu"];
  function setPicking(on, selectors) {
    if (on === picking) return;
    picking = on;
    if (on) {
      chosen = (selectors || []).map((s) => { try { return document.querySelector(s); } catch { return null; } }).filter(Boolean);
      addEventListener("mousemove", onMove, true);
      BLOCK.forEach((t) => addEventListener(t, onClick, true));
      addEventListener("keydown", onKey, true);
      document.documentElement.style.cursor = "crosshair";
      drawPick();
    } else {
      removeEventListener("mousemove", onMove, true);
      BLOCK.forEach((t) => removeEventListener(t, onClick, true));
      removeEventListener("keydown", onKey, true);
      document.documentElement.style.cursor = "";
      hoverEl = null;
      document.getElementById("pc-pick-layer")?.remove();
    }
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
        // CSS \`content:\` swaps don't survive cloning, so wireframe images are swapped on the clone
        onCloneEachNode: wire ? (n) => {
          if (n instanceof HTMLImageElement) { n.removeAttribute("srcset"); n.src = IMG_X_SRC; n.style.objectFit = "fill"; }
          else if (n instanceof HTMLSourceElement) n.removeAttribute("srcset");
        } : null,
        fetch: { requestInit: { cache: "force-cache" } },
      });
      let sections = [];
      try { sections = detectSections().map((x) => ({ ...x })); } catch {}
      post({ type: "snapshot", id, dataUrl, h, w, sections });
    } catch (err) {
      post({ type: "snapshot-error", id, message: String(err?.message || err).slice(0, 300) });
    } finally {
      snapping = false;
    }
  }

  /* ---------- design concepts: preview a proposed change on the real page ---------- */
  const q = (sel) => { try { return sel ? document.querySelector(sel) : null; } catch { return null; } };
  function scopeTarget(scope) {
    if (scope.section != null) return detectSections()[scope.section]?.el || null;
    if (scope.selectors?.length) return q(scope.selectors[0]);
    return null;
  }
  function resolveTarget(sel, scope) {
    if (sel === "@scope" || sel === "@section") return scopeTarget(scope);
    const m = /^@element:(\d+)$/.exec(sel || "");
    if (m) return q(scope.selectors?.[Number(m[1]) - 1]);
    return q(sel);
  }
  async function concept(d) {
    const scope = d.scope || {};
    try {
      if (frozenVH == null) frozenVH = window.innerHeight;
      await settle();
      await revealAll();
      // Find every target before changing anything: section positions shift after a swap
      const scoped = scopeTarget(scope);
      const targets = (d.replace || []).map((r) => ({ r, el: resolveTarget(r.selector, scope) }));
      const missing = targets.filter((t) => !t.el).map((t) => t.r.selector);
      let changed = null;
      for (const { r, el } of targets) {
        if (!el) continue;
        const tpl = document.createElement("template");
        tpl.innerHTML = r.html || "";
        const nodes = [...tpl.content.childNodes];
        const firstEl = nodes.find((n) => n.nodeType === 1);
        if (el === scoped && firstEl) changed = firstEl;
        changed = changed || firstEl || null;
        el.replaceWith(...nodes);
      }
      if (d.css) {
        const st = document.createElement("style");
        st.setAttribute("data-pc-concept", "");
        st.textContent = d.css;
        document.head.appendChild(st);
      }
      await settle();
      await revealAll();
      // Capture the changed part: the new section, the section around a changed element, or the page
      let el = null;
      if (d.capture !== "page") {
        el = changed || scopeTarget(scope);
        if (el && scope.section == null && scope.selectors?.length) {
          const host = detectSections().map((x) => x.el).find((s) => s && s.contains(el));
          if (host) el = host;
        }
      }
      const bg = getComputedStyle(document.body || document.documentElement).backgroundColor;
      const background = bg && bg !== "rgba(0, 0, 0, 0)" ? bg : getComputedStyle(document.documentElement).backgroundColor || "#ffffff";
      const w = window.innerWidth;
      const scale = Math.min(1, (d.maxW || 900) / w);
      const opts = {
        scale, quality: 0.85, backgroundColor: background, timeout: 20000,
        filter: (node) => !(node instanceof Element) || (!DEV_OVERLAYS.has(node.tagName) && !node.hasAttribute("data-project-canvas")),
        fetch: { requestInit: { cache: "force-cache" } },
      };
      let dataUrl, h;
      if (el) {
        const r = el.getBoundingClientRect();
        h = Math.min(Math.round(r.height), 6000);
        // The background option paints the captured root, so only use it when the element has none of its own
        const own = getComputedStyle(el).backgroundColor;
        const elOpts = own && own !== "rgba(0, 0, 0, 0)" && own !== "transparent" ? { ...opts, backgroundColor: own } : opts;
        dataUrl = await domToWebp(el, { ...elOpts, width: Math.round(r.width), height: h, style: { margin: "0" } });
      } else {
        h = Math.min(Math.max(contentHeight(), window.innerHeight), 8000);
        dataUrl = await domToWebp(document.documentElement, { ...opts, width: w, height: h, style: { height: `${h}px`, minHeight: `${h}px`, overflow: "visible" } });
      }
      post({ type: "concept-shot", id: d.id, dataUrl, w, h, missing });
    } catch (err) {
      post({ type: "concept-error", id: d.id, message: String(err?.message || err).slice(0, 300) });
    }
  }

  // Change the page only after the framework has hydrated it; earlier changes cause hydration errors
  const afterHydration = (fn) => {
    const go = () => setTimeout(fn, 250);
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  };

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.source !== "project-canvas-host") return;
    if (d.type === "snapshot") snapshot(d.id, d.maxW);
    if (d.type === "fullpage") {
      if (d.on) afterHydration(enableFull);
      else { full = false; lastH = 0; }
    }
    if (d.type === "wireframe") { if (d.on || wire) afterHydration(() => setWire(!!d.on)); }
    if (d.type === "pick") afterHydration(() => setPicking(!!d.on, d.selectors));
    if (d.type === "concept") afterHydration(() => concept(d));
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
