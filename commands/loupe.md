---
description: Open Loupe for this project (sitemap or flow of every view, live)
argument-hint: "[project path] [--port 4777]"
allowed-tools: Bash, Read, Edit, Write, mcp__plugin_loupe_canvas__canvas_wait, mcp__plugin_loupe_canvas__canvas_reply, mcp__plugin_loupe_canvas__canvas_concepts, mcp__plugin_loupe_canvas__canvas_findings
---

Open Loupe for the project in `$ARGUMENTS` (default: the current working directory).

1. Work out the plugin root: use `${CLAUDE_PLUGIN_ROOT}` if it was expanded, otherwise read `~/.claude/loupe/plugin-root`.
2. Start the server **in the background**, even if a canvas seems to be open already. The server decides: it reuses a running canvas of the same version and replaces an older one.
   `node "<plugin root>/server/index.mjs" --project "<project>" --open`
   In the Claude desktop app's Code tab, leave out `--open` and open the URL in the **Browser pane** instead, so the canvas sits next to the chat.
3. Wait a second and read the URL from its output (`open http://…` or `already running … → http://…`), or from `.canvas/state.json`, and give it to the user.
4. **Dev server:** frames load from the project's dev server through a local proxy (so security headers like `X-Frame-Options` don't block them). Make sure the dev server is running, and that `devUrl` in `.canvas/config.json` matches the URL the dev server actually printed (e.g. Next.js moves to :3001 when :3000 is busy). Fix `devUrl` if it doesn't match.
5. If this is the first time (there's no `.canvas/config.json`), follow the **First connection** checklist in the `loupe` skill. Then reply with a short summary: framework, website or product, number of views, and anything the user needs to fix, like a dev server that isn't running or dynamic routes that need sample URLs.
6. Tell the user, in one line, that this chat now listens to the canvas prompt bar (they can interrupt to type here, and say "stop listening" to end it).
7. **Start listening** (skip this if the user ran `/loupe` with "no-listen" in the arguments): call `canvas_wait`. When a canvas prompt arrives, do it like a message the user typed here, answer with `canvas_reply` (or `canvas_concepts` when the prompt asks for design concepts), then call `canvas_wait` again. Keep your messages in this chat short while listening.
