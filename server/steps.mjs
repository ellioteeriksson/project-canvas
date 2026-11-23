// Turns what Claude Code is doing into short, human steps for the canvas.
import path from "node:path";

const short = (s, n = 140) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const base = (root, f) => { if (!f) return ""; const r = root ? path.relative(root, path.resolve(root, String(f))) || "." : String(f); return r.startsWith("..") ? path.basename(String(f)) : r.split(path.sep).join("/"); };

/** One tool call → { kind, text } (or null for tools that aren't worth showing) */
export function stepForTool(name, input = {}, root) {
  const f = input.file_path || input.notebook_path;
  switch (name) {
    case "Read": return { kind: "read", text: base(root, f) };
    case "Edit": case "MultiEdit": case "NotebookEdit": return { kind: "edit", text: base(root, f) };
    case "Write": return { kind: "edit", text: base(root, f) };
    case "Grep": { const where = input.path ? base(root, input.path) : ""; return { kind: "search", text: `for “${short(input.pattern, 60)}”` + (where && where !== "." ? ` in ${where}` : "") }; }
    case "Glob": return { kind: "search", text: short(input.pattern, 80) };
    case "Bash": return { kind: "run", text: short(input.description || input.command, 100) };
    case "WebFetch": return { kind: "web", text: short(input.url, 100) };
    case "WebSearch": return { kind: "web", text: short(input.query, 100) };
    case "Task": case "Agent": return { kind: "agent", text: short(input.description || input.prompt, 100) };
    case "TodoWrite": {
      const todos = Array.isArray(input.todos) ? input.todos : [];
      const cur = todos.find((t) => t.status === "in_progress");
      if (!cur) return null;
      const done = todos.filter((t) => t.status === "completed").length;
      return { kind: "todo", text: short(cur.activeForm || cur.content, 120), plan: { done, total: todos.length } };
    }
    default:
      if (/^mcp__loupe__/.test(name)) return null;
      return { kind: "tool", text: short(name.replace(/^mcp__/, "").replace(/__/g, " › "), 80) };
  }
}

/** Claude's own words → its first sentence or line */
export function stepForText(text) {
  const t = String(text || "").trim();
  if (!t) return null;
  const first = t.split(/\n+/)[0].replace(/^[#>*\-\s]+/, "");
  const sentence = /^(.{20,}?[.!?:])(\s|$)/.exec(first)?.[1] || first;
  return { kind: "say", text: short(sentence, 160) };
}
