/* Loupe frame helper. Injected into pages shown on the canvas (via the local proxy).
 * - Reports the page's full content height to the canvas (for "Full page" frames)
 * - Freezes vh/svh/dvh/lvh units at the normal viewport height before the frame is stretched,
 *   so "100vh" heroes keep their real size instead of growing with the frame.
 * - Reports runtime errors and the current path.
 * - Renders the whole page to an image (the static snapshots shown on the canvas).
 * Does nothing when the page isn't inside a frame.
 * Source: app/helper/frame-helper.js, bundled into server/frame-helper.js by `npm run build`. */
import { domToWebp } from "modern-screenshot";

(() => {
  // Runs inside canvas frames, and top-level in the headless browser that takes snapshots
  const SHOT = !!window.__LOUPE_SHOT__;
  if (window.__projectCanvasFrame || (window.parent === window && !SHOT)) return;
  window.__projectCanvasFrame = true;

  const post = (msg) => { if (SHOT) return; try { window.parent.postMessage({ source: "project-canvas", ...msg }, "*"); } catch {} };
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
      (cls === "pc-hover" ? "outline:2px solid #0d99ff;background:rgba(13,153,255,.08);"
        : cls === "pc-marked" ? "outline:2px dashed #0d99ff;background:rgba(13,153,255,.10);"
        : cls === "pc-editing" ? "outline:2px solid #8a6bff;outline-offset:3px;border-radius:3px;"
        : "outline:2px solid #0d99ff;background:rgba(13,153,255,.16);");
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

  /* ---------- inspect: hover shows the box model, click shows the styles (like Dev Mode) ---------- */
  let inspecting = false, inspHover = null, inspSel = null;
  const px = (v) => Math.round(parseFloat(v) || 0);
  function boxModel(el, sel) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    const x = r.left + scrollX, y = r.top + scrollY;
    const pad = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(px);
    const mar = [cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft].map(px);
    const d = (l, t, w, h, css) => { const b = document.createElement("div"); b.style.cssText = `position:absolute;left:${l}px;top:${t}px;width:${Math.max(0, w)}px;height:${Math.max(0, h)}px;pointer-events:none;${css}`; return b; };
    const out = [];
    // margin (orange) and padding (green) bands, then the outline and a size tag
    if (mar.some(Boolean)) out.push(d(x - mar[3], y - mar[0], r.width + mar[1] + mar[3], r.height + mar[0] + mar[2], "background:rgba(255,155,60,.16)"));
    out.push(d(x, y, r.width, r.height, "background:rgba(80,200,120,.18)"));
    out.push(d(x + pad[3], y + pad[0], r.width - pad[1] - pad[3], r.height - pad[0] - pad[2], sel ? "background:rgba(13,153,255,.16)" : "background:rgba(13,153,255,.1)"));
    out.push(d(x, y, r.width, r.height, `outline:${sel ? 2 : 1}px solid #0d99ff`));
    const tag = document.createElement("div");
    tag.textContent = `${el.tagName.toLowerCase()} ${Math.round(r.width)} × ${Math.round(r.height)}`;
    tag.style.cssText = `position:absolute;left:${x}px;top:${r.top < 22 ? y + r.height + 2 : y - 20}px;background:#0d99ff;color:#fff;font:500 11px/1.5 ui-sans-serif,system-ui,sans-serif;padding:0 6px;border-radius:3px;white-space:nowrap;pointer-events:none;`;
    out.push(tag);
    return out;
  }
  function drawInspect() {
    const l = layer();
    l.replaceChildren(...(inspSel?.isConnected ? boxModel(inspSel, true) : []), ...(inspHover && inspHover !== inspSel ? boxModel(inspHover, false) : []));
  }
  function stylesOf(el) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    const four = (a) => { const v = a.map(px); return v.every((x) => x === v[0]) ? `${v[0]}` : v.join(" "); };
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    return {
      ...describe(el),
      size: `${Math.round(r.width)} × ${Math.round(r.height)}`,
      typography: hasText || /^(H[1-6]|P|A|BUTTON|LABEL|LI|SPAN)$/.test(el.tagName) ? {
        family: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(), size: cs.fontSize, weight: cs.fontWeight,
        lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, transform: cs.textTransform !== "none" ? cs.textTransform : null, align: cs.textAlign,
      } : null,
      color: cs.color, background: cs.backgroundColor !== "rgba(0, 0, 0, 0)" ? cs.backgroundColor : null,
      backgroundImage: cs.backgroundImage !== "none" ? cs.backgroundImage.slice(0, 160) : null,
      padding: four([cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft]),
      margin: four([cs.marginTop, cs.marginRight, cs.marginBottom, cs.marginLeft]),
      radius: cs.borderRadius !== "0px" ? cs.borderRadius : null,
      border: px(cs.borderTopWidth) ? `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}` : null,
      layout: { display: cs.display, direction: cs.display.includes("flex") ? cs.flexDirection : null, gap: cs.gap !== "normal" && cs.gap !== "0px" ? cs.gap : null, align: cs.display.includes("flex") || cs.display.includes("grid") ? cs.alignItems : null, justify: cs.display.includes("flex") || cs.display.includes("grid") ? cs.justifyContent : null, columns: cs.display.includes("grid") ? cs.gridTemplateColumns.slice(0, 120) : null },
      shadow: cs.boxShadow !== "none" ? cs.boxShadow.slice(0, 160) : null, opacity: cs.opacity !== "1" ? cs.opacity : null,
      viewport: window.innerWidth,
    };
  }
  function onInspMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (ignore(el) || el === inspHover) return;
    inspHover = el;
    drawInspect();
  }
  function onInspClick(e) {
    if (!inspecting) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (e.type !== "click" || ignore(inspHover)) return;
    inspSel = inspHover;
    drawInspect();
    post({ type: "inspected", element: stylesOf(inspSel) });
  }
  function onInspKey(e) {
    if (!inspecting || !inspSel) return;
    const next = e.key === "ArrowUp" ? inspSel.parentElement : e.key === "ArrowDown" ? inspSel.firstElementChild : null;
    if (next && !ignore(next)) { e.preventDefault(); inspSel = next; drawInspect(); post({ type: "inspected", element: stylesOf(inspSel) }); }
  }
  function setInspecting(on) {
    if (on === inspecting) return;
    inspecting = on;
    if (on) {
      addEventListener("mousemove", onInspMove, true);
      BLOCK.forEach((t) => addEventListener(t, onInspClick, true));
      addEventListener("keydown", onInspKey, true);
      document.documentElement.style.cursor = "default";
    } else {
      removeEventListener("mousemove", onInspMove, true);
      BLOCK.forEach((t) => removeEventListener(t, onInspClick, true));
      removeEventListener("keydown", onInspKey, true);
      document.documentElement.style.cursor = "";
      inspHover = inspSel = null;
      document.getElementById("pc-pick-layer")?.remove();
    }
  }
  /** Select the element at a selector (another breakpoint picked it) */
  function inspectSelector(sel) {
    const el = q(sel);
    if (!el) { inspSel = null; drawInspect(); post({ type: "inspected", element: null, missing: sel }); return; }
    inspSel = el;
    el.scrollIntoView({ block: "center", behavior: "instant" });
    drawInspect();
    post({ type: "inspected", element: stylesOf(el), mirrored: true });
  }

  /* ---------- focus: hover a section, click it to prompt about it (⌘-click still clicks the page) ---------- */
  let focusing = false, secList = [], secHover = -1, secSel = -1, secAt = 0, rectRaf = 0, secMarks = [];
  let editing = null; // { el, before, html } while you edit text on the page
  const sections = () => {
    if (Date.now() - secAt > 1500) { try { secList = detectSections(); } catch { secList = []; } secAt = Date.now(); }
    return secList;
  };
  const secIndexAt = (el) => sections().findIndex((x) => x.el === el || x.el.contains(el));
  function drawFocus() {
    const l = layer();
    const list = sections();
    const parts = [];
    // Sections collected for one prompt (shift-click)
    for (const i of secMarks) {
      const x = list[i];
      if (i === secSel || !x?.el?.isConnected) continue;
      parts.push(box(x.el, "pc-marked", `${x.name || `Section ${i + 1}`}`));
    }
    for (const [i, cls] of [[secSel, "pc-chosen"], [secHover !== secSel ? secHover : -1, "pc-hover"]]) {
      const x = list[i];
      if (!x?.el?.isConnected) continue;
      parts.push(box(x.el, cls, `${x.name || `Section ${i + 1}`}`));
    }
    if (editing?.el?.isConnected) parts.push(box(editing.el, "pc-editing", "Editing text · Enter saves · Esc cancels"));
    l.replaceChildren(...parts);
  }
  function sendRect() {
    cancelAnimationFrame(rectRaf);
    rectRaf = requestAnimationFrame(() => {
      const x = sections()[secSel];
      if (!x?.el?.isConnected) return;
      const r = x.el.getBoundingClientRect();
      post({ type: "section-rect", index: secSel, rect: { top: r.top, bottom: r.bottom, left: r.left, width: r.width }, vh: innerHeight });
    });
  }
  function pickSection(i, scroll, add) {
    const list = sections();
    if (i < 0 || i >= list.length) return;
    secSel = i;
    const x = list[i];
    if (scroll) x.el.scrollIntoView({ block: x.el.getBoundingClientRect().height > innerHeight * 0.8 ? "start" : "center", behavior: "smooth" });
    drawFocus();
    const { el, ...data } = x;
    post({ type: "section-picked", index: i, section: data, count: list.length, add: !!add, list: list.map(({ el: _e, ...d }) => d) });
    sendRect();
    setTimeout(sendRect, 400);
  }
  function onFocusMove(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (ignore(el)) return;
    const i = secIndexAt(el);
    if (i !== secHover) { secHover = i; drawFocus(); }
  }
  function onFocusClick(e) {
    if (!focusing || e.metaKey || e.ctrlKey) return; // ⌘-click uses the page as normal
    // While you edit text, clicks inside it place the caret; a click elsewhere saves it
    if (editing && editing.el.contains(e.target)) { if (e.type === "click" || e.type === "submit") e.preventDefault(); return; }
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (ignore(el)) return;
    // Double-click text to change it right here
    if (e.type === "dblclick") { startTextEdit(el); return; }
    if (e.type !== "click") return;
    if (editing) { endTextEdit(true); return; }
    // The second click of a double-click is for editing text, not picking again
    if (e.detail >= 2) return;
    // ⌥-click picks the element itself instead of its section
    if (e.altKey) { post({ type: "picked", elements: [describe(el)] }); return; }
    const i = secIndexAt(el);
    // ⇧-click collects several sections for one prompt
    if (i >= 0) pickSection(i, false, e.shiftKey);
  }

  /* ---------- edit text in place ---------- */
  const TEXTY = "h1,h2,h3,h4,h5,h6,p,a,button,li,span,label,figcaption,blockquote,dt,dd,td,th,small,strong,em,b,i,q,cite,summary,legend,caption,time";
  const BLOCKY = "div,section,article,header,footer,main,nav,aside,ul,ol,table,form,img,svg,video,picture,canvas,iframe,input,textarea,select";
  function textTarget(el) {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (ignore(n)) return null;
      if (!n.matches?.(TEXTY)) continue;
      if (n.querySelector(BLOCKY)) return null;
      const t = (n.innerText || "").trim();
      if (!t || t.length > 1500) return null;
      // A short inline bit inside a sentence: edit the whole sentence
      const up = n.parentElement;
      if (n.matches("span,strong,em,b,i,small,q,cite,time") && up?.matches?.(TEXTY) && !up.querySelector(BLOCKY)) continue;
      return n;
    }
    return null;
  }
  function startTextEdit(el) {
    const t = textTarget(el);
    if (!t) { post({ type: "text-edit-unavailable" }); return; }
    if (editing) endTextEdit(true);
    // Show (and read) the text as written, not as CSS transforms it (uppercase labels and the like)
    const tt = t.style.textTransform;
    if (getComputedStyle(t).textTransform !== "none") t.style.textTransform = "none";
    editing = { el: t, before: t.innerText, html: t.innerHTML, ce: t.getAttribute("contenteditable"), tt, ol: t.style.outline };
    t.style.outline = "none";
    t.setAttribute("contenteditable", "plaintext-only");
    if (t.contentEditable !== "plaintext-only") t.setAttribute("contenteditable", "true");
    t.focus();
    const r = document.createRange(); r.selectNodeContents(t);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    t.addEventListener("keydown", onEditKey, true);
    t.addEventListener("blur", onEditBlur, true);
    drawFocus();
    post({ type: "text-editing", on: true });
  }
  function onEditKey(e) {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); endTextEdit(true); }
    if (e.key === "Escape") { e.preventDefault(); endTextEdit(false); }
  }
  function onEditBlur() { setTimeout(() => editing && endTextEdit(true), 0); }
  function endTextEdit(save) {
    const ed = editing;
    if (!ed) return;
    editing = null;
    const t = ed.el;
    t.removeEventListener("keydown", onEditKey, true);
    t.removeEventListener("blur", onEditBlur, true);
    if (ed.ce === null) t.removeAttribute("contenteditable"); else t.setAttribute("contenteditable", ed.ce);
    const after = t.innerText;
    t.style.textTransform = ed.tt;
    t.style.outline = ed.ol;
    if (!save || after.trim() === ed.before.trim()) { if (!save) t.innerHTML = ed.html; drawFocus(); post({ type: "text-editing", on: false }); return; }
    const i = secIndexAt(t);
    const strip = ({ el: _e, ...d }) => d;
    const list = sections();
    post({ type: "text-edited", before: ed.before, after, element: describe(t), section: i, sectionData: list[i] ? strip(list[i]) : null, list: list.map(strip) });
    drawFocus();
  }
  const onFocusScroll = () => { if (secSel >= 0) sendRect(); };
  function setFocusing(on) {
    if (on === focusing) return;
    focusing = on;
    if (on) {
      secAt = 0;
      addEventListener("mousemove", onFocusMove, true);
      BLOCK.forEach((t) => addEventListener(t, onFocusClick, true));
      addEventListener("scroll", onFocusScroll, { passive: true });
      addEventListener("resize", onFocusScroll);
      document.documentElement.style.cursor = "pointer";
      post({ type: "sections", list: sections().map(({ el, ...d }) => d) });
    } else {
      removeEventListener("mousemove", onFocusMove, true);
      BLOCK.forEach((t) => removeEventListener(t, onFocusClick, true));
      removeEventListener("scroll", onFocusScroll);
      removeEventListener("resize", onFocusScroll);
      document.documentElement.style.cursor = "";
      if (editing) endTextEdit(false);
      secHover = secSel = -1; secMarks = [];
      document.getElementById("pc-pick-layer")?.remove();
    }
  }

  /* ---------- breakpoints side by side: scroll together ---------- */
  let syncing = false, applyingScroll = false;
  const scrollMax = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
  addEventListener("scroll", () => {
    if (!syncing || applyingScroll) return;
    post({ type: "scrolled", ratio: scrollY / scrollMax() });
  }, { passive: true });

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

  /* ---------- audit: what the helper buddy checks on each page ---------- */
  const parseRGB = (c) => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(c || ""); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] } : null; };
  const hex = (c) => "#" + [c.r, c.g, c.b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function bgOf(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") return null; // image or gradient: can't tell
      const c = parseRGB(cs.backgroundColor);
      if (c && c.a > 0.9) return c;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.05; };
  const accName = (el) => (el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("aria-labelledby") && document.getElementById(el.getAttribute("aria-labelledby"))?.textContent || el.innerText || el.querySelector("img[alt]")?.getAttribute("alt") || el.querySelector("svg title")?.textContent || "").trim();
  const tally = (obj, k, n = 1) => { if (k) obj[k] = (obj[k] || 0) + n; };
  const firstFont = (f) => (f || "").split(",")[0].replace(/["']/g, "").trim();

  async function audit(d) {
    try {
      if (frozenVH == null) frozenVH = window.innerHeight;
      await settle();
      await revealAll();
      await settle();
      const out = { url: location.pathname + location.search, width: window.innerWidth };
      // SEO and document basics
      const meta = (n) => document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute("content")?.trim() || null;
      Object.assign(out, {
        title: document.title?.trim() || null, description: meta("description"), ogTitle: meta("og:title"), ogImage: meta("og:image"),
        viewport: meta("viewport"), lang: document.documentElement.getAttribute("lang"), canonical: document.querySelector('link[rel="canonical"]')?.href || null,
      });
      // Structure
      const secs = detectSections();
      out.sections = secs.map((x) => {
        const el = x.el, cs = getComputedStyle(el), r = el.getBoundingClientRect();
        const inner = [...el.querySelectorAll(":scope > *, :scope > * > *")].find((c) => { const w = c.getBoundingClientRect().width; return w > 200 && w < r.width - 40; });
        const grid = el.querySelector("*");
        let cols = 1;
        for (const c of el.querySelectorAll("*")) { const ccs = getComputedStyle(c); if (ccs.display.includes("grid") && ccs.gridTemplateColumns) { cols = Math.max(cols, ccs.gridTemplateColumns.split(" ").length); } if (cols > 1) break; }
        void grid;
        return {
          name: x.name, tag: x.tag, top: x.top, height: x.height, cols,
          hasImg: !!el.querySelector("img, picture, video, svg[width]"), hasH1: !!el.querySelector("h1"), hasH2: !!el.querySelector("h2"),
          padTop: Math.round(parseFloat(cs.paddingTop)), padBottom: Math.round(parseFloat(cs.paddingBottom)),
          contentWidth: inner ? Math.round(inner.getBoundingClientRect().width) : Math.round(r.width), selector: cssPath(el),
        };
      });
      const hdr = document.querySelector("header, [role=banner], body > nav, nav");
      const ftr = document.querySelector("footer, [role=contentinfo]");
      const box = (el) => el && visible(el) ? { height: Math.round(el.getBoundingClientRect().height), links: el.querySelectorAll("a[href]").length, text: el.innerText.replace(/\s+/g, " ").trim().slice(0, 160) } : null;
      out.header = box(hdr);
      out.footer = box(ftr);
      // Typography and color
      const fonts = {}, sizes = {}, colors = {}, bgs = {}, h1 = [], h2 = [];
      const lowContrast = [];
      let tinyText = 0, checked = 0;
      const textEls = [...document.body.querySelectorAll("h1,h2,h3,h4,h5,h6,p,a,li,span,button,label,td,th,small,strong,em,blockquote,figcaption,dt,dd")].filter((el) => !el.closest("[data-project-canvas]"));
      for (const el of textEls) {
        if (!visible(el)) continue;
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
        if (!own) continue;
        const cs = getComputedStyle(el);
        const size = parseFloat(cs.fontSize);
        tally(fonts, firstFont(cs.fontFamily));
        tally(sizes, Math.round(size) + "px");
        const fg = parseRGB(cs.color);
        if (fg) tally(colors, hex(fg));
        if (size < 12) tinyText++;
        if (el.tagName === "H1") h1.push({ text: el.innerText.trim().slice(0, 80), font: firstFont(cs.fontFamily), size: Math.round(size), weight: cs.fontWeight });
        if (el.tagName === "H2" && h2.length < 6) h2.push({ font: firstFont(cs.fontFamily), size: Math.round(size), weight: cs.fontWeight });
        if (checked < 400 && fg) {
          checked++;
          const bg = bgOf(el);
          if (bg) {
            const ratio = contrast(fg, bg), large = size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700);
            if (ratio < (large ? 3 : 4.5) && lowContrast.length < 12) lowContrast.push({ selector: cssPath(el), text: el.innerText.trim().slice(0, 60), ratio: Math.round(ratio * 100) / 100, fg: hex(fg), bg: hex(bg) });
          }
        }
      }
      for (const el of document.body.querySelectorAll("*")) {
        if (el.closest("[data-project-canvas]")) continue;
        const c = parseRGB(getComputedStyle(el).backgroundColor);
        if (c && c.a > 0.5) tally(bgs, hex(c));
      }
      Object.assign(out, { fonts, sizes, colors, bgs, h1, h2, tinyText });
      // Accessibility
      const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map((h) => +h.tagName[1]);
      const skips = [];
      headings.forEach((lv, i) => { if (i && lv > headings[i - 1] + 1) skips.push(`h${headings[i - 1]} → h${lv}`); });
      const imgNoAlt = [...document.querySelectorAll("img")].filter((i) => visible(i) && !i.hasAttribute("alt")).slice(0, 12).map((i) => ({ selector: cssPath(i), src: (i.getAttribute("src") || "").slice(-60) }));
      const unnamed = [...document.querySelectorAll("a[href], button, [role=button]")].filter((el) => visible(el) && !accName(el)).slice(0, 12).map((el) => ({ selector: cssPath(el), tag: el.tagName.toLowerCase() }));
      const inputsNoLabel = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")].filter((el) => visible(el) && !(el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) && !el.closest("label") && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")).slice(0, 12).map((el) => ({ selector: cssPath(el) }));
      out.a11y = { headings, skips, imgNoAlt, unnamed, inputsNoLabel, lowContrast, h1Count: document.querySelectorAll("h1").length };
      // Links
      const seen = new Set();
      out.links = [...document.querySelectorAll("a")].filter((a) => !a.closest("[data-project-canvas]")).map((a) => {
        const raw = a.getAttribute("href");
        let abs = null, internal = false;
        try { if (raw && !/^(mailto:|tel:|javascript:)/i.test(raw)) { const u = new URL(raw, location.href); abs = u.href; internal = u.origin === location.origin; } } catch {}
        return { raw, path: internal ? new URL(abs).pathname : null, external: !internal && abs ? abs : null, text: (a.innerText || accName(a)).trim().slice(0, 50), selector: cssPath(a) };
      }).filter((l) => { const k = l.raw + "|" + l.text; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 200);
      // Mobile
      const docW = document.documentElement.scrollWidth;
      out.overflowX = docW > window.innerWidth + 2;
      out.overflowEls = out.overflowX ? [...document.body.querySelectorAll("*")].filter((el) => { const r = el.getBoundingClientRect(); return r.right > window.innerWidth + 2 && r.width > 0 && getComputedStyle(el).position !== "fixed"; }).filter((el, _, all) => !all.some((o) => o !== el && el.contains(o))).slice(0, 6).map((el) => ({ selector: cssPath(el), width: Math.round(el.getBoundingClientRect().width) })) : [];
      post({ type: "audit-report", id: d.id, report: out });
    } catch (err) {
      post({ type: "audit-error", id: d.id, message: String(err?.message || err).slice(0, 300) });
    }
  }

  /**
   * For the snapshot browser: get the page ready for a real screenshot. Viewport heights are
   * frozen at the screen height (so the browser can then grow to the full page without 100vh
   * sections growing with it), scroll-triggered content is revealed, and the sections are read.
   */
  if (SHOT) {
    window.__loupeShot = {
      /** Quick health check after a change: things that broke, that people notice */
      check() {
        const issues = [];
        const where = (el) => {
          const d = describe(el);
          const text = (el.innerText || el.alt || "").replace(/\s+/g, " ").trim().slice(0, 60);
          return { selector: d.selector, text, section: (() => { try { const i = detectSections().findIndex((x) => x.el.contains(el)); return i >= 0 ? i : null; } catch { return null; } })() };
        };
        const vw = document.documentElement.clientWidth;
        // Sideways scrolling: something sticks out past the screen
        if (document.documentElement.scrollWidth > vw + 2) {
          const wide = [];
          for (const el of document.body.querySelectorAll("*")) {
            if (wide.length >= 3) break;
            const r = el.getBoundingClientRect();
            if (r.width && r.right > vw + 2 && r.left < vw && getComputedStyle(el).position !== "fixed" && !wide.some((w) => w.contains(el))) wide.push(el);
          }
          issues.push({ kind: "overflow", message: `The page scrolls sideways (${document.documentElement.scrollWidth - vw}px too wide)`, at: wide.map(where) });
        }
        // Images that didn't load
        const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute("src") && i.getBoundingClientRect().width > 0);
        if (broken.length) issues.push({ kind: "image", message: `${broken.length} image${broken.length > 1 ? "s" : ""} didn't load`, at: broken.slice(0, 3).map(where) });
        // Text too faint to read (WCAG AA)
        const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
        const rgba = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[\s,/]+/).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
        const bgOf = (el) => {
          for (let n = el; n; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.backgroundImage && cs.backgroundImage !== "none") return null; // over an image or gradient: can't tell
            const c = rgba(cs.backgroundColor);
            if (c && c[3] > 0.9) return c;
          }
          return [255, 255, 255, 1];
        };
        const faint = [];
        const seen = new Set();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let n, count = 0;
        while ((n = walker.nextNode()) && count < 600) {
          const el = n.parentElement;
          if (!el || seen.has(el) || !n.textContent.trim() || el.closest("[data-project-canvas], script, style, noscript")) continue;
          seen.add(el); count++;
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || Number(cs.opacity) < 0.2) continue;
          const fg = rgba(cs.color), bg = bgOf(el);
          if (!fg || !bg) continue;
          const a = fg[3];
          const mix = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));
          const L1 = lum(mix), L2 = lum(bg);
          const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
          const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
          const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
          if (ratio < need) faint.push({ el, ratio });
        }
        if (faint.length) issues.push({ kind: "contrast", message: `${faint.length} bit${faint.length > 1 ? "s" : ""} of text ${faint.length > 1 ? "are" : "is"} hard to read (contrast below WCAG AA; lowest ${Math.min(...faint.map((f) => f.ratio)).toFixed(1)}:1)`, at: faint.sort((a, b) => a.ratio - b.ratio).slice(0, 3).map((f) => ({ ...where(f.el), ratio: Math.round(f.ratio * 10) / 10 })) });
        return issues;
      },
      async prepare({ wire: wireOn = false, minWait = 900 } = {}) {
        await new Promise((r) => (document.readyState === "complete" ? r() : window.addEventListener("load", r, { once: true })));
        await sleep(minWait); // intros and hydration
        frozenVH = window.innerHeight;
        freezeAll();
        if (wireOn) setWire(true);
        await settle();
        await revealAll();
        freezeAll(); // styles that arrived while scrolling
        if (wireOn) setWire(true);
        await settle();
        for (const el of document.querySelectorAll("nextjs-portal, vite-error-overlay, astro-dev-toolbar, astro-dev-overlay, [data-project-canvas]")) el.remove();
        const h = Math.min(Math.max(contentHeight(), window.innerHeight), 16000);
        let sections = [];
        try { sections = detectSections().map((x) => ({ ...x })); } catch {}
        const bg = getComputedStyle(document.body || document.documentElement).backgroundColor;
        return { h, sections, bg };
      },
      /**
       * For design concepts: the scoped part of the page as cleaned-up markup, where it sits, and the
       * fonts and colors it uses, so concepts can be made without reading the project's code.
       */
      extract(scope = {}) {
        // The whole page: its <main>, or else the tallest block in the body (not its header or footer)
        const scoped = scopeTarget(scope);
        let target = scoped || document.querySelector("main");
        let selector = scoped ? "@scope" : target ? "main" : null;
        if (!target) {
          const kids = [...document.body.children].filter((el) => !/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|HEADER|FOOTER|NAV)$/.test(el.tagName) && !el.hasAttribute("data-project-canvas"));
          target = kids.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0] || document.body;
          selector = target === document.body ? "body" : `body > :nth-child(${[...document.body.children].indexOf(target) + 1})`;
        }
        const r = target.getBoundingClientRect();
        const clone = target.cloneNode(true);
        for (const el of clone.querySelectorAll("script, style, noscript, template, link, meta, iframe, [data-project-canvas]")) el.remove();
        for (const el of clone.querySelectorAll("svg")) { if (el.innerHTML.length > 400) el.innerHTML = "<!-- icon -->"; }
        for (const el of [clone, ...clone.querySelectorAll("*")]) {
          for (const a of [...el.attributes]) {
            const n = a.name;
            if (/^(data-(?!testid)|on|aria-hidden$|tabindex$|jsaction|ng-|_ngcontent|wire:)/.test(n) && n !== "data-testid") el.removeAttribute(n);
            else if ((n === "src" || n === "href" || n === "srcset" || n === "style") && a.value.length > 300) el.setAttribute(n, a.value.startsWith("data:") ? "[inline data]" : a.value.slice(0, 300) + "…");
          }
        }
        let html = clone.outerHTML.replace(/<!--(?! icon)[\s\S]*?-->/g, "").replace(/\s{2,}/g, " ").replace(/>\s+</g, "><");
        const truncated = html.length > 28000;
        if (truncated) html = html.slice(0, 28000) + "<!-- …cut, the rest is like the above -->";
        // What it looks like: the fonts, colors and sizes it actually uses
        const count = (m, k) => { if (k && k !== "rgba(0, 0, 0, 0)" && k !== "transparent") m.set(k, (m.get(k) || 0) + 1); };
        const fonts = new Map(), colors = new Map(), bgs = new Map(), sizes = new Map(), radii = new Map();
        for (const el of [target, ...target.querySelectorAll("*")].slice(0, 600)) {
          const cs = getComputedStyle(el);
          if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
            count(fonts, `${cs.fontFamily.split(",")[0].replace(/["']/g, "").trim()} ${cs.fontWeight}`);
            count(colors, cs.color); count(sizes, cs.fontSize);
          }
          count(bgs, cs.backgroundColor);
          if (cs.borderRadius !== "0px") count(radii, cs.borderRadius);
        }
        const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
        const vars = [];
        try {
          for (const sh of document.styleSheets) {
            let rules; try { rules = sh.cssRules; } catch { continue; }
            for (const rule of rules) {
              if (rule.selectorText !== ":root" || !rule.style) continue;
              for (const prop of rule.style) if (prop.startsWith("--") && vars.length < 80) vars.push(`${prop}: ${rule.style.getPropertyValue(prop).trim()}`);
            }
          }
        } catch {}
        const classes = new Set();
        for (const el of [target, ...target.querySelectorAll("[class]")].slice(0, 300)) for (const c of el.classList) if (classes.size < 120) classes.add(c);
        return {
          selector, html, truncated, rect: { x: Math.round(r.left + scrollX), y: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) },
          page: { title: document.title, bodyBg: getComputedStyle(document.body).backgroundColor },
          fonts: top(fonts, 6), colors: top(colors, 8), backgrounds: top(bgs, 8), fontSizes: top(sizes, 8), radii: top(radii, 5), vars, classes: [...classes],
        };
      },
      /** After the browser grew to the full height: late styles get frozen too */
      async settleTall() { freezeAll(); window.scrollTo(0, 0); await settle(); return Math.min(Math.max(contentHeight(), frozenVH || 0), 16000); },
    };
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
    if (d.type === "focus") afterHydration(() => { setFocusing(!!d.on); if (d.on && d.section != null) pickSection(d.section, true); });
    if (d.type === "focus-marks") { secMarks = Array.isArray(d.indices) ? d.indices : []; drawFocus(); }
    if (d.type === "focus-section") { secAt = 0; if (d.index == null) { secSel = -1; drawFocus(); } else pickSection(d.index, true); }
    if (d.type === "inspect") afterHydration(() => setInspecting(!!d.on));
    if (d.type === "inspect-selector") afterHydration(() => { setInspecting(true); inspectSelector(d.selector); });
    if (d.type === "scroll-sync") syncing = !!d.on;
    if (d.type === "scroll-to") { applyingScroll = true; window.scrollTo({ top: d.ratio * scrollMax(), behavior: "instant" }); setTimeout(() => { applyingScroll = false; }, 80); }
    if (d.type === "concept") afterHydration(() => concept(d));
    if (d.type === "audit") afterHydration(() => audit(d));
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
