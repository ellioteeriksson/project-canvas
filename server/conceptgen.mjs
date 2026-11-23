/**
 * Fast design concepts: Loupe sketches the 4 concepts itself, in parallel, instead of asking the chat
 * to make them one after another.
 *
 * It loads the page in the headless browser and takes the scoped part's rendered markup, the fonts and
 * colors it uses and a picture of it. Then it runs four one-off `claude -p` calls at once (no tools, no
 * MCP servers, structured output), each with its own direction, and shows each concept the moment it's
 * ready. The chat only comes in when the user picks one to build. If Claude Code can't be run, or every
 * sketch fails, the request goes to the chat the usual way.
 */
import { spawn, execFile } from "node:child_process";
import { findClaude } from "./agents.mjs";

const DIRECTIONS = [
  "Refined: keep the current structure and feel, and make it clearly better: spacing, hierarchy, alignment and detail.",
  "New layout: rethink how the content is arranged and grouped, a different structure from the current one.",
  "Bold: stronger typography, scale and contrast; a confident, editorial take.",
  "Different mood: a new use of color, surface or imagery, while staying recognisably the same brand.",
];

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "2 to 4 words" },
    summary: { type: "string", description: "One sentence on what changes and why" },
    html: { type: "string", description: "The new markup for the scoped element, one root element" },
    css: { type: "string", description: "CSS for the concept, every rule scoped under the concept's root class" },
  },
  required: ["title", "summary", "html", "css"],
};

const SYSTEM = [
  "You are a senior product designer working inside Loupe, a design tool for websites built with code.",
  "You propose one design concept at a time as replacement markup and CSS, previewed on the live page in a browser.",
  "Answer only with the structured output. Write real, specific copy (keep the page's copy unless the request asks for new copy), keep it accessible (contrast, real buttons and links, alt text), and stay within the brand you're shown.",
].join(" ");

