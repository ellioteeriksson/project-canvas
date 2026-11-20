#!/usr/bin/env node
/**
 * Project Canvas MCP server: one runs inside every Claude Code chat that has the plugin.
 * Zero dependencies; speaks MCP (newline-delimited JSON-RPC) over stdio.
 *
 * It connects the chat to the project's canvas, so prompts typed in the canvas reach this chat:
 * - as a channel event when Claude Code runs with channels on (pushed straight into the chat)
 * - as the result of canvas_wait when Claude is listening (/canvas-listen)
 * and Claude answers in the canvas with canvas_reply. With channels on it also relays permission
 * prompts to the canvas, so you can allow or deny tool use there.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { activeCanvas } from "../scripts/lib.mjs";
import { claudePid, commandLine } from "../scripts/proc.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VERSION = JSON.parse(fs.readFileSync(path.resolve(HERE, "..", ".claude-plugin", "plugin.json"), "utf8")).version;
const PROJECT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CONN = crypto.randomBytes(5).toString("hex");
const CPID = claudePid();
const CMDLINE = commandLine(CPID);
// Channels only deliver when this plugin was named in --channels (or the development flag)
const LIVE = process.env.PROJECT_CANVAS_LIVE === "1" || (/--(dangerously-load-development-)?channels\b/.test(CMDLINE) && /project-canvas/.test(CMDLINE));
const WAIT_MS = Number(process.env.PROJECT_CANVAS_WAIT_MS) || 10 * 60_000;

const log = (...a) => process.stderr.write(`[project-canvas mcp] ${a.join(" ")}\n`);
const write = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
const notify = (method, params) => write({ method, params });

/* ---------------- canvas connection ---------------- */
let canvasUrl = null; // set while the event stream to the canvas is open
let wait = null; // pending canvas_wait: { reqId, timer, progress }

async function post(p, body) {
  if (!canvasUrl) return {};
  try {
    const r = await fetch(canvasUrl + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conn: CONN, ...body }), signal: AbortSignal.timeout(3000) });
    return await r.json();
  } catch {
    return {};
  }
}

function onPrompt({ id, text }) {
  if (LIVE) {
    notify("notifications/claude/channel", { content: text, meta: { prompt_id: id } });
    post("/api/channel/ack", { id, via: "channel" });
  } else if (wait) {
    finishWait(listenResult(text));
    post("/api/channel/ack", { id, via: "listen" });
  } else {
    post("/api/channel/requeue", { id });
  }
}

function onVerdict({ request_id, behavior }) {
  if (LIVE && request_id && (behavior === "allow" || behavior === "deny")) notify("notifications/claude/channel/permission", { request_id, behavior });
}

async function streamOnce(c) {
  const q = new URLSearchParams({ conn: CONN, claudePid: String(CPID), live: LIVE ? "1" : "0", cwd: PROJECT, pid: String(process.pid) });
  const res = await fetch(`${c.state.url}/api/channel/stream?${q}`, { headers: { Accept: "text/event-stream" } });
  if (!res.ok || !res.body) throw new Error(`canvas answered ${res.status}`);
  canvasUrl = c.state.url;
  log(`connected to ${canvasUrl} (${LIVE ? "live channel" : "listen/queue"})`);
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const event = block.match(/^event: (.+)$/m)?.[1];
      const data = block.match(/^data: (.+)$/m)?.[1];
      if (!event || !data) continue;
      let payload;
      try { payload = JSON.parse(data); } catch { continue; }
      if (event === "prompt") onPrompt(payload);
      else if (event === "verdict") onVerdict(payload);
    }
  }
}

async function connectLoop() {
  for (;;) {
    const c = activeCanvas(PROJECT);
    if (c?.state?.url) {
      try { await streamOnce(c); } catch (e) { if (canvasUrl) log("disconnected:", e.message); }
      canvasUrl = null;
      if (wait) finishWait(textResult("The Project Canvas closed. Stop listening and tell the user."));
    }
    await new Promise((r) => setTimeout(r, c ? 2000 : 4000));
  }
}

/* ---------------- tools ---------------- */
const TOOLS = [
  {
    name: "canvas_wait",
    description:
      "Listen for the next prompt the user sends from the Project Canvas. Only use it after the user asked you to listen to the canvas (/canvas-listen) or a canvas_wait result told you to call it again. Blocks until a prompt arrives or about 10 minutes pass. When a prompt arrives, do it like any user message, call canvas_reply, then call canvas_wait again.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "canvas_reply",
    description: "Answer a prompt the user sent from the Project Canvas. The user reads this in the canvas, not in this chat, so summarise what you did in 1–3 sentences, in the language of the prompt.",
    inputSchema: {
      type: "object",
      properties: {
        prompt_id: { type: "string", description: "The prompt_id of the canvas prompt you are answering" },
        text: { type: "string", description: "What you did, or the question you need answered" },
      },
      required: ["prompt_id", "text"],
      additionalProperties: false,
    },
  },
];

