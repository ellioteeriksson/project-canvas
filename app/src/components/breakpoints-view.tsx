import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowsDownUp, Cursor, DeviceMobile, DeviceTablet, Desktop, Sparkle, X } from "@phosphor-icons/react";
import { frameUrl } from "@/lib/api";
import type { InspectedElement, Manifest } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

type DeviceId = "desktop" | "tablet" | "mobile";
const DEVICES: { id: DeviceId; label: string; w: number; Icon: typeof Desktop }[] = [
  { id: "desktop", label: "Desktop", w: 1440, Icon: Desktop },
  { id: "tablet", label: "Tablet", w: 768, Icon: DeviceTablet },
  { id: "mobile", label: "Mobile", w: 390, Icon: DeviceMobile },
];
const GAP = 28;
const send = (w: Window | null | undefined, msg: object) => { try { w?.postMessage({ source: "project-canvas-host", ...msg }, "*"); } catch {} };

/** One page at every breakpoint, live and side by side, scrolling together; Inspect shows how an element changes across them. */
export function BreakpointsView({ manifest, viewId, onView, onAsk }: {
  manifest: Manifest; viewId: string | null; onView: (id: string) => void; onAsk: (viewId: string, el: InspectedElement) => void;
}) {
  const views = useMemo(() => manifest.views.filter((v) => v.url && !v.dynamic), [manifest.views]);
  const view = views.find((v) => v.id === viewId) ?? views[0];
  const base = manifest.frameUrl || manifest.devUrl;
  const [on, setOn] = useState<Record<DeviceId, boolean>>({ desktop: true, tablet: true, mobile: true });
  const [sync, setSync] = useState(true);
  const [inspect, setInspect] = useState(false);
  const [picked, setPicked] = useState<{ from: DeviceId; selector: string } | null>(null);
  const [found, setFound] = useState<Partial<Record<DeviceId, InspectedElement | null>>>({});
  const frames = useRef<Partial<Record<DeviceId, HTMLIFrameElement | null>>>({});
  const box = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState({ w: 1200, h: 700 });

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = DEVICES.filter((d) => on[d.id]);
  const total = shown.reduce((s, d) => s + d.w, 0) + GAP * Math.max(0, shown.length - 1);
  const scale = Math.min(1, area.w / Math.max(1, total));
  const frameH = Math.max(300, area.h / scale);

  const each = useCallback((fn: (id: DeviceId, w: Window | null | undefined) => void) => { for (const d of DEVICES) fn(d.id, frames.current[d.id]?.contentWindow); }, []);

  // Messages from the pages: scrolling, and inspected elements
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== "project-canvas") return;
      const from = DEVICES.find((x) => frames.current[x.id]?.contentWindow === e.source)?.id;
      if (!from) return;
      if (d.type === "scrolled" && sync) each((id, w) => { if (id !== from) send(w, { type: "scroll-to", ratio: d.ratio }); });
      if (d.type === "inspected") {
        setFound((f) => ({ ...f, [from]: d.element ?? null }));
        // Picked here: find the same element at the other breakpoints
        if (!d.mirrored && d.element) {
          setPicked({ from, selector: d.element.selector });
          each((id, w) => { if (id !== from) send(w, { type: "inspect-selector", selector: d.element.selector }); });
        }
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [sync, each]);

  useEffect(() => { each((_, w) => { send(w, { type: "scroll-sync", on: sync }); send(w, { type: "inspect", on: inspect }); }); }, [sync, inspect, each]);
  useEffect(() => { setFound({}); setPicked(null); }, [view?.id]);
  useEffect(() => { if (!inspect) { setFound({}); setPicked(null); } }, [inspect]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "i") { e.preventDefault(); setInspect((x) => !x); }
      if (e.key === "Escape" && inspect) setInspect(false);
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [inspect]);

  if (!view) return <p className="p-10 text-center text-muted-foreground">No pages to show yet.</p>;
  const ready = (id: DeviceId) => () => { const w = frames.current[id]?.contentWindow; send(w, { type: "scroll-sync", on: sync }); send(w, { type: "inspect", on: inspect }); if (picked && inspect) send(w, { type: "inspect-selector", selector: picked.selector }); };
  const inspectorOpen = inspect && picked;

  return (
    <div className="flex h-full flex-col px-6 pb-[150px]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 pt-2 pb-4">
        <select value={view.id} onChange={(e) => onView(e.target.value)} aria-label="Page" className="h-8 max-w-[260px] rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {views.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.url})</option>)}
        </select>
        <div role="group" aria-label="Breakpoints" className="flex items-center gap-0.5 rounded-[10px] bg-segment p-0.5 dark:bg-white/8">
          {DEVICES.map((d) => (
            <button key={d.id} type="button" aria-pressed={on[d.id]} onClick={() => setOn((o) => ({ ...o, [d.id]: !o[d.id] || DEVICES.filter((x) => o[x.id]).length === 1 }))}
              className={cn("flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring", on[d.id] ? "bg-background shadow-sm dark:bg-white/14" : "text-muted-foreground hover:text-foreground")}>
              <d.Icon size={14} /> {d.label} <span className="font-normal text-muted-foreground tabular-nums">{d.w}</span>
            </button>
          ))}
        </div>
        <Button variant={sync ? "secondary" : "ghost"} size="sm" className="h-8" aria-pressed={sync} onClick={() => setSync((x) => !x)}><ArrowsDownUp size={14} /> Scroll together</Button>
        <Button variant={inspect ? "default" : "outline"} size="sm" className="h-8" aria-pressed={inspect} onClick={() => setInspect((x) => !x)}><Cursor size={14} /> Inspect <Kbd className="ml-0.5">I</Kbd></Button>
        {inspect && !picked && <span className="text-xs text-muted-foreground">Click an element in any breakpoint</span>}
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div ref={box} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="flex items-start" style={{ gap: GAP * scale }}>
            {shown.map((d) => (
              <figure key={d.id} className="m-0 shrink-0" style={{ width: d.w * scale }}>
                <div className="overflow-hidden rounded-[10px] bg-white shadow-soft-sm ring-1 ring-black/10" style={{ width: d.w * scale, height: frameH * scale }}>
                  <iframe
                    ref={(el) => { frames.current[d.id] = el; }}
                    title={`${view.name} at ${d.w}px`}
                    src={frameUrl(base, view.url!)}
                    onLoad={ready(d.id)}
                    style={{ width: d.w, height: frameH, border: 0, transform: `scale(${scale})`, transformOrigin: "0 0", display: "block" }}
                  />
                </div>
              </figure>
            ))}
          </div>
        </div>
        {inspectorOpen && <Inspector found={found} on={on} onClose={() => setPicked(null)} onAsk={(el) => onAsk(view.id, el)} />}
      </div>
    </div>
  );
}

