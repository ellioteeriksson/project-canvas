import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Browser, DeviceMobile, FolderSimple, CursorClick, LinkBreak, WarningCircle, CircleNotch, Warning } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { frameUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCanvas } from "./context";
import { frameSize, pageHeight, TITLE_H, type FrameData, type GroupData } from "./layout";
import { useLoadSlot, releaseSlot } from "@/lib/load-queue";

const STATUS_TEXT: Record<number, string> = {
  0: "Dev server didn't answer",
  401: "401 · Needs sign-in",
  403: "403 · Forbidden",
  404: "404 · This route doesn't exist on the dev server",
  500: "500 · The page crashed on the server. Open it to see the error",
};
import { EditableName } from "./editable-name";

export const FrameNode = memo(function FrameNode({ data, sourcePosition, targetPosition }: NodeProps) {
  const { viewId } = data as FrameData;
  const c = useCanvas();
  const v = c.manifest.views.find((x) => x.id === viewId);
  const selected = c.selectedId === viewId;
  const interactive = c.interactiveId === viewId;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const wantsLive = !!v?.url && c.devUp !== false && (c.showLive || interactive);
  const granted = useLoadSlot(viewId, selected ? 10 : 0, wantsLive, c.reloadKey);
  const { full, reportHeight } = c;

  useEffect(() => { setLoaded(false); setPageError(null); }, [c.reloadKey, v?.url]);

  // Messages from the helper script injected into the page
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data;
      if (!d || d.source !== "project-canvas") return;
      if (d.type === "ready") iframeRef.current.contentWindow?.postMessage({ source: "project-canvas-host", type: "fullpage", on: full }, "*");
      if (d.type === "height" && full) reportHeight(viewId, d.h);
      if (d.type === "error") setPageError(d.message);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [viewId, full, reportHeight]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage({ source: "project-canvas-host", type: "fullpage", on: full }, "*");
  }, [full, loaded]);

  if (!v) return null;
  const f = frameSize(c.device);
  const pageH = full ? pageHeight(c.device, c.heights[viewId]) : f.vh;
  const cardH = Math.round(pageH * f.scale);
  const Icon = c.device === "mobile" ? DeviceMobile : Browser;
  const st = v.url ? c.frames[v.url] ?? c.frames[v.url + "/"] : undefined;
  const failed = st && (st.status === 0 || st.status >= 400) ? st : null;

  return (
    <div className="group/frame relative" style={{ width: f.w, paddingTop: TITLE_H }}>
      <Handle id="in" type="target" position={targetPosition ?? Position.Top} isConnectable={false} />
      <Handle id="back-in" type="target" position={sourcePosition ?? Position.Bottom} isConnectable={false} />
      <div
        className="absolute left-0 flex origin-bottom-left items-end gap-1.5 px-0.5 pb-1"
        style={{ bottom: `calc(100% - ${TITLE_H}px)`, width: `calc(100% / var(--title-scale, 1))`, transform: "scale(var(--title-scale, 1))" }}
      >
        <div
          className={cn(
            c.device === "mobile" ? "max-w-full" : "max-w-[75%]",
            "nodrag flex min-w-0 shrink-0 items-center gap-1 rounded-[4px] py-0.5 pr-1.5 pl-0.5 text-[13px] font-medium text-foreground/80",
            selected && "bg-scope text-[#1c2230]",
          )}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); c.select(selected ? null : v.id); }}
            aria-pressed={selected}
            aria-label={`${selected ? "Clear scope from" : "Scope prompts to"} ${v.name}`}
            className="grid size-5 shrink-0 place-items-center rounded-[3px] outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon size={14} weight={selected ? "fill" : "regular"} />
          </button>
          <EditableName value={v.name} onSave={(n) => c.rename(v.id, n)} onClick={() => c.select(v.id)} className="cursor-pointer" />
        </div>
        {c.device === "desktop" && <span className="ml-auto min-w-0 truncate pb-0.5 font-mono text-[11px] text-muted-foreground" title={v.file ?? undefined}>{v.route}</span>}
      </div>

      <div
        className={cn(
          "frame-card relative overflow-hidden rounded-[6px] bg-background ring-1 ring-[#1c2230]/12 transition-shadow",
          "shadow-[0_1px_2px_rgba(28,34,48,.08),0_6px_20px_-8px_rgba(28,34,48,.18)]",
          selected && "ring-0 shadow-[0_0_0_calc(2px*var(--title-scale,1))_#1c2230,0_0_0_calc(7px*var(--title-scale,1))_var(--scope)]",
          interactive && "ring-0 shadow-[0_0_0_calc(3px*var(--title-scale,1))_var(--link)]",
          interactive && "nodrag nopan nowheel",
        )}
        style={{ width: f.w, height: cardH }}
        onClick={(e) => { if (!interactive) { e.stopPropagation(); c.select(v.id); } }}
        onDoubleClick={(e) => { e.stopPropagation(); if (v.url) c.setInteractive(v.id); }}
      >
        {renderBody()}
        {wantsLive && !loaded && (
          <div style={{ fontSize: "calc(12px * min(var(--title-scale, 1), 2.4))" }} className="pointer-events-none absolute inset-x-0 top-0 flex h-[min(100%,225px)] items-center justify-center gap-1.5 text-muted-foreground">
            <CircleNotch size={14} className="animate-spin" /> {granted ? "Loading…" : "Waiting to load"}
          </div>
        )}
        {(failed || pageError) && (
          <div role="status" style={{ fontSize: "calc(11px * min(var(--title-scale, 1), 2.4))" }} className={cn("absolute inset-x-0 bottom-0 flex items-start gap-1.5 px-2 py-1.5 leading-snug text-white", failed ? "bg-destructive" : "bg-[#b7791f]")}>
            <Warning size={13} weight="fill" className="mt-px shrink-0" />
            <span className="line-clamp-2">
              {failed ? STATUS_TEXT[failed.status] ?? `${failed.status} · The dev server returned an error` : `Error in page: ${pageError}`}
            </span>
          </div>
        )}
        {interactive && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-link px-2.5 py-1 text-[11px] font-medium text-white shadow">
            Interacting · Esc to exit
          </div>
        )}
        {!interactive && v.url && c.showLive && (
          <div className="pointer-events-none absolute right-2 bottom-2 flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-1 text-[11px] text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/frame:opacity-100">
            <CursorClick size={12} /> Double-click to interact
          </div>
        )}
      </div>
      <Handle id="out" type="source" position={sourcePosition ?? Position.Bottom} isConnectable={false} />
      <Handle id="back-out" type="source" position={targetPosition ?? Position.Top} isConnectable={false} />
    </div>
  );

  function renderBody() {
    if (!v) return null;
    if (!v.url) return <NeedsParam route={v.route} />;
    if (c.devUp === false)
      return (
        <Placeholder name={v.name} big>
          <span className="flex items-center gap-1 text-[13px] text-muted-foreground"><LinkBreak size={14} /> Dev server offline</span>
        </Placeholder>
      );
    if (!c.showLive && !interactive) return <Placeholder name={v.name} big />;
    if (!granted) return <Placeholder name={v.name} big />;
    return (
      <iframe
        ref={iframeRef}
        key={c.reloadKey}
        title={`${v.name} preview`}
        src={frameUrl(c.frameBase, v.url)}
        tabIndex={interactive ? 0 : -1}
        onLoad={() => { setLoaded(true); releaseSlot(viewId); }}
        className={cn("absolute top-0 left-0 origin-top-left border-0 bg-white transition-opacity", loaded ? "opacity-100" : "opacity-0")}
        style={{ width: f.vw, height: pageH, transform: `scale(${f.scale})`, pointerEvents: interactive ? "auto" : "none" }}
      />
    );
  }
});

