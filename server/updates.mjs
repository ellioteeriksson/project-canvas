// Finds out whether a newer Loupe is installed than the one serving this canvas, and restarts into it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const cmp = (a, b) => {
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

const versionAt = (root) => {
  try {
    if (!fs.existsSync(path.join(root, "server", "index.mjs")) || !fs.existsSync(path.join(root, "app", "dist", "index.html"))) return null;
    return JSON.parse(fs.readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8")).version || null;
  } catch { return null; }
};

/** Every Loupe copy Claude Code has on this computer, newest first */
export function installedCopies() {
  const home = os.homedir();
  const roots = new Set();
  try { roots.add(fs.readFileSync(path.join(home, ".claude", "loupe", "plugin-root"), "utf8").trim()); } catch {}
  const cache = path.join(home, ".claude", "plugins", "cache");
  try {
    for (const market of fs.readdirSync(cache)) {
      const dir = path.join(cache, market, "loupe");
      try { for (const v of fs.readdirSync(dir)) roots.add(path.join(dir, v)); } catch {}
    }
  } catch {}
  return [...roots].map((root) => ({ root, version: versionAt(root) })).filter((x) => x.version).sort((a, b) => cmp(b.version, a.version));
}

export function createUpdates({ version, root: here, project, port, log = () => {}, onChange = () => {} }) {
  let newer = null;
  function check() {
    const best = installedCopies().find((x) => path.resolve(x.root) !== path.resolve(here));
    const next = best && cmp(best.version, version) > 0 ? best : null;
    if (next?.version !== newer?.version) { newer = next; if (next) log(`loupe ${next.version} is installed; this canvas runs ${version}`); if (ready) onChange(); }
  }
  let ready = false;
  check();
  ready = true;
  setInterval(check, 60_000).unref?.();

  /** Start the newer server for this project on the same port; it replaces this one */
  function restart() {
    check();
    if (!newer) return { ok: false, error: "No newer Loupe is installed. Update it first: claude plugin update loupe@loupe" };
    const logFile = path.join(project, ".canvas", "server.log");
    let out = "ignore";
    try { out = fs.openSync(logFile, "a"); } catch {}
    const child = spawn(process.execPath, [path.join(newer.root, "server", "index.mjs"), "--project", project, "--port", String(port())], {
      cwd: project, detached: true, stdio: ["ignore", out, out], env: { ...process.env, CLAUDE_PLUGIN_ROOT: newer.root },
    });
    child.unref();
    log(`restarting into loupe ${newer.version}`);
    return { ok: true, version: newer.version };
  }

  return { info: () => ({ version, newer: newer ? newer.version : null }), check, restart };
}
