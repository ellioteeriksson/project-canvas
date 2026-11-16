import path from "node:path";
import { walk, read, rel, balanced } from "./fsutil.mjs";

const COLOR_RE = /^(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\(|color-mix\()/i;
const BARE_HSL = /^-?\d+(\.\d+)?(deg)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%(\s*\/\s*[\d.]+%?)?$/;
const BARE_OKLCH = /^\d*\.?\d+%?\s+\d*\.?\d+\s+\d*\.?\d+$/;

function categorize(name, display) {
  const n = name.toLowerCase();
  if (/radius|rounded/.test(n)) return "radius";
  if (/shadow/.test(n)) return "shadow";
  if (/^--font|font-family|--family/.test(n)) return "font";
  if (/text-|font-size|leading|tracking|line-height|letter/.test(n)) return "type";
  if (/spacing|space|gap|size|width|height|container|breakpoint/.test(n)) return "spacing";
  if (/ease|duration|animate|transition/.test(n)) return "motion";
  if (COLOR_RE.test(display) || /^--color-/.test(n)) return "color";
  return "other";
}

function parseBlocks(css) {
  // Collect --vars from :root, .dark, [data-theme], @theme blocks
  const out = [];
  const re = /(@theme(?:\s+inline)?|:root|\.dark|html\.dark|\[data-theme=["']?([\w-]+)["']?\]|\.light)\s*(?:,[^{]*)?\{/g;
  let m;
  while ((m = re.exec(css))) {
    const blk = balanced(css, css.indexOf("{", m.index));
    if (!blk) continue;
    const sel = m[1];
    const scope = sel.startsWith("@theme") ? "theme" : /dark/.test(sel) ? "dark" : m[2] || "light";
    for (const d of blk.body.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)(?:;|$)/g)) out.push({ name: d[1], value: d[2].trim(), scope });
  }
  return out;
}

function toDisplay(value) {
  if (BARE_HSL.test(value)) return `hsl(${value})`;
  if (BARE_OKLCH.test(value) && /\./.test(value)) return `oklch(${value})`;
  return value;
}

export function scanDesignSystem(root, { views, graph, viewClosures, resolve }) {
  // ---- Tokens ----
  const cssFiles = walk(root, { filter: (p) => /\.(css|scss|pcss)$/.test(p) }).filter((f) => /--[\w-]+\s*:/.test(read(f)));
  const raw = [];
  for (const f of cssFiles) for (const t of parseBlocks(read(f))) raw.push({ ...t, file: rel(root, f) });

  const byScope = (scope) => new Map(raw.filter((t) => t.scope === scope).map((t) => [t.name, t.value]));
  const light = byScope("light"), dark = byScope("dark"), theme = byScope("theme");
  const lookup = (name, scope) => (scope === "dark" && dark.get(name)) || light.get(name) || theme.get(name);
  const resolveVal = (val, scope, depth = 0) =>
    depth > 8 ? val : val.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g, (_, n, fb) => {
      const v = lookup(n, scope);
      return v ? resolveVal(v, scope, depth + 1) : fb || _;
    });

  const tokens = new Map();
  for (const t of raw) {
    const key = t.name;
    const entry = tokens.get(key) || { name: key, file: t.file, values: {} };
    entry.values[t.scope] = { raw: t.value, display: toDisplay(resolveVal(t.value, t.scope)) };
    tokens.set(key, entry);
  }
  const tokenList = [...tokens.values()].map((t) => {
    const d = (t.values.light || t.values.theme || t.values.dark).display;
    return { ...t, category: categorize(t.name, d) };
  });

  // ---- Fonts (next/font, @fontsource, <link> google fonts) ----
  const fonts = new Set();
  for (const f of walk(root, { filter: (p) => /\.(tsx?|jsx?|astro|html|css)$/.test(p), maxDepth: 6 }).slice(0, 2000)) {
    const src = read(f);
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*["']next\/font\/google["']/g)) m[1].split(",").forEach((x) => x.trim() && fonts.add(x.trim().replace(/_/g, " ")));
    for (const m of src.matchAll(/["']@fontsource(?:-variable)?\/([\w-]+)/g)) fonts.add(m[1].replace(/-/g, " "));
    for (const m of src.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&:]+)/g)) fonts.add(decodeURIComponent(m[1]).replace(/\+/g, " "));
  }

  // ---- Components ----
  const compFiles = walk(root, { filter: (p) => /[\\/]components[\\/].+\.(tsx|jsx|astro|vue|svelte)$/.test(p) && !/\.(test|spec|stories)\./.test(p) });
  const usage = new Map();
  for (const v of views) for (const f of viewClosures.get(v.id) || []) {
    if (!usage.has(f)) usage.set(f, new Set());
    usage.get(f).add(v.id);
  }
  const components = compFiles.map((abs) => {
    const src = read(abs);
    const relp = rel(root, abs);
    const isPrimitive = /(^|\/)components\/ui\//.test(relp);
    const exportsList = [...new Set([...src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Z][\w]*)/g)].map((m) => m[1]))];
    const brace = src.match(/export\s*\{([^}]+)\}/);
    if (brace) brace[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()).filter((s) => /^[A-Z]/.test(s)).forEach((s) => !exportsList.includes(s) && exportsList.push(s));
    // cva variants
    const variants = {};
    const vi = src.search(/\bvariants\s*:\s*\{/);
    if (vi >= 0) {
      const blk = balanced(src, src.indexOf("{", vi));
      if (blk) {
        let body = blk.body;
        for (const m of body.matchAll(/(\w+)\s*:\s*\{/g)) {
          const inner = balanced(body, m.index + m[0].length - 1);
          if (!inner) continue;
          const keys = [...inner.body.matchAll(/(?:^|,|\n)\s*["']?([\w-]+)["']?\s*:/g)].map((k) => k[1]);
          if (keys.length) variants[m[1]] = keys;
        }
      }
    }
    const base = path.basename(abs).replace(/\.[^.]+$/, "");
    return {
      id: "component:" + relp,
      name: exportsList[0] || base.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase()),
      file: relp,
      group: isPrimitive ? "primitive" : "component",
      exports: exportsList,
      variants,
      usedBy: [...(usage.get(abs) || [])],
    };
  });

  return { tokens: tokenList, fonts: [...fonts], components, cssFiles: cssFiles.map((f) => rel(root, f)) };
}