function Placeholder({ name, big, children }: { name: string; big?: boolean; children?: React.ReactNode }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 bg-[repeating-linear-gradient(135deg,transparent_0_10px,rgba(28,34,48,.035)_10px_11px)] p-4 text-center">
      <span className={cn("font-semibold text-foreground/70", big ? "text-[34px] leading-tight" : "text-sm")}>{name}</span>
      {children}
    </div>
  );
}

function NeedsParam({ route }: { route: string }) {
  const c = useCanvas();
  const [val, setVal] = useState(route.replace(/\[\.{0,3}([^\]]+)\]|[:$]([\w]+)/g, (_, a, b) => (a || b) === "slug" ? "example" : "1"));
  return (
    <form
      className="nodrag flex size-full flex-col justify-center gap-2 p-4"
      onClick={(e) => e.stopPropagation()}
      onSubmit={(e) => { e.preventDefault(); c.setParam(route, val); }}
    >
      <span className="flex items-center gap-1.5 text-[12px] font-medium text-foreground/80"><WarningCircle size={14} /> Dynamic route</span>
      <label className="text-[12px] text-muted-foreground" htmlFor={`p-${route}`}>Enter a real URL to preview</label>
      <div className="flex gap-1.5">
        <Input id={`p-${route}`} value={val} onChange={(e) => setVal(e.target.value)} className="h-7 font-mono text-[12px]" />
        <Button size="sm" type="submit">Preview</Button>
      </div>
    </form>
  );
}

export const GroupNode = memo(function GroupNode({ data, sourcePosition, targetPosition }: NodeProps) {
  const { groupId } = data as GroupData;
  const c = useCanvas();
  const g = c.manifest.groups.find((x) => x.id === groupId);
  if (!g) return null;
  return (
    <div
      className="flex h-10 w-[180px] items-center gap-2 rounded-full border border-dashed border-wire bg-background/80 px-3.5"
      style={{ transform: "scale(min(var(--title-scale, 1), 2.4))", transformOrigin: "center" }}
    >
      <Handle id="in" type="target" position={targetPosition ?? Position.Top} isConnectable={false} />
      <FolderSimple size={15} className="shrink-0 text-muted-foreground" />
      <span className="truncate text-[13px] font-medium">{g.name}</span>
      <span className="ml-auto truncate font-mono text-[11px] text-muted-foreground">{g.route}</span>
      <Handle id="out" type="source" position={sourcePosition ?? Position.Bottom} isConnectable={false} />
    </div>
  );
});
