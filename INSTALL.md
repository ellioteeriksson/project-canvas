# Install Project Canvas

Takes about two minutes. You need:

- **Claude Code**: the Code tab in the Claude desktop app, or `claude` in a terminal
- **Node.js 20 or newer**: check with `node -v`
- Optional: the **GitHub CLI**, signed in with `gh auth login`, if you want the Ship button to open pull requests

## 1. Put the folder somewhere permanent

Unzip, then move the `project-canvas` folder to a place you won't clean out, for example:

```
~/claude-plugins/project-canvas
```

Claude Code reads the plugin from this folder whenever it updates, so don't leave it in Downloads.

## 2. Install it in Claude Code

Run this in a terminal. In the desktop app, you can instead paste it into a Code tab session and ask Claude to run it:

```bash
claude plugin marketplace add ~/claude-plugins/project-canvas && claude plugin install project-canvas@project-canvas
```

If you put the folder somewhere else, change the path to match. Then start a new Claude Code session.

## 3. Use it on a project

1. Open your project in Claude Code and start its dev server (`npm run dev`, or ask Claude to). Plain HTML sites don't need one.
2. Type **`/canvas`**. If it isn't in the `/` menu, type `/project-canvas:canvas`.
3. The canvas opens at `http://localhost:4777`. In the desktop app it opens in the Browser pane.

The first time, Claude checks whether the project is a website (sitemap) or a product (flow), names the views and asks about anything it can't detect. The README explains the canvas itself: selecting views, full-page frames, the Design system tab and the Ship button.

## Updating to a new version

Replace the folder with the new one, then run:

```bash
claude plugin marketplace update project-canvas && claude plugin update project-canvas@project-canvas
```

Start a new session and run `/canvas` in your project. A canvas that's still running an older version is replaced automatically.

## If something looks wrong

| What you see | What to do |
| --- | --- |
| Gray frames with a sad-page icon | Run `/canvas` again. An old canvas server is probably still running, and the new one replaces it. |
| "Dev server offline" or a red "Dev server didn't answer" bar | Start the dev server. If it runs on a different port, update the dev server URL in the canvas settings (gear icon). |
| Every frame shows the sign-in page | Sign in to the app at its localhost address in the same browser first. Frames use that sign-in. |
| Red "404" bar on a frame | The route needs a real example URL (dynamic routes ask for one), or it should be hidden. Ask Claude to fix it in `.canvas/config.json`. |
| Selecting a view doesn't limit what Claude edits | Ask Claude "what view am I scoped to?". If it doesn't know, plugin hooks aren't running in your Claude Code setup; try Claude Code in a terminal. |

To stop a canvas, run `/canvas-stop`.
