/**
 * The helper buddy's checks. Each page is loaded off to the side, the frame helper measures it
 * (structure, type, color, accessibility, links, overflow), and the pages are then compared with
 * each other and with the design system. House rules are checked by Claude (see the server).
 */
import type { Manifest, View } from "./types";
import { frameUrl } from "./api";

export type CheckId = "consistency" | "rules" | "tokens" | "a11y" | "links" | "mobile" | "seo";
export type Severity = "error" | "warning" | "info";
export type Finding = {
  id: string; check: CheckId; severity: Severity; title: string; detail?: string;
  views: string[]; fix: string;
};
export const CHECKS: { id: CheckId; label: string; blurb: string }[] = [
  { id: "consistency", label: "Consistency", blurb: "Pages share the same header, footer, type and layout; subpages match their siblings" },
  { id: "rules", label: "House rules", blurb: "Claude checks the project against your rules file" },
  { id: "tokens", label: "Design tokens", blurb: "Colors and fonts come from the design system" },
  { id: "a11y", label: "Accessibility", blurb: "Contrast, alt text, headings, names for buttons and links" },
  { id: "links", label: "Links", blurb: "No broken links or pages that fail to load" },
  { id: "mobile", label: "Mobile", blurb: "Nothing scrolls sideways or gets too small at 390 wide" },
  { id: "seo", label: "SEO", blurb: "Titles, descriptions and share images" },
];

/* ---------- page reports, as measured by the frame helper ---------- */
type Sec = { name: string; tag: string; height: number; cols: number; hasImg: boolean; hasH1: boolean; hasH2: boolean; padTop: number; padBottom: number; contentWidth: number; selector: string };
type Box = { height: number; links: number; text: string } | null;
export type Report = {
  url: string; width: number; title: string | null; description: string | null; ogTitle: string | null; ogImage: string | null; viewport: string | null; lang: string | null;
  sections: Sec[]; header: Box; footer: Box;
  fonts: Record<string, number>; sizes: Record<string, number>; colors: Record<string, number>; bgs: Record<string, number>;
  h1: { text: string; font: string; size: number; weight: string }[]; h2: { font: string; size: number; weight: string }[]; tinyText: number;
  a11y: { headings: number[]; skips: string[]; imgNoAlt: { selector: string; src: string }[]; unnamed: { selector: string; tag: string }[]; inputsNoLabel: { selector: string }[]; lowContrast: { selector: string; text: string; ratio: number; fg: string; bg: string }[]; h1Count: number };
  links: { raw: string | null; path: string | null; external: string | null; text: string; selector: string }[];
  overflowX: boolean; overflowEls: { selector: string; width: number }[];
};

const host = (w: Window | null | undefined, msg: Record<string, unknown>) => w?.postMessage({ source: "project-canvas-host", ...msg }, "*");

/** Load one page in an invisible frame and ask the helper to measure it. */
function measure(base: string, v: View, width: number, signal: AbortSignal): Promise<Report | { error: string }> {
  return new Promise((resolve) => {
    const id = `${v.id}@${width}-${Math.random().toString(36).slice(2, 7)}`;
    const f = document.createElement("iframe");
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    // Inside the window (browsers pause off-screen frames), invisible and inert
    Object.assign(f.style, { position: "fixed", left: "0", top: "0", width: `${width}px`, height: "900px", opacity: "0.001", pointerEvents: "none", zIndex: "-1", border: "0", transform: "scale(0.05)", transformOrigin: "0 0" });
    let sent = false;
    const done = (r: Report | { error: string }) => { window.removeEventListener("message", onMsg); clearTimeout(t); f.remove(); signal.removeEventListener("abort", onAbort); resolve(r); };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow) return;
      const d = e.data;
      if (!d || d.source !== "project-canvas") return;
      if (d.type === "ready" && !sent) { sent = true; host(f.contentWindow, { type: "audit", id }); }
      if (d.type === "audit-report" && d.id === id) done(d.report);
      if (d.type === "audit-error" && d.id === id) done({ error: d.message });
    };
    const onAbort = () => done({ error: "Stopped" });
    const t = setTimeout(() => done({ error: sent ? "The page took too long to measure" : "The page didn't load (is the dev server running?)" }), 40_000);
    window.addEventListener("message", onMsg);
    signal.addEventListener("abort", onAbort);
    f.src = frameUrl(base, v.url!);
    document.body.appendChild(f);
  });
}

