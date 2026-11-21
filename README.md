# Loupe

A Claude Code plugin that lays out every page or screen of your project on a live design canvas, next to your terminal.

- **Websites** appear as a **sitemap** (a tree by URL). **Products** appear as a **flow** (screens connected by the links and navigations found in the code).
- Every view is a **snapshot** of the real page, visible at any zoom, in **Screen** or **Full page** height, as the **Live** design or as a **Wireframe**. Click **Interact** (or double-click) to use the live page right on the canvas.
- **Sections tab:** every page broken into its designed sections (hero, features, footer …), paired with their components in code. Select a section to limit Claude to just that section.
- **Highlight elements:** pick specific buttons, text, images or blocks in a view (**Select elements** on hover), and your next prompt changes only those.
- **See Claude work:** while an agent reads or edits a view, its frame gets an orange ring and goes live, then the snapshot refreshes when it's done.
- **Light, dark or system** theme for the canvas.
- **Select a view, and your next prompt in Claude Code only affects that view.** Select nothing, and it affects the whole project.
- **Design concepts:** with "4 concepts" on, a design request opens a drawer where Claude sketches 4 concepts, previewed on the real page. Add a comment to the one you like and pick it, and Claude builds it in the code. Not quite right? Ask for 4 new ones with feedback.
- **Changelog:** every change Claude makes, from the canvas or the chat, is logged with the request, the scope, Claude's summary and the files it touched. Export it as Markdown from the Changelog tab.
- **Prompt from the canvas:** the prompt bar at the bottom sends a prompt straight to the Claude Code chat open in the project, with the current selection as its scope. Claude's answer and what it's doing show up in the canvas, so you don't have to switch windows.
- A **Design system** tab shows your tokens, primitives (`components/ui`) and components, and which views use each one. Selecting a component scopes your prompts to it.
- A **Ship** button at the top commits, pushes or opens a pull request.

Built with shadcn/ui (Radix), Phosphor icons, React Flow and Tailwind v4. The server has no dependencies, and the UI comes prebuilt in `app/dist`, so you don't need to install anything.

## Install

You need Claude Code and Node 20+. Run this in a terminal, or ask Claude to run it in a Code tab session in the desktop app:

```bash
claude plugin marketplace add ellioteeriksson/loupe && claude plugin install loupe@loupe
```

Start a new session, open a project and type `/loupe`. (Loupe used to be called Project Canvas: if you have that installed, remove it with `claude plugin uninstall project-canvas@project-canvas && claude plugin marketplace remove project-canvas`.) [INSTALL.md](INSTALL.md) has the details and troubleshooting.

**Updates:**

```bash
claude plugin marketplace update loupe && claude plugin update loupe@loupe
```

## Use it on an existing project

```text
cd your-project
npm run dev            # in another terminal; frames load from the dev server
claude
> /loupe
```

The first time, Claude reads what was detected, checks whether the project is a website or a product, names the views and labels the main flow. The canvas opens at `http://localhost:4777`.

| What you do | What happens |
| --- | --- |
| Click a frame or a row in the list | Your prompts are scoped to that view (highlighted in blue). Esc or click the background to clear it. |
| Then click a section inside it | Your prompts are scoped to just that section (hero, features, footer …). Hover shows the section names. Esc steps back to the page. |
| Double-click a frame, or hover and click **Interact** | Use the live page inside the canvas. Esc exits. |
| Hover a frame → **Select elements** | Pick buttons, text, images or blocks. Click selects, Shift-click adds, ↑ ↓ parent/child, Esc finishes. Prompts then only affect those elements. |
| Screen / Full page, Live / Wireframe | Change the frame height or layer (toolbar on the right edge of the canvas). |
| ☾ in the top bar | Light, dark, or match system. |
| Double-click a name | Rename the view. |
| ⤢ / Shift+1 (canvas toolbar) | Zoom out to show the whole project. |
| ⌖ / Shift+2 (canvas toolbar) | Zoom in on the view closest to the centre of the screen. |
| Sitemap / Flow, Desktop / Mobile | Switch the layout or the frame size (same toolbar). |
| Drag frames | Your layout is saved. Use Settings → Reset layout to undo it. |
| Prompt bar / ⌘K | Send a prompt to the Claude Code chat open in this project. It's scoped to what's selected. Click the speech bubble to see earlier prompts and Claude's answers. |
| Ship ▾ | Commit, commit & push, or commit + push + open a PR. If you're on `main`, it creates a branch first. **Write with Claude** drafts the commit message from the diff. |

### Commands

- `/loupe`: open the canvas, or reopen it if it's already running
- `/loupe-listen`: let this chat take prompts from the canvas prompt bar right away (see below)
- `/loupe-stop`: stop the server
- `/loupe-preview`: add a dev-only `/__canvas` route so the Design system tab shows live component previews

### How scoping works

| Hook | What it does |
| --- | --- |
| `UserPromptSubmit` | Adds a `<loupe-scope>` note to each prompt: the selected view, its route, files that belong only to it, files shared with other views, and its preview URL. |
| `PreToolUse` (Edit/Write) | Asks you before Claude edits a file outside the selection. Set `"scopeGuard": "off"` in `.canvas/config.json` to turn this off. |
| `SessionStart` | Tells Claude where the plugin lives and whether a canvas is open. |
| `Stop`, `UserPromptSubmit` | Hand over prompts sent from the canvas while Claude was busy or the chat was idle. |

When no canvas is running, the hooks do nothing.

### Prompting from the canvas

Every Claude Code chat with the plugin connects itself to the project's canvas, and shows up in the prompt bar's chat picker (labelled with the last thing you asked it). A prompt sent from the canvas reaches that chat by the first route that works:

| Chat state | How the prompt gets there |
| --- | --- |
| **Live** (started with channels, see below) | Straight into the chat, even when it's idle. Permission prompts also show up in the canvas, with Allow and Deny. |
| **Listening** (starts with `/loupe`, or `/loupe-listen`) | Claude waits for canvas prompts and picks them up right away. Works in the desktop app. Interrupt Claude to type in the chat; it goes back to listening when it's done. Say "stop listening", or use the chat menu in the prompt bar, to end it. |
| **Working** | Claude takes it as soon as it finishes what it's doing. |
| **Idle** | It rides along with the next message you type in the chat. |

Claude answers in the canvas with a short summary of what it changed, and the prompt shows what Claude is doing while it works.

**Live mode** uses Claude Code [channels](https://code.claude.com/docs/en/channels), a research preview that needs Claude Code 2.1.80+ and a claude.ai or Console login (Team and Enterprise admins must turn channels on). Custom channels aren't on Anthropic's allowlist yet, so start the terminal session with the development flag:

```bash
claude --dangerously-load-development-channels plugin:loupe@loupe
```

Claude Code asks you to confirm once at startup. In the desktop app, use `/loupe-listen` instead.

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
