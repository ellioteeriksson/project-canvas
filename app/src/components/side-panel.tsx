import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise, ChatCircleDots, ChatTeardropText, Check, CheckCircle, CircleNotch, DotsThree, FileText, Globe, MagnifyingGlass,
  ListChecks, PaperPlaneTilt, PencilSimple, Plus, Robot, ShieldCheck, ShieldSlash, Stop, Terminal, Trash, Warning, X,
} from "@phosphor-icons/react";
import { api, AGENT_EVENT } from "@/lib/api";
import type { Agent, CanvasComment, ChatConn, ChatState, ManagedSession, Manifest, Selection, TranscriptEvent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { JobsTab, jobsCount } from "@/components/jobs-tab";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Composer, PermissionCard, PromptItem, StatusDot, STATUS, chatName, liveConns, resolveTarget, AUTO, ChatPicker } from "@/components/prompt-bar";

export type PanelTab = "claude" | "jobs" | "comments";
export const PANEL_W = 380;

type Props = {
  tab: PanelTab; onTab: (t: PanelTab) => void; onClose: () => void;
  manifest: Manifest; chat: ChatState; agents: Agent[]; managed: ManagedSession[]; canStart: boolean;
  target: string | null; onTarget: (id: string) => void;
  selection: Selection | null; scopeName: string | null; onClearScope: () => void; onConcepts: (id: string) => void;
  comments: CanvasComment[]; activeComment: string | null; onShowComment: (c: CanvasComment) => void; commenting: boolean; onCommenting: (on: boolean) => void;
};

