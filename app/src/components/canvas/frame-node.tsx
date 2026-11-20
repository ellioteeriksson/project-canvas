import { memo, useEffect, useRef, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Browser, DeviceMobile, FolderSimple, CursorClick, LinkBreak, WarningCircle, CircleNotch, Warning, Sparkle, ArrowClockwise, SelectionPlus } from "@phosphor-icons/react";
import type { Agent } from "@/lib/types";
import { cn } from "@/lib/utils";
import { api, frameUrl, snapshotKey } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCanvas } from "./context";
import { frameSize, pageHeight, TITLE_H, type FrameData, type GroupData } from "./layout";
import { EditableName } from "./editable-name";
import { useLoadSlot, releaseSlot } from "@/lib/load-queue";

const STATUS_TEXT: Record<number, string> = {
  0: "Dev server didn't answer",
  401: "401 · Needs sign-in",
  403: "403 · Forbidden",
  404: "404 · This route doesn't exist on the dev server",
  500: "500 · The page crashed on the server. Open it to see the error",
};

const host = (w: Window | null | undefined, msg: Record<string, unknown>) => w?.postMessage({ source: "project-canvas-host", ...msg }, "*");

/**
 * A view on the canvas. Shows a cached static snapshot of the page at every zoom level.
 * A live page (iframe) is only loaded when:
 *  - you interact with it (double-click or the Interact button),
 *  - an agent is working on this view (so its edits stream in), or
 *  - the snapshot is missing or out of date (loaded invisibly, captured, then removed).
 */
