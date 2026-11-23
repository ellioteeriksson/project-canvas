import { useEffect, useRef, useState } from "react";
import { CircleNotch, PaperPlaneTilt } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { PageSection } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCanvas } from "./context";

// Pins and the draft box keep a readable size at any zoom, like the frame titles
const PIN_SCALE = "scale(min(var(--title-scale, 1), 3))";

/** Comments on one page: the click layer in comment mode, the pins, and the box for a new comment. */
export function CommentLayer({ viewId, viewName, pageH, scale, sections, interactive }: { viewId: string; viewName: string; pageH: number; scale: number; sections: PageSection[]; interactive: boolean }) {
  const c = useCanvas();
  const pins = c.comments.filter((x) => x.viewId === viewId && x.y <= pageH + 1);
  const draft = c.draft?.viewId === viewId ? c.draft : null;
  const numberOf = (id: string) => c.comments.findIndex((x) => x.id === id) + 1;

  return (
    <>
      {c.commenting && !interactive && (
        <div
          className="nodrag absolute inset-0 z-[4]"
          style={{ cursor: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M3 21V12a9 9 0 1 1 9 9z' fill='%230071e3' stroke='white' stroke-width='1.5'/%3E%3C/svg%3E\") 3 21, crosshair" }}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
            const y = Math.max(0, ((e.clientY - r.top) / r.height) * pageH);
            const i = sections.findIndex((s) => y >= s.top && y < s.top + s.height);
            c.setDraft({ viewId, x, y, section: i >= 0 ? { index: i, name: sections[i].name } : null });
          }}
        />
      )}
      {pins.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={(e) => { e.stopPropagation(); c.showComment(p); }}
          aria-label={`Comment ${numberOf(p.id)}: ${p.text}`}
          title={p.text}
          className="nodrag absolute z-[5] origin-bottom-left outline-none"
          style={{ left: `${p.x}%`, top: Math.round(p.y * scale), transform: `translateY(-100%) ${PIN_SCALE}` }}
        >
          <span
            className={cn(
              "grid h-[26px] min-w-[26px] place-items-center rounded-full rounded-bl-[4px] px-1.5 text-[12px] font-semibold text-white shadow-[0_2px_8px_rgba(0,0,0,.25)] ring-2 ring-white transition-transform hover:scale-110",
              p.status === "sent" ? "bg-[var(--agent)]" : p.status === "review" ? "bg-[#b7791f]" : "bg-scope",
              c.activeComment === p.id && "scale-125",
            )}
          >
            {p.status === "sent" ? <CircleNotch size={12} weight="bold" className="animate-spin" /> : numberOf(p.id)}
          </span>
        </button>
      ))}
      {draft && <DraftBox viewId={viewId} viewName={viewName} draft={draft} scale={scale} />}
    </>
  );
}

function DraftBox({ viewId, viewName, draft, scale }: { viewId: string; viewName: string; draft: NonNullable<ReturnType<typeof useCanvas>["draft"]>; scale: number }) {
  const c = useCanvas();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "save" | "send">(null);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 30); }, [draft.x, draft.y]);
  const save = async (send: boolean) => {
    const t = text.trim();
    if (!t) return;
    setBusy(send ? "send" : "save"); setErr(null);
    const r = await api.comments.add({ viewId, viewName, device: c.device, x: draft.x, y: draft.y, section: draft.section, text: t }).catch(() => ({ ok: false, error: "The canvas server didn't answer", comment: undefined }));
    if (!r.ok || !r.comment) { setBusy(null); return setErr(r.error ?? "Couldn't save the comment"); }
    if (send) {
      const s = await api.comments.send([r.comment.id], "auto").catch(() => ({ ok: false, error: "The canvas server didn't answer" }));
      if (!s.ok) { setBusy(null); c.setDraft(null); return; }
    }
    setBusy(null);
    c.setDraft(null);
  };
  const right = draft.x > 70;
  return (
    <div
      className="nodrag nopan nowheel absolute z-[6]"
      style={{ left: `${draft.x}%`, top: Math.round(draft.y * scale), transform: PIN_SCALE, transformOrigin: right ? "top right" : "top left" }}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <span aria-hidden className="absolute -top-[26px] left-0 grid size-[26px] place-items-center rounded-full rounded-bl-[4px] bg-scope ring-2 ring-white" style={right ? { left: "auto", right: 0 } : undefined} />
      <form
        onSubmit={(e) => { e.preventDefault(); save(false); }}
        className={cn("absolute top-2 w-[280px] rounded-[12px] bg-background p-2.5 text-foreground shadow-soft-lg ring-1 ring-border", right ? "right-0" : "left-0")}
      >
        <p className="mb-1.5 truncate text-[11px] text-muted-foreground">{viewName}{draft.section?.name ? ` · ${draft.section.name}` : ""}</p>
        <textarea
          ref={ref}
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(true); }
            else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); save(false); }
            if (e.key === "Escape") { e.stopPropagation(); c.setDraft(null); }
          }}
          placeholder="What should change here?"
          aria-label="Comment"
          className="block w-full resize-none rounded-md bg-muted/60 px-2 py-1.5 text-[13px] leading-snug outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        {err && <p className="mt-1 text-xs text-destructive">{err}</p>}
        <div className="mt-2 flex items-center gap-1.5">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => c.setDraft(null)}>Cancel</Button>
          <span className="flex-1" />
          <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={!text.trim() || !!busy} onClick={() => save(true)} title="Comment and send to Claude (⌘Enter)">
            {busy === "send" ? <CircleNotch size={12} className="animate-spin" /> : <PaperPlaneTilt size={12} />} Send to Claude
          </Button>
          <Button type="submit" size="sm" className="h-7 px-2.5 text-xs" disabled={!text.trim() || !!busy}>Comment</Button>
        </div>
      </form>
    </div>
  );
}