const textResult = (text, isError = false) => ({ content: [{ type: "text", text }], isError });
const listenResult = (text) => textResult(`${text}\n\nAfter canvas_reply, call canvas_wait again to keep listening to the canvas.`);

function finishWait(result) {
  if (!wait) return;
  const w = wait;
  wait = null;
  clearTimeout(w.timer);
  clearInterval(w.progress);
  if (result) write({ id: w.reqId, result });
}

async function callTool(reqId, name, args, meta) {
  if (name === "canvas_reply") {
    if (!canvasUrl) return write({ id: reqId, result: textResult("The Project Canvas isn't running, so the reply couldn't be shown there. Tell the user in this chat instead.", true) });
    const r = await post("/api/channel/reply", { id: String(args?.prompt_id || ""), text: String(args?.text || "") });
    return write({ id: reqId, result: r.ok ? textResult("Shown in the canvas.") : textResult(r.error || "The canvas didn't accept the reply.", true) });
  }
  if (name === "canvas_wait") {
    for (let i = 0; i < 10 && !canvasUrl; i++) await new Promise((r) => setTimeout(r, 500));
    if (!canvasUrl) return write({ id: reqId, result: textResult("The Project Canvas isn't running for this project, so there is nothing to listen to. Tell the user to start it with /canvas.", true) });
    finishWait(textResult("Superseded by a newer canvas_wait call."));
    const r = await post("/api/channel/waiting", { waiting: true });
    if (r.prompt) return write({ id: reqId, result: listenResult(r.prompt.text) });
    const token = meta?.progressToken;
    let n = 0;
    wait = {
      reqId,
      timer: setTimeout(() => {
        post("/api/channel/waiting", { waiting: false });
        finishWait(textResult("No prompt from the canvas in the last 10 minutes. Call canvas_wait again to keep listening, unless the user asked you to stop."));
      }, WAIT_MS),
      // Keep the call alive in clients that time out quiet requests
      progress: token !== undefined ? setInterval(() => notify("notifications/progress", { progressToken: token, progress: ++n, message: "Listening to the Project Canvas" }), 20_000) : null,
    };
    return;
  }
  write({ id: reqId, error: { code: -32602, message: `Unknown tool: ${name}` } });
}

/* ---------------- JSON-RPC ---------------- */
const INSTRUCTIONS = [
  "Project Canvas shows this project's pages on a visual canvas, and the user can send prompts to this chat from it.",
  'Canvas prompts arrive as <channel source="…" prompt_id="…"> events, or as the result of canvas_wait when you are listening. Treat them exactly like a message the user typed here, and follow the <project-canvas-scope> block inside: it says which page, section or elements the prompt is about.',
  "When you have finished a canvas prompt, call canvas_reply with its prompt_id and a short summary of what you changed, in the language of the prompt. The user reads it in the canvas.",
  "Only call canvas_wait when the user asked you to listen to the canvas, or a canvas_wait result told you to call it again.",
].join("\n");

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    const asked = String(params?.protocolVersion || "2025-06-18");
    return write({
      id,
      result: {
        protocolVersion: asked < "2026-07-28" ? asked : "2025-06-18",
        capabilities: { experimental: { "claude/channel": {}, "claude/channel/permission": {} }, tools: {} },
        serverInfo: { name: "project-canvas", version: VERSION },
        instructions: INSTRUCTIONS,
      },
    });
  }
  if (method === "ping") return write({ id, result: {} });
  if (method === "tools/list") return write({ id, result: { tools: TOOLS } });
  if (method === "tools/call") return callTool(id, params?.name, params?.arguments || {}, params?._meta);
  if (method === "notifications/cancelled") {
    if (wait && wait.reqId === params?.requestId) { finishWait(null); post("/api/channel/waiting", { waiting: false }); }
    return;
  }
  if (method === "notifications/claude/channel/permission_request") {
    post("/api/channel/permission", { request_id: params?.request_id, tool_name: params?.tool_name, description: params?.description, input_preview: params?.input_preview });
    return;
  }
  if (id !== undefined && method) write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  for (const m of Array.isArray(msg) ? msg : [msg]) handle(m).catch((e) => log("error:", e.message));
});
rl.on("close", () => process.exit(0));
connectLoop();
