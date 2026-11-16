import fs from "node:fs";
import path from "node:path";

export const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".next", ".nuxt", ".svelte-kit", ".astro", ".vercel",
  ".netlify", ".turbo", ".cache", ".canvas", "dist", "build", "out", "coverage",
  ".output", "storybook-static", "vendor", "tmp", ".idea", ".vscode",
]);

export function walk(dir, { filter = () => true, maxDepth = 20 } = {}, depth = 0, acc = []) {
  if (depth > maxDepth) return acc;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") {
      if (e.isDirectory()) continue;
    }
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(full, { filter, maxDepth }, depth + 1, acc);
    } else if (e.isFile() && filter(full)) {
      acc.push(full);
    }
  }
  return acc;
}

export function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

export function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readJSON(file, fallback = null) {
  const raw = read(file);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(stripJsonComments(raw));
    } catch {
      return fallback;
    }
  }
}

/** Remove // and /* *\/ comments plus trailing commas (tsconfig-style JSON). */
export function stripJsonComments(src) {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") { out += n; i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === "/" && n === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && n === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; continue; }
    out += c;
  }
  return out.replace(/,(\s*[}\]])/g, "$1");
}

export const rel = (root, file) => path.relative(root, file).split(path.sep).join("/");

export function humanize(seg) {
  if (!seg) return "Home";
  const clean = seg
    .replace(/^\[\[?\.\.\.(.+?)\]?\]$/, "$1")
    .replace(/^\[(.+)\]$/, "$1")
    .replace(/^[:$]/, "")
    .replace(/\.html?$/, "");
  return clean
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function isDynamicSegment(seg) {
  return /^\[.*\]$/.test(seg) || /^[:$]/.test(seg) || seg === "*" || seg === "$";
}

/** Find a balanced {...} or [...] block starting at index of the opening char. */
export function balanced(src, openIdx) {
  const open = src[openIdx];
  const close = open === "{" ? "}" : open === "[" ? "]" : ")";
  let depth = 0;
  let str = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (str) {
      if (c === "\\") { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return { start: openIdx, end: i, body: src.slice(openIdx + 1, i) };
    }
  }
  return null;
}