/* ---------- helpers ---------- */
const mode = <T,>(xs: T[]): T | undefined => {
  const m = new Map<string, { v: T; n: number }>();
  for (const x of xs) { const k = JSON.stringify(x); const e = m.get(k) ?? { v: x, n: 0 }; e.n++; m.set(k, e); }
  return [...m.values()].sort((a, b) => b.n - a.n)[0]?.v;
};
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const top = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0];
const names = (ids: string[], byId: Map<string, View>) => ids.map((id) => byId.get(id)?.name ?? id);
const list = (xs: string[], n = 4) => (xs.length <= n ? xs.join(", ") : `${xs.slice(0, n).join(", ")} and ${xs.length - n} more`);
const where = (v: View) => `the page "${v.name}" (${v.route}${v.file ? `, ${v.file}` : ""})`;
const parentOf = (route: string) => route.replace(/\/[^/]*\/?$/, "") || "/";
let seq = 0;
const F = (f: Omit<Finding, "id">): Finding => ({ ...f, id: `f${++seq}` });

/** Turn any CSS color into #rrggbb using the browser itself. */
const ctx2d = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d", { willReadFrequently: true }) : null;
function toHex(css: string): string | null {
  if (!ctx2d) return null;
  ctx2d.clearRect(0, 0, 1, 1);
  ctx2d.fillStyle = "#010203";
  ctx2d.fillStyle = css;
  if (ctx2d.fillStyle === "#010203" && !/010203/.test(css)) return null;
  ctx2d.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx2d.getImageData(0, 0, 1, 1).data;
  if (a < 200) return null;
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a: string, b: string) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
const GENERIC = /^(serif|sans-serif|monospace|system-ui|ui-sans-serif|ui-serif|ui-monospace|-apple-system|blinkmacsystemfont|cursive|fantasy|inherit|initial)$/i;

