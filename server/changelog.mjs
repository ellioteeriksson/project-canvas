// Changelog: every turn in which Claude changed files, with what was asked, where, what Claude
// said it did and which files it touched. Kept in .canvas/changelog.json (ignored by git).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const KEEP = 500;

export function createChangelog({ root, broadcast }) {
  const file = path.join(root, ".canvas", "changelog.json");
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(file, "utf8")).entries || []; } catch {}
  const open = new Map(); // session key -> entry in progress

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      entries = entries.slice(-KEEP);
      try { fs.writeFileSync(file, JSON.stringify({ entries }, null, 2)); } catch {}
    }, 300);
  }
  let pushTimer = null;
  function push() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => broadcast("changelog", list()), 60);
  }
  function list() {
    const live = [...open.values()].filter((e) => e.files.length).map((e) => ({ ...e, inProgress: true }));
    return [...entries, ...live].sort((a, b) => a.at - b.at);
  }

  /** A new request starts for this session: close whatever it was doing before. */
  function start(key, data) {
    close(key);
    open.set(key, { id: crypto.randomBytes(4).toString("hex"), at: Date.now(), files: [], summary: null, ...data });
  }
  function close(key) {
    const e = open.get(key);
    if (!e) return;
    open.delete(key);
    if (e.files.length) {
      e.endAt = Date.now();
      entries.push(e);
      save();
    }
    push();
  }
  function edited(keys, rel) {
    if (!rel) return;
    let e = keys.map((k) => open.get(k)).find(Boolean);
    if (!e) {
      // Edits without a request we saw (a session from before the canvas started, say)
      start(keys[0], { source: "chat", prompt: null });
      e = open.get(keys[0]);
    }
    if (!e.files.includes(rel)) e.files.push(rel);
    push();
  }
  function summary(promptId, text) {
    const e = [...open.values(), ...entries].find((x) => x.promptId === promptId);
    if (!e) return;
    e.summary = String(text || "").slice(0, 2000);
    save();
    push();
  }
  function clear() {
    entries = [];
    save();
    push();
    return { ok: true };
  }
  return { start, close, edited, summary, list, clear, push };
}