export const FrameNode = memo(function FrameNode({ data, sourcePosition, targetPosition }: NodeProps) {
  const { viewId } = data as FrameData;
  const c = useCanvas();
  const v = c.manifest.views.find((x) => x.id === viewId);
  const selected = c.selectedId === viewId;
  const picking = c.pickingId === viewId;
  const interactive = c.interactiveId === viewId || picking;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const [captureReady, setCaptureReady] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(0);
  const { full, reportHeight, wire } = c;

  const agents = c.agentsByView.get(viewId) ?? [];
  const agentHere = agents.length > 0;
  const layer = wire ? "wireframe" : "live";
  const key = snapshotKey(viewId, c.device, layer);
  const snap = c.snapshots[key];
  const shown = snap ?? c.snapshots[snapshotKey(viewId, c.device, wire ? "live" : "wireframe")];
  const changed = Math.max(c.manifest.changedAt?.[viewId] ?? 0, c.manifest.changedAt?.["*"] ?? 0);
  const stale = !snap || snap.at < changed;
  const failed = failedFor === `${key}@${changed}`;
  const canLoad = !!v?.url && c.devUp !== false;

  const live = canLoad && (interactive || agentHere || failed);
  const wantCapture = canLoad && stale && !live;
  const mode = live ? "live" : "capture";
  const needIframe = live || (wantCapture && captureReady);
  const priority = interactive ? 100 : agentHere ? 50 : selected ? 10 : shown ? 0 : 5;
  const granted = useLoadSlot(viewId, priority, needIframe, `${c.reloadKey}:${frameKey}:${key}:${mode}`);

  // Let a burst of saves settle before re-capturing (no wait for a first snapshot)
  useEffect(() => {
    setCaptureReady(false);
    if (!wantCapture) return;
    const t = setTimeout(() => setCaptureReady(true), snap ? 1200 : 0);
    return () => clearTimeout(t);
  }, [wantCapture, changed, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setLoaded(false); setPageError(null); }, [c.reloadKey, v?.url, frameKey, mode, key]);

  // Flash "Updated" when a fresh snapshot replaces an older one
  const prevAt = useRef(snap?.at);
  useEffect(() => {
    if (prevAt.current && snap?.at && snap.at > prevAt.current) setUpdatedAt(Date.now());
    prevAt.current = snap?.at;
  }, [snap?.at]);

  // Capture: once the page is loaded and its helper is ready, ask it for a snapshot
  const helperReady = useRef(false);
  const pending = useRef<number | null>(null);
  const loadStart = useRef(0);
  useEffect(() => { if (granted && needIframe) loadStart.current = Date.now(); }, [granted, needIframe, key, mode, frameKey, c.reloadKey]);
  const requestCapture = () => {
    if (mode !== "capture" || pending.current || !helperReady.current || !iframeRef.current) return;
    const id = loadStart.current || Date.now(); // the page reflects the files as they were when it started loading
    pending.current = id;
    setTimeout(() => host(iframeRef.current?.contentWindow, { type: "snapshot", id, maxW: frameSize(c.device).w * 2 }), 300);
    setTimeout(() => { if (pending.current === id) { pending.current = null; setFailedFor(`${key}@${changed}`); releaseSlot(viewId); } }, 45_000);
  };
  useEffect(() => { helperReady.current = false; pending.current = null; }, [mode, key, frameKey, c.reloadKey]);
  // Pages without the helper (proxy turned off) never answer: show them live instead
  useEffect(() => {
    if (!(needIframe && mode === "capture" && loaded)) return;
    const t = setTimeout(() => { if (!helperReady.current) setFailedFor(`${key}@${changed}`); }, 8000);
    return () => clearTimeout(t);
  }, [needIframe, mode, loaded, key, changed]);

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (!iframeRef.current || e.source !== iframeRef.current.contentWindow) return;
      const d = e.data;
      if (!d || d.source !== "project-canvas") return;
      const w = iframeRef.current.contentWindow;
      if (d.type === "ready") {
        helperReady.current = true;
        host(w, { type: "wireframe", on: wire });
        if (mode === "live") host(w, { type: "fullpage", on: full });
        else requestCapture();
        if (picking) host(w, { type: "pick", on: true, selectors: c.selectedElements?.viewId === viewId ? c.selectedElements.elements.map((x) => x.selector) : [] });
      }
      if (d.type === "height" && full && mode === "live") reportHeight(viewId, d.h);
      if (d.type === "error") setPageError(d.message);
      if (d.type === "picked") c.onPicked(viewId, d.elements);
      if (d.type === "pick-done") c.setPicking(null);
      if (d.type === "snapshot" && d.id === pending.current) {
        pending.current = null;
        api.saveSnapshot({ key, dataUrl: d.dataUrl, h: d.h, w: d.w, at: d.id, sections: d.sections }).finally(() => releaseSlot(viewId));
      }
      if (d.type === "snapshot-error" && d.id === pending.current) {
        pending.current = null;
        console.warn(`[canvas] snapshot failed for ${viewId}: ${d.message}`);
        setFailedFor(`${key}@${changed}`);
        releaseSlot(viewId);
      }
      if (d.type === "mutation" && pendingCheck.current === d.id) {
        pendingCheck.current = null;
        if (d.at < d.id) setFrameKey((k) => k + 1); // live page didn't hot-reload: reload it
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  });

  useEffect(() => { host(iframeRef.current?.contentWindow, { type: "wireframe", on: wire }); }, [wire, loaded]);
  useEffect(() => {
    if (!loaded) return;
    host(iframeRef.current?.contentWindow, { type: "pick", on: picking, selectors: c.selectedElements?.viewId === viewId ? c.selectedElements.elements.map((x) => x.selector) : [] });
  }, [picking, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === "live") host(iframeRef.current?.contentWindow, { type: "fullpage", on: full }); }, [full, loaded, mode]);

  // While an agent edits a live view: if hot reload doesn't update the page, reload it
  const editAt = Math.max(c.edits[viewId] ?? 0, c.edits["*"] ?? 0);
  const pendingCheck = useRef<number | null>(null);
  useEffect(() => {
    if (!editAt || !loaded || mode !== "live") return;
    const t = setTimeout(() => {
      pendingCheck.current = editAt;
      host(iframeRef.current?.contentWindow, { type: "query-mutation", id: editAt });
      setTimeout(() => { if (pendingCheck.current === editAt) { pendingCheck.current = null; setFrameKey((k) => k + 1); } }, 1200);
    }, 2200);
    return () => clearTimeout(t);
  }, [editAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!v) return null;
  const f = frameSize(c.device);
  const measured = shown?.h ?? c.heights[viewId];
  const pageH = full ? pageHeight(c.device, measured) : f.vh;
  const cardH = Math.round(pageH * f.scale);
  const Icon = c.device === "mobile" ? DeviceMobile : Browser;
  const st = v.url ? c.frames[v.url] ?? c.frames[v.url + "/"] : undefined;
  const httpFailed = st && (st.status === 0 || st.status >= 400) ? st : null;
  const liveVisible = mode === "live" && granted && loaded;
  const busy = needIframe && mode === "capture";

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
            selected && "bg-scope text-white",
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
        {agentHere ? (
          <AgentChip agent={agents[0]} more={agents.length - 1} />
        ) : updatedAt > 0 && Date.now() - updatedAt < 2500 ? (
          <span key={updatedAt} className="updated-chip ml-auto flex shrink-0 items-center gap-1 pb-0.5 text-[11px] font-medium text-ok"><ArrowClockwise size={11} weight="bold" /> Updated</span>
        ) : (
          c.device === "desktop" && <span className="ml-auto min-w-0 truncate pb-0.5 font-mono text-[11px] text-muted-foreground" title={v.file ?? undefined}>{v.route}</span>
        )}
      </div>

      {(agentHere || c.globalAgents.length > 0) && (
        <div aria-hidden className="agent-ring" data-global={agentHere ? undefined : ""} style={{ top: `calc(${TITLE_H}px - 5px * var(--title-scale, 1))`, height: `calc(${cardH}px + 10px * var(--title-scale, 1))`, bottom: "auto" }} />
      )}

      <div
        className={cn(
          "frame-card relative overflow-hidden rounded-[6px] bg-background ring-1 ring-foreground/12 transition-shadow",
          "shadow-[0_1px_2px_rgba(28,34,48,.08),0_6px_20px_-8px_rgba(28,34,48,.18)]",
          selected && "ring-0 shadow-[0_0_0_calc(2px*var(--title-scale,1))_var(--scope)]",
          interactive && !picking && "ring-0 shadow-[0_0_0_calc(2px*var(--title-scale,1))_var(--live)]",
          picking && "ring-0 shadow-[0_0_0_calc(2px*var(--title-scale,1))_var(--scope)]",
          interactive && "nodrag nopan nowheel",
        )}
        style={{ width: f.w, height: cardH }}
        onClick={(e) => { if (!interactive) { e.stopPropagation(); c.select(v.id); } }}
        onDoubleClick={(e) => { e.stopPropagation(); if (v.url) c.setInteractive(v.id); }}
      >
        {!v.url ? (
          <NeedsParam route={v.route} />
        ) : shown ? (
          <img
            src={`/api/snapshots/${shown.file}`}
            alt=""
            draggable={false}
            className={cn("absolute top-0 left-0 max-w-none select-none", liveVisible && "invisible")}
            style={{ width: f.w, height: Math.round(shown.h * f.scale) }}
          />
        ) : c.devUp === false ? (
          <Placeholder name={v.name}>
            <span className="flex items-center gap-1 text-[13px] text-muted-foreground"><LinkBreak size={14} /> Dev server offline</span>
          </Placeholder>
        ) : (
          !liveVisible && (
            <Placeholder name={v.name}>
              <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <CircleNotch size={14} className="animate-spin" /> {granted ? "Rendering…" : "Waiting to render"}
              </span>
            </Placeholder>
          )
        )}

        {granted && needIframe && v.url && (
          <iframe
            ref={iframeRef}
            key={`${c.reloadKey}:${frameKey}:${key}:${mode}`}
            title={`${v.name} ${mode === "live" ? "live page" : "snapshot render"}`}
            src={frameUrl(c.frameBase, v.url)}
            tabIndex={interactive ? 0 : -1}
            aria-hidden={mode === "capture" || undefined}
            onLoad={() => { setLoaded(true); if (mode === "live") releaseSlot(viewId); else requestCapture(); }}
            className={cn("absolute top-0 left-0 origin-top-left border-0 bg-white", mode === "live" && loaded ? "opacity-100" : "opacity-0")}
            style={{
              width: f.vw,
              height: mode === "live" ? pageH : f.vh,
              transform: `scale(${f.scale})`,
              pointerEvents: interactive ? "auto" : "none",
            }}
          />
        )}

        {!picking && c.selectedElements?.viewId === viewId && c.selectedElements.elements.map((el, i) => (
          <div
            key={`${el.selector}-${i}`}
            aria-hidden
            className="pointer-events-none absolute bg-scope/15"
            style={{
              left: Math.round(el.left * f.scale), top: Math.round(el.top * f.scale),
              width: Math.max(3, Math.round(el.width * f.scale)), height: Math.max(3, Math.round(el.height * f.scale)),
              boxShadow: "0 0 0 calc(1.5px * var(--title-scale, 1)) var(--scope)",
            }}
          >
            <span
              className="absolute -top-px -left-px grid origin-bottom-left place-items-center rounded-[3px] bg-scope px-1 font-semibold text-white"
              style={{ fontSize: 10, transform: "translateY(-100%) scale(min(var(--title-scale, 1), 3))" }}
            >
              {i + 1}
            </span>
          </div>
        ))}
        {c.selectedSection?.viewId === viewId && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bg-scope/10"
            style={{
              top: Math.round(c.selectedSection.top * f.scale),
              height: Math.max(4, Math.round(c.selectedSection.height * f.scale)),
              boxShadow: "inset 0 0 0 calc(2px * var(--title-scale, 1)) var(--scope)",
            }}
          />
        )}
        {busy && shown && (
          <span
            className="pointer-events-none absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-muted-foreground shadow-sm"
            style={{ fontSize: "calc(11px * min(var(--title-scale, 1), 2.4))" }}
          >
            <CircleNotch size={11} className="animate-spin" /> Refreshing
          </span>
        )}
        {(httpFailed || pageError) && (
          <div role="status" style={{ fontSize: "calc(11px * min(var(--title-scale, 1), 2.4))" }} className={cn("absolute inset-x-0 bottom-0 flex items-start gap-1.5 px-2 py-1.5 leading-snug text-white", httpFailed ? "bg-destructive" : "bg-[#b7791f]")}>
            <Warning size={13} weight="fill" className="mt-px shrink-0" />
            <span className="line-clamp-2">
              {httpFailed ? STATUS_TEXT[httpFailed.status] ?? `${httpFailed.status} · The dev server returned an error` : `Error in page: ${pageError}`}
            </span>
          </div>
        )}
        {interactive && !picking && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-live px-2.5 py-1 text-[11px] font-medium text-white shadow">
            Live · Esc to exit
          </div>
        )}
        {!interactive && v.url && (
          <div
            className="nodrag absolute right-2 bottom-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/frame:opacity-100 focus-within:opacity-100"
            style={{ transform: "scale(min(var(--title-scale, 1), 2.4))", transformOrigin: "bottom right" }}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); c.setPicking(v.id); }}
              className="flex items-center gap-1 rounded-md bg-background/95 px-2 py-1 text-[11px] font-medium shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <SelectionPlus size={12} /> Select elements
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); c.setInteractive(v.id); }}
              className="flex items-center gap-1 rounded-md bg-background/95 px-2 py-1 text-[11px] font-medium shadow-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CursorClick size={12} /> Interact
            </button>
          </div>
        )}
      </div>
      <Handle id="out" type="source" position={sourcePosition ?? Position.Bottom} isConnectable={false} />
      <Handle id="back-out" type="source" position={targetPosition ?? Position.Top} isConnectable={false} />
    </div>
  );
});