/* ---------- analysis ---------- */
function consistency(reports: Map<string, Report>, byId: Map<string, View>): Finding[] {
  const out: Finding[] = [];
  const ids = [...reports.keys()];
  if (ids.length < 2) return out;
  const R = (id: string) => reports.get(id)!;
  for (const part of ["header", "footer"] as const) {
    const has = ids.filter((id) => R(id)[part]);
    const missing = ids.filter((id) => !R(id)[part]);
    if (has.length >= ids.length / 2 && missing.length) {
      out.push(F({ check: "consistency", severity: "warning", title: `No ${part} on ${list(names(missing, byId))}`, detail: `${has.length} of ${ids.length} pages have a ${part}; these don't.`, views: missing, fix: `Give ${list(names(missing, byId).map((n) => `"${n}"`))} the same ${part} as the other pages (reuse the shared ${part} component or layout).` }));
    }
    const hs = has.map((id) => R(id)[part]!.height);
    const m = median(hs);
    const odd = has.filter((id) => Math.abs(R(id)[part]!.height - m) > 12);
    if (odd.length && odd.length < has.length / 2) {
      out.push(F({ check: "consistency", severity: "warning", title: `The ${part} looks different on ${list(names(odd, byId))}`, detail: `It's ${odd.map((id) => `${R(id)[part]!.height}px`).join(", ")} tall there and ${m}px on the other pages.`, views: odd, fix: `Make the ${part} on ${list(names(odd, byId).map((n) => `"${n}"`))} match the rest of the site (${m}px tall, same content); use the shared ${part}.` }));
    }
  }
  // Type: headline and body fonts
  const h1Font = mode(ids.flatMap((id) => R(id).h1.slice(0, 1).map((h) => h.font)));
  const offH1 = ids.filter((id) => R(id).h1[0] && R(id).h1[0].font !== h1Font);
  if (h1Font && offH1.length && offH1.length < ids.length / 2) out.push(F({ check: "consistency", severity: "warning", title: `Different headline font on ${list(names(offH1, byId))}`, detail: `The main headline uses ${list([...new Set(offH1.map((id) => R(id).h1[0].font))])} there and ${h1Font} everywhere else.`, views: offH1, fix: `Use ${h1Font} for the h1 on ${list(names(offH1, byId).map((n) => `"${n}"`))}, like the other pages.` }));
  const bodyFont = mode(ids.map((id) => top(R(id).fonts)));
  const offBody = ids.filter((id) => top(R(id).fonts) && top(R(id).fonts) !== bodyFont);
  if (bodyFont && offBody.length && offBody.length < ids.length / 2) out.push(F({ check: "consistency", severity: "warning", title: `Different body font on ${list(names(offBody, byId))}`, detail: `Most text there is set in ${list([...new Set(offBody.map((id) => top(R(id).fonts)!))])} instead of ${bodyFont}.`, views: offBody, fix: `Set the body text on ${list(names(offBody, byId).map((n) => `"${n}"`))} in ${bodyFont}, like the rest of the site.` }));
  // Content width
  const widthOf = (id: string) => mode(R(id).sections.filter((s) => s.tag !== "header" && s.tag !== "footer" && s.tag !== "nav").map((s) => Math.round(s.contentWidth / 8) * 8));
  const w = mode(ids.map(widthOf).filter(Boolean) as number[]);
  const offW = ids.filter((id) => widthOf(id) && w && Math.abs(widthOf(id)! - w) > 24);
  if (w && offW.length && offW.length < ids.length / 2) out.push(F({ check: "consistency", severity: "info", title: `Content width differs on ${list(names(offW, byId))}`, detail: `Content there is ${offW.map((id) => `${widthOf(id)}px`).join(", ")} wide; elsewhere it's ${w}px.`, views: offW, fix: `Use the same content container (${w}px wide) on ${list(names(offW, byId).map((n) => `"${n}"`))} as the other pages.` }));
  // Subpages: siblings under the same parent should share a layout
  const groups = new Map<string, string[]>();
  for (const id of ids) { const v = byId.get(id)!; const p = parentOf(v.route); if (p === "/" || p === v.route) continue; groups.set(p, [...(groups.get(p) ?? []), id]); }
  for (const [parent, sib] of groups) {
    if (sib.length < 2) continue;
    const sig = (id: string) => R(id).sections.filter((s) => !["header", "footer", "nav"].includes(s.tag)).slice(0, 3).map((s) => `${s.cols > 1 ? `${s.cols}-column` : "single column"}${s.hasImg ? " with image" : ""}`);
    const common = mode(sib.map(sig));
    const odd = sib.filter((id) => JSON.stringify(sig(id)) !== JSON.stringify(common));
    if (common && odd.length && odd.length < sib.length) {
      out.push(F({ check: "consistency", severity: "warning", title: `${list(names(odd, byId))} ${odd.length === 1 ? "doesn't" : "don't"} follow the ${parent} layout`, detail: `The other ${parent} pages start with: ${common.join(" → ") || "no sections"}. ${odd.map((id) => `${byId.get(id)!.name}: ${sig(id).join(" → ") || "no sections"}`).join(". ")}.`, views: odd, fix: `Rebuild ${list(names(odd, byId).map((n) => `"${n}"`))} on the same template as the other pages under ${parent} (same sections in the same order: ${common.join(" → ")}), keeping their own content.` }));
    }
    const sz = mode(sib.map((id) => R(id).h1[0]?.size).filter(Boolean) as number[]);
    const oddH = sib.filter((id) => R(id).h1[0] && sz && Math.abs(R(id).h1[0].size - sz) > 4);
    if (sz && oddH.length && oddH.length < sib.length / 2 + 1 && oddH.length < sib.length) out.push(F({ check: "consistency", severity: "info", title: `Headline size differs on ${list(names(oddH, byId))}`, detail: `The h1 is ${oddH.map((id) => `${R(id).h1[0].size}px`).join(", ")} there and ${sz}px on the other ${parent} pages.`, views: oddH, fix: `Use the same h1 style (${sz}px) on ${list(names(oddH, byId).map((n) => `"${n}"`))} as the other pages under ${parent}.` }));
  }
  return out;
}

