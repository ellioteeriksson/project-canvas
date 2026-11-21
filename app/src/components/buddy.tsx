import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, CircleNotch, Copy, Crosshair, Lightbulb, MagnifyingGlass, PencilSimple, Wrench, X } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import { CHECKS, findingsMarkdown, ruleFindings, runAudit, type CheckId, type Finding, type Progress } from "@/lib/audit";
import type { ChatState, Manifest } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { CanvasHandle } from "@/components/canvas/canvas-view";
import { LouFigure } from "@/components/lou";

const NAME = "Lou";
const SIZE = 54;
const CORNER = 20;
const SEV = { error: "bg-[#ff3b30]", warning: "bg-[#ff9f0a]", info: "bg-muted-foreground/60" } as const;

/* ---------- buddy ---------- */
type Run = { progress: Progress | null; findings: Finding[]; rulesId: string | null; rulesState: "idle" | "waiting" | "done" | "skipped"; finishedAt: number | null; checks: CheckId[] };

export function Buddy({ manifest, chat, base, canvas, tab, onShowView, onFix, onCounts, onInspecting }: {
  manifest: Manifest; chat: ChatState; base: string; canvas: React.RefObject<CanvasHandle | null>; tab: string;
  onShowView: (id: string) => void; onFix: (f: Finding) => void;
  onCounts: (c: Record<string, number>) => void; onInspecting: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"home" | "rules">("home");
  const [checks, setChecks] = useState<Set<CheckId>>(() => {
    try { const s = JSON.parse(localStorage.getItem("loupe-buddy-checks") || "null"); if (Array.isArray(s)) return new Set(s); } catch {}
    return new Set(CHECKS.map((c) => c.id));
  });
  const [run, setRun] = useState<Run | null>(null);
  const [unseen, setUnseen] = useState(0);
  const [bubble, setBubble] = useState<string | null>(null);
  const [filter, setFilter] = useState<CheckId | "all">("all");
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState(false);
  const [flyTo, setFlyTo] = useState<{ x: number; y: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bubbleEl = useRef<HTMLDivElement>(null);
  const [wave, setWave] = useState(0);
  const greeted = useRef(false);
  const byId = useMemo(() => new Map(manifest.views.map((v) => [v.id, v])), [manifest.views]);
  const working = !!run && !run.finishedAt;

  useEffect(() => { try { localStorage.setItem("loupe-buddy-checks", JSON.stringify([...checks])); } catch {} }, [checks]);
  useEffect(() => {
    if (!open) return;
    setUnseen(0);
    // Wave hello the first time you open him
    if (!greeted.current) { greeted.current = true; setWave((w) => w + 1); }
  }, [open]);

  // Fly over the view being inspected (on the canvas tab)
  const progress = run?.progress;
  useEffect(() => {
    const id = working && progress?.view ? progress.view.id : null;
    onInspecting(id);
    if (!id || tab !== "canvas") { setFlyTo(null); return; }
    canvas.current?.focus?.(id);
    const t = setTimeout(() => {
      const p = canvas.current?.screenPoint(id);
      if (!p) return setFlyTo(null);
      // Hover over the top right of the frame, holding the loupe over it
      // He hovers inside the frame's top right corner, holding the lens over the page
      const x = Math.min(window.innerWidth - SIZE, Math.max(SIZE, p.x + p.w / 2 - 80));
      const y = Math.min(window.innerHeight - SIZE, Math.max(SIZE + 60, p.y - p.h / 2 + 46));
      setFlyTo({ x: x - (window.innerWidth - CORNER - SIZE / 2), y: y - (window.innerHeight - CORNER - SIZE / 2) });
    }, 480);
    return () => clearTimeout(t);
  }, [working, progress?.view?.id, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Claude's answer to the house rules check
  const rulesPrompt = run?.rulesId ? chat.prompts.find((p) => p.id === run.rulesId) : undefined;
  useEffect(() => {
    if (!run || run.rulesState !== "waiting" || !rulesPrompt) return;
    if (rulesPrompt.status === "findings") {
      const extra = ruleFindings(rulesPrompt.findings ?? [], manifest);
      setRun((r) => r && { ...r, findings: [...r.findings, ...extra], rulesState: "done" });
      if (!open && extra.length) { setUnseen((n) => n + extra.length); say(`Claude checked the house rules: ${extra.length ? `${extra.length} thing${extra.length > 1 ? "s" : ""} to look at` : "all good"}`); }
    } else if (rulesPrompt.status === "failed" || rulesPrompt.status === "cancelled") {
      setRun((r) => r && { ...r, rulesState: "skipped" });
    }
  }, [rulesPrompt?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Counts per view for the red badges on the canvas
  useEffect(() => {
    const c: Record<string, number> = {};
    for (const f of run?.findings ?? []) if (f.severity !== "info" && !sent.has(f.id)) for (const v of f.views) c[v] = (c[v] ?? 0) + 1;
    onCounts(c);
  }, [run?.findings, sent]); // eslint-disable-line react-hooks/exhaustive-deps

  const say = useCallback((text: string) => { setBubble(text); setTimeout(() => setBubble((b) => (b === text ? null : b)), 5000); }, []);

  const start = async (only?: CheckId[]) => {
    const list = only ?? [...checks];
    if (!list.length) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setFilter("all");
    setSent(new Set());
    setRun({ progress: null, findings: [], rulesId: null, rulesState: "idle", finishedAt: null, checks: list });
    // House rules go to Claude in parallel with the page checks
    if (list.includes("rules")) {
      const conn = chat.conns.find((c) => c.status !== "offline");
      const rules = await fetch("/api/rules").then((r) => r.json()).catch(() => ({ text: "" }));
      if (!rules.text?.trim()) setRun((r) => r && { ...r, rulesState: "skipped" });
      else if (!conn) setRun((r) => r && { ...r, rulesState: "skipped" });
      else {
        const r = await fetch("/api/audit/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conn: conn.id, rules: rules.text, views: manifest.views.map((v) => ({ name: v.name, route: v.route, file: v.file })) }) }).then((x) => x.json()).catch(() => ({ ok: false }));
        setRun((s) => s && { ...s, rulesId: r.ok ? r.prompt.id : null, rulesState: r.ok ? "waiting" : "skipped" });
      }
    }
    const res = await runAudit({ manifest, base, checks: new Set(list), signal: ac.signal, onProgress: (p) => setRun((r) => r && { ...r, progress: p }) });
    if (ac.signal.aborted) return;
    setRun((r) => r && { ...r, findings: [...res.findings, ...r.findings], finishedAt: Date.now(), progress: { phase: "done", index: 0, total: 0 } });
    const n = res.findings.filter((f) => f.severity !== "info").length;
    if (!open) setUnseen((u) => u + res.findings.length);
    say(n ? `I found ${n} thing${n > 1 ? "s" : ""} to fix` : res.findings.length ? "Looks good. A few tips" : "Everything looks good");
    if (!n) setWave((w) => w + 1);
    canvas.current?.fitAll();
  };
  const stop = () => { abort.current?.abort(); setRun((r) => r && { ...r, finishedAt: Date.now(), progress: null }); setFlyTo(null); onInspecting(null); };

  const findings = run?.findings ?? [];
  const shown = filter === "all" ? findings : findings.filter((f) => f.check === filter);
  const counts = { error: findings.filter((f) => f.severity === "error").length, warning: findings.filter((f) => f.severity === "warning").length, info: findings.filter((f) => f.severity === "info").length };
  const mood: "calm" | "happy" | "worried" = run?.finishedAt && !working ? (counts.error ? "worried" : "happy") : "calm";
  const pct = progress && progress.total ? Math.round(((progress.index + (progress.phase === "mobile" ? progress.total : 0)) / (progress.total * (run?.checks.includes("mobile") ? 2 : 1))) * 100) : 0;
  const status = !run ? null
    : working ? progress?.phase === "links" ? "Following every link…" : progress?.view ? `${progress.phase === "mobile" ? "Checking on mobile" : "Looking at"} ${progress.view.name} (${progress.index + 1} of ${progress.total})` : "Getting started…"
    : null;

  return (
    <>
      {/* Speech panel */}
      {open && (
        <section aria-label={`${NAME}, your helper`} className="buddy-panel island absolute right-5 z-40 flex max-h-[min(72vh,640px)] w-[400px] max-w-[calc(100%-40px)] flex-col overflow-hidden rounded-[20px]" style={{ bottom: CORNER + SIZE + 14 }}>
          <header className="flex items-center gap-2.5 border-b px-4 py-3">
            {view === "rules" && <Button variant="ghost" size="icon" className="-ml-1.5 size-7" onClick={() => setView("home")} aria-label="Back"><ArrowLeft size={14} /></Button>}
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-semibold">{view === "rules" ? "House rules" : NAME}</h2>
              <p className="text-xs text-muted-foreground">{view === "rules" ? ".canvas/rules.md, shared with your team in git" : "Checks your whole project for you"}</p>
            </div>
            <Button variant="ghost" size="icon" className="-mr-1.5 size-7" onClick={() => setOpen(false)} aria-label="Close"><X size={14} /></Button>
          </header>
          {view === "rules" ? (
            <RulesEditor manifest={manifest} chat={chat} onBack={() => setView("home")} />
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
              {/* What Lou says */}
              <div className="px-4 pt-4">
                <p className="buddy-say text-[14px] leading-snug">
                  {!run ? "Hi! I can look through every page and tell you what's off. What should I check?"
                    : working ? status
                    : findings.length ? `Done. I found ${counts.error ? `${counts.error} error${counts.error > 1 ? "s" : ""}` : ""}${counts.error && counts.warning ? ", " : ""}${counts.warning ? `${counts.warning} warning${counts.warning > 1 ? "s" : ""}` : ""}${(counts.error || counts.warning) && counts.info ? " and " : ""}${counts.info ? `${counts.info} tip${counts.info > 1 ? "s" : ""}` : ""}.`
                    : "Done. Everything I checked looks good."}
                </p>
                {working && <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-segment"><div className="h-full rounded-full bg-[var(--buddy)] transition-[width] duration-500" style={{ width: `${Math.max(4, pct)}%` }} /></div>}
                {run && run.rulesState === "waiting" && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><CircleNotch size={12} className="animate-spin" /> Claude is checking the house rules…</p>}
                {run && run.rulesState === "skipped" && run.checks.includes("rules") && <p className="mt-2 text-xs text-muted-foreground">House rules weren't checked: {chat.conns.some((c) => c.status !== "offline") ? "there are no rules yet." : "no Claude Code chat is open."}</p>}
              </div>

              {!working && (
                <div className="px-4 pt-4">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Checks to run">
                    {CHECKS.map((c) => {
                      const on = checks.has(c.id);
                      return (
                        <button
                          key={c.id} type="button" aria-pressed={on} title={c.blurb}
                          onClick={() => setChecks((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                          className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring", on ? "bg-[var(--buddy)]/15 text-[var(--buddy)]" : "bg-segment text-muted-foreground hover:text-foreground")}
                        >
                          {on && <Check size={11} weight="bold" />}{c.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Button className="bg-[var(--buddy)] hover:bg-[var(--buddy)]/90" onClick={() => start()} disabled={!checks.size}><MagnifyingGlass size={14} weight="bold" /> {run ? "Check again" : "Check the project"}</Button>
                    <Button variant="ghost" size="sm" onClick={() => setView("rules")}><PencilSimple size={13} /> House rules</Button>
                  </div>
                </div>
              )}
              {working && <div className="px-4 pt-3"><Button variant="outline" size="sm" onClick={stop}>Stop</Button></div>}

              {!!findings.length && (
                <div className="mt-4 border-t">
                  <div className="flex items-center gap-1 overflow-x-auto px-3 pt-2.5 pb-1">
                    {(["all", ...CHECKS.map((c) => c.id)] as const).map((k) => {
                      const n = k === "all" ? findings.length : findings.filter((f) => f.check === k).length;
                      if (!n) return null;
                      return (
                        <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k} className={cn("h-7 shrink-0 rounded-full px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", filter === k ? "bg-segment text-foreground" : "text-muted-foreground hover:text-foreground")}>
                          {k === "all" ? "All" : CHECKS.find((c) => c.id === k)!.label} <span className="font-mono tabular-nums opacity-70">{n}</span>
                        </button>
                      );
                    })}
                    <Button variant="ghost" size="icon" className="ml-auto size-7 shrink-0 text-muted-foreground" aria-label="Copy the report as Markdown" onClick={async () => { try { await navigator.clipboard.writeText(findingsMarkdown(manifest.project.name, findings, byId)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </Button>
                  </div>
                  <ul className="flex flex-col px-2 pb-3">
                    {shown.map((f) => (
                      <li key={f.id} className="rounded-xl px-2.5 py-2.5 hover:bg-accent">
                        <div className="flex items-start gap-2.5">
                          <span aria-label={f.severity} className={cn("mt-1.5 size-2 shrink-0 rounded-full", SEV[f.severity])} />
                          <div className="min-w-0 flex-1">
                            <p className="text-[13px] leading-snug font-medium">{f.title}</p>
                            {f.detail && <p className="mt-0.5 line-clamp-3 text-xs leading-[1.45] text-muted-foreground">{f.detail}</p>}
                            <div className="mt-1.5 flex flex-wrap items-center gap-1">
                              {f.views.slice(0, 3).map((id) => (
                                <button key={id} type="button" onClick={() => onShowView(id)} className="inline-flex h-6 items-center gap-1 rounded-md bg-segment px-1.5 text-[11px] font-medium outline-none hover:text-scope focus-visible:ring-2 focus-visible:ring-ring">
                                  <Crosshair size={10} /> {byId.get(id)?.name ?? id}
                                </button>
                              ))}
                              {f.views.length > 3 && <span className="text-[11px] text-muted-foreground">+{f.views.length - 3}</span>}
                              <Button size="sm" variant={sent.has(f.id) ? "ghost" : "outline"} className="ml-auto h-6 rounded-md px-2 text-[11px]" disabled={sent.has(f.id) || !chat.conns.some((c) => c.status !== "offline")} onClick={() => { onFix(f); setSent((s) => new Set(s).add(f.id)); }}>
                                {sent.has(f.id) ? <><Check size={11} /> Sent to Claude</> : <><Wrench size={11} /> Fix</>}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Short remarks when the panel is closed */}
      {!open && (bubble || (working && status)) && (
        <div className="pointer-events-none absolute z-40" style={{ right: CORNER + SIZE - 4, bottom: CORNER + SIZE - 2 }} ref={bubbleEl}>
          <div role="status" className="buddy-bubble island max-w-[240px] rounded-[14px] rounded-br-[4px] px-3 py-2 text-[12.5px] leading-snug whitespace-nowrap">
            {working && status ? status : bubble}
          </div>
        </div>
      )}

      {/* Lou */}
      <LouFigure
        to={flyTo ?? { x: 0, y: 0 }}
        mode={working ? "inspecting" : mood === "worried" ? "concerned" : mood === "happy" ? "happy" : "idle"}
        wave={wave}
        label={`${NAME}, your helper${unseen ? `, ${unseen} new findings` : ""}`}
        expanded={open}
        onClick={() => { setOpen((o) => !o); setView("home"); }}
        bubbleRef={bubbleEl}
        right={CORNER}
        bottom={CORNER}
      >
        {unseen > 0 && (
          <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#ff3b30] px-1.5 text-[11px] font-semibold text-white tabular-nums shadow-[0_0_0_2px_var(--paper)]">{unseen > 99 ? "99+" : unseen}</span>
        )}
      </LouFigure>
    </>
  );
}

/* ---------- house rules ---------- */
function RulesEditor({ manifest, chat, onBack }: { manifest: Manifest; chat: ChatState; onBack: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [asked, setAsked] = useState(false);
  useEffect(() => { fetch("/api/rules").then((r) => r.json()).then((r) => setText(r.text || "")).catch(() => setText("")); }, []);
  const conn = chat.conns.find((c) => c.status !== "offline");
  const save = async () => { await fetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) }); setSaved(true); setTimeout(() => setSaved(false), 1500); };
  const suggest = async () => {
    await api.select(null);
    await api.prompt(
      `Write house rules for this ${manifest.mode === "flow" ? "product" : "website"} in .canvas/rules.md: 6 to 12 short, concrete rules a reviewer can check page by page (layout and templates for each kind of page, header and footer, typography, colors and tokens, components to use, spacing, copy and tone, accessibility). Base them on how the project is already built. Keep any rules that are already in the file. One rule per line, as a Markdown list. Don't change anything else.`,
      conn?.id ?? null,
      "direct",
    );
    setAsked(true);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <p className="text-[13px] leading-snug text-muted-foreground">Write the rules your pages should follow, one per line. When you run a check with House rules on, Claude reads them and reports what breaks them.</p>
      <textarea
        value={text ?? ""}
        onChange={(e) => setText(e.target.value)}
        disabled={text === null}
        rows={10}
        aria-label="House rules"
        placeholder={"- Every case page uses the same template: hero, facts, gallery, next case\n- Headlines are set in the display font, never bold body text\n- Buttons come from components/ui/button, with no one-off styles\n- Only colors from the design tokens"}
        className="min-h-48 flex-1 resize-none rounded-[12px] bg-segment px-3.5 py-3 font-mono text-[12px] leading-[1.6] outline-none placeholder:text-muted-foreground/80 focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={save} disabled={text === null}>{saved ? <><Check size={14} /> Saved</> : "Save rules"}</Button>
        <Button variant="ghost" size="sm" onClick={suggest} disabled={!conn || asked}><Lightbulb size={14} /> {asked ? "Claude is writing them" : "Ask Claude to suggest rules"}</Button>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onBack}>Done</Button>
      </div>
      {asked && <p className="text-xs text-muted-foreground">Open the rules again in a minute to see Claude's suggestions.</p>}
    </div>
  );
}
