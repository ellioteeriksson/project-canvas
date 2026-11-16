import path from "node:path";
import { exists, isDir, read, readJSON } from "./fsutil.mjs";

const EXTS = [".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".astro", ".vue", ".svelte", ".mdx", ".md", ".css", ".scss"];
export const CODE_RE = /\.(tsx?|jsx?|mjs|cjs|astro|vue|svelte|mdx?)$/;

/** Build an import resolver that understands relative paths and tsconfig/jsconfig path aliases. */
export function createResolver(root) {
  const aliases = [];
  for (const cfg of ["tsconfig.json", "jsconfig.json", "tsconfig.app.json"]) {
    const json = readJSON(path.join(root, cfg));
    const opts = json?.compilerOptions;
    if (!opts?.paths) continue;
    const base = path.join(root, opts.baseUrl || ".");
    for (const [key, targets] of Object.entries(opts.paths)) {
      const prefix = key.replace(/\*$/, "");
      for (const t of targets) aliases.push({ prefix, target: path.join(base, t.replace(/\*$/, "")), wildcard: key.endsWith("*") });
    }
  }
  // Common defaults if no tsconfig aliases exist
  if (!aliases.some((a) => a.prefix === "@/")) {
    const src = isDir(path.join(root, "src")) ? path.join(root, "src") : root;
    aliases.push({ prefix: "@/", target: src + path.sep, wildcard: true });
    aliases.push({ prefix: "~/", target: src + path.sep, wildcard: true });
  }

  const cache = new Map();
  function tryFile(p) {
    if (cache.has(p)) return cache.get(p);
    let hit = null;
    if (exists(p) && !isDir(p)) hit = p;
    else {
      for (const e of EXTS) if (exists(p + e)) { hit = p + e; break; }
      if (!hit && isDir(p)) for (const e of EXTS) if (exists(path.join(p, "index" + e))) { hit = path.join(p, "index" + e); break; }
    }
    cache.set(p, hit);
    return hit;
  }

  return function resolve(fromFile, spec) {
    if (!spec) return null;
    if (spec.startsWith(".")) return tryFile(path.resolve(path.dirname(fromFile), spec));
    if (spec.startsWith("/")) return tryFile(path.join(root, spec));
    for (const a of aliases) {
      if (a.wildcard ? spec.startsWith(a.prefix) : spec === a.prefix) {
        const hit = tryFile(path.join(a.target, spec.slice(a.prefix.length)));
        if (hit) return hit;
      }
    }
    return null; // package import
  };
}

export function parseImports(src) {
  const out = new Set();
  const res = [
    /\bimport\s+(?:type\s+)?[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bexport\s+[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of res) for (const m of src.matchAll(re)) out.add(m[1]);
  return [...out];
}

/** Map of imported identifier -> specifier, including React.lazy(() => import("...")). */
export function importBindings(src) {
  const map = new Map();
  for (const m of src.matchAll(/\bimport\s+(?:type\s+)?([^'"`;]*?)\s+from\s*["']([^"']+)["']/g)) {
    const clause = m[1];
    const spec = m[2];
    const def = clause.match(/^\s*([A-Za-z_$][\w$]*)/);
    if (def && !clause.trim().startsWith("{") && !clause.trim().startsWith("*")) map.set(def[1], spec);
    const named = clause.match(/\{([^}]*)\}/);
    if (named) for (const part of named[1].split(",")) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (orig) map.set((alias || orig).trim(), spec);
    }
  }
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:React\.)?lazy\(\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']/g)) map.set(m[1], m[2]);
  return map;
}

/** Dependency graph of local files, starting from the given entry files. */
export function buildGraph(root, entries, resolve, maxDepth = 6) {
  const deps = new Map(); // file -> Set(files)
  const queue = entries.map((f) => [f, 0]);
  while (queue.length) {
    const [file, depth] = queue.shift();
    if (deps.has(file)) continue;
    const set = new Set();
    deps.set(file, set);
    if (!CODE_RE.test(file)) continue;
    const src = read(file);
    for (const spec of parseImports(src)) {
      const hit = resolve(file, spec);
      if (hit && hit.startsWith(root) && !hit.includes(`${path.sep}node_modules${path.sep}`)) {
        set.add(hit);
        if (depth < maxDepth) queue.push([hit, depth + 1]);
      }
    }
  }
  return deps;
}

export function closure(deps, entry) {
  const seen = new Set();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const d of deps.get(f) || []) stack.push(d);
  }
  return seen;
}

/** Extract internal hrefs from a source file. */
export function extractLinks(src) {
  const out = new Set();
  const res = [
    /\bhref\s*=\s*\{?\s*["'`](\/[^"'`\s]*)["'`]/g,
    /\bto\s*=\s*\{?\s*["'`](\/[^"'`\s]*)["'`]/g,
    /\b(?:push|replace|navigate|redirect|permanentRedirect)\(\s*["'`](\/[^"'`\s]*)["'`]/g,
    /\bhref\s*:\s*["'`](\/[^"'`\s]*)["'`]/g,
    /\b(?:href|url|path|to)\s*:\s*["'`](\/[^"'`\s]*)["'`]/g,
    /\baction\s*=\s*["'](\/[^"'\s]*)["']/g,
  ];
  for (const re of res) for (const m of src.matchAll(re)) out.add(normalizeHref(m[1]));
  // relative html links like href="about.html"
  for (const m of src.matchAll(/\bhref\s*=\s*["'](?!https?:|mailto:|tel:|#|\/\/|\/)([^"'\s]+\.html?)(?:[#?][^"']*)?["']/g)) out.add("rel:" + m[1]);
  out.delete("");
  return [...out];
}

export function normalizeHref(h) {
  let s = h.split(/[?#]/)[0].replace(/\$\{[^}]*\}/g, "__param__");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return s || "/";
}
