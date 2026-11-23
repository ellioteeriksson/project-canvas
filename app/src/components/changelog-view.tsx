import { useMemo, useState } from "react";
import { ArrowCounterClockwise, ChatCircle, Check, CircleNotch, ClockCounterClockwise, Code, Copy, DotsThree, DownloadSimple, FileText, Sparkle, SquaresFour, Trash, Warning } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { ChangelogEntry, ChangeShot, Manifest } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

function toMarkdown(project: string, entries: ChangelogEntry[]) {
  const out = [`# Changelog: ${project}`, ""];
  let cur = "";
  for (const e of [...entries].reverse()) {
    const d = isoDay(e.at);
    if (d !== cur) { out.push(`## ${d}`, ""); cur = d; }
    const title = e.detail || e.prompt || "Changes made in Claude Code";
    out.push(`### ${time(e.at)} · ${title}`);
    const meta = [e.scope ? `Scope: ${e.scope}` : null, `From: ${e.kind ? "Loupe" : e.source === "canvas" ? "Canvas" : "Claude Code chat"}`, e.detail && e.prompt ? `Request: ${e.prompt}` : null].filter(Boolean);
    out.push("", meta.map((m) => `- ${m}`).join("\n"));
    if (e.summary) out.push("", e.summary);
    if (e.files.length) out.push("", "Files:", ...e.files.map((f) => `- \`${f}\``));
    out.push("");
  }
  return out.join("\n");
}

