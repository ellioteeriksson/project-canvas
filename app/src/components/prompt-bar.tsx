import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowsOutSimple, CaretDown, Check, ChatsCircle, CircleNotch, Crosshair, Play, Plus, ShieldWarning, Shuffle, Sparkle, SquaresFour, Stop, Warning, X } from "@phosphor-icons/react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import type { Agent, CanvasPrompt, ChatConn, ChatState, ChatStatus, Selection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export const STATUS: Record<ChatStatus, { word: string; hint: string }> = {
  live: { word: "Live", hint: "Goes straight into the chat." },
  listening: { word: "Listening", hint: "Claude picks it up right away." },
  busy: { word: "Working", hint: "Claude takes it when it finishes what it's doing." },
  idle: { word: "Idle", hint: "Reaches the chat with your next message there. Run /loupe-listen in the chat to take prompts right away." },
  offline: { word: "Closed", hint: "This chat closed." },
  starting: { word: "Starting", hint: "Claude is starting up. Prompts wait until it's ready." },
};
const RANK: Record<ChatStatus, number> = { live: 0, listening: 1, starting: 2, busy: 2, idle: 3, offline: 9 };
const PHASE = { thinking: "Thinking", reading: "Reading", editing: "Editing", running: "Running" } as const;

export function StatusDot({ status, className }: { status: ChatStatus; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        status === "live" || status === "listening" ? "bg-[var(--live)]" : status === "busy" || status === "starting" ? "agent-dot bg-[var(--agent)]" : status === "idle" ? "bg-muted-foreground/50" : "border border-muted-foreground/50",
        className,
      )}
    />
  );
}

export const chatName = (c: ChatConn) => (c.managed ? c.name || "Claude" : c.label ? `“${c.label}”` : "Terminal chat");
export const AUTO = "auto";

/** Which chat a prompt goes to: the one picked, or "auto" (Loupe picks among its own sessions) */
export function resolveTarget(conns: ChatConn[], target: string | null) {
  const managed = conns.filter((c) => c.managed);
  const picked = target && target !== AUTO ? conns.find((c) => c.id === target) ?? null : null;
  if (picked) return { id: picked.id, conn: picked, auto: false };
  // Loupe's own sessions come first; a terminal chat only when you pick it (or it's the only one)
  if (managed.length > 1) return { id: AUTO, conn: null, auto: true };
  const first = managed[0] ?? conns[0] ?? null;
  return { id: first?.id ?? null, conn: first, auto: false };
}
export const liveConns = (chat: ChatState) => chat.conns.filter((c) => c.status !== "offline").sort((a, b) => RANK[a.status] - RANK[b.status] || b.last - a.last);

type ComposerProps = {
  to: string | null; scopeName: string | null; selection: Selection | null; onClearScope: () => void; onConcepts: (id: string) => void;
  picker?: React.ReactNode; tail?: React.ReactNode; working?: boolean; onStop?: () => void; placeholder?: string; className?: string; inputRef?: React.RefObject<HTMLTextAreaElement | null>;
};

