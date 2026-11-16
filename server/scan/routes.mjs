import path from "node:path";
import { walk, read, isDir, exists, readJSON, rel, balanced } from "./fsutil.mjs";
import { importBindings } from "./graph.mjs";

const SRC_EXT = /\.(tsx?|jsx?|mjs)$/;

export function detectFramework(root, config = {}) {
  if (config.framework && config.framework !== "auto") return config.framework;
  const pkg = readJSON(path.join(root, "package.json"), {});
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (deps.next) return "next";
  if (deps.astro) return "astro";
  if (deps["@tanstack/react-router"] || deps["@tanstack/react-start"]) return "tanstack";
  if (exists(path.join(root, "app", "routes.ts")) || exists(path.join(root, "app", "routes.js"))) return "react-router";
  if (deps["@remix-run/react"] || deps["@react-router/dev"]) return "react-router";
  if (deps["react-router"] || deps["react-router-dom"]) return "react-router";
  return "html";
}

export function defaultDevUrl(root, framework) {
  const pkg = readJSON(path.join(root, "package.json"), {});
  const dev = pkg.scripts?.dev || pkg.scripts?.start || "";
  const port = dev.match(/(?:--port[ =]|-p\s+)(\d{2,5})/)?.[1];
  const fallback = { next: 3000, astro: 4321, tanstack: 3000, "react-router": 5173, html: null }[framework];
  const viteLike = /\bvite\b/.test(dev) || exists(path.join(root, "vite.config.ts")) || exists(path.join(root, "vite.config.js"));
  const p = port || (framework === "tanstack" && viteLike ? 5173 : fallback);
  return p ? `http://localhost:${p}` : null;
}

