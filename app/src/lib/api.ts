import { useEffect, useState, useCallback } from "react";
import type { Manifest, CanvasState, GitStatus, ShipAction, ShipResult, FrameStatus, Agent, EditEvent, SnapshotIndex } from "./types";

async function post<T = unknown>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

export const api = {
  select: (sel: { kind: "view" | "component"; id: string } | null) => post("/api/selection", sel ?? {}),
  config: (patch: Record<string, unknown>) => post("/api/config", patch),
  rescan: () => post("/api/rescan", {}),
  suggestMessage: (ai: boolean) => post<{ message: string; source: string; note?: string }>("/api/git/message", { ai }),
  ship: (action: ShipAction, message: string) => post<ShipResult>("/api/git/ship", { action, message }),
  saveSnapshot: (s: { key: string; dataUrl: string; h: number; w: number; at: number }) => post("/api/snapshot", s),
  refreshSnapshots: () => post("/api/snapshots/refresh", {}),
};

/** Live project data over Server-Sent Events. */
export function useCanvasData() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [state, setState] = useState<CanvasState>({});
  const [git, setGit] = useState<GitStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [frames, setFrames] = useState<FrameStatus>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotIndex>({});
  // Latest agent edit per view ("*" = a global file such as a layout or global CSS)
  const [edits, setEdits] = useState<Record<string, number>>({});

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      es = new EventSource("/api/events");
      es.onopen = () => setConnected(true);
      es.onerror = () => { setConnected(false); es?.close(); retry = setTimeout(connect, 1500); };
      es.addEventListener("manifest", (e) => setManifest(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("state", (e) => setState(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("git", (e) => setGit(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("frames", (e) => setFrames(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("activity", (e) => setAgents(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("snapshots", (e) => setSnapshots(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("edited", (e) => {
        const ev: EditEvent = JSON.parse((e as MessageEvent).data);
        setEdits((prev) => {
          const next = { ...prev };
          for (const v of ev.views) next[v] = ev.at;
          if (ev.global) next["*"] = ev.at;
          return next;
        });
      });
    };
    connect();
    return () => { clearTimeout(retry); es?.close(); };
  }, []);

  const refreshGit = useCallback(async () => setGit(await (await fetch("/api/git/status")).json()), []);
  return { manifest, state, git, connected, refreshGit, setState, frames, agents, edits, snapshots };
}

/** Checks whether the project's dev server answers. */
export function useDevServer(devUrl: string | undefined) {
  const [up, setUp] = useState<boolean | null>(null);
  useEffect(() => {
    if (!devUrl) return;
    if (devUrl.startsWith("/")) { setUp(true); return; }
    let alive = true;
    const ping = () =>
      fetch(devUrl, { mode: "no-cors", cache: "no-store" })
        .then(() => alive && setUp(true))
        .catch(() => alive && setUp(false));
    ping();
    const t = setInterval(ping, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [devUrl]);
  return up;
}

export function frameUrl(devUrl: string, path: string) {
  return devUrl.replace(/\/$/, "") + (path.startsWith("/") ? path : "/" + path);
}

export const snapshotKey = (viewId: string, device: string, layer: string) => `${viewId}|${device}|${layer}`;
