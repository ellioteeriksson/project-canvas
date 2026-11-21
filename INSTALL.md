# Install Loupe

Takes about two minutes. You need:

- **Claude Code**: the Code tab in the Claude desktop app, or `claude` in a terminal
- **Node.js 20 or newer**: check with `node -v`
- Optional: the **GitHub CLI**, signed in with `gh auth login`, if you want the Ship button to open pull requests

## 1. Install it from GitHub

Run this in a terminal. In the desktop app, you can instead paste it into a Code tab session and ask Claude to run it:

```bash
claude plugin marketplace add ellioteeriksson/loupe && claude plugin install loupe@loupe
```

Then start a new Claude Code session.

**Had it installed under its old name, Project Canvas?** Remove the old plugin first, so you don't run both:

```bash
claude plugin uninstall project-canvas@project-canvas && claude plugin marketplace remove project-canvas
```


**Installing from a zip?** Unzip it to a permanent folder (for example `~/claude-plugins/loupe`) and run `claude plugin marketplace add ~/claude-plugins/loupe && claude plugin install loupe@loupe`.

## 2. Use it on a project

1. Open your project in Claude Code and start its dev server (`npm run dev`, or ask Claude to). Plain HTML sites don't need one.
2. Type **`/loupe`**. If it isn't in the `/` menu, type `/loupe:loupe`.
3. The canvas opens at `http://localhost:4777`. In the desktop app it opens in the Browser pane.

The first time, Claude checks whether the project is a website (sitemap) or a product (flow), names the views and asks about anything it can't detect. The README explains the canvas itself: selecting views, full-page frames, the Design system tab and the Ship button.

## Updating to a new version

```bash
claude plugin marketplace update loupe && claude plugin update loupe@loupe
```

Start a new session and run `/loupe` in your project. A canvas that's still running an older version is replaced automatically.

## If something looks wrong

| What you see | What to do |
| --- | --- |
| Gray frames with a sad-page icon | Run `/loupe` again. An old canvas server is probably still running, and the new one replaces it. |
| "Dev server offline" or a red "Dev server didn't answer" bar | Start the dev server. If it runs on a different port, update the dev server URL in the canvas settings (gear icon). |
| A frame is out of date after a CMS or database change | Settings (gear) → **Refresh snapshots**. Code changes refresh on their own. |
| Every frame shows the sign-in page | Sign in to the app at its localhost address in the same browser first. Frames use that sign-in. |
| Red "404" bar on a frame | The route needs a real example URL (dynamic routes ask for one), or it should be hidden. Ask Claude to fix it in `.canvas/config.json`. |
| Selecting a view doesn't limit what Claude edits | Ask Claude "what view am I scoped to?". If it doesn't know, plugin hooks aren't running in your Claude Code setup; try Claude Code in a terminal. |

To stop a canvas, run `/loupe-stop`.