function titleFrom(src) {
  return (
    src.match(/metadata\s*(?::\s*\w+\s*)?=\s*\{[^}]*?\btitle\s*:\s*["'`]([^"'`]+)["'`]/s)?.[1] ||
    src.match(/<title>([^<{]+)<\/title>/i)?.[1]?.trim() ||
    src.match(/^---[\s\S]*?\btitle\s*:\s*["']?([^"'\n]+)["']?[\s\S]*?---/m)?.[1]?.trim() ||
    src.match(/<(?:Layout|BaseLayout|Page)[^>]*\btitle\s*=\s*["']([^"']+)["']/)?.[1] ||
    null
  );
}

function view(root, route, file, extra = {}) {
  return { route: route || "/", file: rel(root, file), title: titleFrom(read(file)), ...extra };
}

/* ---------- Next.js ---------- */
function nextApp(root) {
  const out = [];
  for (const base of ["app", "src/app"]) {
    const dir = path.join(root, base);
    if (!isDir(dir)) continue;
    for (const f of walk(dir, { filter: (p) => /[\\/]page\.(tsx?|jsx?|mdx?)$/.test(p) })) {
      const segs = path.relative(dir, path.dirname(f)).split(path.sep).filter(Boolean);
      if (segs.some((s) => s.startsWith("@") || s.startsWith("_") || /^\(\.+\)/.test(s))) continue;
      const route = "/" + segs.filter((s) => !/^\(.*\)$/.test(s)).join("/");
      out.push(view(root, route, f, { router: "app" }));
    }
  }
  return out;
}

function nextPages(root) {
  const out = [];
  for (const base of ["pages", "src/pages"]) {
    const dir = path.join(root, base);
    if (!isDir(dir)) continue;
    for (const f of walk(dir, { filter: (p) => /\.(tsx?|jsx?|mdx?)$/.test(p) })) {
      const r = path.relative(dir, f).split(path.sep);
      if (r[0] === "api") continue;
      const name = r.pop().replace(/\.[^.]+$/, "");
      if (name.startsWith("_")) continue;
      if (name !== "index") r.push(name);
      out.push(view(root, "/" + r.join("/"), f, { router: "pages" }));
    }
  }
  return out;
}

/* ---------- Astro ---------- */
function astro(root) {
  const dir = path.join(root, "src", "pages");
  if (!isDir(dir)) return [];
  const out = [];
  for (const f of walk(dir, { filter: (p) => /\.(astro|mdx?|html)$/.test(p) })) {
    const r = path.relative(dir, f).split(path.sep);
    if (r.some((s) => s.startsWith("_"))) continue;
    const name = r.pop().replace(/\.[^.]+$/, "");
    if (name !== "index") r.push(name);
    out.push(view(root, "/" + r.join("/"), f));
  }
  return out;
}

/* ---------- TanStack Router (file based) ---------- */
function tanstack(root) {
  const out = [];
  for (const base of ["src/routes", "app/routes"]) {
    const dir = path.join(root, base);
    if (!isDir(dir)) continue;
    for (const f of walk(dir, { filter: (p) => SRC_EXT.test(p) })) {
      const src = read(f);
      const m = src.match(/create(?:File|Lazy)Route\(\s*["'`]([^"'`]+)["'`]/);
      if (!m || /__root/.test(m[1])) continue;
      const segs = m[1].split("/").filter((s) => s && !s.startsWith("_"));
      out.push(view(root, "/" + segs.join("/"), f));
    }
  }
  return dedupe(out);
}

/* ---------- React Router ---------- */
function reactRouter(root, resolve) {
  // v7 framework mode: app/routes.ts
  for (const f of ["app/routes.ts", "app/routes.js"]) {
    const p = path.join(root, f);
    if (exists(p)) return rrConfig(root, p);
  }
  // Remix / RR7 flat routes
  const flat = path.join(root, "app", "routes");
  if (isDir(flat)) return remixFlat(root, flat);
  // Code-based routers
  const out = [];
  const files = walk(path.join(root, "src"), { filter: (p) => SRC_EXT.test(p) });
  for (const f of files) {
    const src = read(f);
    if (/<Route\b/.test(src)) out.push(...jsxRoutes(root, f, src, resolve));
    if (/create(?:Browser|Hash|Memory)Router|useRoutes|RouteObject/.test(src)) out.push(...objectRoutes(root, f, src, resolve));
  }
  return dedupe(out);
}

function joinPath(parent, child) {
  if (child == null) return parent;
  if (child.startsWith("/")) return child.replace(/\/\*$/, "") || "/";
  const p = (parent === "/" ? "" : parent) + "/" + child;
  return p.replace(/\/\*$/, "").replace(/\/+/g, "/") || "/";
}

function componentFile(root, file, src, comp, resolve) {
  if (!comp) return null;
  const spec = importBindings(src).get(comp);
  return spec ? resolve(file, spec) : null;
}

function jsxRoutes(root, file, src, resolve) {
  const out = [];
  const stack = ["/"];
  const re = /<Route\b|<\/Route\s*>/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[0].startsWith("</")) { if (stack.length > 1) stack.pop(); continue; }
    // read the tag until a '>' at brace depth 0
    let i = m.index + 6, depth = 0, str = null;
    for (; i < src.length; i++) {
      const c = src[i];
      if (str) { if (c === "\\") i++; else if (c === str) str = null; continue; }
      if (c === '"' || c === "'" || c === "`") str = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    const tag = src.slice(m.index, i + 1);
    const selfClosing = /\/\s*>$/.test(tag);
    const p = tag.match(/\bpath\s*=\s*\{?\s*["'`]([^"'`]*)["'`]/)?.[1];
    const isIndex = /\bindex\b(?!\s*=\s*\{?\s*false)/.test(tag) && !p;
    const comp = tag.match(/\belement\s*=\s*\{\s*<\s*([A-Z][\w.]*)/)?.[1] || tag.match(/\bComponent\s*=\s*\{\s*([A-Z][\w.]*)/)?.[1];
    const parent = stack[stack.length - 1];
    const full = isIndex ? parent : joinPath(parent, p);
    if ((p != null || isIndex) && comp) {
      const target = componentFile(root, file, src, comp, resolve);
      out.push(view(root, full, target || file, { component: comp, definedIn: rel(root, file), layout: !selfClosing }));
    }
    if (!selfClosing) stack.push(p != null ? full : parent);
    re.lastIndex = i + 1;
  }
  return out;
}

function objectRoutes(root, file, src, resolve) {
  const out = [];
  // Walk every object literal containing `path:` or `index: true`, tracking nesting through `children: [`
  const visit = (body, offset, parent) => {
    let i = 0;
    while (i < body.length) {
      const open = body.indexOf("{", i);
      if (open < 0) break;
      const blk = balanced(body, open);
      if (!blk) break;
      const inner = blk.body;
      // Only inspect top-level keys of this object (strip nested blocks)
      let top = inner, prev;
      do { prev = top; top = top.replace(/\{[^{}]*\}/g, "()"); } while (top !== prev);
      const p = top.match(/\bpath\s*:\s*["'`]([^"'`]*)["'`]/)?.[1];
      const isIndex = /\bindex\s*:\s*true/.test(top);
      if (p != null || isIndex) {
        const full = isIndex ? parent : joinPath(parent, p);
        const comp = inner.match(/\belement\s*:\s*<\s*([A-Z][\w.]*)/)?.[1] || inner.match(/\bComponent\s*:\s*([A-Z][\w.]*)/)?.[1];
        const lazySpec = inner.match(/\blazy\s*:\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']/)?.[1];
        const target = lazySpec ? resolve(file, lazySpec) : componentFile(root, file, src, comp, resolve);
        const ci = inner.search(/\bchildren\s*:\s*\[/);
        out.push(view(root, full, target || file, { component: comp, definedIn: rel(root, file), layout: ci >= 0 }));
        if (ci >= 0) {
          const arr = balanced(inner, inner.indexOf("[", ci));
          if (arr) visit(arr.body, 0, full);
        }
      } else {
        visit(inner, 0, parent);
      }
      i = blk.end + 1;
    }
  };
  visit(src, 0, "/");
  return out;
}

function rrConfig(root, file) {
  const src = read(file);
  const out = [];
  const baseDir = path.dirname(file);
  // frames: { kind, path, closeDepth }
  const frames = [];
  let depth = 0, str = null;
  const cur = () => frames.reduce((acc, f) => (f.path != null ? joinPath(acc, f.path) : acc), "/");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (str) { if (c === "\\") i++; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "(") {
      const fn = src.slice(Math.max(0, i - 12), i).match(/(route|index|layout|prefix)\s*$/)?.[1];
      depth++;
      if (fn) {
        const args = src.slice(i + 1, i + 400).match(/^\s*["'`]([^"'`]*)["'`](?:\s*,\s*["'`]([^"'`]*)["'`])?/);
        if (fn === "route" && args) {
          const full = joinPath(cur(), args[1]);
          if (args[2]) out.push(view(root, full, path.resolve(baseDir, args[2])));
          frames.push({ path: args[1], closeDepth: depth });
        } else if (fn === "index" && args) {
          out.push(view(root, cur(), path.resolve(baseDir, args[1])));
        } else if (fn === "prefix" && args) {
          frames.push({ path: args[1], closeDepth: depth });
        } else if (fn === "layout") {
          frames.push({ path: null, closeDepth: depth });
        }
      }
    } else if (c === ")") {
      while (frames.length && frames[frames.length - 1].closeDepth === depth) frames.pop();
      depth--;
    }
  }
  return dedupe(out);
}

function remixFlat(root, dir) {
  const out = [];
  for (const f of walk(dir, { filter: (p) => SRC_EXT.test(p) || /\.mdx?$/.test(p), maxDepth: 1 })) {
    const relp = path.relative(dir, f).split(path.sep);
    let name;
    if (relp.length === 1) name = relp[0].replace(/\.[^.]+$/, "");
    else if (/^route\.[^.]+$/.test(relp[1])) name = relp[0];
    else continue;
    const segs = name.split(".").filter((s) => s !== "_index" && !s.startsWith("_")).map((s) => s.replace(/_$/, ""));
    out.push(view(root, "/" + segs.join("/"), f));
  }
  return dedupe(out);
}

/* ---------- Plain HTML ---------- */
function html(root) {
  const out = [];
  for (const f of walk(root, { filter: (p) => /\.html?$/.test(p) })) {
    const r = rel(root, f).split("/");
    const name = r.pop();
    if (!/^index\.html?$/.test(name)) r.push(name);
    out.push(view(root, "/" + r.join("/"), f));
  }
  return out;
}

function dedupe(views) {
  const map = new Map();
  for (const v of views) {
    const prev = map.get(v.route);
    // Prefer an index/leaf route over a layout route on the same path
    if (!prev || (prev.layout && !v.layout)) map.set(v.route, v);
  }
  return [...map.values()];
}

export function discoverRoutes(root, framework, resolve) {
  switch (framework) {
    case "next": return dedupe([...nextApp(root), ...nextPages(root)]);
    case "astro": return astro(root);
    case "tanstack": return tanstack(root);
    case "react-router": return reactRouter(root, resolve);
    default: return html(root);
  }
}