/** Where you write a prompt: scope, concepts or straight to code, and send. */
export function Composer({ to, scopeName, selection, onClearScope, onConcepts, picker, tail, working, onStop, placeholder, className, inputRef }: ComposerProps) {
  // Straight to code by default; 4 concepts is for when you want options first
  const [concepts, setConcepts] = useState(() => { try { return localStorage.getItem("loupe-concepts") === "on"; } catch { return false; } });
  const toggleConcepts = () => setConcepts((on) => { try { localStorage.setItem("loupe-concepts", on ? "off" : "on"); } catch {} return !on; });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const own = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? own;

  const grow = () => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  const submit = async () => {
    const body = text.trim();
    if (!body || !to || sending) return;
    setSending(true);
    setError(null);
    const r = await api.prompt(body, to, concepts ? "concepts" : "direct").catch(() => ({ ok: false, error: "The canvas server didn't answer", prompt: undefined }));
    setSending(false);
    if (!r.ok) return setError(r.error ?? "Couldn't send the prompt");
    if (concepts && r.prompt) onConcepts(r.prompt.id);
    setText("");
    requestAnimationFrame(grow);
  };
  const scopeTip = !selection ? "Click a page on the canvas to narrow the prompt" : selection.kind === "view" ? "Click a section in the page to narrow it further" : "Esc steps back out";

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }} className={cn("island w-full rounded-[18px] px-3.5 pt-3 pb-2", className)}>
      <textarea
        ref={input}
        rows={1}
        value={text}
        disabled={!to}
        onChange={(e) => { setText(e.target.value); grow(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
          if (e.key === "Escape") input.current?.blur();
        }}
        placeholder={placeholder ?? (!to ? "Start Claude to prompt from here" : scopeName ? "What should change here?" : "What should change in the project?")}
        aria-label="Prompt for Claude Code"
        className="mb-1.5 block max-h-[160px] min-h-6 w-full resize-none bg-transparent px-1 text-[15px] leading-6 tracking-[-0.011em] outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed"
      />
      <div className="flex min-w-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn("inline-flex h-7 max-w-[42%] min-w-0 items-center gap-1.5 rounded-full text-xs font-medium", selection ? "bg-scope/12 pr-1 pl-2.5 text-scope" : "bg-segment px-2.5 text-muted-foreground")}>
              <Crosshair size={12} weight="bold" className="shrink-0" />
              <span className="truncate">{scopeName ?? "Whole project"}</span>
              {selection && (
                <button type="button" onClick={onClearScope} aria-label="Clear scope: prompt the whole project" className="grid size-5 shrink-0 place-items-center rounded-full outline-none hover:bg-scope/15 focus-visible:ring-2 focus-visible:ring-ring">
                  <X size={10} weight="bold" />
                </button>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>{scopeTip}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button" variant="ghost" size="sm" onClick={toggleConcepts} aria-pressed={concepts}
              className={cn("h-7 shrink-0 gap-1.5 rounded-full px-2.5 text-xs", concepts ? "bg-scope/12 text-scope hover:bg-scope/16 hover:text-scope" : "text-muted-foreground")}
            >
              <SquaresFour size={13} weight={concepts ? "fill" : "regular"} /> 4 concepts
            </Button>
          </TooltipTrigger>
          <TooltipContent>{concepts ? "Claude sketches 4 concepts to pick from before it changes the code" : "Claude changes the code straight away"}</TooltipContent>
        </Tooltip>
        {picker}
        {error && <span className="min-w-0 truncate text-xs text-destructive">{error}</span>}
        <span className="ml-auto" />
        {tail}
        {working && onStop && !text.trim() ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="icon" variant="secondary" className="size-7 shrink-0 rounded-full" onClick={onStop} aria-label="Stop Claude">
                <Stop size={12} weight="fill" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Stop what Claude is doing</TooltipContent>
          </Tooltip>
        ) : (
          <Button type="submit" size="icon" className="size-7 shrink-0 rounded-full" disabled={!to || !text.trim() || sending} aria-label="Send to Claude Code (Enter)">
            <ArrowUp size={14} weight="bold" />
          </Button>
        )}
      </div>
    </form>
  );
}

