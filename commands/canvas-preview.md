---
description: Add a dev-only route that renders each component, so the canvas Design system tab shows live previews
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
---

Create a **development-only** component preview route for this project, then register it with the canvas.

1. Read `.canvas/manifest.json` → `project.framework` and `designSystem.components` (each has `name`, `file`, `exports`, `variants`).
2. Create one route at `/__canvas` that reads `?component=<Name>` and renders only that component, centred on a plain background, with every `variants` combination laid out in a grid (cap at 12). Use the project's own global CSS/layout so tokens apply. Give required props sensible placeholder values.
   - **Next.js App Router:** `app/__canvas/page.tsx` (client component reading `useSearchParams`). Call `notFound()` when `process.env.NODE_ENV === "production"`.
   - **Next.js Pages Router:** `pages/__canvas.tsx`, returning `{ notFound: true }` from `getServerSideProps` in production.
   - **Astro:** `src/pages/__canvas.astro`, using `client:load` only where a component needs it. Redirect to 404 when `import.meta.env.PROD`.
   - **React Router / TanStack / Vite:** add a route guarded by `import.meta.env.DEV`.
   - **Plain HTML:** `__canvas.html` that loads the component markup snippets.
3. Use a registry object `{ [Name]: () => <Element/> }` so each new component is a one-line addition.
4. Save `"previewRoute": "/__canvas"` in `.canvas/config.json` (merge with what's already there, don't overwrite it).
5. Tell the user it's ready and that every card in the Design system tab now shows a live preview.

$ARGUMENTS