export function createConceptEngine({ root, shooter, hub, pageUrl, log = () => {}, model = () => "sonnet" }) {
  const exe = findClaude();
  // Which flags this Claude Code knows (older versions lack some); checked once, in the background
  let flags = null;
  if (exe) execFile(exe, ["--help"], { encoding: "utf8", timeout: 20_000 }, (err, out) => {
    const help = String(out || "");
    flags = new Set(["--tools", "--json-schema", "--strict-mcp-config", "--no-session-persistence", "--system-prompt", "--effort"].filter((f) => help.includes(f)));
  });
  const known = () => flags || new Set();
  const available = () => !!exe && shooter.available() && known().has("--json-schema");
  const running = new Map(); // prompt id → child processes

  function sketch({ index, request, scopeLabel, info, ctx, previous }) {
    const cls = `pc-c${index + 1}`;
    const text = [
      `Request from the user: ${request}`,
      "",
      `Page: ${info?.url || "/"}, shown ${info?.device === "mobile" ? "on a phone, 390" : "on desktop, 1440"}px wide. Scope: ${scopeLabel || "the page"}.`,
      ctx.image ? "The picture shows the scoped part as it looks now." : null,
      "",
      `This is concept ${index + 1} of 4; the other three are made at the same time with other directions. Your direction: ${DIRECTIONS[index]}`,
      previous ? `\nEarlier concepts the user has already seen (make something new):\n${previous}` : null,
      "",
      "The scoped part as rendered now (cleaned DOM):",
      "```html",
      ctx.html,
      "```",
      "",
      "What it uses:",
      `- fonts: ${ctx.fonts.join("; ") || "unknown"}`,
      `- text colors: ${ctx.colors.join(", ") || "unknown"}; backgrounds: ${ctx.backgrounds.join(", ") || "none"}; page background: ${ctx.page?.bodyBg}`,
      `- font sizes: ${ctx.fontSizes.join(", ")}; corner radii: ${ctx.radii.join(", ") || "none"}`,
      ctx.vars.length ? `- CSS variables on :root: ${ctx.vars.join("; ")}` : null,
      ctx.classes.length ? `- classes in use (their CSS exists on the page): ${ctx.classes.join(" ")}` : null,
      "",
      "Return:",
      `- html: one root element that replaces the scoped part, with class "${cls}" on the root. Reuse image URLs from the markup above; don't invent image files.`,
      `- css: all new styling, every selector starting with .${cls}. The page's own CSS still applies, but classes not listed above (Tailwind utilities, for example) don't exist, so style with your CSS. Use the fonts, colors and variables above.`,
      "- title and summary for the user, in the language of the request.",
    ].filter((x) => x !== null).join("\n");

    const f = known();
    const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--json-schema", JSON.stringify(SCHEMA)];
    if (f.has("--tools")) args.push("--tools", "");
    if (f.has("--strict-mcp-config")) args.push("--strict-mcp-config");
    if (f.has("--no-session-persistence")) args.push("--no-session-persistence");
    if (f.has("--system-prompt")) args.push("--system-prompt", SYSTEM);
    const m = model();
    if (m && m !== "default") args.push("--model", m);
    const env = { ...process.env, PROJECT_CANVAS_HOOKS: "off", CLAUDE_CODE_ENTRYPOINT: "loupe-concepts" };
    delete env.ELECTRON_RUN_AS_NODE;

    return new Promise((resolve, reject) => {
      let proc;
      try { proc = spawn(exe, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] }); } catch (e) { return reject(e); }
      const timer = setTimeout(() => { try { proc.kill("SIGTERM"); } catch {} reject(new Error("took too long")); }, 180_000);
      let out = "", err = "", result = null;
      proc.stdout.on("data", (d) => {
        out += d;
        let i;
        while ((i = out.indexOf("\n")) >= 0) {
          const line = out.slice(0, i); out = out.slice(i + 1);
          try { const msg = JSON.parse(line); if (msg.type === "result") result = msg; } catch {}
        }
      });
      proc.stderr.on("data", (d) => { err = (err + d).slice(-2000); });
      proc.on("error", (e) => { clearTimeout(timer); reject(e); });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        if (!result || result.is_error) return reject(new Error((result?.result || err.trim().split("\n").pop() || `Claude Code quit (${code})`).slice(0, 300)));
        let c = result.structured_output;
        if (!c && typeof result.result === "string") { const j = /\{[\s\S]*\}/.exec(result.result); try { c = j && JSON.parse(j[0]); } catch {} }
        if (!c?.html) return reject(new Error("No concept came back"));
        resolve({ title: c.title, summary: c.summary, css: c.css || "", replace: [{ selector: ctx.selector || "@scope", html: c.html }] });
      });
      (running.get(info?.promptId) || running.set(info?.promptId, []).get(info?.promptId)).push(proc);
      const content = [];
      if (ctx.image) content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: ctx.image } });
      content.push({ type: "text", text });
      proc.stdin.end(JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n");
    });
  }

  /** Make the 4 concepts for a prompt. Resolves false when the chat should do it instead. */
  async function run(p, { request, previous }) {
    const t0 = Date.now();
    const url = pageUrl(p.info);
    if (!url) return false;
    let ctx;
    try {
      ctx = await shooter.extract({ url, device: p.info.device, scope: { section: p.info.section, selectors: p.info.selectors } });
    } catch (e) {
      log(`concepts: couldn't read the page (${e.message}); the chat makes them instead`);
      return false;
    }
    hub.conceptProgress(p.id, { stage: "sketching", at: Date.now() });
    let ok = 0;
    const jobs = DIRECTIONS.map((_, index) =>
      sketch({ index, request, scopeLabel: p.scope, info: { ...p.info, promptId: p.id }, ctx, previous })
        .then((c) => { ok++; hub.conceptPart(p.id, index, c); })
        .catch((e) => { log(`concept ${index + 1} failed: ${e.message}`); hub.conceptPart(p.id, index, null, e.message); }));
    await Promise.all(jobs);
    running.delete(p.id);
    log(`concepts for ${p.id}: ${ok} of 4 in ${Math.round((Date.now() - t0) / 1000)}s`);
    return ok > 0;
  }

  function cancel(id) {
    for (const proc of running.get(id) || []) try { proc.kill("SIGTERM"); } catch {}
    running.delete(id);
  }

  return { available, run, cancel };
}
