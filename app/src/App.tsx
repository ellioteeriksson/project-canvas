import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowsOut, Crosshair, SidebarSimple, TreeStructure, FlowArrow, Swatches, X, Globe, Cube } from "@phosphor-icons/react";
import { useCanvasData, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { CanvasView, type CanvasHandle } from "@/components/canvas/canvas-view";
import { ViewsSidebar, DesignSystemSidebar, type DsSection } from "@/components/sidebar";
import { DesignSystemView } from "@/components/design-system/design-system-view";
import { ShipButton } from "@/components/ship-button";
import { SettingsPopover } from "@/components/settings-popover";

type Tab = "canvas" | "design";

export default function App() {
  const { manifest, state, git, connected, refreshGit, setState } = useCanvasData();
  const [tab, setTab] = useState<Tab>("canvas");
  const [dsSection, setDsSection] = useState<DsSection>("tokens");
  const [sidebar, setSidebar] = useState(true);
  const canvas = useRef<CanvasHandle>(null);
  const selection = state.selection ?? null;
  const selectedId = selection?.id ?? null;

  useEffect(() => { if (manifest) document.title = `${manifest.project.name} · Project Canvas`; }, [manifest?.project.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = useCallback(
    (id: string | null) => {
      const kind = id?.startsWith("component:") ? "component" : "view";
      // optimistic update so the highlight is instant
      setState((s) => ({ ...s, selection: id ? ({ ...(s.selection ?? {}), id, kind } as never) : null }));
      api.select(id ? { kind, id } : null);
    },
    [setState],
  );

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
        <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={() => setSidebar((s) => !s)} aria-label={sidebar ? "Hide views list" : "Show views list"} aria-pressed={sidebar}>
                <SidebarSimple size={17} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{sidebar ? "Hide" : "Show"} list</TooltipContent>
          </Tooltip>
          <div className="flex min-w-0 items-center gap-2 pr-2">
            {isProduct ? <Cube size={16} className="shrink-0" /> : <Globe size={16} className="shrink-0" />}
            <h1 className="truncate text-[14px] font-semibold">{manifest.project.name}</h1>
            <Badge variant="outline" className="hidden md:inline-flex">{manifest.project.framework} · {isProduct ? "product" : "website"}</Badge>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="ml-2">
            <TabsList>
              <TabsTrigger value="canvas"><ModeIcon size={14} /> Canvas</TabsTrigger>
              <TabsTrigger value="design"><Swatches size={14} /> Design system</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="ml-auto flex items-center gap-1.5">
            <ScopeChip name={selectionName} kind={selection?.kind} onClear={() => select(null)} />
            <Separator orientation="vertical" className="mx-1" />
            {tab === "canvas" && (
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => canvas.current?.fitAll()} aria-label="Zoom to fit the whole project"><ArrowsOut size={17} /></Button>
                  </TooltipTrigger>
                  <TooltipContent>Show whole project <Kbd>⇧1</Kbd></TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" onClick={() => canvas.current?.zoomToCenter()} aria-label="Zoom in to the view in the center"><Crosshair size={17} /></Button>
                  </TooltipTrigger>
                  <TooltipContent>Zoom to center view <Kbd>⇧2</Kbd></TooltipContent>
                </Tooltip>
              </>
            )}
            <SettingsPopover manifest={manifest} />
            <ShipButton git={git} onDone={refreshGit} />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <aside className={cn("shrink-0 overflow-hidden border-r bg-background transition-[width] duration-200", sidebar ? "w-[272px]" : "w-0 border-r-0")} aria-hidden={!sidebar}>
            <div className="h-full w-[272px]">
              {tab === "canvas" ? (
                <ViewsSidebar
                  manifest={manifest}
                  selectedId={selectedId}
                  onPick={(id, isGroup) => { if (!isGroup) select(id); canvas.current?.focus(id); }}
                />
              ) : (
                <DesignSystemSidebar manifest={manifest} section={dsSection} onSection={setDsSection} selectedId={selectedId} onPick={(id) => select(id)} />
              )}
            </div>
          </aside>
          <main className="relative min-w-0 flex-1 bg-paper">
            {tab === "canvas" ? (
              <CanvasView ref={canvas} manifest={manifest} selectedId={selectedId} onSelect={select} />
            ) : (
              <DesignSystemView manifest={manifest} section={dsSection} selectedId={selectedId} onSelect={select} onOpenView={openView} />
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

function ScopeChip({ name, kind, onClear }: { name?: string; kind?: "view" | "component"; onClear: () => void }) {
  if (!name)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="hidden h-7 items-center rounded-md border border-dashed border-input px-2 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:inline-flex">
            Prompts affect the whole project
          </span>
        </TooltipTrigger>
        <TooltipContent>Select a view to limit your Claude Code prompts to it</TooltipContent>
      </Tooltip>
    );
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md bg-scope pr-0.5 pl-2 text-xs font-medium text-[#1c2230]" role="status">
      <span className="max-w-[220px] truncate">Prompts only affect {kind === "component" ? "component" : ""} {name}</span>
      <button type="button" onClick={onClear} aria-label="Clear scope" className="grid size-6 place-items-center rounded-[4px] outline-none hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-[#1c2230]">
        <X size={12} weight="bold" />
      </button>
    </span>
  );
}
