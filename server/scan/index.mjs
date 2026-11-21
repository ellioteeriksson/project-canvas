import path from "node:path";
import fs from "node:fs";
import { read, rel, readJSON, humanize, isDynamicSegment, walk } from "./fsutil.mjs";
import { createResolver, buildGraph, closure, extractLinks, normalizeHref, importBindings } from "./graph.mjs";
import { detectFramework, defaultDevUrl, discoverRoutes } from "./routes.mjs";
import { scanDesignSystem } from "./designsystem.mjs";

export const CANVAS_DIR = ".canvas";

export function loadConfig(root) {
  return readJSON(path.join(root, CANVAS_DIR, "config.json"), {}) || {};
}

export function saveConfig(root, config) {
  const dir = path.join(root, CANVAS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(config, null, 2) + "\n");
}

const PRODUCT_HINTS = /^(login|log-in|signin|sign-in|signup|sign-up|register|auth|dashboard|settings|account|onboarding|app|workspace|admin|billing|checkout|cart|profile|inbox|projects?|editor|new|edit|create|reset-password|forgot-password|verify)$/i;
const SITE_HINTS = /^(about|pricing|blog|news|contact|careers|jobs|team|services|cases|case-studies|work|portfolio|privacy|terms|legal|faq|press|partners|resources|insights|om-oss|kontakt|tjanster)$/i;
const AUTH_DEPS = ["next-auth", "@auth/core", "@clerk/nextjs", "@clerk/clerk-react", "@supabase/auth-helpers-nextjs", "@supabase/ssr", "firebase", "lucia", "better-auth", "@kinde-oss/kinde-auth-nextjs"];

function detectMode(root, routes) {
  const pkg = readJSON(path.join(root, "package.json"), {});
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  let product = AUTH_DEPS.some((d) => deps[d]) ? 3 : 0;
  let site = 0;
  for (const r of routes) for (const seg of r.route.split("/").filter(Boolean)) {
    if (PRODUCT_HINTS.test(seg)) product++;
    if (SITE_HINTS.test(seg)) site++;
  }
  return product > site ? "flow" : "sitemap";
}

function cleanTitle(t) {
  return t ? t.split(/\s+[|–—·-]\s+/)[0].trim() : null;
}