function Placeholder({ name, children }: { name: string; children?: React.ReactNode }) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-2 bg-[repeating-linear-gradient(135deg,transparent_0_10px,color-mix(in_oklab,var(--foreground)_5%,transparent)_10px_11px)] p-4 text-center">
      <span className="text-[30px] leading-tight font-semibold text-foreground/70">{name}</span>
      {children}
    </div>
  );
}

function NeedsParam({ route }: { route: string }) {
  const c = useCanvas();
  const [val, setVal] = useState(route.replace(/\[\.{0,3}([^\]]+)\]|[:$]([\w]+)/g, (_, a, b) => ((a || b) === "slug" ? "example" : "1")));
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

const PHASE: Record<Agent["phase"], string> = { thinking: "Thinking", reading: "Reading", editing: "Editing", running: "Running" };

function AgentChip({ agent, more }: { agent: Agent; more: number }) {
  const what = agent.phase === "running" ? agent.command : agent.file?.split("/").pop();
  return (
    <span
      role="status"
      className="ml-auto flex min-w-0 items-center gap-1 rounded-full bg-[var(--agent)] py-0.5 pr-2 pl-1.5 text-[11px] font-medium text-white"
      title={`${agent.label}: ${PHASE[agent.phase]}${what ? ` ${what}` : ""}`}
    >
      <Sparkle size={11} weight="fill" className="agent-dot shrink-0" />
      <span className="truncate">
        {agent.sub ? agent.label : "Claude"} · {PHASE[agent.phase]}
        {what ? ` ${what}` : "…"}
      </span>
      {more > 0 && <span className="shrink-0 opacity-80">+{more}</span>}
    </span>
  );
}
