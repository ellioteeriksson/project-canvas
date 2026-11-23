#!/usr/bin/env node
// Reports what Claude is doing (thinking, reading, editing, running a command, done) to the
// project's canvas, so the canvas can show it on the right frames and refresh them afterwards.
// Fire-and-forget: never prints anything and never holds Claude up for more than ~400ms.
import path from "node:path";
import { readStdin, activeCanvas } from "./lib.mjs";
import { sessionClaudePid } from "./proc.mjs";
import { stepForTool } from "../server/steps.mjs";

const input = await readStdin();
const c = activeCanvas(input.cwd);
if (!c?.state?.url) process.exit(0);

const event = input.hook_event_name;
const tool = input.tool_name;
const ti = input.tool_input || {};
const file = ti.file_path || ti.notebook_path || null;

let phase = null;
if (event === "SessionStart") phase = "hello";
else if (event === "UserPromptSubmit") phase = "thinking";
else if (event === "PreToolUse") {
  if (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) phase = "editing";
  else if (tool === "Read") phase = "reading";
  else if (tool === "Bash") phase = "running";
  else if (/^(Grep|Glob)$/.test(tool)) phase = "reading";
  else phase = "step";
} else if (event === "PostToolUse" && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) phase = "edited";
else if (event === "Stop" || event === "SubagentStop") phase = "done";
if (!phase) process.exit(0);

const body = {
  phase,
  session: input.session_id || "session",
  agent: input.agent_id || null,
  agentType: input.agent_type || null,
  subagent: event === "SubagentStop",
  file: file ? path.relative(c.root, path.resolve(input.cwd || c.root, file)).split(path.sep).join("/") : null,
  command: tool === "Bash" ? String(ti.description || ti.command || "").slice(0, 80) : null,
  at: Date.now(),
  step: event === "PreToolUse" ? stepForTool(tool, ti, c.root) : undefined,
  // Which Claude Code process this is, so the canvas can pair the session with its prompt channel
  claudePid: sessionClaudePid(input.session_id),
  prompt: event === "UserPromptSubmit" ? String(input.prompt || "").replace(/\s+/g, " ").slice(0, 400) : undefined,
};

try {
  await fetch(`${c.state.url}/api/activity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(400),
  });
} catch {}
process.exit(0);
