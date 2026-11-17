---
description: Open the Project Canvas for this project (sitemap or flow of every view, live)
argument-hint: "[project path] [--port 4777]"
allowed-tools: Bash, Read, Edit, Write
---

Open the Project Canvas for the project in `$ARGUMENTS` (default: the current working directory).

1. Work out the plugin root: use `${CLAUDE_PLUGIN_ROOT}` if it was expanded, otherwise read `~/.claude/project-canvas/plugin-root`.
2. If `<project>/.canvas/state.json` has a `url`, check it with `curl -s <url>/api/state`. If that answers with this project's `root`, the canvas is already open: give the user the URL and stop. (Don't trust the `pid` alone.)
3. Otherwise start the server **in the background** (it keeps running while you work):
   `node "<plugin root>/server/index.mjs" --project "<project>" --open`
   Wait a second, then read the URL from its output or from `.canvas/state.json` and give it to the user.
   In the Claude desktop app's Code tab, leave out `--open` and open the URL in the **Browser pane** instead, so the canvas sits next to the chat.
4. **Dev server:** frames load from the project's dev server through a local proxy (so security headers like `X-Frame-Options` don't block them). Make sure the dev server is running, and that `devUrl` in `.canvas/config.json` matches the URL the dev server actually printed (e.g. Next.js moves to :3001 when :3000 is busy). Fix `devUrl` if it doesn't match.
5. If this is the first time (there's no `.canvas/config.json`), follow the **First connection** checklist in the `project-canvas` skill. Then reply with a short summary: framework, website or product, number of views, and anything the user needs to fix, like a dev server that isn't running or dynamic routes that need sample URLs.
