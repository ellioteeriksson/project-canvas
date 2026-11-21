import { useCallback, useEffect, useRef, useState } from "react";
import { SidebarSimple, TreeStructure, FlowArrow, Swatches, Rows, ClockCounterClockwise } from "@phosphor-icons/react";
import { ChangelogView } from "@/components/changelog-view";
import { Buddy } from "@/components/buddy";
import { ShortcutsDialog } from "@/components/shortcuts-dialog";
import { usePref } from "@/lib/prefs";
import type { Finding } from "@/lib/audit";
import { useCanvasData, api } from "@/lib/api";
import type { PickedElement } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CanvasView, type CanvasHandle } from "@/components/canvas/canvas-view";
import { ViewsSidebar, DesignSystemSidebar, type DsSection } from "@/components/sidebar";
import { DesignSystemView } from "@/components/design-system/design-system-view";
import { SectionsView } from "@/components/sections/sections-view";
import { ShipButton } from "@/components/ship-button";
import { SettingsPopover } from "@/components/settings-popover";
import { ThemeToggle } from "@/components/theme-toggle";
import { AgentIndicator } from "@/components/agent-indicator";
import { PromptBar } from "@/components/prompt-bar";
import { shell } from "@/lib/shell";
import { BrandMark } from "@/components/brand-mark";
import { ConceptDrawer } from "@/components/concept-drawer";

type Tab = "canvas" | "sections" | "design" | "changelog";

