import { useState } from "react";
import { DotsSixVertical, DotsThree, Stop, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { CanvasPrompt, ChatState, ManagedSession } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LiveSteps, useElapsed } from "@/components/live-steps";
import { StatusDot, chatName } from "@/components/prompt-bar";

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

/** Every job: what each Claude is doing, what's next in line (drag to reorder), and what just finished. */
export function JobsTab({ chat, managed }: { chat: ChatState; managed: ManagedSession[] }) {
  const byId = new Map(chat.prompts.map((p) => [p.id, p]));
  const inSessions = new Set(managed.flatMap((s) => [s.currentPrompt, ...(s.queued ?? []).map((q) => q.promptId)]).filter(Boolean) as string[]);
  const terminal = chat.prompts.filter((p) => ["sending", "delivered"].includes(p.status) && !inSessions.has(p.id) && !chat.conns.find((c) => c.id === p.conn)?.managed);
  const waiting = chat.prompts.filter((p) => p.status === "queued" && p.mode !== "audit");
  const done = chat.prompts.filter((p) => ["done", "failed"].includes(p.status) && p.mode !== "audit").slice(-6).reverse();
  const nothing = !managed.length && !terminal.length && !waiting.length && !done.length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      {nothing && <p className="px-1 py-6 text-center text-[13px] text-muted-foreground">No jobs yet. Prompt from the canvas or a page, and they show up here.</p>}
      <div className="flex flex-col gap-3">
        {managed.map((s) => <SessionJobs key={s.id} s={s} byId={byId} others={managed.filter((x) => x.id !== s.id)} />)}
        {terminal.length > 0 && (
          <Group title="In your terminal">
            {terminal.map((p) => <JobRow key={p.id} p={p} />)}
          </Group>
        )}
        {waiting.length > 0 && (
          <Group title="Waiting for a chat">
            {waiting.map((p) => <JobRow key={p.id} p={p} onCancel={() => api.cancelPrompt(p.id)} />)}
          </Group>
        )}
        {done.length > 0 && (
          <Group title="Just finished">
            {done.map((p) => (
              <div key={p.id} className="flex min-w-0 items-start gap-2 px-1 py-1 text-xs">
                <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", p.status === "done" ? "bg-[var(--live)]" : "bg-destructive")} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{p.text}</p>
                  {p.reply && <p className="line-clamp-2 text-muted-foreground">{p.reply}</p>}
                </div>
              </div>
            ))}
          </Group>
        )}
      </div>
    </div>
  );
}

function Group({ title, right, children }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[12px] ring-1 ring-border">
      <header className="flex items-center gap-2 border-b px-3 py-2 text-[13px] font-medium">{title}<span className="flex-1" />{right}</header>
      <div className="flex flex-col gap-1 p-2">{children}</div>
    </section>
  );
}

function JobRow({ p, onCancel }: { p: CanvasPrompt; onCancel?: () => void }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-md px-1 py-1 text-xs">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{p.text}</p>
        {p.status === "delivered" && p.steps?.length ? <LiveSteps p={p} className="mt-1" /> : <p className="text-muted-foreground">{p.status === "queued" ? "Waiting for a chat to take it" : p.status === "sending" ? "Next up" : "Working"}{p.scope ? ` · ${p.scope}` : ""}</p>}
      </div>
      {onCancel && <button type="button" onClick={onCancel} aria-label="Cancel this job" title="Cancel" className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"><X size={12} /></button>}
    </div>
  );
}

function SessionJobs({ s, byId, others }: { s: ManagedSession; byId: Map<string, CanvasPrompt>; others: ManagedSession[] }) {
  const cur = s.currentPrompt ? byId.get(s.currentPrompt) : null;
  const queued = (s.queued ?? []).filter((q) => q.promptId);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const since = useElapsed(cur?.deliveredAt, !!cur);
  const status = s.state === "working" || s.state === "waiting" ? "busy" : s.state === "starting" ? "offline" : "live";
  const drop = (target: string) => {
    if (!drag || drag === target) return;
    const ids = queued.map((q) => q.promptId!) .filter((id) => id !== drag);
    ids.splice(ids.indexOf(target), 0, drag);
    post("/api/jobs/reorder", { session: s.id, order: ids });
  };
  return (
    <Group
      title={<><StatusDot status={status} /> {s.label}<span className="font-normal text-muted-foreground">{s.state === "working" ? `· working ${since}` : s.state === "waiting" ? "· waiting for you" : s.state === "starting" ? "· starting" : "· free"}</span></>}
      right={s.state === "working" && (
        <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs text-muted-foreground" onClick={() => api.managed.interrupt(s.id)} title="Stop what this Claude is doing now">
          <Stop size={11} weight="fill" /> Stop
        </Button>
      )}
    >
      {cur ? (
        <div className="rounded-md bg-[color-mix(in_oklab,var(--agent)_8%,transparent)] px-2 py-1.5">
          <p className="mb-1 truncate text-xs font-medium">{cur.text}</p>
          {cur.steps?.length ? <LiveSteps p={cur} /> : <p className="text-xs text-muted-foreground">Starting</p>}
        </div>
      ) : s.prompt ? (
        <p className="truncate px-1 text-xs text-muted-foreground">Working on a message from the chat: {s.prompt}</p>
      ) : !queued.length && <p className="px-1 text-xs text-muted-foreground">Nothing to do.</p>}
      {queued.length > 0 && <p className="mt-1 px-1 text-[11px] text-muted-foreground">Next in line{queued.length > 1 ? " · drag to reorder" : ""}</p>}
      {queued.map((q, i) => (
        <div
          key={q.promptId}
          draggable={queued.length > 1}
          onDragStart={() => setDrag(q.promptId)}
          onDragEnd={() => { setDrag(null); setOver(null); }}
          onDragOver={(e) => { e.preventDefault(); setOver(q.promptId); }}
          onDrop={(e) => { e.preventDefault(); drop(q.promptId!); setOver(null); }}
          className={cn("group flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-xs", over === q.promptId && drag !== q.promptId && "ring-2 ring-scope/50", drag === q.promptId && "opacity-50")}
        >
          {queued.length > 1 && <DotsSixVertical size={13} className="shrink-0 cursor-grab text-muted-foreground" />}
          <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">{i + 1}</span>
          <span className="min-w-0 flex-1 truncate">{q.text}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Job options" className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-60 hover:bg-accent hover:text-foreground group-hover:opacity-100"><DotsThree size={14} /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {i > 0 && <DropdownMenuItem onSelect={() => post("/api/jobs/reorder", { session: s.id, order: [q.promptId, ...queued.map((x) => x.promptId).filter((x) => x !== q.promptId)] })}>Do this next</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => post("/api/jobs/move", { id: q.promptId })}>Start it now on a new Claude</DropdownMenuItem>
              {others.map((o) => <DropdownMenuItem key={o.id} onSelect={() => post("/api/jobs/move", { id: q.promptId, to: o.id })}>Move to {o.label}{o.state === "idle" ? " (free)" : ""}</DropdownMenuItem>)}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onSelect={() => api.cancelPrompt(q.promptId!)}>Cancel this job</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ))}
    </Group>
  );
}
export const jobsCount = (chat: ChatState) => chat.prompts.filter((p) => ["queued", "sending", "delivered"].includes(p.status) && p.mode !== "audit").length;
export { chatName };
