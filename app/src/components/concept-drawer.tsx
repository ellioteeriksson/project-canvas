import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowsClockwise, CaretLeft, CaretRight, Check, CircleNotch, Crosshair, MagnifyingGlassPlus, Sparkle, SquaresFour, Warning, X } from "@phosphor-icons/react";
import { api, frameUrl } from "@/lib/api";
import type { Agent, CanvasPrompt, ChatState, Concept } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/* ---------- preview shots: each concept rendered on the real page, cached for the session ---------- */
type Shot = { dataUrl?: string; w?: number; h?: number; error?: string; missing?: string[] };
const shots = new Map<string, Shot>();
const listeners = new Set<() => void>();
let version = 0;
function setShot(key: string, s: Shot) { shots.set(key, s); version++; listeners.forEach((l) => l()); }
function useShots() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version);
}
const shotKey = (p: CanvasPrompt, i: number) => `${p.id}:${i}`;
const host = (w: Window | null | undefined, msg: Record<string, unknown>) => w?.postMessage({ source: "project-canvas-host", ...msg }, "*");

/** Loads the page off to the side, swaps in one concept and captures it. */
function ShotFrame({ p, index, concept, base, onDone }: { p: CanvasPrompt; index: number; concept: Concept; base: string; onDone: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const key = shotKey(p, index);
  const info = p.info!;
  const width = info.device === "mobile" ? 390 : 1440;
  useEffect(() => {
    let sent = false;
    const onMsg = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return;
      const d = e.data;
      if (!d || d.source !== "project-canvas") return;
      if (d.type === "ready" && !sent) {
        sent = true;
        host(ref.current?.contentWindow, {
          type: "concept", id: key, css: concept.css, replace: concept.replace,
          scope: { section: info.section, selectors: info.selectors }, capture: info.section != null || info.selectors.length ? "scope" : "page", maxW: 960,
        });
      }
      if (d.type === "concept-shot" && d.id === key) { setShot(key, { dataUrl: d.dataUrl, w: d.w, h: d.h, missing: d.missing }); onDone(); }
      if (d.type === "concept-error" && d.id === key) { setShot(key, { error: d.message }); onDone(); }
    };
    window.addEventListener("message", onMsg);
    const t = setTimeout(() => { if (!shots.get(key)) { setShot(key, { error: "The page took too long to load" }); onDone(); } }, 45_000);
    return () => { window.removeEventListener("message", onMsg); clearTimeout(t); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <iframe
      ref={ref}
      title={`Preview of concept ${index + 1}`}
      src={frameUrl(base, info.url)}
      aria-hidden
      tabIndex={-1}
      // Kept inside the window (browsers pause frames that are off screen), invisible and inert
      style={{ position: "fixed", left: 0, top: 0, width, height: 900, opacity: 0.001, pointerEvents: "none", zIndex: -1, border: 0, transform: "scale(0.05)", transformOrigin: "0 0" }}
    />
  );
}

function ShotQueue({ p, base }: { p: CanvasPrompt; base: string }) {
  useShots();
  const [running, setRunning] = useState<number[]>([]);
  const todo = (p.concepts ?? []).map((c, i) => (c ? i : -1)).filter((i) => i >= 0 && !shots.get(shotKey(p, i)));
  useEffect(() => {
    // Two at a time keeps the dev server and the browser responsive
    if (running.length >= 2) return;
    const next = todo.find((i) => !running.includes(i));
    if (next !== undefined) setRunning((r) => [...r, next]);
  }, [todo.join(","), running.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!p.info) return null;
  return (
    <>
      {running.map((i) => (
        <ShotFrame key={`${p.id}-${i}`} p={p} index={i} concept={p.concepts![i]!} base={base} onDone={() => setRunning((r) => r.filter((x) => x !== i))} />
      ))}
    </>
  );
}

/* ---------- drawer ---------- */
export function ConceptDrawer({ id, chat, agents, base, onOpen, onClose, collapsed, setCollapsed }: { id: string; chat: ChatState; agents: Agent[]; base: string; onOpen: (id: string) => void; onClose: () => void; collapsed: boolean; setCollapsed: (c: boolean) => void }) {
  useShots();
  const p = chat.prompts.find((x) => x.id === id);
  const applied = p?.applied ? chat.prompts.find((x) => x.id === p.applied) : undefined;
  const conn = chat.conns.find((c) => c.id === p?.conn);
  const agent = conn?.session ? agents.filter((a) => a.session === conn.session).sort((a, b) => b.last - a.last)[0] : undefined;
  const [comments, setComments] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const round = useMemo(() => { let n = 1, cur = p; while (cur?.parent) { const par = chat.prompts.find((x) => x.id === cur!.parent); if (!par || par.mode !== "concepts") break; n++; cur = par; } return n; }, [p, chat.prompts]);

  useEffect(() => {
    // Esc tucks the drawer away instead of closing it
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && zoom === null && !(e.target as HTMLElement).closest("textarea, input")) setCollapsed(true); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);
  // A new request opens the drawer again
  useEffect(() => setCollapsed(false), [id]);

  if (!p) return null;
  // Fast concepts arrive one at a time: show each as soon as it's ready
  const sketching = p.status === "sketching";
  const ready = (p.status === "concepts" || (sketching && p.concepts?.some(Boolean))) && p.concepts?.length;
  const anyChat = chat.conns.some((c) => c.status !== "offline");
  const chosen = p.chosen?.index;
  const choose = async (i: number) => {
    setBusy(true); setError(null);
    const r = await api.chooseConcept(p.id, i, comments[i] ?? "").catch(() => ({ ok: false, error: "The canvas server didn't answer" }));
    setBusy(false);
    if (!r.ok) setError(r.error ?? "Couldn't send your choice");
  };
  const again = async () => {
    setBusy(true); setError(null);
    const r = await api.conceptsAgain(p.id, feedback).catch(() => ({ ok: false, error: "The canvas server didn't answer", prompt: undefined }));
    setBusy(false);
    if (!r.ok || !r.prompt) return setError(r.error ?? "Couldn't ask for new concepts");
    setFeedback("");
    onOpen(r.prompt.id);
  };
  const working = agent ? `${({ thinking: "Thinking", reading: "Reading", editing: "Editing", running: "Running" } as const)[agent.phase]} ${agent.file?.split("/").pop() ?? ""}`.trim() : null;

  if (collapsed) {
    const n = p.concepts?.filter(Boolean).length ?? 0;
    return (
      <>
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          aria-label="Show design concepts"
          className="drawer-in island absolute top-[76px] right-3 z-30 flex w-11 flex-col items-center gap-2 rounded-[14px] py-3 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CaretLeft size={14} className="text-muted-foreground" />
          {ready ? <SquaresFour size={18} weight="fill" className="text-scope" /> : <Sparkle size={18} weight="fill" className="agent-dot text-[var(--agent)]" />}
          {ready && <span className="font-mono text-[11px] tabular-nums">{n}</span>}
          <span className="text-[11px] font-medium text-muted-foreground [writing-mode:vertical-rl]">Concepts</span>
        </button>
        {ready && <ShotQueue p={p} base={base} />}
      </>
    );
  }

  return (
    <aside
      aria-label="Design concepts"
      className="drawer-in island absolute top-3 right-3 bottom-3 z-30 flex w-[min(860px,calc(100%-24px))] flex-col overflow-hidden rounded-[20px]"
    >
      <header className="flex items-start gap-3 border-b px-6 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">Concepts{round > 1 ? `, round ${round}` : ""}</p>
          <h2 className="mt-1 line-clamp-2 text-[17px] leading-snug font-semibold tracking-[-0.01em]">{p.text}</h2>
          <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-scope/12 px-1.5 py-0.5 text-xs font-medium text-scope">
            <Crosshair size={12} weight="bold" /> {p.scope}
          </span>
        </div>
        <div className="-mr-2 flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="size-8" onClick={() => setCollapsed(true)} aria-label="Collapse concepts (Esc)"><CaretRight size={16} /></Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Close concepts"><X size={16} /></Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        {applied && <Applied p={applied} title={chosen !== undefined ? p.concepts?.[chosen]?.title : undefined} working={working} />}
        {!ready ? (
          <div>
            <p className="mb-4 flex items-center gap-2 text-[13px] text-muted-foreground" aria-live="polite">
              {p.status === "failed" || p.status === "cancelled" ? (
                <><Warning size={14} /> {p.note ?? "Claude didn't make concepts for this request"}</>
              ) : (
                <><Sparkle size={14} weight="fill" className="agent-dot text-[var(--agent)]" /> {sketching ? (p.sketch ? "Sketching 4 concepts at once" : "Reading the page") : p.status === "queued" ? (conn?.status === "busy" ? "Waiting for Claude to finish what it's doing" : "Waiting for the chat to pick this up") : working ?? "Claude is sketching 4 concepts"}</>
              )}
            </p>
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {[0, 1, 2, 3].map((i) => <div key={i} className="aspect-[4/3] animate-pulse rounded-[14px] bg-segment" style={{ animationDelay: `${i * 120}ms` }} />)}
            </div>
          </div>
        ) : (
          <ol className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {p.concepts!.map((c, i) => {
              if (!c)
                return p.slots?.[i] === "failed" ? null : (
                  <li key={i} className="flex flex-col overflow-hidden rounded-[14px] bg-card ring-1 ring-black/[0.06] dark:bg-secondary dark:ring-white/10" aria-label={`Concept ${i + 1}, still sketching`}>
                    <div className="aspect-[4/3] animate-pulse bg-segment" />
                    <p className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><CircleNotch size={13} className="animate-spin" /> Sketching concept {i + 1}</p>
                  </li>
                );
              const shot = shots.get(shotKey(p, i));
              const isChosen = chosen === i;
              return (
                <li key={i} className={cn("flex flex-col overflow-hidden rounded-[14px] bg-card shadow-soft-sm ring-1 ring-black/[0.06] transition-opacity dark:bg-secondary dark:ring-white/10", chosen !== undefined && !isChosen && "opacity-45", isChosen && "ring-2 ring-scope dark:ring-scope")}>
                  <div className="group relative bg-muted">
                    {shot?.dataUrl ? (
                      <>
                        <div tabIndex={0} aria-label={`Preview of ${c.title}, scrollable`} className="max-h-80 min-h-36 overflow-y-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
                          <img src={shot.dataUrl} alt={`Preview of ${c.title}`} className="block w-full" />
                        </div>
                        <button
                          type="button"
                          onClick={() => setZoom(i)}
                          aria-label={`Enlarge concept ${i + 1}`}
                          className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-background/90 text-foreground opacity-0 shadow-sm transition-opacity outline-none group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <MagnifyingGlassPlus size={14} />
                        </button>
                      </>
                    ) : shot?.error ? (
                      <span className="flex h-36 items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground"><Warning size={14} className="shrink-0" /> No preview: {shot.error}</span>
                    ) : (
                      <span className="flex h-36 items-center justify-center gap-2 text-xs text-muted-foreground"><CircleNotch size={14} className="animate-spin" /> Rendering on the page</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2.5 p-4">
                    <div>
                      <h3 className="text-[14px] font-semibold tracking-[-0.005em]"><span className="mr-1.5 text-muted-foreground tabular-nums">{i + 1}</span>{c.title}</h3>
                      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">{c.summary}</p>
                      {!!shot?.missing?.length && <p className="mt-1 text-xs text-muted-foreground">Part of it couldn't be previewed ({shot.missing.join(", ")}).</p>}
                    </div>
                    {chosen === undefined && (
                      <>
                        <textarea
                          rows={2}
                          value={comments[i] ?? ""}
                          onChange={(e) => setComments((m) => ({ ...m, [i]: e.target.value }))}
                          placeholder="Comment (optional), like “tighter spacing”"
                          aria-label={`Comment on concept ${i + 1}`}
                          className="mt-auto w-full resize-none rounded-[9px] border-0 bg-segment px-3 py-2 text-[13px] leading-5 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
                        />
                        <Button size="sm" className="self-start" disabled={busy || !anyChat} title={!anyChat ? "Start Claude to build a concept" : undefined} onClick={() => choose(i)}>
                          <Check size={14} weight="bold" /> Use this
                        </Button>
                      </>
                    )}
                    {isChosen && p.chosen?.comment && <p className="mt-auto rounded-lg bg-muted px-3 py-2 text-[13px]">“{p.chosen.comment}”</p>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {error && <p className="mt-4 text-[13px] text-destructive">{error}</p>}
      </div>

      {ready && !sketching && chosen === undefined && (
        <footer className="flex items-end gap-2 border-t px-6 py-4">
          <textarea
            rows={1}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); again(); } }}
            placeholder="None of these? Say what to change and get 4 new ones"
            aria-label="Feedback for a new round of concepts"
            className="min-h-9 flex-1 resize-none rounded-[9px] border-0 bg-segment px-3 py-2 text-[13px] leading-5 outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          />
          <Button variant="outline" disabled={busy || sketching} onClick={again}><ArrowsClockwise size={14} /> 4 new concepts</Button>
        </footer>
      )}

      {ready && <ShotQueue p={p} base={base} />}

      <Dialog open={zoom !== null} onOpenChange={(o) => !o && setZoom(null)}>
        <DialogContent className="max-h-[90vh] w-[min(1200px,95vw)] max-w-none overflow-y-auto p-0 sm:max-w-none">
          <DialogTitle className="sr-only">Concept {zoom !== null ? zoom + 1 : ""}</DialogTitle>
          {zoom !== null && shots.get(shotKey(p, zoom))?.dataUrl && <img src={shots.get(shotKey(p, zoom))!.dataUrl} alt={p.concepts?.[zoom]?.title} className="block w-full" />}
        </DialogContent>
      </Dialog>
    </aside>
  );
}

function Applied({ p, title, working }: { p: CanvasPrompt; title?: string; working: string | null }) {
  const done = p.status === "done";
  return (
    <div role="status" className={cn("mb-5 flex items-start gap-2.5 rounded-xl border px-4 py-3", done ? "border-[var(--live)]/40" : "border-[var(--agent)]/40")}>
      {done ? <Check size={16} weight="bold" className="mt-0.5 shrink-0 text-[var(--live)]" /> : <Sparkle size={16} weight="fill" className="agent-dot mt-0.5 shrink-0 text-[var(--agent)]" />}
      <div className="min-w-0 text-[13px]">
        <p className="font-medium">{done ? `Built “${title}”` : p.status === "failed" ? `Couldn't build “${title}”` : `Building “${title}”`}</p>
        <p className="text-muted-foreground">{done ? p.reply || "Done" : p.status === "failed" ? p.note : working ?? (p.status === "queued" ? "Waiting for the chat" : "Claude is on it")}</p>
      </div>
    </div>
  );
}
