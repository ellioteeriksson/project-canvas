// The canvas side of "send a prompt to Claude Code from the canvas".
//
// Every Claude Code session with the plugin runs the plugin's MCP server (server/mcp.mjs). It finds
// this canvas through .canvas/state.json and holds an event stream open here, so the canvas knows
// which chats are open in the project. A prompt sent from the canvas reaches the chosen chat by the
// first route that works:
//   live       the session runs with channels on: pushed into the chat straight away
//   listening  Claude is waiting in canvas_wait (/canvas-listen): handed over as the tool result
//   stop       Claude is busy: the Stop hook hands it over when the current turn ends
//   prompt     the chat is idle: it rides along with the next message you type there
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEEP = 60;

export function createChannelHub({ root, broadcast, scopeFor, isBusy }) {
  const file = path.join(root, ".canvas", "chat.json");
  const conns = new Map(); // conn id -> { id, claudePid, live, waiting, session, res, connectedAt, goneAt }
  const sessions = new Map(); // session id -> { claudePid, prompt, last }
  const permissions = new Map(); // request_id -> { request_id, conn, tool_name, description, input_preview, at }
  let prompts = [];
  try {
    prompts = JSON.parse(fs.readFileSync(file, "utf8")).prompts || [];
    // Chats from before a restart can't answer any more
    for (const p of prompts) if (!["done", "failed", "cancelled"].includes(p.status)) { p.status = "failed"; p.note = "The canvas restarted before Claude answered"; }
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
        id: c.id, status: statusOf(c), live: c.live, session: c.session || null,
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
  function claim({ session, claudePid, via }) {
    link(session, claudePid);
    const c = connFor({ session, claudePid });
    if (!c) return {};
    const q = nextQueued(c.id);
    return q ? deliver(q, via === "stop" ? "stop" : "prompt") : {};
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
  function submit({ text, conn }) {
    const body = String(text || "").trim();
    if (!body) return { ok: false, error: "Write a prompt first" };
    const target = conn && conns.get(conn)?.res ? conn : defaultConn();
    if (!target) return { ok: false, error: "No Claude Code chat is open in this project" };
    const id = crypto.randomBytes(3).toString("hex");
    const { label, scope } = scopeFor();
    const full = [
      `<canvas-prompt prompt_id="${id}">`,
      body,
      `</canvas-prompt>`,
      "",
      scope,
      "",
      `The user sent this from the Project Canvas, not from this chat. When you're done, call the canvas_reply tool with prompt_id "${id}" and a 1–3 sentence summary of what you changed, in the language of the prompt.`,
    ].join("\n");
    const p = { id, conn: target, session: conns.get(target)?.session || null, text: body, scope: label, status: "queued", at: now(), full };
    prompts.push(p);
    route(p);
    changed();
    const { full: _f, ...pub } = p;
    return { ok: true, prompt: pub };
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
    prompts = prompts.filter((p) => !["done", "failed", "cancelled"].includes(p.status));
    changed();
    return { ok: true };
  }

  return { stream, waiting, ack, requeue, reply, permissionRequest, claim, activity, submit, cancel, verdict, clear, summary, push };
}
