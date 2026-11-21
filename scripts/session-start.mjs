#!/usr/bin/env node
// SessionStart: remember where the plugin lives and tell Claude if a canvas is already open.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readStdin, activeCanvas, out } from "./lib.mjs";

const input = await readStdin();
const root = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  const dir = path.join(os.homedir(), ".claude", "loupe");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plugin-root"), root);
} catch {}

const c = activeCanvas(input.cwd);
const lines = [`Loupe plugin root: ${root} (start a canvas with: node "${root}/server/index.mjs" --project "<project dir>" --open)`];
if (c) {
  const sel = c.state.selection;
  lines.push(`Loupe is open for ${c.root} at ${c.state.url}.${sel ? ` Selected: ${sel.kind} "${sel.name}".` : " Nothing is selected."}`);
}
out({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") } });
