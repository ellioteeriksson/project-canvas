export type View = {
  id: string; name: string; route: string; file: string | null; dynamic: boolean;
  url: string | null; manual: boolean; files: string[]; sharedFiles: string[];
  codeSections?: { name: string; file: string }[];
};
export type Group = { id: string; name: string; route: string; group: true };
export type Edge = { id: string; source: string; target: string; kind: "tree" | "link" | "manual"; label?: string };
export type Token = { name: string; file: string; category: string; values: Record<string, { raw: string; display: string }> };
export type Component = { id: string; name: string; file: string; group: "primitive" | "component"; exports: string[]; variants: Record<string, string[]>; usedBy: string[] };
export type Manifest = {
  project: { name: string; root: string; framework: string };
  mode: "sitemap" | "flow"; modeSource: "auto" | "config";
  /** What's chosen in .canvas/config.json, "auto" when detected */
  frameworkSetting?: string;
  /** How design concepts are made: fast (Loupe sketches 4 at once) with a model, or by the chat */
  concepts?: { fast: boolean; model: string };
  devUrl: string; frameUrl?: string; viewport: "desktop" | "mobile"; previewRoute: string | null;
  frameHeight: "viewport" | "full"; frameConcurrency: number; frameLayer: "live" | "wireframe";
  changedAt: Record<string, number>; globalFiles: string[];
  positions: Partial<Record<"sitemap" | "flow" | "sitemap-full" | "flow-full", Record<string, { x: number; y: number }>>>;
  views: View[]; groups: Group[]; edges: { tree: Edge[]; links: Edge[] };
  designSystem: { tokens: Token[]; fonts: string[]; components: Component[]; cssFiles: string[] };
  scannedAt: string;
};
export type Selection =
  | { kind: "view"; id: string; name: string; route: string; url: string | null; file: string | null; files: string[]; sharedFiles: string[] }
  | { kind: "component"; id: string; name: string; file: string; files: string[]; usedBy: string[] }
  | { kind: "elements"; id: string; name: string; viewId: string; viewName: string; route: string; elements: PickedElement[] }
  | { kind: "section"; id: string; name: string; viewId: string; viewName: string; route: string; component: string | null; componentFile: string | null; position: { index: number; of: number; top: number; height: number } };
export type CanvasState = { pid?: number | null; url?: string; selection?: Selection | null; updatedAt?: string };
export type GitStatus = {
  repo: boolean; branch?: string; defaultBranch?: string; files?: { status: string; file: string }[];
  remote?: string | null; upstream?: string | null; ahead?: number | null; gh?: boolean;
};
export type ShipAction = "commit" | "push" | "pr";
export type ShipResult = { ok: boolean; steps: { cmd: string; ok: boolean; out: string }[]; branch?: string; prUrl?: string | null; error?: string };
export type FrameStatus = Record<string, { status: number; ms?: number; error?: string; at: number }>;
export type AgentPhase = "thinking" | "reading" | "editing" | "running";
export type Agent = {
  key: string; session: string; label: string; sub: boolean; phase: AgentPhase;
  file: string | null; command: string | null; views: string[]; global: boolean; since: number; last: number;
};
export type EditEvent = { file: string | null; views: string[]; global: boolean; at: number };
export type PageSection = { name: string; heading: string | null; tag: string; id: string | null; component: string | null; top: number; height: number };
export type Snapshot = { file: string; at: number; h: number; w: number; sections?: PageSection[]; engine?: "browser" };
export type SnapshotIndex = Record<string, Snapshot>;
export type PickedElement = {
  kind: string; tag: string; id: string | null; selector: string; text: string | null; href: string | null;
  component: string | null; section: string | null; top: number; left: number; width: number; height: number; html: string;
};
export type ChatStatus = "live" | "listening" | "busy" | "idle" | "offline" | "starting";
/** managed: a Claude Code session Loupe runs itself; name is its name in Loupe ("Claude 2") */
export type ChatConn = { id: string; status: ChatStatus; live: boolean; listen?: boolean; session: string | null; label: string | null; last: number; connectedAt: number; managed?: boolean; name?: string | null };
export type ManagedSession = {
  id: string; label: string; state: "starting" | "idle" | "working" | "waiting"; claudeSession: string | null; startedAt: number;
  error: string | null; prompt: string | null; views: string[]; cost: number; queue: number;
};
export type TranscriptEvent = { at: number } & (
  | { kind: "started"; resumed: boolean }
  | { kind: "stopped"; error: string | null }
  | { kind: "note"; text: string }
  | { kind: "user"; text: string; promptId: string | null; scope: string | null }
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; detail: string; toolId: string }
  | { kind: "result"; toolId: string; error: boolean; text: string }
  | { kind: "ask"; requestId: string; tool: string; detail: string }
  | { kind: "answer"; requestId: string; allowed: boolean }
  | { kind: "done"; error: boolean; text: string; ms?: number }
);
export type CanvasComment = {
  id: string; at: number; status: "open" | "sent" | "resolved"; viewId: string; viewName: string; device: "desktop" | "mobile";
  x: number; y: number; section: { index: number; name: string } | null; text: string; promptId?: string; reply?: string | null; resolvedAt?: number | null;
};
export type CanvasPrompt = {
  id: string; conn: string | null; session: string | null; text: string; scope: string;
  status: "queued" | "sending" | "delivered" | "done" | "failed" | "cancelled" | "concepts" | "findings" | "sketching";
  /** Fast concepts sketched by Loupe: each slot is pending, ready or failed, and concepts holds nulls until ready */
  slots?: ("pending" | "ready" | "failed")[]; slotErrors?: Record<number, string>; sketch?: { stage: string; at: number }; fast?: boolean;
  mode?: "direct" | "concepts" | "apply" | "audit";
  findings?: { rule: string | null; severity: "error" | "warning" | "info"; title: string; detail: string | null; route: string | null; file: string | null; fix: string | null }[]; parent?: string | null; applied?: string;
  concepts?: (Concept | null)[]; chosen?: { index: number; comment: string | null; at: number };
  info?: { viewId: string; url: string; device: "desktop" | "mobile"; section: number | null; selectors: string[] } | null;
  via?: "live" | "listen" | "stop" | "prompt"; reply?: string; note?: string; at: number; deliveredAt?: number; doneAt?: number;
};
export type PermissionRequest = { request_id: string; conn: string; tool_name: string; description: string; input_preview: string; at: number };
export type ChatState = { conns: ChatConn[]; prompts: CanvasPrompt[]; permissions: PermissionRequest[] };
export type Concept = { title: string; summary: string; css: string; replace: { selector: string; html: string }[] };
export type ChangeShot = { before?: string; after?: string; h?: number; w?: number; device?: string };
export type ChangelogEntry = {
  id: string; at: number; endAt?: number; source: "canvas" | "chat" | "loupe"; prompt: string | null; detail?: string | null;
  scope?: string; mode?: string; promptId?: string; summary: string | null; files: string[]; inProgress?: boolean;
  /** Saved versions of the project before and after this change */
  before?: string; after?: string; shots?: Record<string, ChangeShot>; undone?: number; kind?: "undo" | "restore"; undoOf?: string;
};
