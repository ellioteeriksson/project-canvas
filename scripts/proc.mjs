// Finds the Claude Code process a hook or the plugin's MCP server belongs to, so the canvas can
// tell which chat a prompt should go to. Hooks run as `sh -c node …` children of Claude Code,
// the MCP server is a direct child: the first ancestor that isn't a shell is Claude Code.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const SHELL = /^-?(sh|bash|zsh|dash|fish|ksh|tcsh|csh|cmd(\.exe)?|powershell(\.exe)?|pwsh)$/i;

function parent(pid) {
  try {
    const line = execFileSync("ps", ["-o", "ppid=,comm=", "-p", String(pid)], { encoding: "utf8", timeout: 600 }).trim();
    const m = line.match(/^(\d+)\s+(.+)$/);
    return m ? { ppid: Number(m[1]), comm: path.basename(m[2].trim()) } : null;
  } catch {
    return null;
  }
}

export function claudePid() {
  if (process.platform === "win32") return process.ppid;
  let pid = process.ppid;
  for (let i = 0; i < 4 && pid > 1; i++) {
    const p = parent(pid);
    if (!p) break;
    if (!SHELL.test(p.comm)) return pid;
    pid = p.ppid;
  }
  return process.ppid;
}

/** The command line Claude Code was started with (to see whether channels are on). */
export function commandLine(pid) {
  if (process.platform === "win32") return "";
  try { return execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8", timeout: 600 }).trim(); } catch { return ""; }
}

/** Cached per session, so hooks only pay for `ps` once. */
export function sessionClaudePid(sessionId) {
  if (!sessionId) return claudePid();
  const file = path.join(os.tmpdir(), `project-canvas-${String(sessionId).replace(/[^\w-]/g, "")}.pid`);
  try {
    const cached = Number(fs.readFileSync(file, "utf8"));
    if (cached) return cached;
  } catch {}
  const pid = claudePid();
  try { fs.writeFileSync(file, String(pid)); } catch {}
  return pid;
}
