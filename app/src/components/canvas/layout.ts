import dagre from "@dagrejs/dagre";
import { MarkerType, Position, type Edge as RFEdge, type Node as RFNode } from "@xyflow/react";
import type { Manifest } from "@/lib/types";

export const DEVICES = {
  desktop: { vw: 1440, vh: 900, w: 360 },
  mobile: { vw: 390, vh: 844, w: 180 },
} as const;
export const TITLE_H = 30;
/** Tallest full-page frame, in page pixels (keeps giant pages from swallowing the canvas). */
export const MAX_PAGE_H = 16000;

/** Height of a frame's page in page pixels: the measured full height, or one viewport. */
export function pageHeight(device: keyof typeof DEVICES, measured?: number) {
  return measured ? Math.min(Math.max(measured, DEVICES[device].vh), MAX_PAGE_H) : DEVICES[device].vh;
}
export const GROUP = { w: 180, h: 40 };

export function frameSize(device: keyof typeof DEVICES) {
  const d = DEVICES[device];
  const scale = d.w / d.vw;
  return { ...d, scale, h: Math.round(d.vh * scale) };
}

export type FrameData = { kind: "frame"; viewId: string };
export type GroupData = { kind: "group"; groupId: string };

export function buildGraph(m: Manifest, mode: "sitemap" | "flow", device: keyof typeof DEVICES, heights?: Record<string, number> | null) {
  const f = frameSize(device);
  const g = new dagre.graphlib.Graph();
  const sitemap = mode === "sitemap";
  g.setGraph({ rankdir: sitemap ? "TB" : "LR", nodesep: sitemap ? 56 : 72, ranksep: sitemap ? 130 : 160, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));

  const nodes: RFNode[] = [];
  for (const v of m.views) {
    const h = Math.round(pageHeight(device, heights?.[v.id]) * f.scale) + TITLE_H;
    g.setNode(v.id, { width: f.w, height: h });
    nodes.push({ id: v.id, type: "frame", position: { x: 0, y: 0 }, data: { kind: "frame", viewId: v.id } satisfies FrameData, width: f.w, height: h });
  }
  if (sitemap) for (const gr of m.groups) {
    g.setNode(gr.id, { width: GROUP.w, height: GROUP.h });
    nodes.push({ id: gr.id, type: "group", position: { x: 0, y: 0 }, data: { kind: "group", groupId: gr.id } satisfies GroupData, width: GROUP.w, height: GROUP.h });
  }

  const raw = sitemap ? m.edges.tree : m.edges.links;
  // Flow: start the journey at the entry screen. Breadth-first depth from "/" (or screens with no
  // incoming links); links that point backwards are reversed for layout only, so loops like
  // "Settings → Log out → Login" don't pull the end of the journey to the front.
  const depth = new Map<string, number>();
  if (!sitemap) {
    const incoming = new Set(raw.map((e) => e.target));
    const roots = m.views.some((v) => v.id === "/") ? ["/"] : m.views.filter((v) => !incoming.has(v.id)).map((v) => v.id);
    const queue: [string, number][] = roots.map((r) => [r, 0]);
    while (queue.length) {
      const [id, d] = queue.shift()!;
      if (depth.has(id)) continue;
      depth.set(id, d);
      for (const e of raw) if (e.source === id && !depth.has(e.target)) queue.push([e.target, d + 1]);
    }
  }
  const backward = new Set<string>();
  for (const e of raw) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    const ds = depth.get(e.source), dt = depth.get(e.target);
    if (!sitemap && dt != null && (ds == null || dt <= ds)) { backward.add(e.id); g.setEdge(e.target, e.source); }
    else g.setEdge(e.source, e.target);
  }
  dagre.layout(g);

  const saved = m.positions?.[mode] || {};
  // Sitemap: frames in the same row share a centre line; align their tops instead (like Figma)
  const rowMax = new Map<number, number>();
  if (sitemap) for (const n of nodes) {
    const p = g.node(n.id);
    rowMax.set(Math.round(p.y), Math.max(rowMax.get(Math.round(p.y)) ?? 0, n.height as number));
  }
  for (const n of nodes) {
    const p = g.node(n.id);
    const top = sitemap ? p.y - (rowMax.get(Math.round(p.y)) as number) / 2 : p.y - (n.height as number) / 2;
    n.position = saved[n.id] ?? { x: p.x - (n.width as number) / 2, y: top };
    n.sourcePosition = sitemap ? Position.Bottom : Position.Right;
    n.targetPosition = sitemap ? Position.Top : Position.Left;
  }

  // Full-page frames are much taller than the screen-height ones the user arranged by hand.
  // Keep their arrangement but re-space it: rows (sitemap) or columns (flow) are stacked by
  // their tallest frame. Positions dragged in full-page mode are kept as they are.
  if (heights && Object.keys(saved).length) {
    const fullSaved = m.positions?.[`${mode}-full`] || {};
    const arranged = nodes.filter((n) => saved[n.id] && !fullSaved[n.id]);
    const GAP = sitemap ? 96 : 72;
    if (sitemap) {
      const rows = new Map<number, RFNode[]>();
      for (const n of arranged) {
        const key = Math.round(saved[n.id].y / 40);
        rows.set(key, [...(rows.get(key) ?? []), n]);
      }
      let cursor = Math.min(...arranged.map((n) => saved[n.id].y));
      for (const key of [...rows.keys()].sort((a, b) => a - b)) {
        const row = rows.get(key)!;
        for (const n of row) n.position = { x: saved[n.id].x, y: cursor };
        cursor += Math.max(...row.map((n) => n.height as number)) + GAP;
      }
    } else {
      const cols = new Map<number, RFNode[]>();
      for (const n of arranged) {
        const key = Math.round(saved[n.id].x / 40);
        cols.set(key, [...(cols.get(key) ?? []), n]);
      }
      for (const col of cols.values()) {
        col.sort((a, b) => saved[a.id].y - saved[b.id].y);
        let cursor = saved[col[0].id].y;
        for (const n of col) { n.position = { x: saved[n.id].x, y: cursor }; cursor += (n.height as number) + GAP; }
      }
    }
    for (const n of nodes) if (fullSaved[n.id]) n.position = fullSaved[n.id];
  } else if (heights) {
    const fullSaved = m.positions?.[`${mode}-full`] || {};
    for (const n of nodes) if (fullSaved[n.id]) n.position = fullSaved[n.id];
  }

  // Merge reciprocal links (A→B and B→A) into one two-headed connector
  const edges: RFEdge[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    if (seen.has(e.id)) continue;
    const back = !sitemap ? raw.find((x) => x.source === e.target && x.target === e.source) : undefined;
    if (back) seen.add(back.id);
    seen.add(e.id);
    // A "return" link (e.g. Log out → Login) leaves from the left and enters on the right,
    // so it curves back under the journey instead of cutting through frames.
    const isBack = backward.has(e.id) && !back;
    edges.push({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: isBack ? "back-out" : "out",
      targetHandle: isBack ? "back-in" : "in",
      type: sitemap ? "smoothstep" : "default",
      label: e.label,
      labelBgPadding: [6, 3],
      labelBgBorderRadius: 4,
      markerEnd: sitemap ? undefined : { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#8d98a8" },
      markerStart: back ? { type: MarkerType.ArrowClosed, width: 16, height: 16, color: "#8d98a8" } : undefined,
      data: { kind: e.kind },
      style: isBack ? { strokeDasharray: "5 5" } : e.kind === "manual" ? { strokeWidth: 2 } : undefined,
    });
  }
  return { nodes, edges };
}