export default function App() {
  const { manifest, state, git, connected, refreshGit, setState, frames, agents, edits, snapshots, chat, changelog } = useCanvasData();
  const [tab, setTab] = useState<Tab>("canvas");
  const [dsSection, setDsSection] = useState<DsSection>("tokens");
  const [sidebar, setSidebar] = useState(true);
  const [conceptId, setConceptId] = useState<string | null>(null);
  const [conceptsTucked, setConceptsTucked] = useState(false);
  const [findingCounts, setFindingCounts] = useState<Record<string, number>>({});
  const [louOn] = usePref("lou", true);
  useEffect(() => { if (!louOn) { setFindingCounts({}); setInspectingId(null); } }, [louOn]);
  const [inspectingId, setInspectingId] = useState<string | null>(null);
  const canvas = useRef<CanvasHandle>(null);
  const selection = state.selection ?? null;
  const selectedId = selection?.id ?? null;

  useEffect(() => { if (manifest) document.title = `${manifest.project.name} · Loupe`; }, [manifest?.project.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback(
    (id: string | null, extra?: Record<string, unknown>) => {
      const kind = id?.includes("::") ? "section" : id?.startsWith("component:") ? "component" : "view";
      // optimistic update so the highlight is instant
      setState((s) => {
        const viewId = kind === "section" ? id!.split("::")[0] : undefined;
        const viewName = viewId ? manifest?.views.find((v) => v.id === viewId)?.name : undefined;
        return { ...s, selection: id ? ({ ...(s.selection?.id === id ? s.selection : {}), id, kind, ...(viewId ? { viewId, viewName } : {}) } as never) : null };
      });
      api.select(id ? { kind, id, ...extra } : null);
    },
    [setState, manifest],
  );

  const pickElements = useCallback((viewId: string, elements: PickedElement[]) => {
    const view = manifest?.views.find((v) => v.id === viewId);
    if (!elements.length) return select(null);
    setState((s) => ({ ...s, selection: { kind: "elements", id: `${viewId}::elements`, viewId, viewName: view?.name ?? viewId, route: view?.route ?? viewId, name: elements.length === 1 ? elements[0].kind : `${elements.length} elements`, elements } }));
    api.select({ kind: "elements", id: `${viewId}::elements`, viewId, elements });
  }, [manifest, select, setState]);

  const openView = (id: string) => {
    setTab("canvas");
    select(id);
    setTimeout(() => canvas.current?.focus(id), 60);
  };

  if (!manifest)
    return (
      <div className="grid h-full place-items-center bg-paper text-muted-foreground">
        {connected ? "Scanning project…" : "Connecting to the canvas server…"}
      </div>
    );

  const ModeIcon = manifest.mode === "flow" ? FlowArrow : TreeStructure;
  const isProduct = manifest.mode === "flow";
  // Room the floating project panel takes on the left of the canvas
  const insetLeft = sidebar ? 288 : 12;
  const selectionName = selection?.name ?? manifest.views.find((v) => v.id === selectedId)?.name ?? manifest.designSystem.components.find((c) => c.id === selectedId)?.name;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative h-full overflow-hidden bg-paper" style={{ ["--inset-left" as string]: `${insetLeft}px` }}>
        {/* The work fills the window; tools float above it */}
        <main className="absolute inset-0">
          {tab === "canvas" ? (
            <CanvasView ref={canvas} manifest={manifest} selectedId={selectedId} onSelect={select} frames={frames} agents={agents} edits={edits} snapshots={snapshots} selection={selection} onPickElements={pickElements} insetLeft={insetLeft} findingCounts={findingCounts} inspectingId={inspectingId} />
          ) : (
            <div className="absolute inset-0 pt-[68px]" style={{ paddingLeft: insetLeft }}>
              {tab === "sections" ? (
                <SectionsView manifest={manifest} snapshots={snapshots} selectedId={selectedId} onSelect={select} onShowView={openView} />
              ) : tab === "changelog" ? (
                <ChangelogView manifest={manifest} entries={changelog} />
              ) : (
                <DesignSystemView manifest={manifest} section={dsSection} selectedId={selectedId} onSelect={select} onOpenView={openView} />
              )}
            </div>
          )}
          <PromptBar
            chat={chat}
            agents={agents}
            selection={selection}
            insetLeft={insetLeft}
            onClearScope={() => select(null)}
            onConcepts={setConceptId}
            scopeName={selectionName ? (selection?.kind === "section" || selection?.kind === "elements" ? `${selectionName} on ${selection.viewName}` : selectionName) : null}
          />
          {conceptId && manifest && (
            <ConceptDrawer id={conceptId} chat={chat} agents={agents} base={manifest.frameUrl || manifest.devUrl} onOpen={setConceptId} onClose={() => setConceptId(null)} collapsed={conceptsTucked} setCollapsed={setConceptsTucked} />
          )}
        </main>

        {/* Project and views */}
        <aside
          className={cn("island absolute top-3 left-3 z-20 flex w-[264px] flex-col overflow-hidden transition-[height] duration-200", sidebar ? "bottom-3" : "h-[56px]")}
          aria-label="Project"
        >
          <div className="shell-lights shell-drag flex h-[56px] shrink-0 items-center gap-2.5 pr-2 pl-3.5">
            {shell ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" onClick={() => shell!.showHome()} aria-label="All projects" className="rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring"><BrandMark size={26} /></button>
                </TooltipTrigger>
                <TooltipContent>All projects (⌘1)</TooltipContent>
              </Tooltip>
            ) : <BrandMark size={26} />}
            <div className="min-w-0 flex-1 leading-tight">
              <h1 className="truncate text-[14px] font-semibold">{manifest.project.name}</h1>
              <p className="truncate text-[11.5px] text-muted-foreground">
                {isProduct ? "Product" : "Website"} <span className="font-mono text-[11px]">· {manifest.project.framework}</span>
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" onClick={() => setSidebar((s) => !s)} aria-label={sidebar ? "Hide views list" : "Show views list"} aria-pressed={sidebar}>
                  <SidebarSimple size={17} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{sidebar ? "Hide" : "Show"} list</TooltipContent>
            </Tooltip>
          </div>
          {sidebar && (
            <div className="min-h-0 flex-1 border-t">
              {tab !== "design" ? (
                <ViewsSidebar
                  manifest={manifest}
                  activeViews={new Set(agents.flatMap((a) => a.views))}
                  selectedId={selection && (selection.kind === "section" || selection.kind === "elements") ? selection.viewId : selectedId}
                  onPick={(id, isGroup) => {
                    if (tab === "sections") { document.getElementById(`sections-${id}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }); return; }
                    if (!isGroup) select(id);
                    canvas.current?.focus(id);
                  }}
                />
              ) : (
                <DesignSystemSidebar manifest={manifest} section={dsSection} onSection={setDsSection} selectedId={selectedId} onPick={(id) => select(id)} />
              )}
            </div>
          )}
        </aside>

        {/* Where you are */}
        <div className="island absolute top-3 z-20 -translate-x-1/2 p-1" style={{ left: `calc(${insetLeft}px + (100% - ${insetLeft}px) / 2)` }}>
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="bg-transparent [&_[data-state=active]]:bg-segment [&_[data-state=active]]:shadow-none dark:[&_[data-state=active]]:bg-white/12">
              <TabsTrigger value="canvas"><ModeIcon size={15} /> Canvas</TabsTrigger>
              <TabsTrigger value="sections"><Rows size={15} /> Sections</TabsTrigger>
              <TabsTrigger value="design"><Swatches size={15} /> Design system</TabsTrigger>
              <TabsTrigger value="changelog"><ClockCounterClockwise size={15} /> Changelog</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Actions */}
        <div className="island absolute top-3 right-3 z-20 flex items-center gap-1 p-1.5">
          <AgentIndicator agents={agents} manifest={manifest} onFocus={(id) => { setTab("canvas"); setTimeout(() => canvas.current?.focus(id), 60); }} />
          <ThemeToggle />
          <SettingsPopover manifest={manifest} />
          <ShipButton git={git} onDone={refreshGit} />
        </div>

        {louOn && <Buddy
          manifest={manifest}
          chat={chat}
          base={manifest.frameUrl || manifest.devUrl}
          canvas={canvas}
          tab={tab}
          parkLeft={conceptId && !conceptsTucked ? Math.min(860, window.innerWidth - 24) + 8 : 0}
          selectedViewId={selection ? (selection.kind === "section" || selection.kind === "elements" ? selection.viewId : selection.kind === "view" ? selection.id : null) : null}
          onCounts={setFindingCounts}
          onInspecting={setInspectingId}
          onShowView={(id) => { setTab("canvas"); select(id); setTimeout(() => canvas.current?.focus(id), 60); }}
          onFix={async (f: Finding) => {
            // Scope the fix to its page when it's about one page
            await api.select(f.views.length === 1 ? { kind: "view", id: f.views[0] } : null);
            const conn = chat.conns.find((c) => c.status !== "offline");
            await api.prompt(f.fix, conn?.id ?? null, "direct");
          }}
          onFixMany={async (fs: Finding[]) => {
            // One prompt for a whole group, scoped to the project
            await api.select(null);
            const conn = chat.conns.find((c) => c.status !== "offline");
            await api.prompt(`Fix these ${fs.length} problems Lou found in the project, one by one. Keep each change as small as it can be.\n\n${fs.map((f, i) => `${i + 1}. ${f.fix}`).join("\n")}`, conn?.id ?? null, "direct");
          }}
        />}
        <ShortcutsDialog />

        {!connected && (
          <div role="status" className="island absolute top-[68px] left-1/2 z-30 -translate-x-1/2 px-3.5 py-2 text-muted-foreground">
            Lost connection to the canvas server. Reconnecting…
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
