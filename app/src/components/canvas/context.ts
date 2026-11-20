import { createContext, useContext } from "react";
import type { Manifest, FrameStatus, Agent, SnapshotIndex } from "@/lib/types";

export type CanvasCtx = {
  manifest: Manifest;
  device: "desktop" | "mobile";
  selectedId: string | null;
  interactiveId: string | null;
  showLive: boolean;
  devUp: boolean | null;
  reloadKey: number;
  full: boolean;
  heights: Record<string, number>;
  frames: FrameStatus;
  frameBase: string;
  reportHeight: (id: string, h: number) => void;
  wire: boolean;
  agentsByView: Map<string, Agent[]>;
  globalAgents: Agent[];
  edits: Record<string, number>;
  snapshots: SnapshotIndex;
  select: (id: string | null) => void;
  setInteractive: (id: string | null) => void;
  rename: (id: string, name: string) => void;
  setParam: (route: string, url: string) => void;
};
export const CanvasContext = createContext<CanvasCtx | null>(null);
export function useCanvas() {
  const c = useContext(CanvasContext);
  if (!c) throw new Error("CanvasContext missing");
  return c;
}
