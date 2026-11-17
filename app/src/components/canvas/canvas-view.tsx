import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, MiniMap, Panel,
  useReactFlow, useViewport, useNodesState, type Node, type NodeMouseHandler,
} from "@xyflow/react";
import { TreeStructure, FlowArrow, Desktop, DeviceMobile, LinkBreak, Copy, Check, Rectangle, ArrowsVertical } from "@phosphor-icons/react";
import type { Manifest, FrameStatus } from "@/lib/types";
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
  onSelect: (id: string | null) => void;
  frames: FrameStatus;
  ref?: Ref<CanvasHandle>;
};

export function CanvasView(props: Props) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

function CanvasInner({ manifest, selectedId, onSelect, frames, ref }: Props) {
  const rf = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const mode = manifest.mode;
  const device = manifest.viewport;
  const full = manifest.frameHeight === "full";
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
  const graph = useMemo(() => buildGraph(manifest, mode, device, full ? heights : null), [manifest, mode, device, full, heights]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(graph.nodes);
  const [interactiveId, setInteractive] = useState<string | null>(null);
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
  const fitAll = useCallback((duration = 450) => { const b = boundsOf(); if (b) rf.fitBounds(b, { padding: "56px", duration }); }, [rf, boundsOf]);
  const focus = useCallback((id: string) => {
    const b = boundsOf([id]);
    if (!b) return;
    const el = wrapper.current;
    // Leave room for the title above the frame and a margin around it
    const zoom = el ? Math.min(3, (el.clientWidth - 96) / b.width, (el.clientHeight - 120) / b.height) : 1;
    rf.setCenter(b.x + b.width / 2, b.y + b.height / 2, { zoom, duration: 450 });
  }, [rf, boundsOf]);
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
    if (!full || !fitAfterHeights.current || !Object.keys(heights).length) return;
    fitAfterHeights.current = false;
    setTimeout(() => fitRef.current(400), 60);
  }, [heights, full]);

  useImperativeHandle(ref, () => ({ fitAll: () => fitAll(), zoomToCenter, focus }), [fitAll, zoomToCenter, focus]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "Escape") { if (interactiveId) setInteractive(null); else onSelect(null); }
      if (e.shiftKey && e.code === "Digit1") { e.preventDefault(); fitAll(); }
      if (e.shiftKey && e.code === "Digit2") { e.preventDefault(); zoomToCenter(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [interactiveId, onSelect, fitAll, zoomToCenter]);

  const ctx: CanvasCtx = {
    manifest, device, selectedId, interactiveId, showLive, devUp, reloadKey,
    full, heights, frames, reportHeight,
    frameBase: manifest.frameUrl || manifest.devUrl,
    select: onSelect,
    setInteractive,
    rename: (id, name) => api.config({ names: { [id]: name } }),
    setParam: (route, url) => api.config({ params: { [route]: url } }),
  };

  const onNodeClick: NodeMouseHandler = (_, n) => { if (n.type === "frame") onSelect(n.id); };
  const onNodeDragStop = () => {
    const positions = Object.fromEntries(rf.getNodes().map((n) => [n.id, { x: Math.round(n.position.x), y: Math.round(n.position.y) }]));
    api.config({ positions: { ...manifest.positions, [mode]: positions } });
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
          onPaneClick={() => { setInteractive(null); onSelect(null); }}
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
          onlyRenderVisibleElements
          zoomOnDoubleClick={false}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--paper-dot)" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(n) => (n.id === selectedId ? "#ffd23f" : n.type === "group" ? "transparent" : "#c9d1db")}
            nodeStrokeColor={(n) => (n.id === selectedId ? "#1c2230" : "#8d98a8")}
            nodeStrokeWidth={4}
            maskColor="rgba(233,237,241,.7)"
            ariaLabel="Mini map"
          />
          <Panel position="bottom-left" className="!m-3">
            <CanvasToolbar manifest={manifest} />
          </Panel>
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

function CanvasToolbar({ manifest }: { manifest: Manifest }) {
  const { zoom } = useViewport();
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background p-1 shadow-[0_2px_8px_-4px_rgba(28,34,48,.25)]">
      <ToggleGroup type="single" value={manifest.mode} onValueChange={(v) => v && api.config({ mode: v })} aria-label="Layout">
        <ToggleGroupItem value="sitemap" aria-label="Sitemap layout"><TreeStructure size={14} /> Sitemap</ToggleGroupItem>
        <ToggleGroupItem value="flow" aria-label="Flow layout"><FlowArrow size={14} /> Flow</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="single" value={manifest.frameHeight} onValueChange={(v) => v && api.config({ frameHeight: v })} aria-label="Frame height">
        <Tooltip><TooltipTrigger asChild><ToggleGroupItem value="viewport" aria-label="Show one screen of each page"><Rectangle size={14} /> Screen</ToggleGroupItem></TooltipTrigger><TooltipContent>First screen of each page</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><ToggleGroupItem value="full" aria-label="Show full pages"><ArrowsVertical size={14} /> Full page</ToggleGroupItem></TooltipTrigger><TooltipContent>Every page at its full length</TooltipContent></Tooltip>
      </ToggleGroup>
      <ToggleGroup type="single" value={manifest.viewport} onValueChange={(v) => v && api.config({ viewport: v })} aria-label="Frame size">
        <Tooltip><TooltipTrigger asChild><ToggleGroupItem value="desktop" aria-label="Desktop frames"><Desktop size={14} /></ToggleGroupItem></TooltipTrigger><TooltipContent>Desktop · 1440</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild><ToggleGroupItem value="mobile" aria-label="Mobile frames"><DeviceMobile size={14} /></ToggleGroupItem></TooltipTrigger><TooltipContent>Mobile · 390</TooltipContent></Tooltip>
      </ToggleGroup>
      <span className="w-10 pr-1 text-right text-xs tabular-nums text-muted-foreground" aria-live="off">{Math.round(zoom * 100)}%</span>
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
