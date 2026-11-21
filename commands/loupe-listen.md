---
description: Let this chat take prompts from Loupe prompt bar (listen mode)
allowed-tools: mcp__plugin_loupe_canvas__canvas_wait, mcp__plugin_loupe_canvas__canvas_reply, mcp__plugin_loupe_canvas__canvas_concepts, mcp__plugin_loupe_canvas__canvas_findings, mcp__plugin_loupe_canvas__canvas_stop_listening
---

Listen for prompts the user sends from Loupe prompt bar, and do them here.

1. Call `canvas_wait`. It blocks until the user sends a prompt from the canvas.
2. When a prompt arrives, treat it exactly like a message the user typed in this chat, including the `<loupe-scope>` block (it says which page, section or elements the prompt is about).
3. If the prompt asks for design concepts, call `canvas_concepts` instead of editing files (the prompt explains how). Otherwise, when the work is done, call `canvas_reply` with the prompt's `prompt_id` and a 1–3 sentence summary of what you changed, in the language of the prompt.
4. Call `canvas_wait` again. Keep going until the user asks you to stop: then call `canvas_stop_listening`. (If the user interrupts to ask something else, answer it; you'll be reminded to go back to listening afterwards.)

If `canvas_wait` says the canvas isn't running, tell the user to start it with `/loupe` and stop. Keep your messages in this chat short while listening: the user is reading the canvas.