function tokens(reports: Map<string, Report>, byId: Map<string, View>, m: Manifest): Finding[] {
  const out: Finding[] = [];
  const palette = [...new Set(m.designSystem.tokens.filter((t) => t.category === "color").flatMap((t) => Object.values(t.values).map((v) => toHex(v.raw) ?? toHex(v.display))).filter(Boolean) as string[])];
  if (palette.length) {
    const used = new Map<string, string[]>();
    for (const [id, r] of reports) for (const c of new Set([...Object.keys(r.colors), ...Object.keys(r.bgs)])) used.set(c, [...(used.get(c) ?? []), id]);
    const off = [...used.entries()].filter(([c]) => !["#ffffff", "#000000"].includes(c) && Math.min(...palette.map((p) => dist(p, c))) > 10).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
    for (const [c, ids] of off) {
      const near = palette.slice().sort((a, b) => dist(a, c) - dist(b, c))[0];
      out.push(F({ check: "tokens", severity: "warning", title: `${c} isn't a design token`, detail: `Used on ${list(names(ids, byId))}. The closest token color is ${near}.`, views: ids, fix: `Replace the hard-coded color ${c} on ${list(names(ids, byId).map((n) => `"${n}"`))} with the right design token (the closest is ${near}). Find where it's set in the code.` }));
    }
  } else {
    out.push(F({ check: "tokens", severity: "info", title: "No color tokens found", detail: "Loupe couldn't find color tokens (CSS custom properties) in the project, so colors weren't checked.", views: [], fix: "Set up the project's colors as design tokens (CSS custom properties, e.g. --color-primary) and use them everywhere instead of hard-coded values." }));
  }
  const known = m.designSystem.fonts.map((f) => f.toLowerCase());
  if (known.length) {
    const fonts = new Map<string, string[]>();
    for (const [id, r] of reports) for (const f of Object.keys(r.fonts)) fonts.set(f, [...(fonts.get(f) ?? []), id]);
    for (const [f, ids] of fonts) if (!GENERIC.test(f) && !known.some((k) => k.includes(f.toLowerCase()) || f.toLowerCase().includes(k))) {
      out.push(F({ check: "tokens", severity: "warning", title: `Font "${f}" isn't in the design system`, detail: `Used on ${list(names(ids, byId))}. The design system has ${list(m.designSystem.fonts)}.`, views: ids, fix: `Replace the font "${f}" with one of the design system's fonts (${list(m.designSystem.fonts)}) on ${list(names(ids, byId).map((n) => `"${n}"`))}.` }));
    }
  }
  const sizes = new Set([...reports.values()].flatMap((r) => Object.keys(r.sizes)));
  if (sizes.size > 12) out.push(F({ check: "tokens", severity: "info", title: `${sizes.size} different text sizes`, detail: `Text across the site uses ${[...sizes].sort((a, b) => parseFloat(a) - parseFloat(b)).join(", ")}. A tighter type scale reads calmer.`, views: [], fix: `Consolidate the text sizes into the design system's type scale; replace one-off font sizes with the nearest step.` }));
  return out;
}

function a11y(reports: Map<string, Report>, byId: Map<string, View>): Finding[] {
  const out: Finding[] = [];
  for (const [id, r] of reports) {
    const v = byId.get(id)!;
    const A = r.a11y;
    if (A.lowContrast.length) out.push(F({ check: "a11y", severity: "error", title: `Low contrast text on ${v.name}`, detail: A.lowContrast.slice(0, 3).map((c) => `“${c.text || c.selector}” is ${c.ratio}:1 (${c.fg} on ${c.bg})`).join("; ") + (A.lowContrast.length > 3 ? ` and ${A.lowContrast.length - 3} more.` : "."), views: [id], fix: `On ${where(v)}, raise the text contrast to at least 4.5:1 (3:1 for large text) for: ${A.lowContrast.map((c) => `${c.selector} (${c.fg} on ${c.bg})`).join(", ")}. Use colors from the design tokens.` }));
    if (A.imgNoAlt.length) out.push(F({ check: "a11y", severity: "error", title: `${A.imgNoAlt.length} image${A.imgNoAlt.length > 1 ? "s" : ""} without alt text on ${v.name}`, views: [id], detail: A.imgNoAlt.map((i) => i.src || i.selector).slice(0, 3).join(", "), fix: `On ${where(v)}, add alt text to these images (alt="" if purely decorative): ${A.imgNoAlt.map((i) => i.selector).join(", ")}.` }));
    if (A.unnamed.length) out.push(F({ check: "a11y", severity: "error", title: `${A.unnamed.length} button${A.unnamed.length > 1 ? "s or links" : " or link"} without a name on ${v.name}`, views: [id], detail: "Screen readers can't tell what these do.", fix: `On ${where(v)}, give these an accessible name (visible text or aria-label): ${A.unnamed.map((u) => u.selector).join(", ")}.` }));
    if (A.inputsNoLabel.length) out.push(F({ check: "a11y", severity: "error", title: `Form fields without labels on ${v.name}`, views: [id], fix: `On ${where(v)}, add a <label> (or aria-label) to: ${A.inputsNoLabel.map((u) => u.selector).join(", ")}.` }));
    if (A.h1Count !== 1) out.push(F({ check: "a11y", severity: "warning", title: A.h1Count ? `${A.h1Count} h1 headings on ${v.name}` : `No h1 on ${v.name}`, views: [id], detail: "Each page should have exactly one main heading.", fix: `On ${where(v)}, make sure there's exactly one h1 (the page's main heading); turn the others into h2.` }));
    if (A.skips.length) out.push(F({ check: "a11y", severity: "info", title: `Headings skip levels on ${v.name}`, views: [id], detail: A.skips.slice(0, 4).join(", "), fix: `On ${where(v)}, fix the heading order so levels don't skip (${A.skips.join(", ")}); keep the look with classes, not heading levels.` }));
    if (!r.lang) out.push(F({ check: "a11y", severity: "warning", title: `No language set on ${v.name}`, views: [id], fix: `Add a lang attribute to the <html> element (for example lang="sv" or lang="en") for ${where(v)}.` }));
  }
  return out;
}

