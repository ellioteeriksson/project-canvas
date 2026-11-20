import { useMemo, useState } from "react";
import { Browser, CaretRight, FolderSimple, MagnifyingGlass, WarningCircle, Palette, Cube, Stack } from "@phosphor-icons/react";
import type { Manifest } from "@/lib/types";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { EditableName } from "@/components/canvas/editable-name";

type TreeItem = { id: string; name: string; route: string; group: boolean; needsParam: boolean; children: TreeItem[] };

function buildTree(m: Manifest): TreeItem[] {
  const items = new Map<string, TreeItem>();
  for (const v of m.views) items.set(v.id, { id: v.id, name: v.name, route: v.route, group: false, needsParam: !v.url, children: [] });
  for (const g of m.groups) items.set(g.id, { id: g.id, name: g.name, route: g.route, group: true, needsParam: false, children: [] });
  const hasParent = new Set<string>();
  for (const e of m.edges.tree) {
    const p = items.get(e.source), c = items.get(e.target);
    if (p && c) { p.children.push(c); hasParent.add(c.id); }
  }
  const sort = (a: TreeItem, b: TreeItem) => a.route.localeCompare(b.route);
  for (const it of items.values()) it.children.sort(sort);
  return [...items.values()].filter((i) => !hasParent.has(i.id)).sort(sort);
}

export function ViewsSidebar({ manifest, selectedId, onPick, activeViews }: { manifest: Manifest; selectedId: string | null; onPick: (id: string, isGroup: boolean) => void; activeViews: Set<string> }) {
  const [q, setQ] = useState("");
  const tree = useMemo(() => buildTree(manifest), [manifest]);
  const flat = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return null;
    return manifest.views.filter((v) => v.name.toLowerCase().includes(s) || v.route.toLowerCase().includes(s) || v.file?.toLowerCase().includes(s));
  }, [q, manifest.views]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-3 pt-3 pb-2">
        <h2 className="text-[13px] font-semibold">Views</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{manifest.views.length}</span>
      </div>
      <div className="relative px-3 pb-2">
        <MagnifyingGlass size={14} className="pointer-events-none absolute top-1/2 left-5.5 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a view" aria-label="Find a view" className="h-7 pl-7" />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <ul className="px-1.5 pb-3" role="tree" aria-label="Project views">
          {flat
            ? flat.map((v) => <Row key={v.id} item={{ id: v.id, name: v.name, route: v.route, group: false, needsParam: !v.url, children: [] }} depth={0} selectedId={selectedId} onPick={onPick} active={activeViews} />)
            : tree.map((t) => <Row key={t.id} item={t} depth={0} selectedId={selectedId} onPick={onPick} active={activeViews} />)}
          {flat?.length === 0 && <li className="px-3 py-2 text-muted-foreground">No views match “{q}”.</li>}
        </ul>
      </ScrollArea>
    </div>
  );
}

function Row({ item, depth, selectedId, onPick, active }: { item: TreeItem; depth: number; selectedId: string | null; onPick: (id: string, isGroup: boolean) => void; active: Set<string> }) {
  const [open, setOpen] = useState(depth < 2);
  const selected = selectedId === item.id;
  const Icon = item.group ? FolderSimple : item.needsParam ? WarningCircle : Browser;
  const row = (
    <div
      className={cn(
        "group/row relative flex h-7 items-center gap-1.5 rounded-md pr-2 text-[13px] hover:bg-accent",
        selected && "bg-scope/30 font-medium hover:bg-scope/40",
      )}
      style={{ paddingLeft: 6 + depth * 14 }}
    >
      {selected && <span aria-hidden className="absolute top-1 bottom-1 left-0 w-[3px] rounded-full bg-scope" />}
      {item.children.length > 0 ? (
        <CollapsibleTrigger className="grid size-4 shrink-0 place-items-center rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring" aria-label={open ? `Collapse ${item.name}` : `Expand ${item.name}`}>
          <CaretRight size={11} weight="bold" className={cn("transition-transform", open && "rotate-90")} />
        </CollapsibleTrigger>
      ) : (
        <span className="size-4 shrink-0" />
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left outline-none focus-visible:underline"
        onClick={() => onPick(item.id, item.group)}
        aria-current={selected ? "true" : undefined}
      >
        <Icon size={14} className={cn("shrink-0", item.needsParam ? "text-[#b7791f]" : "text-muted-foreground")} weight={selected ? "fill" : "regular"} />
        <EditableName value={item.name} onSave={(n) => api.config({ names: { [item.id]: n } })} />
        {active.has(item.id) && <span className="agent-dot size-1.5 shrink-0 rounded-full bg-[var(--agent)]" aria-label="Claude is working here" />}
      </button>
      <span className="ml-auto max-w-[52%] shrink-0 truncate text-left font-mono text-[11px] text-muted-foreground [direction:rtl]" title={item.route}><bdi>{item.route}</bdi></span>
    </div>
  );
  return (
    <li role="treeitem" aria-selected={selected} aria-expanded={item.children.length ? open : undefined}>
      {item.children.length > 0 ? (
        <Collapsible open={open} onOpenChange={setOpen}>
          {row}
          <CollapsibleContent>
            <ul role="group">
              {item.children.map((c) => <Row key={c.id} item={c} depth={depth + 1} selectedId={selectedId} onPick={onPick} active={active} />)}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : row}
    </li>
  );
}

export type DsSection = "tokens" | "primitive" | "component";

export function DesignSystemSidebar({ manifest, section, onSection, selectedId, onPick }: {
  manifest: Manifest; section: DsSection; onSection: (s: DsSection) => void; selectedId: string | null; onPick: (id: string) => void;
}) {
  const ds = manifest.designSystem;
  const prim = ds.components.filter((c) => c.group === "primitive");
  const comp = ds.components.filter((c) => c.group === "component");
  const sections: { id: DsSection; label: string; icon: typeof Palette; count: number; items?: typeof prim }[] = [
    { id: "tokens", label: "Tokens", icon: Palette, count: ds.tokens.length },
    { id: "primitive", label: "Primitives", icon: Cube, count: prim.length, items: prim },
    { id: "component", label: "Components", icon: Stack, count: comp.length, items: comp },
  ];
  return (
    <ScrollArea className="h-full">
      <nav className="flex flex-col gap-0.5 p-1.5 pt-3" aria-label="Design system sections">
        {sections.map((s) => (
          <Collapsible key={s.id} open={section === s.id} onOpenChange={(o) => o && onSection(s.id)}>
            <CollapsibleTrigger
              className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", section === s.id && "bg-secondary font-medium")}
            >
              <s.icon size={15} className="text-muted-foreground" weight={section === s.id ? "fill" : "regular"} />
              {s.label}
              <span className="ml-auto text-xs tabular-nums text-muted-foreground">{s.count}</span>
            </CollapsibleTrigger>
            {s.items && s.items.length > 0 && (
              <CollapsibleContent>
                <ul className="py-1">
                  {s.items.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => onPick(c.id)}
                        className={cn("relative flex h-7 w-full items-center gap-2 rounded-md pr-2 pl-8 text-left text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", selectedId === c.id && "bg-scope/30 font-medium")}
                      >
                        {selectedId === c.id && <span aria-hidden className="absolute top-1 bottom-1 left-0 w-[3px] rounded-full bg-scope" />}
                        <span className="truncate">{c.name}</span>
                        <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">{c.usedBy.length || ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </CollapsibleContent>
            )}
          </Collapsible>
        ))}
      </nav>
    </ScrollArea>
  );
}
