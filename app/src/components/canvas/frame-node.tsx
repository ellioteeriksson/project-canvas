import { memo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Browser, DeviceMobile, FolderSimple, CursorClick, LinkBreak, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { frameUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCanvas } from "./context";
import { frameSize, TITLE_H, type FrameData, type GroupData } from "./layout";
import { EditableName } from "./editable-name";

export const FrameNode = memo(function FrameNode({ data, sourcePosition, targetPosition }: NodeProps) {
  const { viewId } = data as FrameData;
  const c = useCanvas();
  const v = c.manifest.views.find((x) => x.id === viewId);
  if (!v) return null;
  const f = frameSize(c.device);
  const selected = c.selectedId === v.id;
  const interactive = c.interactiveId === v.id;
  const Icon = c.device === "mobile" ? DeviceMobile : Browser;

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
        style={{ width: f.w, height: f.h }}
        onClick={(e) => { if (!interactive) { e.stopPropagation(); c.select(v.id); } }}
        onDoubleClick={(e) => { e.stopPropagation(); if (v.url) c.setInteractive(v.id); }}
      >
        {renderBody()}
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
    return (
      <iframe
        key={c.reloadKey}
        title={`${v.name} preview`}
        src={frameUrl(c.manifest.devUrl, v.url)}
        loading="lazy"
        tabIndex={interactive ? 0 : -1}
        className="absolute top-0 left-0 origin-top-left border-0 bg-white"
        style={{ width: f.vw, height: f.vh, transform: `scale(${f.scale})`, pointerEvents: interactive ? "auto" : "none" }}
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
