#!/usr/bin/env node
// PreToolUse (Edit/Write/MultiEdit): when a view is selected, ask before touching files outside it.
import fs from "node:fs";
import path from "node:path";
import { readStdin, activeCanvas, out } from "./lib.mjs";

const input = await readStdin();
const c = activeCanvas(input.cwd);
const sel = c?.state?.selection;
if (!c || !sel || c.config.scopeGuard === "off") process.exit(0);

const target = input.tool_input?.file_path || input.tool_input?.notebook_path;
if (!target) process.exit(0);
const abs = path.resolve(input.cwd || c.root, target);
const rel = path.relative(c.root, abs).split(path.sep).join("/");
if (rel.startsWith("..") || rel.startsWith(".canvas/")) process.exit(0);

const own = new Set(sel.files || []);
if (own.has(rel)) process.exit(0);

// New files created next to the selected view's page are part of that view
const isNew = !fs.existsSync(abs);
if ((sel.kind === "view" || sel.kind === "section") && isNew && sel.file && path.posix.dirname(rel) === path.posix.dirname(sel.file)) process.exit(0);

const shared = (sel.sharedFiles || []).includes(rel);
const reason = shared
  ? `Project Canvas: "${rel}" is shared with other views, but only "${sel.name}" is selected. Editing it changes those views too.`
  : `Project Canvas: "${rel}" is outside the selected ${sel.kind} "${sel.name}".`;

out({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: `${reason} Clear the selection on the canvas to work project-wide.`,
  },
});
