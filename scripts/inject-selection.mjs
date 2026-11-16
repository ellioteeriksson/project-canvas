#!/usr/bin/env node
// UserPromptSubmit: scope every prompt to whatever is selected on the canvas.
import { readStdin, activeCanvas, out } from "./lib.mjs";

const input = await readStdin();
const c = activeCanvas(input.cwd);
if (!c) process.exit(0);

const sel = c.state.selection;
const m = c.manifest;
let ctx;

if (sel?.kind === "view") {
  const shared = (sel.sharedFiles || []).filter((f) => f !== sel.file);
  ctx = [
    `<project-canvas-scope>`,
    `The user has selected the view "${sel.name}" on the Project Canvas (route ${sel.route}${sel.file ? `, page file ${sel.file}` : ""}).`,
    `Treat this prompt as applying ONLY to this view. Do not change other views.`,
    sel.files?.length ? `Files that belong only to this view (safe to edit): ${sel.files.join(", ")}` : "",
    `New files for this view go next to ${sel.file || "its page file"}.`,
    shared.length ? `Shared files (used by other views too, so edit only if the request truly needs it, and tell the user which other views are affected): ${shared.join(", ")}` : "",
    sel.url && m?.devUrl ? `Live preview: ${m.devUrl.replace(/\/$/, "")}${sel.url}` : "",
    `If the request is obviously meant for the whole project, ask the user before acting outside this view.`,
    `</project-canvas-scope>`,
  ].filter(Boolean).join("\n");
} else if (sel?.kind === "component") {
  ctx = [
    `<project-canvas-scope>`,
    `The user has selected the component "${sel.name}" (${sel.file}) in the Project Canvas design system tab.`,
    `Treat this prompt as applying ONLY to this component. Keep its public API (props, exports) backwards compatible unless asked.`,
    sel.usedBy?.length ? `It is used by these views: ${sel.usedBy.join(", ")}. Mention visible side effects on them.` : "",
    `</project-canvas-scope>`,
  ].filter(Boolean).join("\n");
} else {
  const views = (m?.views || []).slice(0, 40).map((v) => `${v.name} (${v.route})`).join(", ");
  ctx = [
    `<project-canvas-scope>`,
    `No view is selected on the Project Canvas, so this prompt applies to the whole project (${m?.mode === "flow" ? "product" : "website"}, ${m?.views?.length ?? 0} views).`,
    views ? `Views: ${views}${(m?.views?.length || 0) > 40 ? ", …" : ""}` : "",
    `</project-canvas-scope>`,
  ].filter(Boolean).join("\n");
}

out({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: ctx } });
