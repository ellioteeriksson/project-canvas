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
} else if (sel?.kind === "elements") {
  const lines = sel.elements.map((e, i) => {
    const bits = [
      `${i + 1}. ${e.kind} <${e.tag}>`,
      e.text ? `"${e.text}"` : null,
      `selector \`${e.selector}\``,
      e.section ? `in section "${e.section}"` : null,
      e.component ? `rendered by <${e.component} />${e.componentFile ? ` (${e.componentFile})` : ""}` : null,
      e.href ? `href ${e.href}` : null,
    ].filter(Boolean);
    return `   ${bits.join(", ")}`;
  });
  ctx = [
    `<project-canvas-scope>`,
    `The user has highlighted ${sel.elements.length === 1 ? "one element" : `${sel.elements.length} elements`} on the page "${sel.viewName}" (route ${sel.route}${sel.file ? `, page file ${sel.file}` : ""}):`,
    ...lines,
    `Treat this prompt as applying ONLY to ${sel.elements.length === 1 ? "this element" : "these elements"}. Find ${sel.elements.length === 1 ? "it" : "them"} in the code by the text, component and selector above. Leave everything else on the page as it is.`,
    `If an element comes from a component used elsewhere too, say so before changing the shared component, or make the change specific to this place.`,
    sel.url && m?.devUrl ? `Live preview: ${m.devUrl.replace(/\/$/, "")}${sel.url}` : "",
    `</project-canvas-scope>`,
  ].filter(Boolean).join("\n");
} else if (sel?.kind === "section") {
  const where = [
    sel.component ? `component <${sel.component} />${sel.componentFile ? ` in ${sel.componentFile}` : ""}` : null,
    sel.heading ? `heading "${sel.heading}"` : null,
    sel.domId ? `element #${sel.domId}` : `a <${sel.tag}> element`,
  ].filter(Boolean).join(", ");
  ctx = [
    `<project-canvas-scope>`,
    `The user has selected the section "${sel.name}" on the page "${sel.viewName}" (route ${sel.route}${sel.file ? `, page file ${sel.file}` : ""}).`,
    `It is section ${sel.position.index + 1} of ${sel.position.of} from the top of the page. Identify it by: ${where}.`,
    `Treat this prompt as applying ONLY to this section. Do not change other sections or other pages.`,
    sel.componentFile ? `If ${sel.componentFile} is used on other pages too, say so before changing it, or make the change specific to this page.` : "",
    sel.url && m?.devUrl ? `Live preview: ${m.devUrl.replace(/\/$/, "")}${sel.url}` : "",
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