function matchRoute(href, routes) {
  if (routes.has(href)) return href;
  const hs = href.split("/").filter(Boolean);
  for (const r of routes) {
    const rs = r.split("/").filter(Boolean);
    const catchAll = rs.length && /^\[\[?\.\.\.|^\*$|^\$$/.test(rs[rs.length - 1]);
    if (!catchAll && rs.length !== hs.length) continue;
    if (catchAll && hs.length < rs.length - 1) continue;
    let ok = true;
    for (let i = 0; i < rs.length; i++) {
      if (catchAll && i === rs.length - 1) break;
      if (isDynamicSegment(rs[i])) continue;
      if (rs[i] !== hs[i]) { ok = false; break; }
    }
    if (ok) return r;
  }
  return null;
}

export function scanProject(root, config = loadConfig(root)) {
  const t0 = Date.now();
  const framework = detectFramework(root, config);
  const resolve = createResolver(root);
  let routes = discoverRoutes(root, framework, resolve);

  // Manual views from config (for anything the scanner can't see)
  for (const v of config.views || []) if (!routes.some((r) => r.route === v.route)) routes.push({ route: v.route, file: v.file || null, title: v.name || null, manual: true });
  const hidden = new Set(config.hidden || []);
  routes = routes.filter((r) => !hidden.has(r.route)).sort((a, b) => a.route.localeCompare(b.route));

  // Names: config override > unique page title > humanized segment
  const titleCount = new Map();
  for (const r of routes) { const t = cleanTitle(r.title); if (t) titleCount.set(t, (titleCount.get(t) || 0) + 1); }
  const names = config.names || {};

  const views = routes.map((r) => {
    const segs = r.route.split("/").filter(Boolean);
    const last = segs[segs.length - 1];
    const t = cleanTitle(r.title);
    let name = names[r.route] || (t && titleCount.get(t) === 1 ? t : null);
    // Code-based routers: the screen component's name beats a URL segment ("Login" > "Home")
    const base = r.file ? path.basename(r.file).replace(/\.[^.]+$/, "") : "";
    const comp = r.component || (/^[A-Z][A-Za-z0-9]+$/.test(base) ? base : null);
    if (!name && comp) name = comp.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/\s?(Page|Screen|View|Route)$/, "") || null;
    if (!name) name = !last ? "Home" : isDynamicSegment(last) ? `${humanize(segs[segs.length - 2] || "")} · ${last}`.replace(/^ · /, "") : humanize(last);
    const dynamic = segs.some(isDynamicSegment);
    return {
      id: r.route,
      name,
      route: r.route,
      file: r.file,
      dynamic,
      url: dynamic ? (config.params || {})[r.route] || null : r.route,
      manual: !!r.manual,
    };
  });

  // Import graph -> per-view file ownership
  const absFiles = views.filter((v) => v.file).map((v) => path.join(root, v.file));
  const graph = buildGraph(root, absFiles, resolve);
  const viewClosures = new Map();
  const fileUse = new Map();
  for (const v of views) {
    if (!v.file) continue;
    const c = closure(graph, path.join(root, v.file));
    viewClosures.set(v.id, c);
    for (const f of c) fileUse.set(f, (fileUse.get(f) || 0) + 1);
  }
  for (const v of views) {
    const c = viewClosures.get(v.id) || new Set();
    v.files = [...c].filter((f) => fileUse.get(f) === 1).map((f) => rel(root, f));
    v.sharedFiles = [...c].filter((f) => fileUse.get(f) > 1).map((f) => rel(root, f));
  }

  // Section components each page renders, in order (<Hero />, <Pricing /> …)
  for (const v of views) {
    v.codeSections = [];
    if (!v.file) continue;
    const abs = path.join(root, v.file);
    const src = read(abs).replace(/^\s*import[^;]*;?$/gm, "");
    const bindings = importBindings(read(abs));
    const seen = new Set();
    for (const m of src.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) {
      const name = m[1];
      if (seen.has(name) || !bindings.has(name)) continue;
      const hit = resolve(abs, bindings.get(name));
      if (!hit || hit.includes(`${path.sep}node_modules${path.sep}`) || /[\\/]ui[\\/]/.test(hit)) continue;
      seen.add(name);
      v.codeSections.push({ name, file: rel(root, hit) });
    }
  }

  // Edges: links found in code
  const routeSet = new Set(views.map((v) => v.route));
  const linkEdges = new Map();
  for (const v of views) {
    if (!v.file) continue;
    for (const f of v.files) {
      for (let href of extractLinks(read(path.join(root, f)))) {
        if (href.startsWith("rel:")) href = normalizeHref("/" + rel(root, path.resolve(path.dirname(path.join(root, f)), href.slice(4))).replace(/(^|\/)index\.html?$/, ""));
        const target = matchRoute(href, routeSet);
        if (target && target !== v.route) linkEdges.set(`${v.id}->${target}`, { id: `${v.id}->${target}`, source: v.id, target, kind: "link" });
      }
    }
  }
  for (const e of config.edges || []) {
    const id = `${e.from}->${e.to}`;
    linkEdges.set(id, { id, source: e.from, target: e.to, label: e.label, kind: "manual" });
  }
  for (const id of config.hiddenEdges || []) linkEdges.delete(id);

  // Sitemap hierarchy, with virtual group nodes for missing parents
  const groups = new Map();
  const treeEdges = [];
  const parentOf = (route) => {
    const segs = route.split("/").filter(Boolean);
    if (!segs.length) return null;
    const parent = "/" + segs.slice(0, -1).join("/");
    if (!routeSet.has(parent) && parent !== "/") {
      if (!groups.has(parent)) {
        groups.set(parent, { id: parent, name: names[parent] || humanize(parent.split("/").pop()), route: parent, group: true });
        const gp = parentOf(parent);
        if (gp) treeEdges.push({ id: `${gp}=>${parent}`, source: gp, target: parent, kind: "tree" });
      }
    }
    if (parent === "/" && !routeSet.has("/")) return null;
    return parent;
  };
  for (const v of views) {
    const p = parentOf(v.route);
    if (p) treeEdges.push({ id: `${p}=>${v.id}`, source: p, target: v.id, kind: "tree" });
  }

  const ds = scanDesignSystem(root, { views, graph, viewClosures, resolve });

  // Files that affect every view (layouts, app shells): used to know when all snapshots are stale
  const globalFiles = [];
  for (const base of ["app", "src/app", "pages", "src/pages", "src/layouts", "src"]) {
    const dir = path.join(root, base);
    if (!fs.existsSync(dir)) continue;
    for (const f of walk(dir, { filter: (p) => /[\\/](layout|template|_app|_document|root|__root|Layout|BaseLayout)\.(tsx?|jsx?|astro)$/.test(p), maxDepth: base === "src" ? 1 : 8 })) {
      const r = rel(root, f);
      if (!globalFiles.includes(r)) globalFiles.push(r);
    }
  }
  const pkg = readJSON(path.join(root, "package.json"), {});

  return {
    version: 1,
    project: { name: config.name || pkg.name || path.basename(root), root, framework },
    mode: config.mode && config.mode !== "auto" ? config.mode : detectMode(root, views),
    modeSource: config.mode && config.mode !== "auto" ? "config" : "auto",
    frameworkSetting: config.framework && config.framework !== "auto" ? config.framework : "auto",
    devUrl: config.devUrl || defaultDevUrl(root, framework) || "/__site",
    viewport: config.viewport || "desktop",
    previewRoute: config.previewRoute || null,
    positions: config.positions || {},
    frameHeight: config.frameHeight === "full" ? "full" : "viewport",
    frameLayer: config.frameLayer === "wireframe" ? "wireframe" : "live",
    frameConcurrency: Math.max(1, Math.min(12, Number(config.frameConcurrency) || 3)),
    views,
    groups: [...groups.values()],
    edges: { tree: treeEdges, links: [...linkEdges.values()] },
    designSystem: ds,
    globalFiles,
    scannedAt: new Date().toISOString(),
    scanMs: Date.now() - t0,
  };
}

export function writeManifest(root, manifest) {
  const dir = path.join(root, CANVAS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const gi = path.join(dir, ".gitignore");
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, "# Loupe runtime files (config.json is meant to be committed)\nstate.json\nmanifest.json\nsnapshots/\nchat.json\nchangelog.json\nserver.log\n");
  else {
    const cur = fs.readFileSync(gi, "utf8");
    const missing = ["snapshots/", "chat.json", "changelog.json", "server.log"].filter((l) => !new RegExp(`^${l.replace(/[./]/g, "\\$&")}?$`, "m").test(cur));
    if (missing.length) fs.appendFileSync(gi, (cur.endsWith("\n") ? "" : "\n") + missing.join("\n") + "\n");
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
}

// CLI: node scan/index.mjs <projectRoot>
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.resolve(process.argv[2] || process.cwd());
  const m = scanProject(root);
  writeManifest(root, m);
  console.log(`[canvas] ${m.project.framework} · ${m.views.length} views · ${m.edges.links.length} links · ${m.designSystem.components.length} components · ${m.designSystem.tokens.length} tokens · mode=${m.mode} (${m.scanMs}ms)`);
}
