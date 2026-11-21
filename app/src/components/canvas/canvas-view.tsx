import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Panel,
  useReactFlow, useViewport, useNodesState, type Node, type NodeMouseHandler,
} from "@xyflow/react";
import { TreeStructure, FlowArrow, Desktop, DeviceMobile, LinkBreak, Copy, Check, Rectangle, ArrowsVertical, Browser, Layout, ArrowsOut, Crosshair } from "@phosphor-icons/react";
import { Kbd } from "@/components/ui/kbd";
import type { Manifest, FrameStatus, Agent, SnapshotIndex, Selection, PickedElement } from "@/lib/types";
import { snapshotKey } from "@/lib/api";
import { setLoadLimit } from "@/lib/load-queue";
import { api, useDevServer } from "@/lib/api";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { CanvasContext, type CanvasCtx } from "./context";
import { buildGraph } from "./layout";
import { FrameNode, GroupNode } from "./frame-node";

export type CanvasHandle = {
  fitAll: () => void;
  zoomToCenter: () => void;
  focus: (id: string) => void;
};

const nodeTypes = { frame: FrameNode, group: GroupNode };
const LIVE_ZOOM = 0.2;

type Props = {
  manifest: Manifest;
  selectedId: string | null;
  onSelect: (id: string | null, extra?: Record<string, unknown>) => void;
  frames: FrameStatus;
  agents: Agent[];
  edits: Record<string, number>;
  snapshots: SnapshotIndex;
  selection: Selection | null;
  onPickElements: (viewId: string, elements: PickedElement[]) => void;
  /** Room taken by the floating project panel on the left */
  insetLeft?: number;
  ref?: Ref<CanvasHandle>;
};

