/**
 * The projects you've opened Loupe in, for the Loupe app's home screen.
 * Kept in ~/.claude/loupe/projects.json, keyed by project root. Nothing in it leaves your machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.homedir(), ".claude", "loupe");
const FILE = path.join(DIR, "projects.json");

const read = () => { try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return { projects: {} }; } };
const write = (d) => {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, FILE);
};

/** Note that Loupe ran in a project, with what it found there */
export function remember(root, info = {}) {
  try {
    const d = read();
    const prev = d.projects[root] || {};
    d.projects[root] = { ...prev, ...info, root, lastOpened: info.lastOpened ?? Date.now(), addedAt: prev.addedAt ?? Date.now() };
    delete d.projects[root].hidden;
    write(d);
  } catch {}
}

/** Take a project off the home screen (its files and .canvas folder stay as they are) */
export function forget(root) {
  const d = read();
  if (d.projects[root]) { d.projects[root].hidden = true; write(d); }
}

/**
 * Projects where Loupe ran before the app existed: Claude Code keeps a folder per project under
 * ~/.claude/projects, and each session log records the working directory it ran in.
 */
function backfill(d) {
  const base = path.join(os.homedir(), ".claude", "projects");
  let dirs = [];
  try { dirs = fs.readdirSync(base); } catch { return false; }
  let changed = false;
  const known = new Set(Object.keys(d.projects));
  for (const dir of dirs) {
    let logs = [];
    try { logs = fs.readdirSync(path.join(base, dir)).filter((f) => f.endsWith(".jsonl")).slice(0, 3); } catch { continue; }
    for (const log of logs) {
      const cwd = firstCwd(path.join(base, dir, log));
      if (!cwd) continue;
      const root = findCanvasRoot(cwd);
      if (root && !known.has(root)) {
        known.add(root);
        const m = loadManifest(root);
        d.projects[root] = { root, name: m?.project?.name || path.basename(root), framework: m?.project?.framework, mode: m?.mode, views: m?.views?.length, lastOpened: mtime(path.join(root, ".canvas")), addedAt: Date.now() };
        changed = true;
      }
      break;
    }
  }
  return changed;
}

function firstCwd(file) {
  try {
    const fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const m = /"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(buf.subarray(0, n).toString("utf8"));
    return m ? JSON.parse(`"${m[1]}"`) : null;
  } catch { return null; }
}

function findCanvasRoot(dir) {
  let d = path.resolve(dir);
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, ".canvas", "config.json")) || fs.existsSync(path.join(d, ".canvas", "manifest.json"))) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
export const loadManifest = (root) => { try { return JSON.parse(fs.readFileSync(path.join(root, ".canvas", "manifest.json"), "utf8")); } catch { return null; } };

let backfilled = false;
/** Every remembered project that still exists, most recent first */
export function list() {
  const d = read();
  if (!backfilled) { backfilled = true; if (backfill(d)) write(d); }
  return Object.values(d.projects)
    .filter((p) => !p.hidden && fs.existsSync(p.root))
    .sort((a, b) => (b.lastOpened || 0) - (a.lastOpened || 0));
}

/** The home page's latest desktop snapshot, for the project's card */
export function thumbnail(root) {
  const dir = path.join(root, ".canvas", "snapshots");
  let index = {};
  try { index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")); } catch { return null; }
  const m = loadManifest(root);
  const ids = m?.views?.map((v) => v.id) ?? [];
  const pick = (id) => index[`${id}|desktop|live`] || index[`${id}|desktop|wire`];
  const hit = ids.map(pick).find(Boolean) || Object.entries(index).find(([k]) => k.includes("|desktop|"))?.[1];
  if (!hit) return null;
  const file = path.join(dir, path.basename(hit.file));
  return fs.existsSync(file) ? file : null;
}
