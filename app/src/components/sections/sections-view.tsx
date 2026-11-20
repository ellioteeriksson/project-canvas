import { useMemo, useState } from "react";
import { MagnifyingGlass, Rows, SquaresFour, Browser, ArrowSquareOut, CircleNotch } from "@phosphor-icons/react";
import type { Manifest, PageSection, Snapshot, SnapshotIndex, View } from "@/lib/types";
import { snapshotKey } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";

const THUMB_W = 260;
const MAX_THUMB_H = 340;

type Item = { view: View; snap: Snapshot; section: PageSection; index: number; code: { name: string; file: string } | null };

/** Same pairing the server uses: a rendered section ↔ a section component in the page's code. */
function codeFor(view: View, sections: PageSection[], idx: number) {
  const code = view.codeSections || [];
  const sec = sections[idx];
  if (!sec || !code.length) return null;
  const norm = (x: string | null | undefined) => String(x || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const byName = code.find((c) => [sec.component, sec.id, sec.name].some((n) => n && (norm(n) === norm(c.name) || norm(n).includes(norm(c.name)))));
  if (byName) return byName;
  const body = sections.map((s, i) => [s, i] as const).filter(([s]) => !["header", "nav", "footer"].includes(s.tag));
  if (body.length === code.length) { const pos = body.findIndex(([, i]) => i === idx); return pos >= 0 ? code[pos] : null; }
  return null;
}

function snapFor(snapshots: SnapshotIndex, viewId: string, device: string, wire: boolean) {
  const own = snapshots[snapshotKey(viewId, device, wire ? "wireframe" : "live")];
  const live = snapshots[snapshotKey(viewId, device, "live")];
  // Sections are detected on the live render; the image follows the current layer
  if (own && live) return { ...own, sections: live.sections ?? own.sections };
  return own ?? live;
}

export function SectionsView({ manifest, snapshots, selectedId, onSelect, onShowView }: {
  manifest: Manifest; snapshots: SnapshotIndex; selectedId: string | null;
  onSelect: (id: string | null) => void; onShowView: (viewId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<"page" | "component">("page");
  const wire = manifest.frameLayer === "wireframe";
  const device = manifest.viewport;

  const pages = useMemo(() => manifest.views.map((view) => {
    const snap = snapFor(snapshots, view.id, device, wire);
    const items: Item[] = (snap?.sections ?? []).map((section, index, all) => ({ view, snap: snap!, section, index, code: codeFor(view, all, index) }));
    return { view, snap, items };
  }), [manifest.views, snapshots, device, wire]);

  const match = (it: Item) => {
    const s = q.trim().toLowerCase();
    return !s || [it.section.name, it.section.heading, it.code?.name, it.section.component, it.view.name, it.view.route].some((x) => x?.toLowerCase().includes(s));
  };

  const groups = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const p of pages) for (const it of p.items) {
      const key = it.code?.name || it.section.component || it.section.name;
      m.set(key, [...(m.get(key) ?? []), it]);
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [pages]);

  const total = pages.reduce((n, p) => n + p.items.length, 0);
  const rendering = pages.filter((p) => p.view.url && !p.snap).length;

  return (
    <div className="flex h-full flex-col bg-paper">
      <div className="flex flex-wrap items-center gap-3 border-b bg-background px-5 py-3">
        <h1 className="text-[15px] font-semibold">Sections</h1>
        <span className="text-xs tabular-nums text-muted-foreground">{total} on {pages.filter((p) => p.items.length).length} pages</span>
        {rendering > 0 && <span className="flex items-center gap-1 text-xs text-muted-foreground"><CircleNotch size={12} className="animate-spin" /> {rendering} still rendering on the canvas</span>}
        <div className="relative ml-auto w-64">
          <MagnifyingGlass size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a section" aria-label="Find a section" className="h-7 pl-7" />
        </div>
        <ToggleGroup type="single" value={group} onValueChange={(v) => v && setGroup(v as "page" | "component")} aria-label="Group sections">
          <ToggleGroupItem value="page" aria-label="Group by page"><Rows size={14} /> By page</ToggleGroupItem>
          <ToggleGroupItem value="component" aria-label="Group by section"><SquaresFour size={14} /> By section</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {total === 0 ? (
          <div className="mx-auto mt-20 max-w-md rounded-xl border border-dashed border-wire bg-background/60 p-8 text-center">
            <p className="font-semibold">No sections yet</p>
            <p className="mt-1 text-muted-foreground">Sections are found while the canvas renders each page. Open the Canvas tab and let the snapshots finish. Pages that use <code className="font-mono">&lt;section&gt;</code>, <code className="font-mono">&lt;header&gt;</code> and <code className="font-mono">&lt;footer&gt;</code> give the best results.</p>
          </div>
        ) : group === "page" ? (
          <div className="flex gap-6 overflow-x-auto p-6">
            {pages.filter((p) => p.items.some(match)).map((p) => (
              <section key={p.view.id} id={`sections-${p.view.id}`} className="w-[260px] shrink-0" aria-label={p.view.name}>
                <header className="mb-2 flex items-center gap-1.5">
                  <Browser size={14} className="shrink-0 text-muted-foreground" />
                  <h2 className="truncate text-[13px] font-semibold">{p.view.name}</h2>
                  <Button variant="ghost" size="icon-sm" className="ml-auto" onClick={() => onShowView(p.view.id)} aria-label={`Show ${p.view.name} on the canvas`}>
                    <ArrowSquareOut size={14} />
                  </Button>
                </header>
                <div className="flex flex-col gap-2">
                  {p.items.filter(match).map((it) => <SectionCard key={it.index} it={it} selected={selectedId === `${it.view.id}::${it.index}`} onSelect={onSelect} />)}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-8 p-6">
            {groups.filter(([, items]) => items.some(match)).map(([name, items]) => (
              <section key={name} aria-label={name}>
                <h2 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
                  {name}
                  <span className="text-xs font-normal text-muted-foreground">
                    {items.length === 1 ? "1 page" : `${new Set(items.map((i) => i.view.id)).size} pages`}
                    {items[0].code ? <span className="ml-2 font-mono">{items[0].code.file}</span> : null}
                  </span>
                </h2>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {items.filter(match).map((it) => (
                    <div key={`${it.view.id}-${it.index}`} className="w-[260px] shrink-0">
                      <SectionCard it={it} selected={selectedId === `${it.view.id}::${it.index}`} onSelect={onSelect} showPage />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

function SectionCard({ it, selected, onSelect, showPage }: { it: Item; selected: boolean; onSelect: (id: string | null) => void; showPage?: boolean }) {
  const scale = THUMB_W / (it.snap.w || 1440);
  const h = Math.max(24, Math.round(it.section.height * scale));
  const id = `${it.view.id}::${it.index}`;
  const meta = it.code?.name ? `<${it.code.name} />` : it.section.component ? `<${it.section.component} />` : `<${it.section.tag}>`;
  return (
    <button
      type="button"
      onClick={() => onSelect(selected ? null : id)}
      aria-pressed={selected}
      className={cn(
        "group/section block w-full overflow-hidden rounded-md border bg-background text-left outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-scope shadow-[0_0_0_1px_var(--scope)]" : "hover:border-input",
      )}
    >
      <div
        className="relative w-full bg-no-repeat"
        style={{
          height: Math.min(h, MAX_THUMB_H),
          backgroundImage: `url(/api/snapshots/${it.snap.file})`,
          backgroundSize: `${THUMB_W}px auto`,
          backgroundPosition: `0 -${Math.round(it.section.top * scale)}px`,
        }}
      >
        {h > MAX_THUMB_H && <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-background to-transparent" />}
      </div>
      <div className="flex items-center gap-2 border-t px-2.5 py-1.5">
        <span className={cn("truncate text-[12px] font-medium", selected && "text-scope")}>{showPage ? it.view.name : it.section.name}</span>
        <span className="ml-auto shrink-0 truncate font-mono text-[10.5px] text-muted-foreground">{meta}</span>
      </div>
    </button>
  );
}
