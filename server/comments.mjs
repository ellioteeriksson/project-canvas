/**
 * Comments pinned on the canvas: a note on a spot of a page, kept in .canvas/comments.json.
 * They can be sent to Claude as a prompt scoped to that page (and section), and resolved when done.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createComments({ root, broadcast }) {
  const file = path.join(root, ".canvas", "comments.json");
  let items = [];
  try { items = JSON.parse(fs.readFileSync(file, "utf8")).comments || []; } catch {}
  const save = () => {
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ comments: items }, null, 2)); } catch {}
    broadcast("comments", items);
  };
  const str = (v, n) => String(v ?? "").slice(0, n);
  const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : 0);

  function add(b) {
    const text = str(b.text, 4000).trim();
    if (!text || !b.viewId) return { ok: false, error: "Write a comment first" };
    const c = {
      id: crypto.randomBytes(4).toString("hex"), at: Date.now(), status: "open",
      viewId: str(b.viewId, 400), viewName: str(b.viewName, 200), device: b.device === "mobile" ? "mobile" : "desktop",
      x: num(b.x), y: num(b.y), // % across the frame, px down the page
      section: b.section ? { index: Number(b.section.index) || 0, name: str(b.section.name, 200) } : null,
      text, selection: b.selection && typeof b.selection === "object" ? b.selection : null,
    };
    items.push(c);
    save();
    return { ok: true, comment: c };
  }
  function update(b) {
    const c = items.find((x) => x.id === b.id);
    if (!c) return { ok: false, error: "That comment is gone" };
    if (b.text != null) { const t = str(b.text, 4000).trim(); if (t) c.text = t; }
    if (["open", "resolved"].includes(b.status)) { c.status = b.status; c.resolvedAt = b.status === "resolved" ? Date.now() : null; }
    if (b.x != null) c.x = num(b.x);
    if (b.y != null) c.y = num(b.y);
    save();
    return { ok: true, comment: c };
  }
  function remove(id) {
    items = items.filter((x) => x.id !== id);
    save();
    return { ok: true };
  }
  /** Mark comments as sent with a prompt; resolve them when its reply arrives */
  function sent(ids, promptId) {
    for (const c of items) if (ids.includes(c.id)) Object.assign(c, { status: "sent", promptId, sentAt: Date.now() });
    save();
  }
  function promptDone(promptId, reply) {
    let n = 0;
    for (const c of items) if (c.promptId === promptId && c.status === "sent") { Object.assign(c, { status: "resolved", resolvedAt: Date.now(), reply: reply ? str(reply, 1200) : null }); n++; }
    if (n) save();
  }
  function promptFailed(promptId) {
    let n = 0;
    for (const c of items) if (c.promptId === promptId && c.status === "sent") { c.status = "open"; n++; }
    if (n) save();
  }

  /** The prompt for a set of comments on one page */
  function promptFor(list) {
    const v = list[0];
    const lines = list.map((c, i) => {
      const where = [`${Math.round(c.x)}% across`, `${Math.round(c.y)}px down the ${c.device} page`, c.section ? `in section ${c.section.index + 1}${c.section.name ? ` (“${c.section.name}”)` : ""}` : null].filter(Boolean).join(", ");
      return `${list.length > 1 ? `${i + 1}. ` : ""}${c.text}\n   (pinned ${where})`;
    });
    return {
      text: list.length === 1 ? v.text : `${list.length} comments on ${v.viewName || v.viewId}`,
      body: [
        `The user left ${list.length === 1 ? "a comment" : `${list.length} comments`} on the page “${v.viewName || v.viewId}” in Loupe. Each is pinned to a spot on the page; work out which element it means from that spot and the section, then make the change${list.length === 1 ? "" : "s"}.`,
        "",
        ...lines,
      ].join("\n"),
    };
  }

  return { list: () => items, add, update, remove, sent, promptDone, promptFailed, promptFor, get: (id) => items.find((x) => x.id === id) };
}
