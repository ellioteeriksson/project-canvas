#!/usr/bin/env node
// Delivers prompts sent from the canvas to a chat that has no live channel and isn't listening:
// - Stop: when Claude finishes a turn, a waiting canvas prompt keeps it going (decision "block").
// - UserPromptSubmit: when you type in the chat, waiting canvas prompts ride along as context.
import { readStdin, activeCanvas, out } from "./lib.mjs";
import { sessionClaudePid } from "./proc.mjs";

const input = await readStdin();
const c = activeCanvas(input.cwd);
if (!c?.state?.url) process.exit(0);
const event = input.hook_event_name;

let claim = null;
try {
  const r = await fetch(`${c.state.url}/api/channel/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session: input.session_id, claudePid: sessionClaudePid(input.session_id), via: event === "Stop" ? "stop" : "prompt", stopHookActive: !!input.stop_hook_active }),
    signal: AbortSignal.timeout(1500),
  });
  claim = await r.json();
} catch {}
if (!claim?.text) process.exit(0);

if (event === "Stop") out({ decision: "block", reason: claim.text });
else if (claim.resume) process.exit(0);
else out({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `While you were busy, the user also sent this from the Project Canvas. Handle it too:\n${claim.text}` } });
