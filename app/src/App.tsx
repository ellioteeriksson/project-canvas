import { useCallback, useEffect, useRef, useState } from "react";
import { SidebarSimple, TreeStructure, FlowArrow, Swatches, Rows, ClockCounterClockwise, Play, ChatCircleDots, ChatTeardropText } from "@phosphor-icons/react";
import { SidePanel, PANEL_W, type PanelTab } from "@/components/side-panel";
import type { CanvasComment } from "@/lib/types";
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
  const { manifest, state, git, connected, refreshGit, setState, frames, agents, edits, snapshots, chat, changelog, managed, comments } = useCanvasData();
  // The right-hand panel (full chat or comments), where prompts go, and comment mode
  const [panel, setPanel] = useState<PanelTab | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [canStart, setCanStart] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const [winW, setWinW] = useState(() => window.innerWidth);
  useEffect(() => { const on = () => setWinW(window.innerWidth); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []);
  useEffect(() => {
    // In the Loupe app, opening a project starts a Claude session for it (unless a chat is already connected)
    api.managed.info().then((d) => setCanStart(!!d.available)).catch(() => {});
    if (shell) api.managed.ensure().catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "j") { e.preventDefault(); setPanel((p) => (p ? null : "claude")); return; }
      if (t.closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "c" && tab === "canvas") { e.preventDefault(); setCommenting((on) => !on); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
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
  const insetRight = panel ? PANEL_W + 8 : 0;
  // With the panel open the tab labels only fit on wide windows
  const openComments = comments.filter((c) => c.status !== "resolved").length;
  const toggleCommenting = (on: boolean) => { setCommenting(on); if (on) { setTab("canvas"); setPanel((p) => p ?? "comments"); } };
  const showComment = (c: CanvasComment) => {
    setActiveComment(c.id);
    setPanel("comments");
    setTab("canvas");
    setTimeout(() => canvas.current?.focus(c.viewId), 60);
  };
  const isProduct = manifest.mode === "flow";
  // Room the floating project panel takes on the left of the canvas
  const insetLeft = sidebar ? 288 : 12;
  const compactTabs = winW - insetLeft - insetRight < 1000;
  const selectionName = selection?.name ?? manifest.views.find((v) => v.id === selectedId)?.name ?? manifest.designSystem.components.find((c) => c.id === selectedId)?.name;
  const scopeName = selectionName ? (selection?.kind === "section" || selection?.kind === "elements" ? `${selectionName} on ${selection.viewName}` : selectionName) : null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="relative h-full overflow-hidden bg-paper" style={{ ["--inset-left" as string]: `${insetLeft}px` }}>
        {/* The work fills the window; tools float above it */}
        <main className="absolute inset-0">
          {tab === "canvas" ? (
            <CanvasView ref={canvas} manifest={manifest} selectedId={selectedId} onSelect={select} frames={frames} agents={agents} edits={edits} snapshots={snapshots} selection={selection} onPickElements={pickElements} insetLeft={insetLeft} findingCounts={findingCounts} inspectingId={inspectingId} insetRight={insetRight} commenting={commenting} onCommenting={toggleCommenting} comments={comments} activeComment={activeComment} onShowComment={showComment} />
          ) : (
            <div className="absolute inset-0 pt-[68px]" style={{ paddingLeft: insetLeft, paddingRight: insetRight }}>
              {tab === "sections" ? (
                <SectionsView manifest={manifest} snapshots={snapshots} selectedId={selectedId} onSelect={select} onShowView={openView} />
              ) : tab === "changelog" ? (
                <ChangelogView manifest={manifest} entries={changelog} />
              ) : (
                <DesignSystemView manifest={manifest} section={dsSection} selectedId={selectedId} onSelect={select} onOpenView={openView} />
              )}
            </div>
          )}
          {panel !== "claude" && <PromptBar
            chat={chat}
            agents={agents}
            selection={selection}
            insetLeft={insetLeft}
            insetRight={72 + insetRight}
            target={target}
            onTarget={setTarget}
            canStart={canStart}
            onOpenChat={() => setPanel("claude")}
            onClearScope={() => select(null)}
            onConcepts={setConceptId}
            scopeName={scopeName}
          />}
          {panel && (
            <SidePanel
              tab={panel} onTab={setPanel} onClose={() => { setPanel(null); setCommenting(false); }}
              manifest={manifest} chat={chat} agents={agents} managed={managed} canStart={canStart}
              target={target} onTarget={setTarget}
              selection={selection} scopeName={scopeName} onClearScope={() => select(null)} onConcepts={setConceptId}
              comments={comments} activeComment={activeComment} onShowComment={showComment} commenting={commenting} onCommenting={toggleCommenting}
            />
          )}
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
        <div className={cn("island absolute top-3 z-20 p-1", !compactTabs && "-translate-x-1/2")} style={compactTabs ? { left: insetLeft + 12 } : { left: `calc(${insetLeft}px + (100% - ${insetLeft + insetRight}px) / 2)` }}>
          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <TabsList className="bg-transparent [&_[data-state=active]]:bg-segment [&_[data-state=active]]:shadow-none dark:[&_[data-state=active]]:bg-white/12">
              {([["canvas", "Canvas", ModeIcon], ["sections", "Sections", Rows], ["design", "Design system", Swatches], ["changelog", "Changelog", ClockCounterClockwise]] as const).map(([id, label, Icon]) =>
                compactTabs ? (
                  <Tooltip key={id}>
                    <TooltipTrigger asChild><TabsTrigger value={id} aria-label={label}><Icon size={15} /></TabsTrigger></TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                  </Tooltip>
                ) : <TabsTrigger key={id} value={id}><Icon size={15} /> {label}</TabsTrigger>,
              )}
            </TabsList>
          </Tabs>
        </div>

        {/* Actions */}
        <div className="island absolute top-3 z-20 flex items-center gap-1 p-1.5" style={{ right: 12 + insetRight }}>
          <AgentIndicator agents={agents} manifest={manifest} onFocus={(id) => { setTab("canvas"); setTimeout(() => canvas.current?.focus(id), 60); }} />
          <ThemeToggle />
          <SettingsPopover manifest={manifest} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Play: open the site full screen" onClick={() => {
                // Start on the selected page, like Figma's Present starts on the selected frame
                const viewId = selection ? (selection.kind === "section" || selection.kind === "elements" ? selection.viewId : selection.id) : null;
                const v = manifest.views.find((x) => x.id === viewId && x.url && !x.dynamic) ?? manifest.views.find((x) => x.url && !x.dynamic);
                if (!v?.url) return;
                const url = manifest.devUrl.replace(/\/$/, "") + (v.url.startsWith("/") ? v.url : "/" + v.url);
                if (shell?.play) shell.play({ url, device: manifest.viewport, title: `${manifest.project.name}: ${v.name}` });
                else window.open(url, "_blank", "noopener");
              }}>
                <Play size={17} weight="fill" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Play: open the site full screen from the selected page {shell ? "(Esc to leave)" : "in a new tab"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label="Comments" aria-pressed={panel === "comments"} onClick={() => setPanel((p) => (p === "comments" ? null : "comments"))}>
                <ChatTeardropText size={17} weight={panel === "comments" ? "fill" : "regular"} />
                {openComments > 0 && <span className="absolute top-0.5 right-0.5 grid h-[15px] min-w-[15px] place-items-center rounded-full bg-scope px-1 text-[9.5px] font-semibold text-white tabular-nums">{openComments}</span>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Comments (C to add one)</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label="Chat with Claude" aria-pressed={panel === "claude"} onClick={() => setPanel((p) => (p === "claude" ? null : "claude"))}>
                <ChatCircleDots size={17} weight={panel === "claude" ? "fill" : "regular"} />
                {managed.some((m) => m.state === "working" || m.state === "waiting") && <span className="agent-dot absolute top-1 right-1 size-2 rounded-full bg-[var(--agent)]" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Chat with Claude (⌘J)</TooltipContent>
          </Tooltip>
          <ShipButton git={git} onDone={refreshGit} />
        </div>

        {louOn && <Buddy
          manifest={manifest}
          chat={chat}
          base={manifest.frameUrl || manifest.devUrl}
          canvas={canvas}
          tab={tab}
          parkLeft={conceptId && !conceptsTucked ? Math.min(860, window.innerWidth - 24) + 8 : insetRight}
          selectedViewId={selection ? (selection.kind === "section" || selection.kind === "elements" ? selection.viewId : selection.kind === "view" ? selection.id : null) : null}
          onCounts={setFindingCounts}
          onInspecting={setInspectingId}
          onShowView={(id) => { setTab("canvas"); select(id); setTimeout(() => canvas.current?.focus(id), 60); }}
          onFix={async (f: Finding) => {
            // Scope the fix to its page when it's about one page
            await api.select(f.views.length === 1 ? { kind: "view", id: f.views[0] } : null);
            const conn = chat.conns.find((c) => c.status !== "offline");
            await api.prompt(f.fix, managed.length > 1 ? "auto" : conn?.id ?? null, "direct");
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
