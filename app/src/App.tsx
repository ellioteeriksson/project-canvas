import { useCallback, useEffect, useRef, useState } from "react";
import { SidebarSimple, TreeStructure, FlowArrow, Swatches, Globe, Cube, Rows } from "@phosphor-icons/react";
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
import { BrandMark } from "@/components/brand-mark";
import { ConceptDrawer } from "@/components/concept-drawer";

type Tab = "canvas" | "sections" | "design";

export default function App() {
  const { manifest, state, git, connected, refreshGit, setState, frames, agents, edits, snapshots, chat } = useCanvasData();
  const [tab, setTab] = useState<Tab>("canvas");
  const [dsSection, setDsSection] = useState<DsSection>("tokens");
  const [sidebar, setSidebar] = useState(true);
  const [conceptId, setConceptId] = useState<string | null>(null);
  const canvas = useRef<CanvasHandle>(null);
  const selection = state.selection ?? null;
  const selectedId = selection?.id ?? null;

  useEffect(() => { if (manifest) document.title = `${manifest.project.name} · Project Canvas`; }, [manifest?.project.name]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const selectionName = selection?.name ?? manifest.views.find((v) => v.id === selectedId)?.name ?? manifest.designSystem.components.find((c) => c.id === selectedId)?.name;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col">
        {/* Top bar */}
        <header className="relative flex h-[52px] shrink-0 items-center gap-2 border-b bg-chrome px-2.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => setSidebar((s) => !s)} aria-label={sidebar ? "Hide views list" : "Show views list"} aria-pressed={sidebar}>
                <SidebarSimple size={17} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sidebar ? "Hide" : "Show"} list</TooltipContent>
          </Tooltip>
          <div className="flex min-w-0 items-center gap-2.5 pr-2 pl-0.5">
            <BrandMark />
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-[13px] font-semibold">{manifest.project.name}</h1>
              <p className="hidden truncate text-[11px] text-muted-foreground md:block">
                {isProduct ? <Cube size={10} className="mr-1 inline align-[-1px]" /> : <Globe size={10} className="mr-1 inline align-[-1px]" />}
                {isProduct ? "Product" : "Website"}, {manifest.project.framework}
              </p>
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="absolute left-1/2 -translate-x-1/2 max-lg:static max-lg:ml-2 max-lg:translate-x-0">
            <TabsList>
              <TabsTrigger value="canvas"><ModeIcon size={14} /> Canvas</TabsTrigger>
              <TabsTrigger value="sections"><Rows size={14} /> Sections</TabsTrigger>
              <TabsTrigger value="design"><Swatches size={14} /> Design system</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="ml-auto flex items-center gap-1.5">
            <AgentIndicator agents={agents} manifest={manifest} onFocus={(id) => { setTab("canvas"); setTimeout(() => canvas.current?.focus(id), 60); }} />
            <ThemeToggle />
            <SettingsPopover manifest={manifest} />
            <ShipButton git={git} onDone={refreshGit} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className={cn("shrink-0 overflow-hidden border-r bg-chrome transition-[width] duration-200", sidebar ? "w-[272px]" : "w-0 border-r-0")} aria-hidden={!sidebar}>
            <div className="h-full w-[272px]">
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
          </aside>
          <main className="relative min-w-0 flex-1 bg-paper">
            {tab === "sections" ? (
              <SectionsView manifest={manifest} snapshots={snapshots} selectedId={selectedId} onSelect={select} onShowView={openView} />
            ) : tab === "canvas" ? (
              <CanvasView ref={canvas} manifest={manifest} selectedId={selectedId} onSelect={select} frames={frames} agents={agents} edits={edits} snapshots={snapshots} selection={selection} onPickElements={pickElements} />
            ) : (
              <DesignSystemView manifest={manifest} section={dsSection} selectedId={selectedId} onSelect={select} onOpenView={openView} />
            )}
            <PromptBar
              chat={chat}
              agents={agents}
              selection={selection}
              onClearScope={() => select(null)}
              onConcepts={setConceptId}
              scopeName={selectionName ? (selection?.kind === "section" || selection?.kind === "elements" ? `${selectionName} on ${selection.viewName}` : selectionName) : null}
            />
            {conceptId && manifest && (
              <ConceptDrawer id={conceptId} chat={chat} agents={agents} base={manifest.frameUrl || manifest.devUrl} onOpen={setConceptId} onClose={() => setConceptId(null)} />
            )}
            {!connected && (
              <div role="status" className="absolute top-3 left-1/2 -translate-x-1/2 rounded-md border bg-background px-3 py-1.5 text-muted-foreground shadow-sm">
                Lost connection to the canvas server. Reconnecting…
              </div>
            )}
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
