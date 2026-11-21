---
description: Show every project you've opened Loupe in, and open any of their canvases
allowed-tools: Bash
---

Open Loupe home: a page listing every project the user has opened Loupe in, with a button to open each one's canvas.

1. Work out the plugin root: use `${CLAUDE_PLUGIN_ROOT}` if it was expanded, otherwise read `~/.claude/loupe/plugin-root`.
2. Start it **in the background**: `node "<plugin root>/server/hub.mjs" --open`. In the Claude desktop app's Code tab, leave out `--open` and open the URL in the **Browser pane** instead.
3. Read the URL from its output (`home → http://…`) and give it to the user in one line.
