---
name: project-canvas
description: Use when the user mentions the project canvas, a selected view or frame, the sitemap/flow canvas, `.canvas/` files, or asks to open, name, connect, organise or label the views of a web project on a canvas. Also use when a <project-canvas-scope> block appears in context, since it tells you which view the user's prompt is limited to.
---

# Project Canvas

Project Canvas is a local web app (started with `/canvas`). It shows every view of a project as a **live frame** (an iframe of the dev server) on a zoomable canvas:

- **Websites** are laid out as a **sitemap**: a tree by URL path, with folder nodes for missing parents.
- **Products** are laid out as a **flow**: a left-to-right graph built from the links and navigations between screens.

The user selects a view (or a component in the Design system tab) to **scope their prompts**. A `UserPromptSubmit` hook adds a `<project-canvas-scope>` block to every prompt. A `PreToolUse` hook asks before you edit files outside the selection.

## Respecting scope (most important)

When a `<project-canvas-scope>` block names a view or component:
- Make the change **only** in that view. "Make the hero bigger" means the selected view's hero, not every hero.
- Prefer the files listed as belonging only to the view. Put new view-specific components next to the page file.
- Only touch shared files (layouts, shared components, global CSS) when the request truly needs it, and say which other views will change.
- If the prompt is clearly project-wide ("rename the brand everywhere"), say that a view is selected and ask, or suggest clearing the selection.
- When nothing is selected, the prompt is project-wide.

## Files in `<project>/.canvas/`

| File | Who writes it | Commit? |
| --- | --- | --- |
| `config.json` | canvas UI + you | **Yes** (names, mode, layout, params) |
| `manifest.json` | server (rescans when files change) | No |
| `state.json` | server (pid, url, current selection) | No |

The server watches the project and rescans on every save. **Edit `config.json` and the canvas updates live.** Never hand-edit `manifest.json`.

### `config.json` keys (all optional)

```jsonc
{
  "name": "Acme website",                    // project title in the top bar
  "mode": "sitemap",                         // "sitemap" (website) | "flow" (product) | "auto"
  "framework": "auto",                       // next | react-router | tanstack | astro | html | auto
  "devUrl": "http://localhost:3000",         // where frames load from
  "viewport": "desktop",                     // desktop | mobile frames
  "names": { "/": "Home", "/pricing": "Pricing" },        // display names by route
  "params": { "/blog/[slug]": "/blog/hello-world" },     // sample URLs for dynamic routes
  "views": [{ "route": "/checkout/success", "file": "src/Success.tsx", "name": "Order confirmed" }], // add views the scanner can't see
  "hidden": ["/api-docs"],                   // routes to leave off the canvas
  "edges": [{ "from": "/signup", "to": "/onboarding", "label": "Create account" }], // labelled flow connectors
  "hiddenEdges": ["/settings->/"],           // remove noisy detected links (id = "from->to")
  "previewRoute": "/__canvas",               // set by /canvas-preview
  "scopeGuard": "ask",                       // "ask" (default) | "off": confirm edits outside the selection
  "positions": {}                            // saved when the user drags frames; don't edit by hand
}
```

Always **merge** into `config.json`. Read it, change the keys you need, and write it back. Never overwrite what the user set.

## First connection checklist (run after `/canvas` on a new project)

1. Read `.canvas/manifest.json`. Check `project.framework`, `mode`, `views[]` and `devUrl`.
2. **Website or product?** `mode` is auto-detected: auth, dashboards and settings routes suggest a product, while about, pricing and blog suggest a website. If it isn't obvious, ask the user in one question, then set `"mode"` in `config.json`.
3. **Names:** views are named from page titles or route segments. Give unclear ones human names in `names` (e.g. `/` becomes "Home", `/app/projects/[id]` becomes "Project detail").
4. **Flow labels (products only):** detected links have no labels. For the main journey (sign up, onboarding, core task), add `edges` with short action labels ("Sign in", "Create project"). Hide noisy edges such as logo links back to home with `hiddenEdges`.
5. **Dynamic routes:** for each view with `url: null`, find a real example (seed data, fixtures, a CMS) and add it to `params`.
6. **Dev server:** frames need it running. If `devUrl` doesn't answer, tell the user the exact command (`npm run dev`). Don't start long-running servers without asking. Plain HTML projects are served by the canvas itself.
7. Suggest committing `.canvas/config.json` (the server already gitignores `state.json` and `manifest.json`).

## Detection details (for debugging an empty or wrong canvas)

- **Next.js:** `app/**/page.*` (route groups `(x)` stripped; `@slots`, `_private` and intercepting routes skipped) and `pages/**` (no `_app`, `_document` or `api/`).
- **Astro:** `src/pages/**` (`.astro`, `.md`, `.mdx`, `.html`; endpoints skipped).
- **React Router:** `app/routes.ts` (v7 config), `app/routes/*` (flat routes), or `<Route>` / `createBrowserRouter` objects in `src/` (nested paths and `lazy` imports resolved).
- **TanStack Router:** `createFileRoute('/path')` in `src/routes`.
- **Plain HTML:** every `*.html`, served on its own port.
- **View ownership:** each view's import graph is followed. Files imported by only that view are "its files", and files imported by several views are "shared".
- **Design system:** CSS custom properties in `:root`, `.dark`, `[data-theme]` and `@theme` blocks; fonts from `next/font`, `@fontsource` and Google Fonts links; **primitives** = `components/ui/*` (shadcn), **components** = other `components/**`. For tokens to show up, they need to be CSS variables.

If the scanner misses something, add it through `config.json` (`views`, `framework`) rather than restructuring the user's code.

## The Ship button

The top-right **Ship** button runs, on the user's machine: `git add -A`, then `git commit`, `git push -u origin HEAD` and `gh pr create`. If they're on the default branch when they open a PR, it first creates a `canvas/<slug>-<timestamp>` branch. **Write with Claude** in the dialog runs `claude -p` on the diff to draft the commit message. You don't need to do anything for this. If the user asks you to commit or open a PR from the terminal, do it normally.