/** The picked element's values at each breakpoint, side by side; values that change between them stand out */
function Inspector({ found, on, onClose, onAsk }: { found: Partial<Record<DeviceId, InspectedElement | null>>; on: Record<DeviceId, boolean>; onClose: () => void; onAsk: (el: InspectedElement) => void }) {
  const cols = DEVICES.filter((d) => on[d.id]);
  const first = cols.map((d) => found[d.id]).find(Boolean);
  if (!first) return null;
  const row = (label: string, get: (e: InspectedElement) => string | null | undefined) => {
    const vals = cols.map((d) => { const e = found[d.id]; return e === undefined ? "…" : e === null ? "not shown" : get(e) ?? "–"; });
    if (vals.every((v) => v === "–")) return null;
    const differs = new Set(vals.filter((v) => v !== "…")).size > 1;
    return (
      <tr key={label} className={cn(differs && "bg-scope/[0.06]")}>
        <th scope="row" className="py-1 pr-2 text-left align-top text-[11.5px] font-normal whitespace-nowrap text-muted-foreground">{label}</th>
        {vals.map((v, i) => <td key={i} className={cn("py-1 pr-2 align-top font-mono text-[11px] break-words", differs && "text-scope")}>{v}</td>)}
      </tr>
    );
  };
  const swatch = (c: string | null | undefined) => c ? c : null;
  return (
    <aside className="island flex w-[340px] shrink-0 flex-col overflow-hidden" aria-label="Inspector">
      <header className="flex items-start gap-2 border-b px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">&lt;{first.tag}&gt; {first.kind !== "block" ? <span className="font-normal text-muted-foreground">{first.kind}</span> : null}</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground" title={first.selector}>{first.selector}</p>
          {first.text && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">“{first.text}”</p>}
        </div>
        <Button variant="ghost" size="icon" className="size-7" onClick={onClose} aria-label="Close the inspector"><X size={14} /></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <table className="w-full table-fixed border-collapse">
          <colgroup><col className="w-[86px]" />{cols.map((d) => <col key={d.id} />)}</colgroup>
          <thead>
            <tr>{[<th key="x" />, ...cols.map((d) => <th key={d.id} scope="col" className="pb-1.5 text-left text-[11px] font-semibold"><d.Icon size={12} className="mr-1 inline" />{d.w}</th>)]}</tr>
          </thead>
          <tbody>
            {row("Size", (e) => e.size)}
            {row("Font", (e) => e.typography?.family)}
            {row("Font size", (e) => e.typography?.size)}
            {row("Weight", (e) => e.typography?.weight)}
            {row("Line height", (e) => e.typography?.lineHeight)}
            {row("Letter sp.", (e) => (e.typography?.letterSpacing === "normal" ? null : e.typography?.letterSpacing))}
            {row("Text color", (e) => swatch(e.color))}
            {row("Background", (e) => swatch(e.background))}
            {row("Padding", (e) => (e.padding === "0" ? null : e.padding))}
            {row("Margin", (e) => (e.margin === "0" ? null : e.margin))}
            {row("Radius", (e) => e.radius)}
            {row("Border", (e) => e.border)}
            {row("Display", (e) => e.layout.display)}
            {row("Direction", (e) => e.layout.direction)}
            {row("Gap", (e) => e.layout.gap)}
            {row("Columns", (e) => e.layout.columns)}
            {row("Align", (e) => [e.layout.align, e.layout.justify].filter((x) => x && x !== "normal").join(" / ") || null)}
            {row("Shadow", (e) => e.shadow)}
            {row("Opacity", (e) => e.opacity)}
          </tbody>
        </table>
        <p className="mt-3 text-[11px] text-muted-foreground">Values that change between breakpoints are highlighted. ↑ and ↓ select the parent or first child.</p>
      </div>
      <footer className="border-t p-3">
        <Button size="sm" className="w-full" onClick={() => onAsk(first)}><Sparkle size={14} weight="fill" /> Prompt about this element</Button>
      </footer>
    </aside>
  );
}
