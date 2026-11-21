import { createContext, useContext } from "react";
import type { Manifest, FrameStatus, Agent, SnapshotIndex, PickedElement, CanvasComment } from "@/lib/types";

export type CommentDraft = { viewId: string; x: number; y: number; section: { index: number; name: string } | null };

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
  selectedSection: { viewId: string; top: number; height: number; name: string } | null;
  pickingId: string | null;
  setPicking: (id: string | null) => void;
  selectedElements: { viewId: string; elements: PickedElement[] } | null;
  onPicked: (viewId: string, elements: PickedElement[]) => void;
  select: (id: string | null) => void;
  /** The view whose content is in scope: the selected view, or the view of a selected section or elements */
  activeViewId: string | null;
  selectedSectionId: string | null;
  selectSection: (viewId: string, index: number | null) => void;
  /** Open findings from the helper buddy, per view */
  findingCounts: Record<string, number>;
  /** The view the helper buddy is looking at right now */
  inspectingId: string | null;
  setInteractive: (id: string | null) => void;
  rename: (id: string, name: string) => void;
  setParam: (route: string, url: string) => void;
  /** Comment mode: clicking a page pins a comment there */
  commenting: boolean;
  comments: CanvasComment[];
  activeComment: string | null;
  showComment: (c: CanvasComment) => void;
  draft: CommentDraft | null;
  setDraft: (d: CommentDraft | null) => void;
};
export const CanvasContext = createContext<CanvasCtx | null>(null);
export function useCanvas() {
  const c = useContext(CanvasContext);
  if (!c) throw new Error("CanvasContext missing");
  return c;
}
