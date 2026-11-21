// The canvas side of "send a prompt to Claude Code from the canvas".
//
// Every Claude Code session with the plugin runs the plugin's MCP server (server/mcp.mjs). It finds
// this canvas through .canvas/state.json and holds an event stream open here, so the canvas knows
// which chats are open in the project. A prompt sent from the canvas reaches the chosen chat by the
// first route that works:
//   live       the session runs with channels on: pushed into the chat straight away
//   listening  Claude is waiting in canvas_wait (/loupe-listen): handed over as the tool result
//   stop       Claude is busy: the Stop hook hands it over when the current turn ends
//   prompt     the chat is idle: it rides along with the next message you type there
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEEP = 60;

export function createChannelHub({ root, broadcast, scopeFor, isBusy, onEvent = () => {} }) {
  const file = path.join(root, ".canvas", "chat.json");
  const conns = new Map(); // conn id -> { id, claudePid, live, waiting, session, res, connectedAt, goneAt }
  const sessions = new Map(); // session id -> { claudePid, prompt, last }
  const permissions = new Map(); // request_id -> { request_id, conn, tool_name, description, input_preview, at }
  let prompts = [];
  try {
    prompts = JSON.parse(fs.readFileSync(file, "utf8")).prompts || [];
    // Chats from before a restart can't answer any more
    for (const p of prompts) if (!["done", "failed", "cancelled", "concepts", "findings"].includes(p.status)) { p.status = "failed"; p.note = "The canvas restarted before Claude answered"; }
  } catch {}

  /* ---------- helpers ---------- */
  const now = () => Date.now();
  function statusOf(c) {
    if (!c.res) return "offline";
    if (c.live) return "live";
    if (c.waiting) return "listening";
    if (c.session && isBusy(c.session)) return "busy";
    return "idle";
  }
  function summary() {
    return {
      conns: [...conns.values()].map((c) => ({
        id: c.id, status: statusOf(c), live: c.live, listen: !!c.listen, session: c.session || null,
        label: (c.session && sessions.get(c.session)?.prompt) || null,
        last: (c.session && sessions.get(c.session)?.last) || c.connectedAt, connectedAt: c.connectedAt,
      })).sort((a, b) => b.last - a.last),
      prompts: prompts.map(({ full, ...p }) => p),
      permissions: [...permissions.values()],
    };
  }
  let pushTimer = null;
  function push() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => broadcast("chat", summary()), 30);
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      prompts = prompts.slice(-KEEP);
      try { fs.writeFileSync(file, JSON.stringify({ prompts: prompts.map(({ full, ...p }) => p) }, null, 2)); } catch {}
    }, 200);
  }
  function changed() { push(); save(); }
  function sendTo(c, event, data) {
    if (!c?.res) return false;
    c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  }
  function connFor({ session, claudePid }) {
    const all = [...conns.values()].filter((c) => c.res);
    return all.find((c) => session && c.session === session) || all.find((c) => claudePid && c.claudePid === claudePid) || null;
  }
  function link(session, claudePid) {
    if (!session || !claudePid) return;
    for (const c of conns.values()) if (c.claudePid === claudePid && c.session !== session) { c.session = session; push(); }
  }
  function nextQueued(connId) {
    return prompts.find((p) => p.conn === connId && p.status === "queued");
  }
  function deliver(p, via) {
    Object.assign(p, { status: "delivered", via, deliveredAt: now() });
    const parent = p.parent ? prompts.find((x) => x.id === p.parent) : null;
    onEvent("delivered", { ...p, parentText: parent?.text ?? null }, conns.get(p.conn));
    changed();
    return { id: p.id, text: p.full };
  }
  /** Try to hand a queued prompt to its chat right away. */
  function route(p) {
    const c = conns.get(p.conn);
    if (!c?.res || !(c.live || c.waiting)) return;
    c.waiting = false;
    p.status = "sending";
    sendTo(c, "prompt", { id: p.id, text: p.full });
    changed();
  }
  function defaultConn() {
    const order = { live: 0, listening: 1, busy: 2, idle: 3 };
    const list = summary().conns.filter((c) => c.status !== "offline");
    list.sort((a, b) => order[a.status] - order[b.status] || b.last - a.last);
    return list[0]?.id || null;
  }

  /* ---------- MCP side ---------- */
  function stream(req, res, url) {
    const id = String(url.searchParams.get("conn") || "").slice(0, 40);
    if (!id) { res.writeHead(400); return res.end(); }
    const c = conns.get(id) || { id, connectedAt: now() };
    Object.assign(c, {
      claudePid: Number(url.searchParams.get("claudePid")) || null,
      live: url.searchParams.get("live") === "1",
      waiting: false, res, goneAt: null,
    });
    // Pair with a session the hooks already told us about
    for (const [sid, s] of sessions) if (s.claudePid && s.claudePid === c.claudePid) c.session = sid;
    conns.set(id, c);
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
    const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
    req.on("close", () => {
      clearInterval(ping);
      if (c.res !== res) return;
      c.res = null;
      c.waiting = false;
      c.goneAt = now();
      push();
      // Give a restarting MCP server a moment before giving up on the chat
      setTimeout(() => {
        if (c.res) return;
        conns.delete(id);
        for (const p of prompts) {
          if (p.conn !== id) continue;
          if (["queued", "sending"].includes(p.status)) { p.status = "failed"; p.note = "The chat closed before it got the prompt"; }
          else if (p.status === "delivered") { p.status = "failed"; p.note = "The chat closed without answering"; }
        }
        for (const [rid, perm] of permissions) if (perm.conn === id) permissions.delete(rid);
        changed();
      }, 8000).unref();
    });
    const q = nextQueued(id);
    if (q) route(q);
    push();
  }

  function waiting(connId, on) {
    const c = conns.get(connId);
    if (!c) return {};
    if (on) { c.listen = true; onEvent("waiting", null, c); }
    if (on) {
      // Calling canvas_wait again means the previous canvas prompt is finished
      for (const p of prompts) if (p.conn === connId && p.status === "delivered" && p.via === "listen") { p.status = "done"; p.doneAt = now(); }
      const q = nextQueued(connId);
      if (q) { c.waiting = false; return { prompt: deliver(q, "listen") }; }
    }
    c.waiting = !!on;
    changed();
    return {};
  }
  function ack(connId, id, via) {
    const p = prompts.find((x) => x.id === id && x.conn === connId);
    if (p && ["sending", "queued"].includes(p.status)) deliver(p, via === "channel" ? "live" : "listen");
    return { ok: !!p };
  }
  function requeue(connId, id) {
    const p = prompts.find((x) => x.id === id && x.conn === connId);
    if (p && p.status === "sending") { p.status = "queued"; changed(); }
    return { ok: !!p };
  }
  function reply(connId, id, text) {
    const p = prompts.find((x) => x.id === id) || [...prompts].reverse().find((x) => x.conn === connId && x.status === "delivered");
    if (!p) return { ok: false, error: `No canvas prompt with id ${id}` };
    Object.assign(p, { status: "done", reply: String(text || "").slice(0, 4000), doneAt: now() });
    onEvent("reply", p, conns.get(p.conn));
    changed();
    return { ok: true };
  }
  function permissionRequest(connId, body) {
    if (!body?.request_id) return { ok: false };
    permissions.set(body.request_id, {
      request_id: String(body.request_id), conn: connId, at: now(),
      tool_name: String(body.tool_name || ""), description: String(body.description || "").slice(0, 600),
      input_preview: String(body.input_preview || "").slice(0, 2000),
    });
    push();
    return { ok: true };
  }

  /* ---------- hook side ---------- */
  function claim({ session, claudePid, via, stopHookActive }) {
    link(session, claudePid);
    const c = connFor({ session, claudePid });
    if (!c) return {};
    const q = nextQueued(c.id);
    if (q) return deliver(q, via === "stop" ? "stop" : "prompt");
    // The chat was listening before you used it: go back to listening when the turn ends
    if (via === "stop" && c.listen && !c.waiting && !c.live && !stopHookActive) {
      return { resume: true, text: "Go back to listening to Loupe: call canvas_wait now (listening was started by /loupe). If the user asked you to stop listening, call canvas_stop_listening instead." };
    }
    return {};
  }
  function activity(ev) {
    if (!ev?.session) return;
    const s = sessions.get(ev.session) || {};
    sessions.set(ev.session, { claudePid: ev.claudePid || s.claudePid, prompt: ev.prompt || s.prompt, last: now() });
    link(ev.session, ev.claudePid);
    if (ev.phase === "done" && !ev.subagent) {
      // The turn ended: what it was working on is finished (unless the Stop hook just handed over a new one)
      for (const p of prompts) {
        const c = conns.get(p.conn);
        if (p.status !== "delivered" || c?.session !== ev.session || p.via === "listen") continue;
        if (p.via === "stop" && now() - p.deliveredAt < 4000) continue;
        p.status = "done";
        p.doneAt = now();
      }
      changed();
    } else push();
  }

  /* ---------- canvas UI side ---------- */
  const REPLY = (id) => `When you're done, call the canvas_reply tool with prompt_id "${id}" and a 1–3 sentence summary of what you changed, in the language of the prompt.`;

  function conceptInstructions(id, info) {
    const where = info?.section != null ? `the selected section (selector "@scope")`
      : info?.selectors?.length ? `the selected element${info.selectors.length > 1 ? `s ("@element:1" … "@element:${info.selectors.length}", "@scope" is the first)` : ` (selector "@scope")`}`
      : null;
    return [
      `This is a design request from Loupe. Don't edit any project files yet: propose 4 visual concepts first.`,
      `1. Read the code behind the scope above, so the concepts fit the existing page and design system.`,
      `2. Call the canvas_concepts tool once, with prompt_id "${id}" and exactly 4 concepts that differ clearly from each other (layout, hierarchy, type, color or imagery, not only copy). Give each a short title and a one-sentence summary.`,
      `   Each concept is previewed by changing the live page ${info?.url ? `${info.url} ` : ""}in the browser, at ${info?.device === "mobile" ? "390" : "1440"}px wide:`,
      where
        ? `   - replace: [{ selector, html }] swaps rendered elements for your HTML. Replace ${where} with your version of it.`
        : `   - replace: [{ selector, html }] swaps rendered elements for your HTML. Use CSS selectors for elements as they are rendered on the page (for example "main > section:nth-of-type(2)").`,
      `   - css: extra CSS for the preview. The page's own CSS still applies, but utility classes the project doesn't already use (Tailwind, for example) won't exist, so put new styling here, scoped under a class unique to the concept (such as .pc-c1). Use real copy and the project's fonts and colors. Images: reuse ones from the page.`,
      `3. Then stop and wait. The user picks a concept in the canvas, and you'll get a follow-up prompt to build it in the real code.`,
    ].join("\n");
  }

  function createPrompt({ conn, text, mode = "direct", scope, body, parent, tailOverride }) {
    const target = conn && conns.get(conn)?.res ? conn : defaultConn();
    if (!target) return { ok: false, error: "No Claude Code chat is open in this project" };
    const id = crypto.randomBytes(3).toString("hex");
    const tail = tailOverride ? tailOverride(id) : mode === "concepts" ? conceptInstructions(id, scope.info) : REPLY(id);
    const full = [`<canvas-prompt prompt_id="${id}">`, body ?? text, `</canvas-prompt>`, "", scope.scope, "", typeof tail === "function" ? tail(id) : tail].join("\n");
    const p = {
      id, conn: target, session: conns.get(target)?.session || null, text, mode, parent: parent || null,
      scope: scope.label, scopeText: scope.scope, info: scope.info || null, status: "queued", at: now(), full,
    };
    prompts.push(p);
    route(p);
    changed();
    const { full: _f, ...pub } = p;
    return { ok: true, prompt: pub };
  }

  function submit({ text, conn, mode }) {
    const body = String(text || "").trim();
    if (!body) return { ok: false, error: "Write a prompt first" };
    return createPrompt({ conn, text: body, mode: mode === "concepts" ? "concepts" : "direct", scope: scopeFor() });
  }

  /* ---------- design concepts ---------- */
  function concepts(connId, id, list) {
    const p = prompts.find((x) => x.id === id);
    if (!p) return { ok: false, error: `No canvas prompt with id ${id}` };
    if (!Array.isArray(list) || !list.length) return { ok: false, error: "Send at least one concept" };
    const str = (v, n) => String(v ?? "").slice(0, n);
    p.concepts = list.slice(0, 6).map((c, i) => ({
      title: str(c?.title, 80) || `Concept ${i + 1}`,
      summary: str(c?.summary, 500),
      css: str(c?.css, 30_000),
      replace: (Array.isArray(c?.replace) ? c.replace : []).slice(0, 10).map((r) => ({ selector: str(r?.selector, 300), html: str(r?.html, 60_000) })),
    }));
    Object.assign(p, { status: "concepts", doneAt: now() });
    changed();
    return { ok: true };
  }
  function choose({ id, index, comment }) {
    const p = prompts.find((x) => x.id === id);
    const c = p?.concepts?.[index];
    if (!c) return { ok: false, error: "That concept doesn't exist any more" };
    const note = String(comment || "").trim().slice(0, 2000);
    p.chosen = { index, comment: note || null, at: now() };
    const code = [
      `Concept ${index + 1} “${c.title}”: ${c.summary}`,
      c.css ? `Preview CSS:\n\`\`\`css\n${c.css}\n\`\`\`` : null,
      ...c.replace.map((r) => `Preview HTML for \`${r.selector}\`:\n\`\`\`html\n${r.html}\n\`\`\``),
    ].filter(Boolean).join("\n\n");
    const text = `Build concept ${index + 1}, “${c.title}”${note ? `, with this change: ${note}` : ""}`;
    const body = [
      `Build concept ${index + 1} (“${c.title}”) in the real code.${note ? `\nThe user's comment on it: ${note}` : ""}`,
      "",
      `The user picked it in Loupe from your concepts for prompt ${p.id} (“${p.text}”). It was previewed with the markup and CSS below. Build the same design with the project's own components, styling approach and tokens, rather than pasting the preview HTML. Keep to the scope below.`,
      "",
      code,
    ].join("\n");
    const r = createPrompt({ conn: p.conn, text, mode: "apply", scope: { label: p.scope, scope: p.scopeText, info: p.info }, body, parent: p.id });
    if (r.ok) p.applied = r.prompt.id;
    changed();
    return r;
  }
  function again({ id, comment }) {
    const p = prompts.find((x) => x.id === id);
    if (!p) return { ok: false, error: "That request doesn't exist any more" };
    const note = String(comment || "").trim().slice(0, 2000);
    const prev = (p.concepts || []).map((c, i) => `${i + 1}. ${c.title}: ${c.summary}`).join("\n");
    const body = [
      p.text,
      "",
      `This is a new round: the user wants 4 new concepts for the request above.${note ? ` Their feedback: ${note}` : ""}`,
      prev ? `Your previous concepts were:\n${prev}` : null,
    ].filter((x) => x !== null).join("\n");
    return createPrompt({ conn: p.conn, text: note ? `${p.text} (new round: ${note})` : `${p.text} (new round)`, mode: "concepts", scope: { label: p.scope, scope: p.scopeText, info: p.info }, body, parent: p.id });
  }

  /* ---------- helper buddy: checking the project against the house rules ---------- */
  function rulesCheck({ conn, rules, views }) {
    const text = String(rules || "").trim();
    if (!text) return { ok: false, error: "There are no rules yet. Add some in the rules file first." };
    const list = (Array.isArray(views) ? views : []).slice(0, 200).map((v) => `- ${v.name} (${v.route}${v.file ? `, ${v.file}` : ""})`).join("\n");
    const body = [
      `Check the whole project against the house rules below, and report what breaks them. Don't change any files.`,
      "",
      "Rules (.canvas/rules.md):",
      text,
      "",
      list ? `Pages in the project:\n${list}` : null,
    ].filter((x) => x !== null).join("\n");
    const tail = (id) => [
      `Read the code (and the rendered pages if you need to) for every page. Then call the canvas_findings tool once with prompt_id "${id}" and every rule that is broken: for each, the rule, a severity (error, warning or info), a short title, one or two sentences of detail, the route of the page (or null for the whole project), the file to change, and a one-sentence fix. Report each problem once, the most important first. If nothing breaks the rules, call canvas_findings with an empty list.`,
    ].join("\n");
    return createPrompt({ conn, text: "Check the project against the house rules", mode: "audit", scope: { label: "Whole project", scope: "", info: null }, body, tailOverride: tail });
  }
  function findings(connId, id, list) {
    const p = prompts.find((x) => x.id === id);
    if (!p) return { ok: false, error: `No canvas prompt with id ${id}` };
    const str = (v, n) => (v == null ? null : String(v).slice(0, n));
    p.findings = (Array.isArray(list) ? list : []).slice(0, 80).map((f) => ({
      rule: str(f?.rule, 300), severity: ["error", "warning", "info"].includes(f?.severity) ? f.severity : "warning",
      title: str(f?.title, 160) || "Rule not followed", detail: str(f?.detail, 800), route: str(f?.route, 300), file: str(f?.file, 300), fix: str(f?.fix, 600),
    }));
    Object.assign(p, { status: "findings", doneAt: now() });
    changed();
    return { ok: true };
  }

  /* ---------- listening that survives the chat being used ---------- */
  function stopListening(connId) {
    const c = conns.get(connId);
    if (!c) return { ok: false };
    c.listen = false;
    if (c.waiting) { c.waiting = false; sendTo(c, "stop-wait", {}); }
    changed();
    return { ok: true };
  }

  function cancel(id) {
    const p = prompts.find((x) => x.id === id);
    if (p && p.status === "queued") { p.status = "cancelled"; changed(); return { ok: true }; }
    return { ok: false };
  }
  function verdict(requestId, behavior) {
    const perm = permissions.get(requestId);
    if (!perm || !["allow", "deny"].includes(behavior)) return { ok: false };
    permissions.delete(requestId);
    sendTo(conns.get(perm.conn), "verdict", { request_id: requestId, behavior });
    push();
    return { ok: true };
  }
  function clear() {
    prompts = prompts.filter((p) => !["done", "failed", "cancelled", "findings"].includes(p.status) && !(p.status === "concepts" && p.chosen));
    changed();
    return { ok: true };
  }

  /** Keys the changelog may have used for a session's work (before the chat was paired with it) */
  function connKeys(session) {
    return [...conns.values()].filter((c) => c.session === session).map((c) => `conn:${c.id}`);
  }

  return { rulesCheck, findings, connKeys, stream, waiting, ack, requeue, reply, permissionRequest, claim, activity, submit, cancel, verdict, clear, summary, push, concepts, choose, again, stopListening };
}
