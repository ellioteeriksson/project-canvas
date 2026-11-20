---
description: Let this chat take prompts from the Project Canvas prompt bar (listen mode)
allowed-tools: mcp__plugin_project-canvas_canvas__canvas_wait, mcp__plugin_project-canvas_canvas__canvas_reply
---

Listen for prompts the user sends from the Project Canvas prompt bar, and do them here.

1. Call `canvas_wait`. It blocks until the user sends a prompt from the canvas.
2. When a prompt arrives, treat it exactly like a message the user typed in this chat, including the `<project-canvas-scope>` block (it says which page, section or elements the prompt is about).
3. When the work is done, call `canvas_reply` with the prompt's `prompt_id` and a 1–3 sentence summary of what you changed, in the language of the prompt.
4. Call `canvas_wait` again. Keep going until the user interrupts you or asks you to stop.

If `canvas_wait` says the canvas isn't running, tell the user to start it with `/canvas` and stop. Keep your messages in this chat short while listening: the user is reading the canvas.
