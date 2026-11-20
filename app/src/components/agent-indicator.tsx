import { Sparkle } from "@phosphor-icons/react";
import type { Agent, Manifest } from "@/lib/types";

const PHASE = { thinking: "Thinking", reading: "Reading", editing: "Editing", running: "Running" } as const;

/** Top-bar status while Claude (or a subagent) is working. Click to jump to the view it's on. */
export function AgentIndicator({ agents, manifest, onFocus }: { agents: Agent[]; manifest: Manifest; onFocus: (viewId: string) => void }) {
  if (!agents.length) return null;
  const a = [...agents].sort((x, y) => y.last - x.last)[0];
  const view = a.views.map((id) => manifest.views.find((v) => v.id === id)).find(Boolean);
  const what = a.phase === "running" ? a.command : a.file?.split("/").pop() ?? (a.global ? "the whole project" : view?.name);
  return (
    <button
      type="button"
      onClick={() => view && onFocus(view.id)}
      disabled={!view}
      className="inline-flex h-7 max-w-[320px] items-center gap-1.5 rounded-md border border-[var(--agent)]/40 bg-[color-mix(in_oklab,var(--agent)_12%,transparent)] px-2 text-xs font-medium outline-none hover:bg-[color-mix(in_oklab,var(--agent)_20%,transparent)] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      aria-live="polite"
      title={view ? `Show ${view.name}` : undefined}
    >
      <Sparkle size={13} weight="fill" className="agent-dot shrink-0 text-[var(--agent)]" />
      <span className="truncate">
        {agents.length > 1 ? `${agents.length} agents · ` : ""}
        {PHASE[a.phase]} {what ?? "…"}
      </span>
    </button>
  );
}
