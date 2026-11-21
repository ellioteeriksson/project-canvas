import { useEffect, useState, useCallback } from "react";
import type { Manifest, CanvasState, GitStatus, ShipAction, ShipResult, FrameStatus, Agent, EditEvent, SnapshotIndex, ChatState, CanvasPrompt, ChangelogEntry, ManagedSession, TranscriptEvent, CanvasComment } from "./types";

async function post<T = unknown>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}

export const api = {
  select: (sel: ({ kind: "view" | "component" | "section" | "elements"; id: string } & Record<string, unknown>) | null) => post("/api/selection", sel ?? {}),
  config: (patch: Record<string, unknown>) => post("/api/config", patch),
  rescan: () => post("/api/rescan", {}),
  suggestMessage: (ai: boolean) => post<{ message: string; source: string; note?: string }>("/api/git/message", { ai }),
  ship: (action: ShipAction, message: string) => post<ShipResult>("/api/git/ship", { action, message }),
  saveSnapshot: (s: { key: string; dataUrl: string; h: number; w: number; at: number; sections?: unknown[] }) => post("/api/snapshot", s),
  refreshSnapshots: () => post("/api/snapshots/refresh", {}),
  /** A real browser screenshot taken by the server. Resolves to the HTTP status. */
  renderSnapshot: (b: { viewId: string; device: string; layer: string; at: number }) =>
    fetch("/api/snapshot/render", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.status).catch(() => 0),
  prompt: (text: string, conn?: string | null, mode: "direct" | "concepts" = "direct", selection?: unknown) => post<{ ok: boolean; error?: string; prompt?: CanvasPrompt }>("/api/prompt", { text, conn, mode, ...(selection !== undefined ? { selection } : {}) }),
  chooseConcept: (id: string, index: number, comment: string) => post<{ ok: boolean; error?: string; prompt?: CanvasPrompt }>("/api/concepts/choose", { id, index, comment }),
  conceptsAgain: (id: string, comment: string) => post<{ ok: boolean; error?: string; prompt?: CanvasPrompt }>("/api/concepts/again", { id, comment }),
  stopListening: (conn: string) => post("/api/listen/stop", { conn }),
  clearChangelog: () => post("/api/changelog/clear", {}),
  cancelPrompt: (id: string) => post("/api/prompt/cancel", { id }),
  clearPrompts: () => post("/api/prompt/clear", {}),
  permission: (request_id: string, behavior: "allow" | "deny") => post("/api/permission", { request_id, behavior }),
  /* Claude Code sessions Loupe runs */
  managed: {
    info: () => fetch("/api/managed").then((r) => r.json()) as Promise<{ available: boolean; sessions: ManagedSession[]; previous: { id: string; label: string; claudeSession: string }[] }>,
    ensure: () => post<{ ok: boolean; started?: boolean; error?: string }>("/api/managed/ensure", {}),
    start: (b: { label?: string; resume?: string } = {}) => post<{ ok: boolean; error?: string; session?: ManagedSession }>("/api/managed/start", b),
    interrupt: (id: string) => post("/api/managed/interrupt", { id }),
    stop: (id: string) => post("/api/managed/stop", { id }),
    transcript: (id: string) => fetch(`/api/managed/transcript?id=${encodeURIComponent(id)}`).then((r) => r.json()).then((d) => (d.events ?? []) as TranscriptEvent[]).catch(() => [] as TranscriptEvent[]),
  },
  /* version history */
  history: {
    diff: (entry: string) => fetch(`/api/history/diff?entry=${encodeURIComponent(entry)}`).then((r) => r.json()) as Promise<{ files?: { file: string; status: string }[]; diff?: string; error?: string }>,
    undo: (entry: string, force = false) => post<{ ok: boolean; error?: string; conflict?: string[]; files?: string[] }>("/api/history/undo", { entry, force }),
    restore: (entry: string, point: "before" | "after") => post<{ ok: boolean; error?: string; files?: string[] }>("/api/history/restore", { entry, point }),
  },
  /* comments pinned on the canvas */
  comments: {
    add: (c: Omit<CanvasComment, "id" | "at" | "status"> & { selection?: unknown }) => post<{ ok: boolean; error?: string; comment?: CanvasComment }>("/api/comments/add", c),
    update: (b: { id: string; text?: string; status?: "open" | "resolved"; x?: number; y?: number }) => post("/api/comments/update", b),
    remove: (id: string) => post("/api/comments/delete", { id }),
    send: (ids: string[], conn?: string | null) => post<{ ok: boolean; error?: string; prompts?: CanvasPrompt[] }>("/api/comments/send", { ids, conn }),
  },
};

/** Transcript events of Loupe's own Claude sessions, as they happen */
export const AGENT_EVENT = "loupe:agent-event";

/** How snapshots are taken: "browser" (sharp screenshots from the server) or "frame" (drawn in the canvas) */
let engineP: Promise<"browser" | "frame"> | null = null;
export function useSnapshotEngine() {
  const [engine, setEngine] = useState<"browser" | "frame" | null>(null);
  useEffect(() => {
    engineP ??= fetch("/api/snapshot/engine").then((r) => r.json()).then((d) => (d.engine === "browser" ? "browser" : "frame")).catch(() => "frame" as const);
    engineP.then(setEngine);
  }, []);
  return engine;
}

/** Live project data over Server-Sent Events. */
export function useCanvasData() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [state, setState] = useState<CanvasState>({});
  const [git, setGit] = useState<GitStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const [frames, setFrames] = useState<FrameStatus>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotIndex>({});
  const [chat, setChat] = useState<ChatState>({ conns: [], prompts: [], permissions: [] });
  const [changelog, setChangelog] = useState<ChangelogEntry[]>([]);
  const [managed, setManaged] = useState<ManagedSession[]>([]);
  const [comments, setComments] = useState<CanvasComment[]>([]);
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
      es.addEventListener("chat", (e) => setChat(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("changelog", (e) => setChangelog(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("agents", (e) => setManaged(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("comments", (e) => setComments(JSON.parse((e as MessageEvent).data)));
      es.addEventListener("agent-event", (e) => window.dispatchEvent(new CustomEvent(AGENT_EVENT, { detail: JSON.parse((e as MessageEvent).data) })));
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
  return { manifest, state, git, connected, refreshGit, setState, frames, agents, edits, snapshots, chat, changelog, managed, comments };
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