function seo(reports: Map<string, Report>, byId: Map<string, View>): Finding[] {
  const out: Finding[] = [];
  const titles = new Map<string, string[]>();
  for (const [id, r] of reports) {
    const v = byId.get(id)!;
    if (!r.title) out.push(F({ check: "seo", severity: "error", title: `No page title on ${v.name}`, views: [id], fix: `Give ${where(v)} a descriptive <title>.` }));
    else titles.set(r.title, [...(titles.get(r.title) ?? []), id]);
    if (!r.description) out.push(F({ check: "seo", severity: "warning", title: `No meta description on ${v.name}`, views: [id], fix: `Add a meta description (around 150 characters, specific to the page) to ${where(v)}.` }));
    if (!r.ogImage) out.push(F({ check: "seo", severity: "info", title: `No share image on ${v.name}`, views: [id], fix: `Add an og:image (and og:title) to ${where(v)} so links to it get a preview when shared.` }));
  }
  for (const [t, ids] of titles) if (ids.length > 1) out.push(F({ check: "seo", severity: "warning", title: `${ids.length} pages share the title “${t.slice(0, 50)}”`, views: ids, detail: list(names(ids, byId)), fix: `Give each of ${list(names(ids, byId).map((n) => `"${n}"`))} its own page title instead of “${t}”.` }));
  return out;
}

function mobile(mob: Map<string, Report>, byId: Map<string, View>): Finding[] {
  const out: Finding[] = [];
  for (const [id, r] of mob) {
    const v = byId.get(id)!;
    if (r.overflowX) out.push(F({ check: "mobile", severity: "error", title: `${v.name} scrolls sideways on mobile`, views: [id], detail: r.overflowEls.map((e) => `${e.selector} is ${e.width}px wide`).slice(0, 3).join("; "), fix: `On ${where(v)} at 390px wide, the page scrolls sideways. Make these fit the screen: ${r.overflowEls.map((e) => e.selector).join(", ")}.` }));
    if (r.tinyText > 5) out.push(F({ check: "mobile", severity: "warning", title: `Small text on ${v.name} on mobile`, views: [id], detail: `${r.tinyText} pieces of text are under 12px at 390 wide.`, fix: `On ${where(v)}, make text at least 12px (ideally 14px or more) on mobile.` }));
    if (!r.viewport) out.push(F({ check: "mobile", severity: "error", title: `No viewport meta tag on ${v.name}`, views: [id], fix: `Add <meta name="viewport" content="width=device-width, initial-scale=1"> to ${where(v)}.` }));
  }
  return out;
}

