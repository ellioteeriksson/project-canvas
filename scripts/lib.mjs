// Shared helpers for Project Canvas hooks. Hooks must never crash or block Claude Code.
import fs from "node:fs";
import path from "node:path";

export async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  try { return JSON.parse(data || "{}"); } catch { return {}; }
}

/** Walk up from cwd to find a project with a .canvas folder. */
export function findProject(start) {
  let dir = path.resolve(start || process.cwd());
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, ".canvas", "state.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

export function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

export function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

/** Returns { root, state, config, manifest } when a canvas server is running for this project. */
export function activeCanvas(cwd) {
  if (process.env.PROJECT_CANVAS_HOOKS === "off") return null;
  const root = findProject(cwd);
  if (!root) return null;
  const state = readJSON(path.join(root, ".canvas", "state.json"));
  if (!state || !alive(state.pid)) return null;
  return {
    root,
    state,
    config: readJSON(path.join(root, ".canvas", "config.json")) || {},
    manifest: readJSON(path.join(root, ".canvas", "manifest.json")),
  };
}

export function out(obj) {
  process.stdout.write(JSON.stringify(obj));
}
