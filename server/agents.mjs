/**
 * Claude Code sessions that Loupe runs itself, one or more per project.
 *
 * Each is `claude -p` with streaming JSON in and out. To the prompt hub it looks like a live chat:
 * canvas prompts are written to its input, its answers come back through Loupe's MCP tools
 * (canvas_reply, canvas_concepts, canvas_findings) or its final result. Edits run without asking
 * (permission mode acceptEdits); anything else that needs approval asks the user in Loupe through
 * the canvas_permission tool. What it does feeds the canvas's activity and changelog, and every
 * event is kept as the session's transcript for the chat panel.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MCP = path.join(HERE, "mcp.mjs");
const KEEP = 600; // transcript events kept per session

export function findClaude() {
  if (process.env.LOUPE_CLAUDE && fs.existsSync(process.env.LOUPE_CLAUDE)) return process.env.LOUPE_CLAUDE;
  const home = os.homedir();
  for (const c of [`${home}/.claude/local/claude`, `${home}/.local/bin/claude`, "/opt/homebrew/bin/claude", "/usr/local/bin/claude"]) if (fs.existsSync(c)) return c;
  try { return execFileSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split("\n")[0].trim() || null; } catch { return null; }
}

const SYSTEM = [
  "You are running inside Loupe, a visual canvas of this project's pages. The user talks to you from Loupe and reads your messages there, not in a terminal.",
  "Keep messages short and plain. When a message is a <canvas-prompt>, follow its scope and instructions, and answer with the canvas tools it names.",
  "File edits in the project run without asking. Shell commands and anything outside the project ask the user in Loupe first, so explain briefly why you need one.",
].join(" ");

const summarize = (name, input = {}) => {
  const f = input.file_path || input.notebook_path || input.path;
  if (f) return String(f);
  if (input.command) return String(input.command).slice(0, 300);
  if (input.pattern) return String(input.pattern).slice(0, 200);
  if (input.url) return String(input.url).slice(0, 300);
  if (input.description) return String(input.description).slice(0, 200);
  return "";
};

export function createAgents({ root, hub, recordActivity, broadcast, serverUrl, log = () => {} }) {
  const file = path.join(root, ".canvas", "agents.json");
  const exe = findClaude();
  const sessions = new Map(); // id → session
  const waiters = new Map(); // permission request id → resolve
  let saved = [];
  try { saved = JSON.parse(fs.readFileSync(file, "utf8")).sessions || []; } catch {}

  const save = () => {
    const list = [...sessions.values()].map((s) => ({ id: s.id, label: s.label, claudeSession: s.claudeSession, startedAt: s.startedAt }));
    // Keep sessions that ran before, so they can be resumed later
    const merged = [...list, ...saved.filter((x) => !list.some((y) => y.id === x.id))].slice(0, 12);
    saved = merged;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ sessions: merged }, null, 2)); } catch {}
  };
  const pub = (s) => ({
    id: s.id, label: s.label, state: s.state, claudeSession: s.claudeSession, startedAt: s.startedAt, error: s.error || null,
    prompt: s.current ? s.current.text : null, views: [...s.views], cost: s.cost, queue: s.queue.length,
  });
  const list = () => [...sessions.values()].map(pub);
  const push = () => broadcast("agents", list());
  const emit = (s, ev) => {
    const e = { at: Date.now(), ...ev };
    s.transcript.push(e);
    if (s.transcript.length > KEEP) s.transcript.splice(0, s.transcript.length - KEEP);
    broadcast("agent-event", { id: s.id, ev: e });
  };
  const rel = (f) => { const p = path.resolve(root, String(f)); return p.startsWith(root) ? path.relative(root, p) : String(f); };
  const setState = (s, state) => { s.state = state; hub.setManaged(s.id, { state }); push(); };

  function writeUser(s, text) {
    if (!s.proc?.stdin?.writable) return false;
    s.proc.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: text } }) + "\n");
    return true;
  }

  /** Hand the next message to Claude when it's free */
  function pump(s) {
    if (s.state !== "idle" || !s.queue.length) return;
    const m = s.queue.shift();
    s.current = m;
    if (!writeUser(s, m.full)) { s.current = null; return; }
    if (m.promptId) hub.ack(s.id, m.promptId, "channel");
    emit(s, { kind: "user", text: m.text, promptId: m.promptId || null, scope: m.scope || null });
    setState(s, "working");
    // Canvas prompts start their changelog entry when delivered; typed messages start one here
    if (s.claudeSession) recordActivity({ session: s.claudeSession, phase: "thinking", prompt: m.promptId ? undefined : m.text, managed: s.id });
  }

  /** The hub "streams" to a managed session through this function */
  function hubWriter(s) {
    return (chunk) => {
      const event = /^event: (.+)$/m.exec(chunk)?.[1];
      const data = /^data: (.+)$/m.exec(chunk)?.[1];
      if (!event || !data) return true;
      let d; try { d = JSON.parse(data); } catch { return true; }
      if (event === "prompt") {
        const p = hub.promptById(d.id);
        s.queue.push({ promptId: d.id, full: d.text, text: p?.text || d.text, scope: p?.scope || null });
        pump(s);
        push();
      } else if (event === "verdict") {
        const w = waiters.get(d.request_id);
        if (w) { waiters.delete(d.request_id); w(d.behavior); }
      }
      return true;
    };
  }

  function onLine(s, line) {
    let m; try { m = JSON.parse(line); } catch { return; }
    // Every event carries the session id; take it from the first one
    if (m.session_id && s.claudeSession !== m.session_id) {
      s.claudeSession = m.session_id;
      hub.setManaged(s.id, { session: m.session_id });
      save();
    }
    if (m.type === "system" && m.subtype === "init") {
      s.claudeSession = m.session_id;
      hub.setManaged(s.id, { session: m.session_id });
      if (s.state === "starting") setState(s, "idle");
      save();
      recordActivity({ session: s.claudeSession, phase: "hello", managed: s.id });
      pump(s);
      return;
    }
    if (m.type === "system" && m.subtype === "api_retry") { emit(s, { kind: "note", text: `Retrying (${m.error || "error"})…` }); return; }
    if (m.type === "assistant" && m.message?.content) {
      if (m.parent_tool_use_id) return; // subagent detail stays out of the chat
      for (const b of m.message.content) {
        if (b.type === "text" && b.text?.trim()) emit(s, { kind: "text", text: b.text });
        if (b.type === "tool_use") {
          const name = b.name || "";
          if (name === "mcp__loupe__canvas_permission") continue;
          const detail = summarize(name, b.input);
          emit(s, { kind: "tool", name, detail, toolId: b.id });
          if (!s.claudeSession) continue;
          if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(name) && detail) {
            const f = rel(detail);
            s.edits.set(b.id, f);
            recordActivity({ session: s.claudeSession, phase: "editing", file: f, managed: s.id });
          } else if (name === "Bash") recordActivity({ session: s.claudeSession, phase: "running", command: detail, managed: s.id });
          else if (["Read", "Grep", "Glob"].includes(name)) recordActivity({ session: s.claudeSession, phase: "reading", file: detail ? rel(detail) : null, managed: s.id });
        }
      }
      return;
    }
    if (m.type === "user" && Array.isArray(m.message?.content)) {
      if (m.parent_tool_use_id) return;
      for (const b of m.message.content) {
        if (b.type !== "tool_result") continue;
        const text = Array.isArray(b.content) ? b.content.map((x) => x.text || "").join(" ") : String(b.content || "");
        emit(s, { kind: "result", toolId: b.tool_use_id, error: !!b.is_error, text: text.slice(0, 400) });
        const f = s.edits.get(b.tool_use_id);
        if (f) {
          s.edits.delete(b.tool_use_id);
          if (!b.is_error && s.claudeSession) { recordActivity({ session: s.claudeSession, phase: "edited", file: f, managed: s.id }); s.views.add(f); }
        }
      }
      return;
    }
    if (m.type === "result") {
      s.cost = m.total_cost_usd ?? s.cost;
      const text = typeof m.result === "string" ? m.result : "";
      const authFail = m.is_error && /authenticat|oauth|log ?in|api key|credential/i.test(text);
      if (authFail) s.error = "Claude Code isn't logged in for Loupe. Run claude in a terminal, type /login, then start a new session here.";
      emit(s, { kind: "done", error: !!m.is_error, text: authFail ? s.error : m.is_error ? text.slice(0, 600) : "", ms: m.duration_ms });
      if (authFail) push();
      // Claude may finish without calling canvas_reply: close the prompt with its last words
      const open = hub.openPromptOf(s.id);
      if (open) hub.reply(s.id, open.id, text ? text.slice(0, 1200) : m.is_error ? "Claude stopped with an error." : "Done.");
      if (s.claudeSession) recordActivity({ session: s.claudeSession, phase: "done", managed: s.id });
      s.current = null;
      setState(s, "idle");
      pump(s);
    }
  }

  function start({ label, resume } = {}) {
    if (!exe) return { ok: false, error: "Claude Code isn't installed, or Loupe can't find it. Install it from claude.com/code, then try again." };
    const id = `loupe-${crypto.randomBytes(3).toString("hex")}`;
    const n = sessions.size + 1;
    const s = {
      id, label: label || (n === 1 ? "Claude" : `Claude ${n}`), state: "starting", startedAt: Date.now(), claudeSession: resume || null,
      queue: [], current: null, transcript: [], views: new Set(), edits: new Map(), cost: 0, proc: null, error: null,
    };
    const mcpEnv = { LOUPE_MANAGED_URL: serverUrl(), LOUPE_CONN: id, CLAUDE_PROJECT_DIR: root, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
    const args = [
      "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
      "--permission-mode", "acceptEdits",
      "--mcp-config", JSON.stringify({ mcpServers: { loupe: { command: process.execPath, args: [MCP], env: mcpEnv } } }),
      "--permission-prompt-tool", "mcp__loupe__canvas_permission",
      "--allowedTools", "mcp__loupe__canvas_reply,mcp__loupe__canvas_concepts,mcp__loupe__canvas_findings",
      "--append-system-prompt", SYSTEM,
      ...(resume ? ["--resume", resume] : []),
    ];
    // The plugin's own hooks and MCP server stay out of the way: this session talks to Loupe directly
    const env = { ...process.env, PROJECT_CANVAS_HOOKS: "off", CLAUDE_CODE_ENTRYPOINT: "loupe" };
    delete env.ELECTRON_RUN_AS_NODE;
    let proc;
    try { proc = spawn(exe, args, { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (e) { return { ok: false, error: String(e.message || e) }; }
    s.proc = proc;
    sessions.set(id, s);
    hub.attach(id, { label: s.label, write: hubWriter(s), session: s.claudeSession });
    // Claude Code only says hello (init) after the first message, so it takes messages right away
    s.state = "idle";
    hub.setManaged(id, { state: "idle" });
    pump(s);
    let buf = "";
    proc.stdout.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) onLine(s, line); }
    });
    let err = "";
    proc.stderr.on("data", (d) => { err = (err + d).slice(-4000); });
    proc.on("error", (e) => { s.error = String(e.message || e); });
    proc.on("exit", (code) => {
      if (code && !s.stopping) s.error = s.error || err.trim().split("\n").slice(-2).join(" ") || `Claude Code quit (${code})`;
      emit(s, { kind: "stopped", error: s.stopping ? null : s.error });
      for (const [rid, w] of waiters) if (rid.startsWith(id)) { waiters.delete(rid); w("deny"); }
      hub.detach(id, s.stopping ? "You stopped the session" : "The session stopped before it answered");
      if (s.claudeSession) recordActivity({ session: s.claudeSession, phase: "done", managed: id });
      sessions.delete(id);
      push();
      log(`session ${s.label} ended${s.error ? `: ${s.error}` : ""}`);
    });
    emit(s, { kind: "started", resumed: !!resume });
    save();
    push();
    log(`started ${s.label} (${path.basename(exe)})`);
    return { ok: true, session: pub(s) };
  }

  function say(id, text) {
    const s = sessions.get(id);
    if (!s) return { ok: false, error: "That session isn't running" };
    const t = String(text || "").trim().slice(0, 20_000);
    if (!t) return { ok: false, error: "Write something first" };
    s.queue.push({ full: t, text: t });
    pump(s);
    push();
    return { ok: true };
  }

  function interrupt(id) {
    const s = sessions.get(id);
    if (!s?.proc) return { ok: false };
    // The SDK's control message ends the turn without ending the session
    s.proc.stdin.write(JSON.stringify({ type: "control_request", request_id: crypto.randomBytes(4).toString("hex"), request: { subtype: "interrupt" } }) + "\n");
    s.queue.length = 0;
    emit(s, { kind: "note", text: "Stopped by you." });
    return { ok: true };
  }

  function stop(id) {
    const s = sessions.get(id);
    if (!s) return { ok: false };
    s.stopping = true;
    try { s.proc.stdin.end(); } catch {}
    setTimeout(() => { try { s.proc.kill("SIGTERM"); } catch {} }, 1500).unref?.();
    return { ok: true };
  }

  /** From the canvas_permission tool: ask the user, resolve with their answer */
  function permission(connId, body) {
    const s = sessions.get(connId);
    if (!s) return Promise.resolve({ behavior: "deny", message: "This session isn't run by Loupe." });
    const request_id = `${connId}-${crypto.randomBytes(3).toString("hex")}`;
    const tool = String(body?.tool_name || "a tool");
    const input = body?.input || {};
    const detail = summarize(tool, input);
    const description = tool === "Bash" ? `Run a command${input.description ? `: ${input.description}` : ""}`
      : tool === "WebFetch" ? "Open a web page" : tool === "WebSearch" ? "Search the web"
      : /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool) ? "Change a file outside the project"
      : `Use ${tool.replace(/^mcp__/, "").replace(/__/g, " › ")}`;
    hub.permissionRequest(connId, { request_id, tool_name: tool, description, input_preview: detail || JSON.stringify(input).slice(0, 1500) });
    emit(s, { kind: "ask", requestId: request_id, tool, detail: description + (detail ? `: ${detail}` : "") });
    setState(s, "waiting");
    return new Promise((resolve) => {
      const t = setTimeout(() => { waiters.delete(request_id); resolve("deny"); }, 30 * 60_000);
      waiters.set(request_id, (behavior) => {
        clearTimeout(t);
        emit(s, { kind: "answer", requestId: request_id, allowed: behavior === "allow" });
        if (s.state === "waiting") setState(s, "working");
        resolve(behavior);
      });
    }).then((behavior) => (behavior === "allow" ? { behavior: "allow" } : { behavior: "deny", message: "The user declined this in Loupe. Find another way or ask them." }));
  }

  const transcript = (id) => sessions.get(id)?.transcript ?? [];

  /** The session to send a prompt about these views to: the one that worked on them, else a free one */
  function pick(viewFiles = []) {
    const all = [...sessions.values()].filter((s) => s.state !== "starting" || s.queue.length < 3);
    if (!all.length) return null;
    const touched = all.find((s) => viewFiles.some((f) => s.views.has(f)));
    if (touched) return touched.id;
    const free = all.filter((s) => s.state === "idle");
    return (free[0] || all.sort((a, b) => a.queue.length - b.queue.length)[0]).id;
  }

  function stopAll() { for (const id of sessions.keys()) stop(id); }
  process.on("exit", () => { for (const s of sessions.values()) try { s.proc.kill("SIGTERM"); } catch {} });

  return {
    available: () => !!exe, binary: exe, list, start, say, interrupt, stop, stopAll, permission, transcript, pick,
    previous: () => saved.filter((x) => x.claudeSession && !sessions.has(x.id)),
    has: (id) => sessions.has(id),
  };
}