/** Every change Claude made in the project, grouped by day, exportable as Markdown. */
export function ChangelogView({ manifest, entries }: { manifest: Manifest; entries: ChangelogEntry[] }) {
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, ChangelogEntry[]>();
    for (const e of [...entries].reverse()) {
      const k = day(e.at);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [entries]);
  const md = () => toMarkdown(manifest.project.name, entries);
  const download = () => {
    const url = URL.createObjectURL(new Blob([md()], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `changelog-${manifest.project.name}-${isoDay(Date.now())}.md` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(md()); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {}
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-8 pt-6 pb-48">
        <header className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[26px] leading-tight font-semibold tracking-[-0.025em]">Changelog</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {entries.length ? `${entries.length} change${entries.length === 1 ? "" : "s"} Claude made in ${manifest.project.name}` : `Changes Claude makes in ${manifest.project.name} are listed here`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copy} disabled={!entries.length}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy Markdown"}</Button>
            <Button size="sm" onClick={download} disabled={!entries.length}><DownloadSimple size={14} weight="bold" /> Export .md</Button>
          </div>
        </header>

        {!entries.length ? (
          <div className="island mt-8 flex flex-col items-center px-8 py-14 text-center">
            <FileText size={28} className="text-muted-foreground" />
            <p className="mt-3 font-medium">Nothing changed yet</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">When Claude edits files, from the prompt bar or in the chat, each change is logged here with the request, a summary and the files it touched.</p>
          </div>
        ) : (
          groups.map(([d, list]) => (
            <section key={d} className="mt-9">
              <h3 className="sticky top-0 z-10 -mx-2 bg-paper/95 px-2 py-2 text-[12px] font-semibold text-muted-foreground first-letter:uppercase">{d}</h3>
              <ol className="relative mt-1 flex flex-col gap-3 border-l border-border pl-6">
                {list.map((e) => (
                  <li key={e.id} className="relative">
                    <span aria-hidden className={cn("absolute top-5 -left-[29px] size-[9px] rounded-full ring-4 ring-paper", e.inProgress ? "agent-dot bg-[var(--agent)]" : "bg-foreground/35")} />
                    <article className="island px-5 py-4">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <time className="font-mono tabular-nums" dateTime={new Date(e.at).toISOString()}>{time(e.at)}</time>
                        <span className="inline-flex items-center gap-1">
                          {e.kind ? <ClockCounterClockwise size={12} /> : e.mode === "apply" ? <SquaresFour size={12} weight="fill" className="text-scope" /> : e.source === "canvas" ? <Sparkle size={12} weight="fill" className="text-scope" /> : <ChatCircle size={12} />}
                          {e.kind === "undo" ? "Undone in Loupe" : e.kind === "restore" ? "Version restored" : e.mode === "apply" ? "Concept from the canvas" : e.source === "canvas" ? "From the canvas" : "From the chat"}
                        </span>
                        {e.scope && <span className="truncate">· {e.scope}</span>}
                        {e.undone && <span className="rounded-full bg-segment px-1.5 py-px text-[11px]">Undone</span>}
                        {e.inProgress ? <span className="ml-auto text-[var(--agent)]">Claude is still working</span> : e.before && e.after && <span className="ml-auto"><VersionMenu e={e} /></span>}
                      </div>
                      <h4 className="mt-1.5 text-[15px] leading-snug font-medium tracking-[-0.01em]">{e.detail || e.prompt || "Changes made in Claude Code"}</h4>
                      {e.detail && e.prompt && <p className="mt-0.5 text-[13px] text-muted-foreground">For: {e.prompt}</p>}
                      {e.summary && <p className="mt-2 text-[13.5px] leading-[1.55]">{e.summary}</p>}
                      {e.shots && Object.keys(e.shots).length > 0 && <BeforeAfter shots={e.shots} manifest={manifest} />}
                      {!!e.files.length && (
                        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Files changed">
                          {e.files.map((f) => (
                            <li key={f} className="rounded-md bg-segment px-1.5 py-0.5 font-mono text-[11px]" title={f}>{f.split("/").slice(-2).join("/")}</li>
                          ))}
                        </ul>
                      )}
                      {e.before && e.after && !e.inProgress && <ChangeActions e={e} />}
                    </article>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}

        {!!entries.length && (
          <div className="mt-10 flex justify-center">
            {confirmClear ? (
              <div className="flex items-center gap-2 text-[13px]">
                <span className="text-muted-foreground">Clear the whole changelog? This can't be undone.</span>
                <Button size="sm" variant="destructive" onClick={() => { api.clearChangelog(); setConfirmClear(false); }}>Clear</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Keep it</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmClear(true)}><Trash size={14} /> Clear changelog</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** What a page looked like before and after a change: drag the divider to compare */
export function BeforeAfter({ shots, manifest }: { shots: Record<string, ChangeShot>; manifest: Manifest }) {
  const ids = Object.keys(shots).filter((k) => shots[k].after || shots[k].before);
  const [view, setView] = useState(ids[0]);
  const [pos, setPos] = useState(50);
  const s = shots[view] ?? shots[ids[0]];
  if (!s) return null;
  const name = (id: string) => manifest.views.find((v) => v.id === id)?.name ?? id;
  const both = s.before && s.after;
  return (
    <figure className="mt-3">
      {ids.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Pages this change touched">
          {ids.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={id === view} onClick={() => setView(id)} className={cn("rounded-full px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring", id === view ? "bg-segment font-medium dark:bg-white/12" : "text-muted-foreground hover:bg-accent")}>{name(id)}</button>
          ))}
        </div>
      )}
      <div
        className="relative max-h-[420px] overflow-hidden rounded-[10px] bg-muted ring-1 ring-border select-none"
        onPointerDown={(ev) => {
          if (!both) return;
          const el = ev.currentTarget;
          const move = (x: number) => { const r = el.getBoundingClientRect(); setPos(Math.max(0, Math.min(100, ((x - r.left) / r.width) * 100))); };
          move(ev.clientX);
          const onMove = (m: PointerEvent) => move(m.clientX);
          const up = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", up); };
          window.addEventListener("pointermove", onMove);
          window.addEventListener("pointerup", up);
        }}
        style={{ cursor: both ? "ew-resize" : undefined }}
      >
        <img src={`/api/snapshots/${s.after ?? s.before}`} alt={`${name(view)} ${s.after ? "after" : "before"} the change`} className="block w-full" draggable={false} />
        {both && (
          <>
            <img src={`/api/snapshots/${s.before}`} alt={`${name(view)} before the change`} className="absolute inset-0 block w-full" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }} draggable={false} />
            <span aria-hidden className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,.15)]" style={{ left: `${pos}%` }} />
            <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">Before</span>
            <span className="absolute top-2 right-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">After</span>
            <input type="range" min={0} max={100} value={Math.round(pos)} onChange={(ev) => setPos(Number(ev.target.value))} aria-label="Compare before and after" className="sr-only" />
          </>
        )}
        {!both && <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">{s.after ? "After" : "Before"}</span>}
      </div>
    </figure>
  );
}

/** Undo one change, and see its code changes */
function ChangeActions({ e }: { e: ChangelogEntry }) {
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<{ busy?: boolean; conflict?: string[]; error?: string; done?: boolean }>({});
  const showDiff = async () => {
    if (diff !== null) return setDiff(null);
    setLoading(true);
    const r: { diff?: string; error?: string } = await api.history.diff(e.id).catch(() => ({ error: "Couldn't load the changes" }));
    setLoading(false);
    setDiff(r.diff ?? r.error ?? "");
  };
  const undo = async (force = false) => {
    setState({ busy: true });
    const r: { ok: boolean; error?: string; conflict?: string[] } = await api.history.undo(e.id, force).catch(() => ({ ok: false, error: "The canvas server didn't answer" }));
    setState(r.ok ? { done: true } : r.conflict ? { conflict: r.conflict } : { error: r.error ?? "Couldn't undo" });
  };
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" onClick={showDiff} aria-expanded={diff !== null}>
          {loading ? <CircleNotch size={13} className="animate-spin" /> : <Code size={13} />} {diff !== null ? "Hide code changes" : "Code changes"}
        </Button>
        {!e.undone && e.kind !== "undo" && e.kind !== "restore" && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" disabled={state.busy || state.done} onClick={() => undo(false)}>
            {state.busy ? <CircleNotch size={13} className="animate-spin" /> : <ArrowCounterClockwise size={13} />} {state.done ? "Undone" : "Undo this change"}
          </Button>
        )}
        {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      </div>
      {state.conflict && (
        <div role="alert" className="mt-2 flex items-start gap-2 rounded-md bg-[#b7791f]/10 px-3 py-2 text-xs">
          <Warning size={14} className="mt-px shrink-0 text-[#b7791f]" />
          <div className="min-w-0 flex-1">
            <p>{state.conflict.length === 1 ? "This file has" : "These files have"} changed again since: <span className="font-mono">{state.conflict.join(", ")}</span>. Undoing puts {state.conflict.length === 1 ? "it" : "them"} back to before this change, so the later edits to {state.conflict.length === 1 ? "it" : "them"} go too.</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => undo(true)}>Undo anyway</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setState({})}>Keep it</Button>
            </div>
          </div>
        </div>
      )}
      {diff !== null && <DiffView text={diff} />}
    </div>
  );
}

function DiffView({ text }: { text: string }) {
  if (!text.trim()) return <p className="mt-2 text-xs text-muted-foreground">No code changes to show.</p>;
  const lines = text.split("\n").filter((l) => !/^(index |diff --git|new file mode|deleted file mode)/.test(l));
  return (
    <pre className="mt-2 max-h-[380px] overflow-auto rounded-md bg-muted/70 py-2 font-mono text-[11.5px] leading-[1.5]">
      {lines.map((l, i) => (
        <div
          key={i}
          className={cn(
            "px-3 whitespace-pre",
            l.startsWith("+++") || l.startsWith("---") ? "pt-2 font-semibold text-foreground" : l.startsWith("+") ? "bg-[var(--live)]/12 text-foreground" : l.startsWith("-") ? "bg-destructive/10 text-foreground" : l.startsWith("@@") ? "text-muted-foreground" : "text-foreground/75",
          )}
        >
          {l.startsWith("+++ b/") ? l.slice(6) : l.startsWith("--- a/") ? null : l || " "}
        </div>
      ))}
    </pre>
  );
}

/** Put the whole project back to how it was before or after this change */
function VersionMenu({ e }: { e: ChangelogEntry }) {
  const [msg, setMsg] = useState<string | null>(null);
  const restore = async (point: "before" | "after") => {
    setMsg("Restoring…");
    const r = await api.history.restore(e.id, point).catch(() => ({ ok: false, error: "The canvas server didn't answer", files: [] }));
    setMsg(r.ok ? (r.files?.length ? `Restored ${r.files.length} file${r.files.length === 1 ? "" : "s"}` : "Already like that") : r.error ?? "Couldn't restore");
    setTimeout(() => setMsg(null), 3000);
  };
  return (
    <span className="inline-flex items-center gap-1">
      {msg && <span className="text-[11px]">{msg}</span>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" aria-label="Versions"><DotsThree size={16} weight="bold" /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel className="font-normal text-muted-foreground">Put the whole project back to how it was. Loupe saves the current state first, so you can come back.</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => restore("before")}><ClockCounterClockwise size={14} /> Restore to before this change</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => restore("after")}><ClockCounterClockwise size={14} /> Restore to right after it</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}