/** Prompt bar: send a prompt from the canvas to Claude, in a session Loupe runs or a chat open in this project. */
export function PromptBar({ chat, agents, selection, scopeName, insetLeft = 12, insetRight = 72, target, onTarget, canStart, onClearScope, onConcepts, onOpenChat }: {
  chat: ChatState; agents: Agent[]; selection: Selection | null; scopeName: string | null; insetLeft?: number; insetRight?: number;
  target: string | null; onTarget: (id: string) => void; canStart: boolean; onClearScope: () => void; onConcepts: (id: string) => void; onOpenChat: () => void;
}) {
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const thread = useRef<HTMLDivElement>(null);

  const conns = useMemo(() => liveConns(chat), [chat]);
  const to = resolveTarget(conns, target);
  // Rules checks belong to the helper buddy, not to the prompt history
  const recent = chat.prompts.filter((p) => p.mode !== "audit").slice(-30);
  const latest = recent[recent.length - 1];
  const showLatest = !open && latest && latest.status !== "cancelled" && !(latest.status === "done" && Date.now() - (latest.doneAt ?? 0) > 120_000);
  // Permission requests from Loupe's own sessions are answered in the chat panel too; show them here as well
  const perms = chat.permissions;

  // ⌘K / Ctrl+K focuses the prompt
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) thread.current?.scrollTo({ top: thread.current.scrollHeight }); }, [open, recent.length, latest?.status]);

  const working = to.conn?.managed && to.conn.status === "busy";

  return (
    <div className="pointer-events-none absolute bottom-5 z-20 flex justify-center px-4" style={{ left: insetLeft, right: insetRight }}>
      <div className="pointer-events-auto flex w-[640px] max-w-full flex-col items-center gap-2.5">
        {perms.map((p) => <PermissionCard key={p.request_id} p={p} />)}

        {open && (
          <div ref={thread} className="island max-h-[min(46vh,440px)] w-full overflow-y-auto" aria-label="Prompts sent from the canvas">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-chrome px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">Sent from the canvas</h2>
              <div className="flex items-center gap-1">
                {recent.some((p) => ["done", "failed", "cancelled"].includes(p.status)) && (
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => api.clearPrompts()}>Clear finished</Button>
                )}
                <Button variant="ghost" size="icon" className="size-7" onClick={() => setOpen(false)} aria-label="Hide sent prompts"><X size={14} /></Button>
              </div>
            </div>
            {recent.length ? (
              <ol className="flex flex-col">
                {recent.map((p) => <PromptItem key={p.id} p={p} conns={chat.conns} agents={agents} onConcepts={onConcepts} />)}
              </ol>
            ) : (
              <p className="px-4 py-8 text-center text-muted-foreground">Prompts you send from here show up here, with Claude's answers.</p>
            )}
          </div>
        )}

        {showLatest && (
          <button
            type="button"
            onClick={() => (latest.mode === "concepts" ? onConcepts(latest.id) : setOpen(true))}
            className="island flex max-w-[90%] items-center gap-2 rounded-full py-1.5 pr-3.5 pl-3 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <PromptState p={latest} conns={chat.conns} agents={agents} compact onConcepts={onConcepts} />
          </button>
        )}

        <Composer
          to={to.id}
          inputRef={input}
          scopeName={scopeName}
          selection={selection}
          onClearScope={onClearScope}
          onConcepts={onConcepts}
          working={!!working}
          onStop={() => to.conn && api.managed.interrupt(to.conn.id)}
          placeholder={!to.id ? (canStart ? "Start Claude to prompt from here" : "Open Claude Code in this project to prompt from here") : undefined}
          picker={<ChatPicker conns={conns} to={to} onPick={onTarget} canStart={canStart} />}
          tail={
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-7 rounded-full text-muted-foreground" onClick={() => setOpen((o) => !o)} aria-pressed={open} aria-label={open ? "Hide sent prompts" : "Show sent prompts"}>
                    <ChatsCircle size={15} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Sent from the canvas</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button type="button" variant="ghost" size="icon" className="size-7 rounded-full text-muted-foreground" onClick={onOpenChat} aria-label="Open the chat panel">
                    <ArrowsOutSimple size={15} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Open the chat panel (⌘J)</TooltipContent>
              </Tooltip>
            </>
          }
        />
      </div>
    </div>
  );
}