async function links(reports: Map<string, Report>, byId: Map<string, View>): Promise<Finding[]> {
  const out: Finding[] = [];
  const from = new Map<string, Set<string>>();
  const empty: string[] = [];
  for (const [id, r] of reports) {
    for (const l of r.links) {
      if (l.raw === null || l.raw === "" || l.raw === "#") { empty.push(id); continue; }
      if (l.path) from.set(l.path, new Set([...(from.get(l.path) ?? []), id]));
    }
  }
  const res = await fetch("/api/check-links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: [...from.keys()] }) }).then((r) => r.json()).catch(() => ({ statuses: {} }));
  for (const [p, status] of Object.entries(res.statuses as Record<string, number>)) {
    if (status && status < 400) continue;
    const ids = [...(from.get(p) ?? [])];
    out.push(F({ check: "links", severity: "error", title: `Broken link to ${p}`, detail: `${status ? `It answers ${status}` : "It doesn't answer"}. Linked from ${list(names(ids, byId))}.`, views: ids, fix: `The link to ${p} on ${list(names(ids, byId).map((n) => `"${n}"`))} is broken (${status || "no answer"}). Point it at the right page, or create the page if it's missing.` }));
  }
  const em = [...new Set(empty)];
  if (em.length) out.push(F({ check: "links", severity: "warning", title: `Placeholder links on ${list(names(em, byId))}`, detail: `Links with href="#" or no href don't go anywhere.`, views: em, fix: `Replace the placeholder links (href="#" or empty) on ${list(names(em, byId).map((n) => `"${n}"`))} with real destinations, or make them buttons if they trigger an action.` }));
  return out;
}

/* ---------- running it ---------- */
export type Progress = { phase: "pages" | "mobile" | "links" | "rules" | "done"; view?: View; index: number; total: number };

export async function runAudit({ manifest, base, checks, signal, onProgress }: {
  manifest: Manifest; base: string; checks: Set<CheckId>; signal: AbortSignal; onProgress: (p: Progress) => void;
}): Promise<{ findings: Finding[]; failed: { view: View; error: string }[] }> {
  const views = manifest.views.filter((v) => v.url && !v.dynamic);
  const byId = new Map(manifest.views.map((v) => [v.id, v]));
  const desk = new Map<string, Report>();
  const mob = new Map<string, Report>();
  const failed: { view: View; error: string }[] = [];
  const needDesk = ["consistency", "tokens", "a11y", "links", "seo"].some((c) => checks.has(c as CheckId));

  // One page at a time keeps the tour readable and the dev server calm
  if (needDesk) {
    for (let i = 0; i < views.length && !signal.aborted; i++) {
      onProgress({ phase: "pages", view: views[i], index: i, total: views.length });
      const r = await measure(base, views[i], manifest.viewport === "mobile" ? 390 : 1440, signal);
      if ("error" in r) { if (!signal.aborted) failed.push({ view: views[i], error: r.error }); } else desk.set(views[i].id, r);
    }
  }
  if (checks.has("mobile")) {
    for (let i = 0; i < views.length && !signal.aborted; i++) {
      onProgress({ phase: "mobile", view: views[i], index: i, total: views.length });
      const r = await measure(base, views[i], 390, signal);
      if (!("error" in r)) mob.set(views[i].id, r);
    }
  }
  if (signal.aborted) return { findings: [], failed };
  const findings: Finding[] = [];
  if (checks.has("consistency")) findings.push(...consistency(desk, byId));
  if (checks.has("tokens")) findings.push(...tokens(desk, byId, manifest));
  if (checks.has("a11y")) findings.push(...a11y(desk, byId));
  if (checks.has("seo")) findings.push(...seo(desk, byId));
  if (checks.has("mobile")) findings.push(...mobile(mob, byId));
  if (checks.has("links")) { onProgress({ phase: "links", index: 0, total: 1 }); findings.push(...(await links(desk, byId))); }
  for (const f of failed) findings.push(F({ check: "links", severity: "error", title: `${f.view.name} didn't load`, detail: f.error, views: [f.view.id], fix: `${where(f.view)} fails to load or render (${f.error}). Find out why and fix it.` }));
  const order = { error: 0, warning: 1, info: 2 };
  return { findings: findings.sort((a, b) => order[a.severity] - order[b.severity]), failed };
}

/** Findings Claude reported for the house rules, matched to views by route. */
export function ruleFindings(list: NonNullable<import("./types").CanvasPrompt["findings"]>, manifest: Manifest): Finding[] {
  const byRoute = new Map(manifest.views.map((v) => [v.route.replace(/\/$/, "") || "/", v.id]));
  return list.map((f) => {
    const id = f.route ? byRoute.get(f.route.replace(/\/$/, "") || "/") : undefined;
    return F({
      check: "rules", severity: f.severity, title: f.title, detail: [f.detail, f.rule ? `Rule: ${f.rule}` : null].filter(Boolean).join(" "),
      views: id ? [id] : [], fix: `${f.fix || f.title}${f.file ? ` (in ${f.file})` : ""}${f.rule ? `. This follows the house rule: “${f.rule}”.` : ""}`,
    });
  });
}

export function findingsMarkdown(project: string, findings: Finding[], byId: Map<string, View>) {
  const out = [`# Loupe check: ${project}`, "", `${new Date().toLocaleString()}`, ""];
  for (const c of CHECKS) {
    const fs = findings.filter((f) => f.check === c.id);
    if (!fs.length) continue;
    out.push(`## ${c.label}`, "");
    for (const f of fs) out.push(`- **${f.severity}**: ${f.title}${f.detail ? `. ${f.detail}` : ""}${f.views.length ? ` _(${f.views.map((id) => byId.get(id)?.name ?? id).join(", ")})_` : ""}`);
    out.push("");
  }
  return out.join("\n");
}
