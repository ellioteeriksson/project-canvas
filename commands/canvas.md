---
description: Open the Project Canvas for this project (sitemap or flow of every view, live)
argument-hint: "[project path] [--port 4777]"
allowed-tools: Bash, Read, Edit, Write
---

Open the Project Canvas for the project in `$ARGUMENTS` (default: the current working directory).

1. Work out the plugin root: use `${CLAUDE_PLUGIN_ROOT}` if it was expanded, otherwise read `~/.claude/project-canvas/plugin-root`.
2. If `<project>/.canvas/state.json` has a `pid` that is still running, the canvas is already open. Just tell the user the `url` from that file and stop.
3. Otherwise start the server **in the background** (it keeps running while you work):
   `node "<plugin root>/server/index.mjs" --project "<project>" --open`
   Wait a second, then read the URL from its output or from `.canvas/state.json` and give it to the user.
4. If this is the first time (there's no `.canvas/config.json`), follow the **First connection** checklist in the `project-canvas` skill. Then reply with a short summary: framework, website or product, number of views, and anything the user needs to fix, like a dev server that isn't running or dynamic routes that need sample URLs.