export function ChatPicker({ conns, to, onPick, canStart, align = "start" }: { conns: ChatConn[]; to: ReturnType<typeof resolveTarget>; onPick: (id: string) => void; canStart: boolean; align?: "start" | "end" }) {
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setStarting(true); setErr(null);
    const r = await api.managed.start().catch(() => ({ ok: false, error: "The canvas server didn't answer" }));
    setStarting(false);
    if (!r.ok) setErr(r.error ?? "Couldn't start Claude");
  };
  if (!conns.length)
    return canStart ? (
      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 rounded-full px-2 text-xs text-scope" onClick={start} disabled={starting} title={err ?? undefined}>
        {starting ? <CircleNotch size={12} className="animate-spin" /> : <Play size={11} weight="fill" />} {err ? "Try again" : "Start Claude"}
      </Button>
    ) : <span className="inline-flex h-7 items-center gap-1.5 px-2 text-xs text-muted-foreground"><StatusDot status="offline" />No chat open</span>;
  const managed = conns.filter((c) => c.managed);
  const status: ChatStatus = to.auto ? (managed.some((c) => c.status === "live") ? "live" : "busy") : to.conn?.status ?? "offline";
  const label = to.auto ? `Auto · ${managed.length} Claudes` : to.conn ? (to.conn.managed ? chatName(to.conn) : STATUS[to.conn.status].word) : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 min-w-0 gap-1.5 rounded-full px-2 text-xs text-muted-foreground" aria-label={`Sending to ${label}. Choose where prompts go`}>
          <StatusDot status={status} />
          <span className="max-w-[130px] truncate">{label}</span>
          <CaretDown size={10} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-80">
        <DropdownMenuLabel className="font-normal text-muted-foreground">{to.auto ? "Each prompt goes to the Claude that worked on that page, or to a free one." : to.conn ? STATUS[to.conn.status].hint : ""}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {managed.length > 1 && (
          <DropdownMenuItem onSelect={() => onPick(AUTO)} className="flex items-start gap-2">
            <Shuffle size={13} className="mt-1 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block">Auto</span>
              <span className="block text-xs text-muted-foreground">Loupe picks among {managed.length} Claudes</span>
            </span>
            {to.auto && <Check size={14} className="mt-1" />}
          </DropdownMenuItem>
        )}
        {conns.map((c) => (
          <DropdownMenuItem key={c.id} onSelect={() => onPick(c.id)} className="flex items-start gap-2">
            <StatusDot status={c.status} className="mt-1.5" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{chatName(c)}</span>
              <span className="block text-xs text-muted-foreground">{c.managed ? `Run by Loupe · ${STATUS[c.status].word}` : `In your terminal · ${STATUS[c.status].word}`}</span>
            </span>
            {!to.auto && c.id === to.conn?.id && <Check size={14} className="mt-1" />}
          </DropdownMenuItem>
        ))}
        {canStart && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); start(); }} disabled={starting}>
              {starting ? <CircleNotch size={14} className="animate-spin" /> : <Plus size={14} />} New Claude session
              {err && <span className="ml-auto truncate text-xs text-destructive">{err}</span>}
            </DropdownMenuItem>
          </>
        )}
        {to.conn?.listen && !to.conn.managed && to.conn.status !== "live" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => api.stopListening(to.conn!.id)}>Stop listening in this chat</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PromptItem({ p, conns, agents, onConcepts }: { p: CanvasPrompt; conns: ChatConn[]; agents: Agent[]; onConcepts: (id: string) => void }) {
  return (
    <li className="flex flex-col gap-1.5 border-b px-4 py-3 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <p className="line-clamp-3 min-w-0 flex-1 text-[13px] whitespace-pre-wrap">{p.text}</p>
        <span className="shrink-0 text-xs text-muted-foreground">{p.scope}</span>
      </div>
      <PromptState p={p} conns={conns} agents={agents} onConcepts={onConcepts} />
    </li>
  );
}

