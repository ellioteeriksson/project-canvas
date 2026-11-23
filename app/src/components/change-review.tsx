import { useState } from "react";
import { ArrowCounterClockwise, Check, CheckCircle, CircleNotch, Columns, Images, Warning, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { BeforeAfter } from "@/components/changelog-view";
import { api } from "@/lib/api";
import type { CanvasPrompt, ChangelogEntry, CheckIssue, Manifest } from "@/lib/types";

/**
 * A finished change, right where you made it: keep it, undo it, or compare before and after.
 */
export function ChangeReview({ entry, manifest, title, note, onSettle, onFix, onCompare }: {
  entry: ChangelogEntry; manifest: Manifest; title?: string; note?: string | null; onSettle: (how: "kept" | "undone") => void;
  onFix?: (p: CanvasPrompt) => void; onCompare?: () => void;
}) {
  const [state, setState] = useState<{ busy?: boolean; conflict?: string[]; error?: string }>({});
  const [compare, setCompare] = useState(false);
  const shots = entry.shots && Object.values(entry.shots).some((s) => s.before && s.after) ? entry.shots : null;
  const canUndo = !!(entry.before && entry.after) && !entry.undone;
  const undo = async (force = false) => {
    setState({ busy: true });
    const r: { ok: boolean; error?: string; conflict?: string[] } = await api.history.undo(entry.id, force).catch(() => ({ ok: false, error: "The canvas server didn't answer" }));
    if (r.ok) { onSettle("undone"); return; }
    setState(r.conflict ? { conflict: r.conflict } : { error: r.error ?? "Couldn't undo" });
  };
  const files = entry.files ?? [];
  return (
    <div className="flex min-w-0 flex-col gap-2 text-xs" role="group" aria-label="Review this change">
      <div className="flex min-w-0 items-start gap-2">
        <CheckCircle size={15} weight="fill" className="mt-px shrink-0 text-[var(--live)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{title ?? entry.prompt ?? "Change"}</p>
          <p className="line-clamp-2 text-muted-foreground">{note || entry.summary || (files.length ? `Changed ${files.length === 1 ? files[0] : `${files.length} files`}.` : "Done.")}</p>
        </div>
      </div>
      {state.conflict ? (
        <div role="alert" className="flex items-start gap-2 rounded-md bg-[#b7791f]/10 px-2.5 py-2">
          <Warning size={14} className="mt-px shrink-0 text-[#b7791f]" />
          <div className="min-w-0 flex-1">
            <p>{state.conflict.length === 1 ? "This file has" : "These files have"} changed again since: <span className="font-mono">{state.conflict.join(", ")}</span>. Undoing drops those later edits too.</p>
            <div className="mt-1.5 flex gap-1.5">
              <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => undo(true)}>Undo anyway</Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setState({})}>Cancel</Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" className="h-7 gap-1.5 rounded-full px-3 text-xs" onClick={() => onSettle("kept")}><Check size={12} weight="bold" /> Keep</Button>
          {canUndo && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5 rounded-full px-3 text-xs" disabled={state.busy} onClick={() => undo(false)}>
              {state.busy ? <CircleNotch size={12} className="animate-spin" /> : <ArrowCounterClockwise size={12} />} Undo
            </Button>
          )}
          {shots && (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground" aria-expanded={compare} onClick={() => setCompare((c) => !c)}>
              <Images size={12} /> {compare ? "Hide before/after" : "Before/after"}
            </Button>
          )}
          {onCompare && (
            <Button size="sm" variant="ghost" className="h-7 gap-1.5 rounded-full px-2.5 text-xs text-muted-foreground" onClick={onCompare}>
              <Columns size={12} /> Compare with original
            </Button>
          )}
          {state.error && <span className="text-destructive">{state.error}</span>}
        </div>
      )}
      {compare && shots && <div className="-mt-1 max-h-[300px] overflow-auto"><BeforeAfter shots={shots} manifest={manifest} /></div>}
      <CheckResult entry={entry} manifest={manifest} onFix={onFix} />
    </div>
  );
}

/** What Loupe's check after the change found: new problems first, with a way to have them fixed */
export function CheckResult({ entry, manifest, onFix }: { entry: ChangelogEntry; manifest: Manifest; onFix?: (p: CanvasPrompt) => void }) {
  const [sent, setSent] = useState(false);
  if (!entry.check) {
    const fresh = Date.now() - (entry.endAt ?? entry.at) < 90_000 && entry.files?.length;
    return fresh ? <p className="flex items-center gap-1.5 text-muted-foreground"><CircleNotch size={11} className="animate-spin" /> Checking the page on desktop and mobile…</p> : null;
  }
  const issues = entry.check.issues.filter((i) => i.new !== false);
  if (!issues.length) return <p className="flex items-center gap-1.5 text-muted-foreground"><Check size={11} weight="bold" className="text-[var(--live)]" /> Checked on desktop and mobile: nothing broke</p>;
  const name = (id: string) => manifest.views.find((v) => v.id === id)?.name ?? id;
  const fix = async () => {
    const byView = new Map<string, CheckIssue[]>();
    issues.forEach((i) => byView.set(i.viewId, [...(byView.get(i.viewId) ?? []), i]));
    for (const [viewId, list] of byView) {
      const text = `Fix what broke on ${name(viewId)}:\n${list.map((i) => `- ${i.message} (${i.device})${i.at?.length ? `: ${i.at.map((a) => [a.selector, a.text && `“${a.text}”`, a.ratio && `${a.ratio}:1`].filter(Boolean).join(" ")).join("; ")}` : ""}`).join("\n")}`;
      const r = await api.prompt(text, "auto", "direct", { kind: "view", id: viewId }).catch(() => null);
      if (r?.ok && r.prompt) onFix?.(r.prompt);
    }
    setSent(true);
  };
  return (
    <div className="rounded-md bg-[#b7791f]/10 px-2.5 py-2" role="alert">
      <p className="flex items-center gap-1.5 font-medium"><Warning size={13} className="text-[#b7791f]" /> {issues.some((i) => i.new) ? "This change may have broken something" : "Loupe found something to look at"}</p>
      <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
        {issues.slice(0, 4).map((i, n) => <li key={n}>{i.message} · {i.device === "mobile" ? "mobile" : "desktop"}{Object.keys(entry.shots ?? {}).length > 1 ? ` · ${name(i.viewId)}` : ""}</li>)}
      </ul>
      <Button size="sm" variant="outline" className="mt-1.5 h-7 rounded-full text-xs" disabled={sent} onClick={fix}>{sent ? "Sent to Claude" : "Ask Claude to fix it"}</Button>
    </div>
  );
}

/** A small note that dismisses itself or with × */
export function Note({ children, onClose, tone = "plain" }: { children: React.ReactNode; onClose: () => void; tone?: "plain" | "warn" }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {tone === "warn" ? <Warning size={14} className="mt-px shrink-0 text-[#b7791f]" /> : null}
      <div className="min-w-0 flex-1">{children}</div>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:text-foreground"><X size={11} /></button>
    </div>
  );
}