/** The right-hand panel: the full chat with Claude, and the comments pinned on the canvas. */
export function SidePanel(p: Props) {
  const open = p.comments.filter((c) => c.status !== "resolved").length;
  const jobs = jobsCount(p.chat);
  return (
    <aside className="island absolute top-3 right-3 bottom-3 z-30 flex flex-col overflow-hidden" style={{ width: PANEL_W }} aria-label={p.tab === "claude" ? "Chat with Claude" : p.tab === "jobs" ? "Jobs" : "Comments"}>
      <div className="flex h-[52px] shrink-0 items-center gap-1 border-b px-2">
        <div role="tablist" aria-label="Panel" className="flex items-center gap-0.5 rounded-[10px] bg-segment p-0.5 dark:bg-white/8">
          {([["claude", "Claude", ChatCircleDots], ["jobs", "Jobs", ListChecks], ["comments", "Comments", ChatTeardropText]] as const).map(([id, label, Icon]) => (
            <button
              key={id} type="button" role="tab" aria-selected={p.tab === id} onClick={() => p.onTab(id)}
              className={cn("flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", p.tab === id ? "bg-background shadow-sm dark:bg-white/14" : "text-muted-foreground hover:text-foreground")}
            >
              <Icon size={14} weight={p.tab === id ? "fill" : "regular"} /> {label}
              {id === "jobs" && jobs > 0 && <span className="rounded-full bg-[var(--agent)] px-1.5 text-[10.5px] leading-[16px] font-semibold text-white tabular-nums">{jobs}</span>}
              {id === "comments" && open > 0 && <span className="rounded-full bg-scope px-1.5 text-[10.5px] leading-[16px] font-semibold text-white tabular-nums">{open}</span>}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={p.onClose} aria-label="Close the panel"><X size={16} /></Button>
          </TooltipTrigger>
          <TooltipContent>Close (⌘J)</TooltipContent>
        </Tooltip>
      </div>
      {p.tab === "claude" ? <ClaudeTab {...p} /> : p.tab === "jobs" ? <JobsTab chat={p.chat} managed={p.managed} /> : <CommentsTab {...p} />}
    </aside>
  );
}

/* ------------------------------------------------------------------ Claude */

function ClaudeTab({ manifest, chat, agents, managed, canStart, target, onTarget, selection, scopeName, onClearScope, onConcepts }: Props) {
  const conns = useMemo(() => liveConns(chat), [chat]);
  const to = resolveTarget(conns, target);
  // Which conversation is shown: the picked one, or the first of Loupe's own sessions
  const [viewing, setViewing] = useState<string | null>(null);
  const shown = conns.find((c) => c.id === viewing) ?? (to.conn ?? conns.find((c) => c.managed) ?? conns[0] ?? null);
  const session = shown?.managed ? managed.find((m) => m.id === shown.id) ?? null : null;
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const start = async () => {
    setStarting(true); setErr(null);
    const r: { ok: boolean; error?: string; session?: ManagedSession } = await api.managed.start().catch(() => ({ ok: false, error: "The canvas server didn't answer" }));
    setStarting(false);
    if (!r.ok) setErr(r.error ?? "Couldn't start Claude");
    else if (r.session) { setViewing(r.session.id); onTarget(r.session.id); }
  };

  return (
    <>
      {/* Sessions */}
      {conns.length > 0 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b px-2 py-1.5" role="tablist" aria-label="Claude sessions">
          {conns.map((c) => (
            <button
              key={c.id} type="button" role="tab" aria-selected={shown?.id === c.id}
              onClick={() => { setViewing(c.id); onTarget(c.id); }}
              className={cn("flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring", shown?.id === c.id ? "bg-segment font-medium dark:bg-white/12" : "text-muted-foreground hover:bg-accent")}
            >
              {c.managed ? <StatusDot status={c.status} /> : <Terminal size={12} />}
              <span className="max-w-[120px] truncate">{chatName(c)}</span>
            </button>
          ))}
          {canStart && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7 shrink-0 rounded-full text-muted-foreground" onClick={start} disabled={starting} aria-label="New Claude session">
                  {starting ? <CircleNotch size={13} className="animate-spin" /> : <Plus size={14} />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>New Claude session. Several can work in parallel.</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      {!shown ? (
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <Robot size={30} className="text-muted-foreground" />
          <p className="mt-3 font-medium">No Claude here yet</p>
          {canStart ? (
            <>
              <p className="mt-1 text-[13px] text-muted-foreground">Start a Claude Code session in {manifest.project.name}. Loupe runs it in the background: edits go through, commands ask you first.</p>
              <Button className="mt-4" onClick={start} disabled={starting}>{starting ? <CircleNotch size={14} className="animate-spin" /> : <Robot size={14} />} Start Claude</Button>
              {err && <p className="mt-2 text-xs text-destructive">{err}</p>}
            </>
          ) : (
            <p className="mt-1 text-[13px] text-muted-foreground">Loupe couldn't find Claude Code on this computer. Install it, or open Claude Code in this project and run /loupe.</p>
          )}
        </div>
      ) : shown.managed ? (
        <Transcript key={shown.id} conn={shown} session={session} chat={chat} root={manifest.project.root} />
      ) : (
        <TerminalChat conn={shown} chat={chat} agents={agents} onConcepts={onConcepts} />
      )}

      {/* Free Claude sessions get a header line with what they cost and how to stop them */}
      {shown?.managed && session && (
        <div className="flex shrink-0 items-center gap-2 border-t px-3 py-1.5 text-[11.5px] text-muted-foreground">
          <StatusDot status={shown.status} />
          <span className="min-w-0 flex-1 truncate">{session.state === "waiting" ? "Waiting for your answer" : session.state === "working" ? "Working" : session.state === "starting" ? "Starting…" : "Ready"}{session.queue ? ` · ${session.queue} queued` : ""}{session.cost ? ` · $${session.cost.toFixed(2)}` : ""}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" aria-label="Session options"><DotsThree size={16} weight="bold" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={session.state !== "working" && session.state !== "waiting"} onSelect={() => api.managed.interrupt(session.id)}><Stop size={14} /> Stop what it's doing</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => api.managed.stop(session.id)} className="text-destructive focus:text-destructive"><X size={14} /> End this session</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      <div className="shrink-0 border-t p-2">
        <Composer
          className="rounded-[14px] shadow-none ring-1 ring-border"
          to={shown ? (to.auto && !viewing ? AUTO : shown.id) : null}
          scopeName={scopeName}
          selection={selection}
          onClearScope={onClearScope}
          onConcepts={onConcepts}
          working={shown?.managed && shown.status === "busy"}
          onStop={() => shown && api.managed.interrupt(shown.id)}
          placeholder={!shown ? (canStart ? "Start Claude to prompt from here" : "Open Claude Code in this project") : scopeName ? "What should change here?" : `Message ${chatName(shown)}`}
          picker={conns.length > 1 ? <ChatPicker conns={conns} to={viewing ? { id: shown!.id, conn: shown, auto: false } : to} onPick={(id) => { onTarget(id); setViewing(id === AUTO ? null : id); }} canStart={canStart} align="end" /> : null}
        />
      </div>
    </>
  );
}

const TOOL_VERB: Record<string, string> = { Read: "Read", Edit: "Edited", Write: "Wrote", MultiEdit: "Edited", NotebookEdit: "Edited", Bash: "Ran", Grep: "Searched for", Glob: "Looked for", WebFetch: "Opened", WebSearch: "Searched the web for", Task: "Started a helper:", TodoWrite: "Updated its plan" };
const toolIcon = (name: string) => (/^(Edit|Write|MultiEdit|NotebookEdit)$/.test(name) ? PencilSimple : name === "Bash" ? Terminal : name === "Read" ? FileText : /^(Grep|Glob)$/.test(name) ? MagnifyingGlass : /^Web/.test(name) ? Globe : Robot);
const shortPath = (s: string, root: string) => (s.startsWith(root + "/") ? s.slice(root.length + 1) : s.includes("/") && !s.includes(" ") ? s.split("/").slice(-2).join("/") : s);

/** A session Loupe runs: everything it said and did, live */
function Transcript({ conn, session, chat, root }: { conn: ChatConn; session: ManagedSession | null; chat: ChatState; root: string }) {
  const [events, setEvents] = useState<TranscriptEvent[]>([]);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    let alive = true;
    const buffer: TranscriptEvent[] = [];
    let loaded = false;
    const onEv = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; ev: TranscriptEvent }>).detail;
      if (d.id !== conn.id) return;
      if (!loaded) buffer.push(d.ev);
      else setEvents((xs) => [...xs, d.ev]);
    };
    window.addEventListener(AGENT_EVENT, onEv);
    api.managed.transcript(conn.id).then((list) => {
      if (!alive) return;
      loaded = true;
      const last = list[list.length - 1]?.at ?? 0;
      setEvents([...list, ...buffer.filter((b) => b.at > last)]);
    });
    return () => { alive = false; window.removeEventListener(AGENT_EVENT, onEv); };
  }, [conn.id]);
  useEffect(() => { if (stick.current) box.current?.scrollTo({ top: box.current.scrollHeight }); }, [events.length]);

  const results = useMemo(() => new Map(events.filter((e) => e.kind === "result").map((e) => [(e as { toolId: string }).toolId, e as Extract<TranscriptEvent, { kind: "result" }>])), [events]);
  const answers = useMemo(() => new Map(events.filter((e) => e.kind === "answer").map((e) => [(e as { requestId: string }).requestId, (e as { allowed: boolean }).allowed])), [events]);
  const pending = chat.permissions.filter((x) => x.conn === conn.id);
  const working = session?.state === "working";

  return (
    <div ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }} className="min-h-0 flex-1 overflow-y-auto px-3 py-3" aria-live="polite">
      {!events.length && <p className="px-2 py-10 text-center text-[13px] text-muted-foreground">{session?.state === "starting" ? "Starting Claude…" : `Ask ${chatName(conn)} for a change. Pick a page or section on the canvas first to keep it to that.`}</p>}
      <ol className="flex flex-col gap-2">
        {events.map((e, i) => {
          if (e.kind === "user")
            return (
              <li key={i} className="ml-8 self-end rounded-[14px] rounded-br-[4px] bg-scope/10 px-3 py-2 text-[13.5px] leading-[1.45] whitespace-pre-wrap">
                {e.text}
                {e.scope && <span className="mt-1 block text-[11px] text-scope">{e.scope}</span>}
              </li>
            );
          if (e.kind === "text") return <li key={i} className="pr-4 text-[13.5px] leading-[1.55] whitespace-pre-wrap">{e.text}</li>;
          if (e.kind === "tool") {
            const r = results.get(e.toolId);
            const Icon = toolIcon(e.name);
            const verb = TOOL_VERB[e.name] ?? e.name.replace(/^mcp__loupe__canvas_/, "Loupe: ").replace(/^mcp__/, "").replace(/__/g, " › ");
            return (
              <li key={i} className={cn("flex min-w-0 items-start gap-1.5 text-xs text-muted-foreground", r?.error && "text-destructive")}>
                {!r && working ? <CircleNotch size={12} className="mt-0.5 shrink-0 animate-spin" /> : <Icon size={12} className="mt-0.5 shrink-0" />}
                <span className="min-w-0 truncate" title={e.detail}>{verb} {e.detail && <span className="font-mono text-[11px]">{shortPath(e.detail, root)}</span>}</span>
              </li>
            );
          }
          if (e.kind === "ask") {
            const p = pending.find((x) => x.request_id === e.requestId);
            if (p) return <li key={i}><PermissionCard p={p} /></li>;
            const ok = answers.get(e.requestId);
            return (
              <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                {ok ? <ShieldCheck size={12} className="mt-0.5 shrink-0 text-[var(--live)]" /> : <ShieldSlash size={12} className="mt-0.5 shrink-0" />}
                <span className="min-w-0">{ok ? "You allowed" : ok === false ? "You declined" : "Asked"}: {e.detail}</span>
              </li>
            );
          }
          if (e.kind === "done")
            return e.error ? (
              <li key={i} className="flex items-start gap-1.5 rounded-md bg-destructive/8 px-2 py-1.5 text-xs text-destructive"><Warning size={12} className="mt-0.5 shrink-0" /> {e.text || "Claude stopped with an error."}</li>
            ) : <li key={i} aria-hidden className="mx-auto my-1 h-px w-10 bg-border" />;
          if (e.kind === "started") return <li key={i} className="text-center text-[11px] text-muted-foreground">{e.resumed ? "Picked up where the last session left off" : "Session started"} · {new Date(e.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</li>;
          if (e.kind === "stopped") return <li key={i} className={cn("text-center text-[11px]", e.error ? "text-destructive" : "text-muted-foreground")}>{e.error ? `Session ended: ${e.error}` : "Session ended"}</li>;
          if (e.kind === "note") return <li key={i} className="text-center text-[11px] text-muted-foreground">{e.text}</li>;
          return null;
        })}
        {working && !pending.length && (
          <li className="flex items-center gap-1.5 text-xs text-[var(--agent)]"><span className="agent-dot size-1.5 rounded-full bg-[var(--agent)]" /> Working…</li>
        )}
      </ol>
      {session?.error && <p className="mt-3 rounded-md bg-destructive/8 px-2.5 py-2 text-xs text-destructive">{session.error}</p>}
    </div>
  );
}

/** A Claude Code chat in the user's terminal: Loupe only sees the prompts sent from the canvas */
function TerminalChat({ conn, chat, agents, onConcepts }: { conn: ChatConn; chat: ChatState; agents: Agent[]; onConcepts: (id: string) => void }) {
  const list = chat.prompts.filter((p) => p.conn === conn.id && p.mode !== "audit");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <p className="flex items-start gap-2 border-b px-4 py-2.5 text-xs text-muted-foreground">
        <Terminal size={13} className="mt-px shrink-0" /> This chat runs in your terminal ({STATUS[conn.status].word.toLowerCase()}). Prompts from here reach it; the rest of the conversation stays there.
      </p>
      {list.length ? (
        <ol className="flex flex-col">{list.map((p) => <PromptItem key={p.id} p={p} conns={chat.conns} agents={agents} onConcepts={onConcepts} />)}</ol>
      ) : (
        <p className="px-6 py-10 text-center text-[13px] text-muted-foreground">Prompts you send to this chat show up here, with Claude's answers.</p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Comments */

function CommentsTab({ comments, manifest, chat, target, activeComment, onShowComment, commenting, onCommenting }: Props) {
  const [showResolved, setShowResolved] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const conns = liveConns(chat);
  const to = resolveTarget(conns, target);
  const open = comments.filter((c) => c.status !== "resolved");
  const shown = showResolved ? comments : open;
  const byView = useMemo(() => {
    const m = new Map<string, CanvasComment[]>();
    for (const c of [...shown].sort((a, b) => a.y - b.y)) m.set(c.viewId, [...(m.get(c.viewId) ?? []), c]);
    return [...m.entries()].sort((a, b) => manifest.views.findIndex((v) => v.id === a[0]) - manifest.views.findIndex((v) => v.id === b[0]));
  }, [shown, manifest.views]);
  const sendable = open.filter((c) => c.status === "open");
  const send = async (ids: string[]) => {
    setBusy(true); setErr(null);
    const r = await api.comments.send(ids, to.id).catch(() => ({ ok: false, error: "The canvas server didn't answer" }));
    setBusy(false);
    if (!r.ok) setErr(r.error ?? "Couldn't send"); else setPicked(new Set());
  };
  const numberOf = useMemo(() => new Map(comments.map((c, i) => [c.id, i + 1])), [comments]);

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button size="sm" variant={commenting ? "default" : "outline"} className="h-8" onClick={() => onCommenting(!commenting)} aria-pressed={commenting}>
          <ChatTeardropText size={14} weight={commenting ? "fill" : "regular"} /> {commenting ? "Click a page to comment" : "Add comment"}
        </Button>
        <span className="flex-1" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="accent-[var(--scope)]" /> Show resolved
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!shown.length ? (
          <div className="flex flex-col items-center px-8 py-14 text-center">
            <ChatTeardropText size={28} className="text-muted-foreground" />
            <p className="mt-3 font-medium">{comments.length ? "All comments are resolved" : "No comments yet"}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">Press C, then click anywhere on a page to pin a note there. Send notes to Claude one at a time or all together.</p>
          </div>
        ) : (
          byView.map(([viewId, list]) => (
            <section key={viewId} className="border-b last:border-b-0">
              <h3 className="sticky top-0 z-10 bg-chrome px-4 py-1.5 text-[11.5px] font-semibold text-muted-foreground">{list[0].viewName || viewId}</h3>
              <ol>
                {list.map((c) => (
                  <li key={c.id} className={cn("group/c flex gap-2.5 px-4 py-2.5", activeComment === c.id && "bg-scope/[0.06]")}>
                    {c.status === "open" ? (
                      <input type="checkbox" aria-label="Pick to send" className="mt-1 accent-[var(--scope)]" checked={picked.has(c.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); e.target.checked ? n.add(c.id) : n.delete(c.id); return n; })} />
                    ) : <span className="w-[13px]" />}
                    <button type="button" onClick={() => onShowComment(c)} className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className={cn("grid size-[18px] place-items-center rounded-full rounded-bl-[3px] text-[10px] font-semibold text-white", c.status === "resolved" ? "bg-muted-foreground/60" : c.status === "sent" ? "bg-[var(--agent)]" : c.status === "review" ? "bg-[#b7791f]" : "bg-scope")}>{numberOf.get(c.id)}</span>
                        {c.section?.name ? <span className="truncate">{c.section.name}</span> : null}
                        <span className="ml-auto shrink-0">{c.status === "sent" ? "With Claude" : c.status === "review" ? "To review" : c.status === "resolved" ? "Done" : new Date(c.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                      </span>
                      <span className={cn("mt-1 block text-[13px] leading-snug whitespace-pre-wrap", c.status === "resolved" && "text-muted-foreground line-through decoration-muted-foreground/40")}>{c.text}</span>
                      {c.reply && <span className="mt-1 flex gap-1 text-xs text-muted-foreground"><Check size={12} className="mt-0.5 shrink-0 text-[var(--live)]" /> <span className="line-clamp-3">{c.reply}</span></span>}
                    </button>
                    <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity group-hover/c:opacity-100 focus-within:opacity-100">
                      {c.status === "open" && (
                        <Tooltip><TooltipTrigger asChild>
                          <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" disabled={busy || !to.id} onClick={() => send([c.id])} aria-label="Send to Claude"><PaperPlaneTilt size={14} /></Button>
                        </TooltipTrigger><TooltipContent side="left">Send to Claude</TooltipContent></Tooltip>
                      )}
                      <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={() => api.comments.update({ id: c.id, status: c.status === "resolved" ? "open" : "resolved" })} aria-label={c.status === "resolved" ? "Reopen" : "Mark done"}>
                          {c.status === "resolved" ? <ArrowCounterClockwise size={14} /> : <CheckCircle size={14} />}
                        </Button>
                      </TooltipTrigger><TooltipContent side="left">{c.status === "resolved" ? "Reopen" : "Mark done"}</TooltipContent></Tooltip>
                      <Tooltip><TooltipTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 text-muted-foreground" onClick={() => api.comments.remove(c.id)} aria-label="Delete comment"><Trash size={14} /></Button>
                      </TooltipTrigger><TooltipContent side="left">Delete</TooltipContent></Tooltip>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}
      </div>
      {sendable.length > 0 && (
        <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{err ?? (!to.id ? "Start Claude to send comments" : picked.size ? `${picked.size} picked` : `${sendable.length} open`)}</span>
          <Button size="sm" disabled={busy || !to.id} onClick={() => send(picked.size ? [...picked] : sendable.map((c) => c.id))}>
            {busy ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneTilt size={14} />} Send {picked.size ? picked.size : "all"} to Claude
          </Button>
        </div>
      )}
    </>
  );
}