/** What happened to a prompt: waiting, Claude working on it (with what it's doing), answered. */
export function PromptState({ p, conns, agents, compact, onConcepts }: { p: CanvasPrompt; conns: ChatConn[]; agents: Agent[]; compact?: boolean; onConcepts: (id: string) => void }) {
  const conn = conns.find((c) => c.id === p.conn);
  const session = conn?.session ?? p.session;
  const agent = session ? agents.filter((a) => a.session === session).sort((a, b) => b.last - a.last)[0] : undefined;
  const lead = compact ? <span className="max-w-[40%] shrink-0 truncate font-medium">{p.text}</span> : null;

  if (p.status === "sketching") {
    const ready = p.slots?.filter((x) => x === "ready").length ?? 0;
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs" aria-live="polite">
        {lead}
        <Sparkle size={13} weight="fill" className="agent-dot shrink-0 text-[var(--agent)]" />
        <span className="truncate">{ready ? `${ready} of 4 concepts ready` : p.sketch ? "Sketching 4 concepts" : "Reading the page"}</span>
        {!compact && <Button variant="ghost" size="sm" className="ml-auto h-6 px-1.5 text-xs" onClick={() => onConcepts(p.id)}>Open</Button>}
      </div>
    );
  }
  if (p.status === "concepts") {
    const label = p.chosen ? `Picked “${p.concepts?.[p.chosen.index]?.title}”` : `${p.concepts?.filter(Boolean).length ?? 4} concepts ready to pick from`;
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs">
        {lead}
        <SquaresFour size={13} weight="fill" className="shrink-0 text-scope" />
        <span className="truncate">{label}</span>
        {!compact && <Button variant="ghost" size="sm" className="ml-auto h-6 px-1.5 text-xs" onClick={() => onConcepts(p.id)}>Open</Button>}
      </div>
    );
  }
  if (p.status === "done")
    return (
      <div className={cn("flex min-w-0 gap-2", compact ? "items-center" : "items-start")}>
        {lead}
        <Check size={13} weight="bold" className={cn("shrink-0 text-[var(--live)]", !compact && "mt-0.5")} />
        <p className={cn("min-w-0 text-[13px] text-muted-foreground", compact ? "truncate text-xs" : "whitespace-pre-wrap")}>{p.reply || "Done"}</p>
      </div>
    );
  if (p.status === "failed" || p.status === "cancelled")
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        {lead}
        <Warning size={13} className="shrink-0" />
        <span className="truncate">{p.status === "cancelled" ? "Cancelled" : p.note ?? "Not delivered"}</span>
      </div>
    );
  if (p.status === "delivered") {
    if (!conn)
      return (
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          {lead}
          <Warning size={13} className="shrink-0" />
          <span className="truncate">The chat closed without answering</span>
        </div>
      );
    if (p.mode === "concepts" && !agent) return (
      <div className="flex min-w-0 items-center gap-2 text-xs" aria-live="polite">
        {lead}
        <Sparkle size={13} weight="fill" className="agent-dot shrink-0 text-[var(--agent)]" />
        <span className="truncate">Claude is sketching concepts</span>
      </div>
    );
    const what = agent ? `${PHASE[agent.phase]} ${agent.phase === "running" ? agent.command ?? "" : agent.file?.split("/").pop() ?? ""}`.trim() : "Claude is on it";
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs" aria-live="polite">
        {lead}
        <Sparkle size={13} weight="fill" className="agent-dot shrink-0 text-[var(--agent)]" />
        <span className="truncate">{what}</span>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
      {lead}
      <StatusDot status={conn?.status ?? "offline"} />
      <span className="truncate">{p.status === "sending" ? "Sending…" : conn?.status === "busy" ? "Waiting for Claude to finish" : "Waiting for the chat"}</span>
      {p.status === "queued" && !compact && (
        <Button variant="ghost" size="sm" className="ml-auto h-6 px-1.5 text-xs" onClick={() => api.cancelPrompt(p.id)}>
          <X size={12} /> Cancel
        </Button>
      )}
    </div>
  );
}

export function PermissionCard({ p }: { p: { request_id: string; tool_name: string; description: string; input_preview: string } }) {
  const [busy, setBusy] = useState(false);
  const decide = async (b: "allow" | "deny") => { setBusy(true); await api.permission(p.request_id, b); };
  return (
    <div role="alertdialog" aria-label={`Claude wants to use ${p.tool_name}`} className="rounded-[14px] bg-background p-3.5 shadow-soft-lg ring-1 ring-[var(--agent)]/45">
      <div className="flex items-start gap-2">
        <ShieldWarning size={16} className="mt-0.5 shrink-0 text-[var(--agent)]" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">Claude wants to use {p.tool_name}</p>
          {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
          {p.input_preview && <pre className="mt-2 max-h-28 overflow-auto rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] leading-4 whitespace-pre-wrap">{p.input_preview}</pre>}
        </div>
      </div>
      <div className="mt-2.5 flex justify-end gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => decide("deny")}>Deny</Button>
        <Button size="sm" disabled={busy} onClick={() => decide("allow")}>Allow</Button>
      </div>
    </div>
  );
}
