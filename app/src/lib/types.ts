export type View = {
  id: string; name: string; route: string; file: string | null; dynamic: boolean;
  url: string | null; manual: boolean; files: string[]; sharedFiles: string[];
};
export type Group = { id: string; name: string; route: string; group: true };
export type Edge = { id: string; source: string; target: string; kind: "tree" | "link" | "manual"; label?: string };
export type Token = { name: string; file: string; category: string; values: Record<string, { raw: string; display: string }> };
export type Component = { id: string; name: string; file: string; group: "primitive" | "component"; exports: string[]; variants: Record<string, string[]>; usedBy: string[] };
export type Manifest = {
  project: { name: string; root: string; framework: string };
  mode: "sitemap" | "flow"; modeSource: "auto" | "config";
  devUrl: string; frameUrl?: string; viewport: "desktop" | "mobile"; previewRoute: string | null;
  frameHeight: "viewport" | "full"; frameConcurrency: number;
  positions: Partial<Record<"sitemap" | "flow", Record<string, { x: number; y: number }>>>;
  views: View[]; groups: Group[]; edges: { tree: Edge[]; links: Edge[] };
  designSystem: { tokens: Token[]; fonts: string[]; components: Component[]; cssFiles: string[] };
  scannedAt: string;
};
export type Selection =
  | { kind: "view"; id: string; name: string; route: string; url: string | null; file: string | null; files: string[]; sharedFiles: string[] }
  | { kind: "component"; id: string; name: string; file: string; files: string[]; usedBy: string[] };
export type CanvasState = { pid?: number | null; url?: string; selection?: Selection | null; updatedAt?: string };
export type GitStatus = {
  repo: boolean; branch?: string; defaultBranch?: string; files?: { status: string; file: string }[];
  remote?: string | null; upstream?: string | null; ahead?: number | null; gh?: boolean;
};
export type ShipAction = "commit" | "push" | "pr";
export type ShipResult = { ok: boolean; steps: { cmd: string; ok: boolean; out: string }[]; branch?: string; prUrl?: string | null; error?: string };
export type FrameStatus = Record<string, { status: number; ms?: number; error?: string; at: number }>;
