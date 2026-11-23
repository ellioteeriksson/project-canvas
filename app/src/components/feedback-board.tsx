import { useMemo, useState } from "react";
import { ArrowCounterClockwise, Check, CheckCircle, CircleNotch, Crosshair, PaperPlaneTilt, Trash } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { CanvasComment, ChatState, Manifest, SnapshotIndex } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { liveConns, resolveTarget } from "@/components/prompt-bar";

type Status = CanvasComment["status"];
const COLUMNS: { id: Status; title: string; empty: string; tone: string }[] = [
  { id: "open", title: "Open", empty: "New comments land here. Press C on the canvas to pin one.", tone: "bg-scope" },
  { id: "sent", title: "With Claude", empty: "Drag a card here, or use Send, to hand it to Claude.", tone: "bg-[var(--agent)]" },
  { id: "review", title: "To review", empty: "When Claude answers, the card waits here for you to check.", tone: "bg-[#b7791f]" },
  { id: "resolved", title: "Done", empty: "Checked and done.", tone: "bg-muted-foreground/60" },
];

/** Comments as a board, like a task list: open, with Claude, to review, done. */
export function FeedbackBoard({ manifest, comments, chat, snapshots, target, onShow }: {
  manifest: Manifest; comments: CanvasComment[]; chat: ChatState; snapshots: SnapshotIndex; target: string | null; onShow: (c: CanvasComment) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);
  const [page, setPage] = useState<string>("all");
  const to = resolveTarget(liveConns(chat), target);
  const numberOf = useMemo(() => new Map(comments.map((c, i) => [c.id, i + 1])), [comments]);
  const shown = page === "all" ? comments : comments.filter((c) => c.viewId === page);
  const pages = useMemo(() => [...new Set(comments.map((c) => c.viewId))].map((id) => ({ id, name: comments.find((c) => c.viewId === id)?.viewName || id })), [comments]);

  const send = async (ids: string[]) => {
    if (!ids.length) return;
    setBusy(true); setErr(null);
    const r = await api.comments.send(ids, to.id).catch(() => ({ ok: false, error: "The canvas server didn't answer" }));
    setBusy(false);
    if (!r.ok) setErr(r.error ?? "Couldn't send to Claude");
    else setPicked(new Set());
  };
  const move = (c: CanvasComment, status: Status) => {
    if (c.status === status) return;
    if (status === "sent") return send([c.id]);
    api.comments.update({ id: c.id, status: status as "open" | "review" | "resolved" });
  };
  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); on ? n.add(id) : n.delete(id); return n; });

  return (
    <div className="flex h-full flex-col px-6 pb-[150px]">
      <div className="flex shrink-0 items-center gap-3 pt-2 pb-4">
        <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Feedback</h2>
        <select value={page} onChange={(e) => setPage(e.target.value)} aria-label="Show comments on" className="h-8 rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <option value="all">All pages</option>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <span className="flex-1" />
        {err && <span className="text-xs text-destructive">{err}</span>}
        {picked.size > 0 && (
          <Button size="sm" disabled={busy || !to.id} onClick={() => send([...picked])}>
            {busy ? <CircleNotch size={14} className="animate-spin" /> : <PaperPlaneTilt size={14} />} Send {picked.size} to Claude
          </Button>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-4 gap-4">
        {COLUMNS.map((col) => {
          const cards = shown.filter((c) => c.status === col.id).sort((a, b) => (b.answeredAt ?? b.at) - (a.answeredAt ?? a.at));
          return (
            <section
              key={col.id}
              aria-label={col.title}
              onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); const c = comments.find((x) => x.id === e.dataTransfer.getData("text/plain")); if (c) move(c, col.id); }}
              className={cn("flex min-h-0 flex-col rounded-[14px] bg-segment/60 p-2 transition-colors dark:bg-white/[0.04]", over === col.id && "bg-scope/10 ring-2 ring-scope/40")}
            >
              <h3 className="flex items-center gap-2 px-2 pt-1 pb-2 text-[13px] font-semibold">
                <span className={cn("size-2 rounded-full", col.tone)} /> {col.title}
                <span className="font-normal text-muted-foreground tabular-nums">{cards.length}</span>
                {col.id === "open" && cards.length > 1 && (
                  <Button variant="ghost" size="sm" className="ml-auto h-6 px-2 text-xs" disabled={busy || !to.id} onClick={() => send(cards.map((c) => c.id))}>Send all</Button>
                )}
              </h3>
              <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                {!cards.length && <li className="px-2 py-6 text-center text-xs text-muted-foreground">{col.empty}</li>}
                {cards.map((c) => (
                  <li
                    key={c.id}
                    draggable={c.status !== "sent"}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                    className="group/card overflow-hidden rounded-[10px] bg-card shadow-soft-sm ring-1 ring-black/[0.06] dark:bg-secondary dark:ring-white/10"
                  >
                    <PinCrop c={c} manifest={manifest} snapshots={snapshots} />
                    <div className="flex flex-col gap-1.5 p-3">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {c.status === "open" && <input type="checkbox" aria-label="Pick to send" className="accent-[var(--scope)]" checked={picked.has(c.id)} onChange={(e) => toggle(c.id, e.target.checked)} />}
                        <span className={cn("grid size-[18px] place-items-center rounded-full rounded-bl-[3px] text-[10px] font-semibold text-white", col.tone)}>{numberOf.get(c.id)}</span>
                        <span className="truncate">{c.viewName}{c.section?.name ? ` · ${c.section.name}` : ""}</span>
                        {c.device === "mobile" && <span className="shrink-0">· mobile</span>}
                      </div>
                      <p className="text-[13px] leading-snug whitespace-pre-wrap">{c.text}</p>
                      {c.status === "sent" && <p className="flex items-center gap-1.5 text-xs text-[var(--agent)]"><CircleNotch size={12} className="animate-spin" /> Claude is on it</p>}
                      {c.reply && c.status !== "sent" && <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground"><span className="font-medium text-foreground">Claude: </span>{c.reply}</p>}
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {c.status === "open" && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy || !to.id} onClick={() => send([c.id])}><PaperPlaneTilt size={12} /> Send to Claude</Button>}
                        {c.status === "review" && <Button size="sm" className="h-7 px-2 text-xs" onClick={() => move(c, "resolved")}><Check size={12} weight="bold" /> Looks good</Button>}
                        {c.status === "review" && <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => move(c, "open")}><ArrowCounterClockwise size={12} /> Not yet</Button>}
                        {c.status === "resolved" && <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => move(c, "open")}><ArrowCounterClockwise size={12} /> Reopen</Button>}
                        <span className="flex-1" />
                        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={() => onShow(c)} aria-label="Show on the canvas" title="Show on the canvas"><Crosshair size={13} /></Button>
                        {c.status === "open" && <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" onClick={() => move(c, "resolved")} aria-label="Mark done" title="Mark done"><CheckCircle size={13} /></Button>}
                        <Button size="icon" variant="ghost" className="size-7 text-muted-foreground opacity-0 group-hover/card:opacity-100 focus-visible:opacity-100" onClick={() => api.comments.remove(c.id)} aria-label="Delete comment" title="Delete"><Trash size={13} /></Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** The spot the comment is pinned on, cut from the page's snapshot */
function PinCrop({ c, manifest, snapshots }: { c: CanvasComment; manifest: Manifest; snapshots: SnapshotIndex }) {
  const snap = snapshots[`${c.viewId}|${c.device}|live`];
  if (!snap?.file || !snap.w) return null;
  const W = 280, H = 120; // card crop, in px
  const pageW = snap.w, s = W / Math.min(pageW, 900); // show ~900px of page width around the pin
  const imgW = pageW * s, imgH = (snap.h ?? 2000) * s;
  const cx = (c.x / 100) * imgW, cy = c.y * s;
  const left = Math.min(0, Math.max(W - imgW, W / 2 - cx)), top = Math.min(0, Math.max(H - imgH, H / 2 - cy));
  return (
    <div className="relative h-[120px] overflow-hidden bg-muted" aria-hidden>
      <img src={`/api/snapshots/${snap.file}`} alt="" className="absolute max-w-none" style={{ width: imgW, height: imgH, left, top }} draggable={false} />
      <span className="absolute grid size-5 -translate-y-full place-items-center rounded-full rounded-bl-[3px] bg-scope ring-2 ring-white" style={{ left: cx + left, top: cy + top }} />
    </div>
  );
}