export function CanvasView(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

// Room the floating tools take: tabs on top, canvas toolbar on the right, prompt bar at the bottom
const INSET = { top: 76, right: 72, bottom: 224 };

function CanvasInner({ manifest, selectedId, onSelect, frames, agents, edits, snapshots, selection, onPickElements, insetLeft = 12, ref }: Props) {
  const rf = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const mode = manifest.mode;
  const device = manifest.viewport;
  const full = manifest.frameHeight === "full";
  const agentsByView = useMemo(() => {
    const m = new Map<string, Agent[]>();
    for (const a of agents) for (const v of a.views) m.set(v, [...(m.get(v) ?? []), a]);
    return m;
  }, [agents]);
  const globalAgents = useMemo(() => agents.filter((a) => a.global), [agents]);
  // Measured page heights arrive one by one; apply them in batches so the layout doesn't jitter
  const [heights, setHeights] = useState<Record<string, number>>({});
  const pendingHeights = useRef<Record<string, number>>({});
  const heightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fitAfterHeights = useRef(false);
  const reportHeight = useCallback((id: string, h: number) => {
    pendingHeights.current[id] = h;
    if (heightTimer.current) clearTimeout(heightTimer.current);
    heightTimer.current = setTimeout(() => {
      const batch = pendingHeights.current;
      pendingHeights.current = {};
      setHeights((prev) => {
        const changed = Object.entries(batch).some(([k, v]) => Math.abs((prev[k] ?? 0) - v) > 4);
        return changed ? { ...prev, ...batch } : prev;
      });
    }, 350);
  }, []);
  useEffect(() => setLoadLimit(manifest.frameConcurrency || 3), [manifest.frameConcurrency]);
  // Full-page heights come from the snapshots (falling back to live measurements)
  const layer = manifest.frameLayer === "wireframe" ? "wireframe" : "live";
  const allHeights = useMemo(() => {
    const out: Record<string, number> = { ...heights };
    for (const v of manifest.views) {
      const s = snapshots[snapshotKey(v.id, device, layer)] ?? snapshots[snapshotKey(v.id, device, layer === "live" ? "wireframe" : "live")];
      if (s) out[v.id] = s.h;
    }
    return out;
  }, [heights, snapshots, manifest.views, device, layer]);
  const graph = useMemo(() => buildGraph(manifest, mode, device, full ? allHeights : null), [manifest, mode, device, full, allHeights]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(graph.nodes);
  const [interactiveId, setInteractive] = useState<string | null>(null);
  const [pickingId, setPicking] = useState<string | null>(null);
  const [showLive, setShowLive] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const devUp = useDevServer(manifest.devUrl);

  useEffect(() => setNodes(graph.nodes), [graph, setNodes]);


  // Reload frames when the dev server comes back
  const prevUp = useRef(devUp);
  useEffect(() => { if (prevUp.current === false && devUp) setReloadKey((k) => k + 1); prevUp.current = devUp; }, [devUp]);

  // Bounds are computed from the layout's explicit sizes: with culling on, off-screen
  // nodes are never measured, so React Flow's own fitView would ignore them.
  const boundsOf = useCallback((ids?: string[]) => {
    const list = rf.getNodes().filter((n) => !ids || ids.includes(n.id));
    if (!list.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of list) {
      const w = n.width ?? n.measured?.width ?? 0, h = n.height ?? n.measured?.height ?? 0;
      x0 = Math.min(x0, n.position.x); y0 = Math.min(y0, n.position.y);
      x1 = Math.max(x1, n.position.x + w); y1 = Math.max(y1, n.position.y + h);
    }
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }, [rf]);
  const fitAll = useCallback((duration = 450) => { const b = boundsOf(); if (b) rf.fitBounds(b, { padding: { top: `${INSET.top}px`, bottom: `${INSET.bottom}px`, left: `${insetLeft + 36}px`, right: `${INSET.right + 12}px` }, duration }); }, [rf, boundsOf, insetLeft]);
  const focus = useCallback((id: string) => {
    const b = boundsOf([id]);
    if (!b) return;
    const el = wrapper.current;
    // Leave room for the title above the frame and a margin around it
    // and keep it clear of the floating tools
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;
    const visW = W - insetLeft - INSET.right, visH = H - INSET.top - INSET.bottom;
    const zoom = Math.min(3, (visW - 48) / b.width, (visH - 24) / b.height);
    const dx = (insetLeft + visW / 2 - W / 2) / zoom, dy = (INSET.top + visH / 2 - H / 2) / zoom;
    rf.setCenter(b.x + b.width / 2 - dx, b.y + b.height / 2 - dy, { zoom, duration: 450 });
  }, [rf, boundsOf, insetLeft]);
  const zoomToCenter = useCallback(() => {
    const el = wrapper.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const c = rf.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    let best: Node | null = null;
    let bestD = Infinity;
    for (const n of rf.getNodes()) {
      if (n.type !== "frame") continue;
      const w = n.width ?? 0;
      const h = n.height ?? 0;
      const d = Math.hypot(n.position.x + w / 2 - c.x, n.position.y + h / 2 - c.y);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (best) focus(best.id);
  }, [rf, focus]);

  // Refit when the layout itself changes (mode/device/view count), not on every rescan
  const layoutKey = `${mode}|${device}|${manifest.views.length}|${manifest.frameHeight}`;
  const lastLayout = useRef("");
  const fitRef = useRef(fitAll);
  fitRef.current = fitAll;
  useEffect(() => {
    if (lastLayout.current === layoutKey) return;
    const first = lastLayout.current === "";
    lastLayout.current = layoutKey;
    fitAfterHeights.current = full;
    setTimeout(() => fitRef.current(first ? 0 : 400), first ? 30 : 80);
  }, [layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // After switching to full-page frames, refit once the first page heights are in
  useEffect(() => {
    if (!full || !fitAfterHeights.current || !Object.keys(allHeights).length) return;
    fitAfterHeights.current = false;
    setTimeout(() => fitRef.current(400), 60);
  }, [allHeights, full]);

  useImperativeHandle(ref, () => ({ fitAll: () => fitAll(), zoomToCenter, focus }), [fitAll, zoomToCenter, focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Escape") {
        if (pickingId) setPicking(null);
        else if (interactiveId) setInteractive(null);
        // Step out one level: section or elements → their view → nothing
        else if (selection && (selection.kind === "section" || selection.kind === "elements")) onSelect(selection.viewId);
        else onSelect(null);
      }
      if (e.shiftKey && e.code === "Digit1") { e.preventDefault(); fitAll(); }
      if (e.shiftKey && e.code === "Digit2") { e.preventDefault(); zoomToCenter(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactiveId, pickingId, onSelect, fitAll, zoomToCenter, selection]);

  const ctx: CanvasCtx = {
    manifest, device, selectedId, interactiveId, showLive, devUp, reloadKey,
    full, heights, frames, reportHeight,
    wire: manifest.frameLayer === "wireframe",
    agentsByView, globalAgents, edits, snapshots,
    pickingId,
    setPicking: (id) => { setPicking(id); if (id) { setInteractive(null); focus(id); } },
    selectedElements: selection?.kind === "elements" ? { viewId: selection.viewId, elements: selection.elements } : null,
    onPicked: onPickElements,
    selectedSection: selection?.kind === "section" && selection.position ? { viewId: selection.viewId, top: selection.position.top, height: selection.position.height, name: selection.name } : null,
    frameBase: manifest.frameUrl || manifest.devUrl,
    select: onSelect,
    activeViewId: selection && (selection.kind === "section" || selection.kind === "elements") ? selection.viewId : selection?.kind === "view" ? selection.id : null,
    selectedSectionId: selection?.kind === "section" ? selection.id : null,
    selectSection: (viewId, index) => onSelect(index === null ? viewId : `${viewId}::${index}`, index === null ? undefined : { device }),
    setInteractive,
    rename: (id, name) => api.config({ names: { [id]: name } }),
    setParam: (route, url) => api.config({ params: { [route]: url } }),
  };

  const onNodeClick: NodeMouseHandler = (_, n) => { if (n.type === "frame") onSelect(n.id); };
  const onNodeDragStop = () => {
    const positions = Object.fromEntries(rf.getNodes().map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]));
    // Full-page and screen-height arrangements are saved separately
    api.config({ positions: { ...manifest.positions, [full ? `${mode}-full` : mode]: positions } });
  };

  return (
    <CanvasContext.Provider value={ctx}>
      <div ref={wrapper} className="relative size-full" aria-label="Project canvas">
        <ReactFlow
          nodes={nodes}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={onNodeClick}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={() => { setInteractive(null); setPicking(null); if (!pickingId) onSelect(null); }}
          onMove={(_, vp) => {
            setShowLive(vp.zoom >= LIVE_ZOOM);
            // Keep frame titles readable at any zoom, like Figma (no React re-render)
            wrapper.current?.style.setProperty("--title-scale", String(Math.min(Math.max(1 / vp.zoom, 0.3), 6)));
          }}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable
          edgesFocusable={false}
          minZoom={0.04}
          maxZoom={4}
          onlyRenderVisibleElements={false}
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--paper-dot)" />
          <Panel position="center-right" className="!m-3">
            <CanvasToolbar manifest={manifest} onFit={() => fitAll()} onCenter={zoomToCenter} />
          </Panel>
          {pickingId && (
            <Panel position="top-center" className="!mt-3">
              <div role="status" className="flex items-center gap-3 rounded-lg bg-scope py-1.5 pr-1.5 pl-3 text-[13px] text-white shadow-lg">
                <span><b className="font-semibold">Click</b> to select · <b className="font-semibold">Shift-click</b> to add · <b className="font-semibold">↑ ↓</b> parent / child · <b className="font-semibold">Esc</b> to finish</span>
                <Button size="sm" variant="secondary" onClick={() => setPicking(null)}>Done</Button>
              </div>
            </Panel>
          )}
          {devUp === false && !manifest.devUrl.startsWith("/") && (
            <Panel position="top-center" className="!mt-3">
              <DevOffline url={manifest.devUrl} />
            </Panel>
          )}
          {manifest.views.length === 0 && (
            <Panel position="top-center" className="!mt-24 max-w-sm rounded-lg border bg-background p-4 text-center shadow-sm">
              <p className="font-medium">No views found in this project</p>
              <p className="mt-1 text-muted-foreground">
                Detected framework: <span className="font-mono">{manifest.project.framework}</span>. Ask Claude Code to add views to <span className="font-mono">.canvas/config.json</span>, or change the framework in settings.
              </p>
            </Panel>
          )}
        </ReactFlow>
      </div>
    </CanvasContext.Provider>
  );
}

/** View options for the canvas: one quiet column of icons on the right edge. */
function CanvasToolbar({ manifest, onFit, onCenter }: { manifest: Manifest; onFit: () => void; onCenter: () => void }) {
  const { zoom } = useViewport();
  const sep = <span aria-hidden className="my-1 h-px w-5 bg-border" />;
  const tip = (label: React.ReactNode, el: React.ReactElement) => (
    <Tooltip><TooltipTrigger asChild>{el}</TooltipTrigger><TooltipContent side="left">{label}</TooltipContent></Tooltip>
  );
  const group = "flex flex-col gap-0.5 bg-transparent p-0";
  const item = "size-9 rounded-[10px] px-0 [&_svg]:size-[17px] data-[state=on]:bg-segment data-[state=on]:shadow-none dark:data-[state=on]:bg-white/12";
  const btn = "size-9 rounded-[10px] text-muted-foreground [&_svg]:size-[17px]";
  return (
    <div className="island flex flex-col items-center p-1.5" role="toolbar" aria-orientation="vertical" aria-label="Canvas view">
      <ToggleGroup type="single" orientation="vertical" className={group} value={manifest.mode} onValueChange={(v) => v && api.config({ mode: v })} aria-label="Layout">
        {tip("Sitemap: pages as a tree by URL", <ToggleGroupItem className={item} value="sitemap" aria-label="Sitemap layout"><TreeStructure /></ToggleGroupItem>)}
        {tip("Flow: screens connected by their links", <ToggleGroupItem className={item} value="flow" aria-label="Flow layout"><FlowArrow /></ToggleGroupItem>)}
      </ToggleGroup>
      {sep}
      <ToggleGroup type="single" orientation="vertical" className={group} value={manifest.frameHeight} onValueChange={(v) => v && api.config({ frameHeight: v })} aria-label="Frame height">
        {tip("First screen of each page", <ToggleGroupItem className={item} value="viewport" aria-label="Show one screen of each page"><Rectangle /></ToggleGroupItem>)}
        {tip("Full pages", <ToggleGroupItem className={item} value="full" aria-label="Show full pages"><ArrowsVertical /></ToggleGroupItem>)}
      </ToggleGroup>
      {sep}
      <ToggleGroup type="single" orientation="vertical" className={group} value={manifest.frameLayer} onValueChange={(v) => v && api.config({ frameLayer: v })} aria-label="Layer">
        {tip("Design: pages as they look", <ToggleGroupItem className={item} value="live" aria-label="Design layer"><Browser /></ToggleGroupItem>)}
        {tip("Wireframe: gray layout only", <ToggleGroupItem className={item} value="wireframe" aria-label="Wireframe layer"><Layout /></ToggleGroupItem>)}
      </ToggleGroup>
      {sep}
      <ToggleGroup type="single" orientation="vertical" className={group} value={manifest.viewport} onValueChange={(v) => v && api.config({ viewport: v })} aria-label="Frame size">
        {tip("Desktop, 1440 wide", <ToggleGroupItem className={item} value="desktop" aria-label="Desktop frames"><Desktop /></ToggleGroupItem>)}
        {tip("Mobile, 390 wide", <ToggleGroupItem className={item} value="mobile" aria-label="Mobile frames"><DeviceMobile /></ToggleGroupItem>)}
      </ToggleGroup>
      {sep}
      {tip(<>Show the whole project <Kbd>⇧1</Kbd></>, <Button variant="ghost" size="icon" className={btn} onClick={onFit} aria-label="Zoom to fit the whole project"><ArrowsOut /></Button>)}
      {tip(<>Zoom to the view in the center <Kbd>⇧2</Kbd></>, <Button variant="ghost" size="icon" className={btn} onClick={onCenter} aria-label="Zoom in to the view in the center"><Crosshair /></Button>)}
      <span className="pt-1 pb-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground" aria-live="off">{Math.round(zoom * 100)}%</span>
    </div>
  );
}

function DevOffline({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-lg border bg-background py-1.5 pr-1.5 pl-3 shadow-sm">
      <LinkBreak size={16} className="text-destructive" />
      <span>
        Can't reach <span className="font-mono text-[12px]">{url}</span>. Start your dev server and the frames load on their own.
      </span>
      <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText("npm run dev"); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
        {copied ? <Check size={14} /> : <Copy size={14} />} npm run dev
      </Button>
    </div>
  );
}
