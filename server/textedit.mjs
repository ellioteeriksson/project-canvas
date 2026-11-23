// Change a piece of text on the page straight in the source, without a round trip to Claude.
import fs from "node:fs";
import path from "node:path";

const EXT = /\.(html?|jsx|tsx|vue|svelte|astro|mdx?|php|erb|liquid|njk|hbs|handlebars|twig|ejs|pug|json|ya?ml|js|ts)$/i;
const SKIP = new Set(["node_modules", ".git", ".canvas", ".next", ".nuxt", ".svelte-kit", ".astro", "dist", "build", "out", ".output", ".vercel", "coverage", ".cache", "vendor"]);
const MARKUP = /\.(html?|vue|svelte|astro|php|erb|liquid|njk|hbs|handlebars|twig|ejs)$/i;
const JSX = /\.(jsx|tsx|mdx)$/i;

const ALT = {
  "&": "(?:&|&amp;|&#38;)", "<": "(?:<|&lt;)", ">": "(?:>|&gt;)",
  "'": "(?:'|’|&#39;|&apos;|&rsquo;|&#8217;)", "’": "(?:’|'|&rsquo;|&#8217;|&#39;)", "‘": "(?:‘|'|&lsquo;|&#8216;)",
  '"': '(?:"|“|”|&quot;|&ldquo;|&rdquo;|&#34;)', "“": '(?:“|"|&ldquo;|&#8220;)', "”": '(?:”|"|&rdquo;|&#8221;)',
  "–": "(?:–|&ndash;|&#8211;)", "—": "(?:—|&mdash;|&#8212;)", "…": "(?:…|&hellip;|\\.\\.\\.)",
};
const esc = (c) => ALT[c] ?? c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
/** The text as it renders → a pattern that finds it in source (entities, line breaks, indentation) */
function patternFor(text) {
  const words = String(text).replace(/ /g, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return null;
  const gap = "(?:\\s|&nbsp;|&#160;|<br\\s*/?>|\\{\" \"\\})+";
  return new RegExp(words.map((w) => [...w].map(esc).join("")).join(gap), "g");
}

function* walk(dir, depth = 0) {
  if (depth > 8) return;
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of list) {
    if (d.name.startsWith(".") && d.name !== ".vitepress") continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (!SKIP.has(d.name)) yield* walk(p, depth + 1); }
    else if (EXT.test(d.name)) yield p;
  }
}

/** The new text, written the way this kind of file needs it */
function encode(text, file) {
  let t = String(text).replace(/ /g, " ").replace(/\s*\n\s*/g, "\n").trim();
  if (MARKUP.test(file)) return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
  if (JSX.test(file)) {
    if (/[{}<>]/.test(t)) return null; // needs JSX care: leave it to Claude
    return t.replace(/\n/g, "<br />");
  }
  if (/\.(json|ya?ml|js|ts)$/i.test(file)) {
    if (/["'`\\\n]/.test(t)) return null;
    return t;
  }
  return t.replace(/\n/g, "  \n");
}

export function createTextEdit({ root, history, changelog, log = () => {} }) {
  /** Find the one place this text lives. Files of the page first, then the rest of the project. */
  function locate(before, preferred = []) {
    const re = patternFor(before);
    if (!re) return { matches: [] };
    const hits = [];
    const seen = new Set();
    const look = (abs) => {
      if (seen.has(abs)) return;
      seen.add(abs);
      let src;
      try { const st = fs.statSync(abs); if (!st.isFile() || st.size > 1_500_000) return; src = fs.readFileSync(abs, "utf8"); } catch { return; }
      for (const m of src.matchAll(re)) hits.push({ file: abs, index: m.index, length: m[0].length });
    };
    for (const f of preferred) look(path.resolve(root, f));
    const inPage = hits.length;
    if (inPage === 1) return { matches: hits };
    if (inPage > 1) return { matches: hits, ambiguous: true };
    let n = 0;
    for (const f of walk(root)) { look(f); if (++n > 6000 || hits.length > 1) break; }
    return { matches: hits, ambiguous: hits.length > 1 };
  }

  async function edit({ before, after, files = [] }) {
    if (!String(after).trim()) return { ok: false, reason: "empty" };
    const found = locate(before, files);
    if (found.matches.length !== 1) return { ok: false, reason: found.matches.length ? "ambiguous" : "not-found", count: found.matches.length };
    const m = found.matches[0];
    const value = encode(after, m.file);
    if (value == null) return { ok: false, reason: "needs-care" };
    const rel = path.relative(root, m.file).split(path.sep).join("/");
    const short = (t) => { t = String(t).replace(/\s+/g, " ").trim(); return t.length > 60 ? t.slice(0, 59) + "…" : t; };
    const was = await history.checkpoint(`Before text edit in ${rel}`).catch(() => null);
    const src = fs.readFileSync(m.file, "utf8");
    fs.writeFileSync(m.file, src.slice(0, m.index) + value + src.slice(m.index + m.length));
    const now = await history.checkpoint(`Text edit in ${rel}: “${short(after)}”`).catch(() => null);
    const e = changelog.add({
      source: "loupe", kind: "text", prompt: `Text: “${short(before)}” → “${short(after)}”`, files: [rel],
      summary: `Changed the text in ${rel}.`, ...(was && now ? { before: was, after: now } : {}),
    });
    log(`text edit in ${rel}`);
    return { ok: true, via: "file", file: rel, entry: e.id };
  }

  return { edit, locate };
}
