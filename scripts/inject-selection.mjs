#!/usr/bin/env node
// UserPromptSubmit: scope every prompt to whatever is selected on the canvas.
import { readStdin, activeCanvas, out } from "./lib.mjs";
import { buildScope } from "./scope.mjs";

const input = await readStdin();
const c = activeCanvas(input.cwd);
if (!c) process.exit(0);

const ctx = buildScope(c.state.selection, c.manifest);
out({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx } });
