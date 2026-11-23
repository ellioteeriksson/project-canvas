import { useEffect, useState } from "react";
import { BookOpen, Brain, CaretDown, ChatCircleText, Globe, HandPalm, ListChecks, MagnifyingGlass, PencilSimple, Robot, TerminalWindow, Wrench } from "@phosphor-icons/react";
import type { CanvasPrompt, PromptStep } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICON = { read: BookOpen, edit: PencilSimple, run: TerminalWindow, search: MagnifyingGlass, web: Globe, agent: Robot, todo: ListChecks, say: ChatCircleText, think: Brain, wait: HandPalm, tool: Wrench } as const;
const VERB: Record<PromptStep["kind"], string> = { read: "Reading", edit: "Editing", run: "Running", search: "Searching", web: "Looking up", agent: "Handing off", todo: "", say: "", think: "", wait: "", tool: "Using" };

/** "Reading about.html", "Running Build the site", or Claude's own words */
export const stepLabel = (s: PromptStep) => (VERB[s.kind] ? `${VERB[s.kind]} ${s.text}` : s.text);

/** Seconds since a moment, ticking once a second */
export function useElapsed(since?: number, on = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { if (!on) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [on]);
  if (!since) return "";
  const s = Math.max(0, Math.round((now - since) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** The step Claude is on now (its latest action, or what it last said when that's newer) */
export function currentStep(p: CanvasPrompt): PromptStep | null {
  const steps = p.steps ?? [];
  return steps[steps.length - 1] ?? null;
}

export function StepIcon({ kind, className }: { kind: PromptStep["kind"]; className?: string }) {
  const I = ICON[kind] ?? Wrench;
  return <I size={13} weight={kind === "wait" ? "fill" : "regular"} className={cn("shrink-0", kind === "wait" ? "text-[var(--agent)]" : "text-muted-foreground", className)} />;
}

/** What Claude is doing for a prompt, live: its words, its current action, its plan and the steps so far */
export function LiveSteps({ p, className, startOpen = false }: { p: CanvasPrompt; className?: string; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const steps = p.steps ?? [];
  const elapsed = useElapsed(p.deliveredAt ?? p.at);
  const said = [...steps].reverse().find((s) => s.kind === "say");
  const now = currentStep(p);
  const doing = now && now.kind !== "say" ? now : null;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 text-xs", className)} aria-live="polite">
      {said && <p className="line-clamp-2 text-[13px] text-foreground">{said.text}</p>}
      <div className="flex min-w-0 items-center gap-2">
        <span className="agent-dot size-1.5 shrink-0 rounded-full bg-[var(--agent)]" />
        <span className="min-w-0 truncate text-muted-foreground">{doing ? stepLabel(doing) : steps.length ? "Working" : "Starting"}</span>
        {p.plan && p.plan.total > 1 && <span className="shrink-0 text-muted-foreground">· step {Math.min(p.plan.done + 1, p.plan.total)} of {p.plan.total}</span>}
        <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{elapsed}</span>
      </div>
      {steps.length > 1 && (
        <>
          <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }} className="flex items-center gap-1 self-start rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <CaretDown size={11} className={cn("transition-transform", open && "rotate-180")} /> {open ? "Hide steps" : `${steps.length} steps so far`}
          </button>
          {open && (
            <ol className="flex max-h-48 flex-col gap-1 overflow-auto border-l pl-2.5">
              {steps.map((s, i) => (
                <li key={i} className={cn("flex min-w-0 items-start gap-1.5", i === steps.length - 1 ? "text-foreground" : "text-muted-foreground")}>
                  <StepIcon kind={s.kind} className="mt-px" />
                  <span className="min-w-0 break-words">{stepLabel(s)}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
