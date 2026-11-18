# Project Canvas

A Claude Code plugin that lays out every page or screen of your project on a live design canvas, next to your terminal.

- **Websites** appear as a **sitemap** (a tree by URL). **Products** appear as a **flow** (screens connected by the links and navigations found in the code).
- Every frame is a **live iframe** of your dev server, so it updates as Claude edits.
- **Select a view, and your next prompt in Claude Code only affects that view.** Select nothing, and it affects the whole project.
- A **Design system** tab shows your tokens, primitives (`components/ui`) and components, and which views use each one. Selecting a component scopes your prompts to it.
- A **Ship** button at the top commits, pushes or opens a pull request.

Built with shadcn/ui (Radix), Phosphor icons, React Flow and Tailwind v4. The server has no dependencies, and the UI comes prebuilt in `app/dist`, so you don't need to install anything.

## Install

See **[INSTALL.md](INSTALL.md)**. In short: put the folder somewhere permanent, then run

```bash
claude plugin marketplace add ~/claude-plugins/project-canvas && claude plugin install project-canvas@project-canvas
```

## Use it on an existing project

```text
cd your-project
npm run dev            # in another terminal; frames load from the dev server
claude
> /canvas
```

The first time, Claude reads what was detected, checks whether the project is a website or a product, names the views and labels the main flow. The canvas opens at `http://localhost:4777`.

| What you do | What happens |
| --- | --- |
| Click a frame or a row in the list | Your prompts are scoped to that view (highlighted in yellow). Esc or click the background to clear it. |
| Double-click a frame | Use the live page inside the canvas. Esc exits. |
| Double-click a name | Rename the view. |
| ⤢ / Shift+1 | Zoom out to show the whole project. |
| ⌖ / Shift+2 | Zoom in on the view closest to the centre of the screen. |
| Sitemap / Flow, Desktop / Mobile | Switch the layout or the frame size (bottom-left). |
| Drag frames | Your layout is saved. Use Settings → Reset layout to undo it. |
| Ship ▾ | Commit, commit & push, or commit + push + open a PR. If you're on `main`, it creates a branch first. **Write with Claude** drafts the commit message from the diff. |

### Commands

- `/canvas`: open the canvas, or reopen it if it's already running
- `/canvas-stop`: stop the server
- `/canvas-preview`: add a dev-only `/__canvas` route so the Design system tab shows live component previews

### How scoping works

| Hook | What it does |
| --- | --- |
| `UserPromptSubmit` | Adds a `<project-canvas-scope>` note to each prompt: the selected view, its route, files that belong only to it, files shared with other views, and its preview URL. |
| `PreToolUse` (Edit/Write) | Asks you before Claude edits a file outside the selection. Set `"scopeGuard": "off"` in `.canvas/config.json` to turn this off. |
| `SessionStart` | Tells Claude where the plugin lives and whether a canvas is open. |

When no canvas is running, the hooks do nothing.

## Supported projects

| Framework | Detected from |
| --- | --- |
| Next.js | `app/**/page.*` (App Router) and `pages/**` |
| Vite + React Router | `createBrowserRouter`, `<Route>`, `app/routes.ts` (v7) and flat `app/routes/*` |
| TanStack Router | `createFileRoute()` |
| Astro | `src/pages/**` |
| Plain HTML | every `*.html`, served by the canvas itself |

If something is missed, add it in `.canvas/config.json` (`views`, `framework`, `devUrl`, `params` for dynamic routes). The skill documents every key. Commit `config.json`. `state.json` and `manifest.json` are gitignored automatically.

## Developing the UI

```bash
cd app && npm install
node ../server/index.mjs --project /path/to/project   # API on :4777
npm run dev                                            # UI with hot reload, proxies /api
npm run build                                          # writes app/dist (commit it)
```
