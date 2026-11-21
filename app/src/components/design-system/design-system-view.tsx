import { useMemo } from "react";
import { Browser, Cube, Stack, Info } from "@phosphor-icons/react";
import type { Component, Manifest, Token } from "@/lib/types";
import { cn } from "@/lib/utils";
import { frameUrl } from "@/lib/api";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { DsSection } from "@/components/sidebar";

const CATEGORY_ORDER: { id: string; label: string }[] = [
  { id: "color", label: "Color" },
  { id: "font", label: "Typefaces" },
  { id: "type", label: "Type scale" },
  { id: "radius", label: "Radius" },
  { id: "spacing", label: "Spacing & size" },
  { id: "shadow", label: "Shadow" },
  { id: "motion", label: "Motion" },
  { id: "other", label: "Other" },
];

type Props = {
  manifest: Manifest;
  section: DsSection;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onOpenView: (id: string) => void;
};

export function DesignSystemView({ manifest, section, selectedId, onSelect, onOpenView }: Props) {
  return (
    <ScrollArea className="h-full bg-paper">
      <div className="mx-auto max-w-[1180px] px-8 pt-8 pb-44">
        {section === "tokens" ? (
          <Tokens manifest={manifest} />
        ) : (
          <Components manifest={manifest} group={section} selectedId={selectedId} onSelect={onSelect} onOpenView={onOpenView} />
        )}
      </div>
    </ScrollArea>
  );
}

function Tokens({ manifest }: { manifest: Manifest }) {
  const { tokens, fonts, cssFiles } = manifest.designSystem;
  const byCat = useMemo(() => {
    const m = new Map<string, Token[]>();
    for (const t of tokens) m.set(t.category, [...(m.get(t.category) || []), t]);
    return m;
  }, [tokens]);

  if (!tokens.length && !fonts.length)
    return (
      <Empty title="No design tokens found">
        The scanner looks for CSS custom properties in <code className="font-mono">:root</code>, <code className="font-mono">.dark</code> and Tailwind <code className="font-mono">@theme</code> blocks. Ask Claude Code to move your colors, radii and fonts into CSS variables and they'll show up here.
      </Empty>
    );

  return (
    <div className="flex flex-col gap-10">
      <header>
        <h1 className="text-xl font-semibold tracking-[-0.01em]">Tokens</h1>
        <p className="mt-1 text-muted-foreground">
          Read live from {cssFiles.map((f, i) => <span key={f}>{i > 0 && ", "}<span className="font-mono text-[12px]">{f}</span></span>)}.
        </p>
      </header>
      {fonts.length > 0 && (
        <Section title="Loaded fonts" count={fonts.length}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {fonts.map((f) => (
              <div key={f} className="rounded-lg border bg-background p-4">
                <div className="text-[40px] leading-none" style={{ fontFamily: `"${f}", "${f} Variable", var(--font-sans)` }}>Aa</div>
                <div className="mt-3 font-medium">{f}</div>
              </div>
            ))}
          </div>
        </Section>
      )}
      {CATEGORY_ORDER.filter((c) => byCat.has(c.id)).map((c) => (
        <Section key={c.id} title={c.label} count={byCat.get(c.id)!.length}>
          {c.id === "color" ? <ColorGrid tokens={byCat.get(c.id)!} /> : <TokenTable tokens={byCat.get(c.id)!} category={c.id} />}
        </Section>
      ))}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 flex items-baseline gap-2 text-[15px] font-semibold">
        {title} <span className="text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function ColorGrid({ tokens }: { tokens: Token[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
      {tokens.map((t) => {
        const light = t.values.light || t.values.theme;
        const dark = t.values.dark;
        return (
          <div key={t.name} className="overflow-hidden rounded-lg border bg-background">
            <div className="flex h-20">
              {light && <div className="flex-1" style={{ background: light.display }} title={`Light: ${light.raw}`} />}
              {dark && <div className="flex-1 border-l border-black/5" style={{ background: dark.display }} title={`Dark: ${dark.raw}`} />}
            </div>
            <div className="px-2.5 py-2">
              <div className="truncate font-mono text-[12px] font-medium">{t.name}</div>
              <div className="truncate font-mono text-[11px] text-muted-foreground" title={light?.raw}>{light?.raw ?? dark?.raw}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TokenTable({ tokens, category }: { tokens: Token[]; category: string }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <table className="w-full text-left">
        <thead className="border-b bg-secondary/50 text-xs text-muted-foreground">
          <tr><th className="px-3 py-2 font-medium">Token</th><th className="px-3 py-2 font-medium">Value</th><th className="w-40 px-3 py-2 font-medium">Preview</th></tr>
        </thead>
        <tbody>
          {tokens.map((t) => {
            const v = (t.values.light || t.values.theme || t.values.dark)!;
            return (
              <tr key={t.name} className="border-b last:border-0">
                <td className="px-3 py-2 font-mono text-[12px]">{t.name}</td>
                <td className="max-w-[360px] truncate px-3 py-2 font-mono text-[12px] text-muted-foreground" title={v.raw}>{v.raw}</td>
                <td className="px-3 py-2"><Preview category={category} value={v.display} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Preview({ category, value }: { category: string; value: string }) {
  if (category === "radius") return <div className="size-9 border-2 border-foreground/70 bg-secondary" style={{ borderRadius: value }} />;
  if (category === "shadow") return <div className="h-8 w-14 rounded-md bg-background" style={{ boxShadow: value }} />;
  if (category === "font") return <span className="text-lg" style={{ fontFamily: value }}>Aa Bb</span>;
  if (category === "spacing" && /^[\d.]+(px|rem|em)$/.test(value)) return <div className="h-2 rounded-sm bg-link/60" style={{ width: `min(${value}, 140px)` }} />;
  if (category === "type" && /^[\d.]+(px|rem|em)$/.test(value)) return <span style={{ fontSize: `min(${value}, 32px)` }}>Aa</span>;
  return <span className="text-muted-foreground">–</span>;
}

function Components({ manifest, group, selectedId, onSelect, onOpenView }: Omit<Props, "section"> & { group: "primitive" | "component" }) {
  const list = manifest.designSystem.components.filter((c) => c.group === group);
  const title = group === "primitive" ? "Primitives" : "Components";
  if (!list.length)
    return (
      <Empty title={`No ${title.toLowerCase()} found`}>
        {group === "primitive"
          ? <>Primitives are read from <code className="font-mono">components/ui/</code> (the shadcn convention). Ask Claude Code to add one, e.g. <em>“add the shadcn button and card primitives”</em>.</>
          : <>Components are read from any <code className="font-mono">components/</code> folder outside <code className="font-mono">ui/</code>.</>}
      </Empty>
    );
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
        <p className="mt-1 max-w-[64ch] text-muted-foreground">
          Select one to scope your next prompt in Claude Code to that component only.
          {!manifest.previewRoute && <> Run <span className="font-mono text-[12px] text-foreground">/loupe-preview</span> in Claude Code to get live previews here.</>}
        </p>
      </header>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
        {list.map((c) => <ComponentCard key={c.id} c={c} manifest={manifest} selected={selectedId === c.id} onSelect={onSelect} onOpenView={onOpenView} />)}
      </div>
    </div>
  );
}

function ComponentCard({ c, manifest, selected, onSelect, onOpenView }: { c: Component; manifest: Manifest; selected: boolean; onSelect: (id: string | null) => void; onOpenView: (id: string) => void }) {
  const Icon = c.group === "primitive" ? Cube : Stack;
  const views = c.usedBy.map((id) => manifest.views.find((v) => v.id === id)).filter(Boolean);
  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-background transition-shadow",
        selected && "border-scope shadow-[0_0_0_1px_var(--scope)]",
      )}
    >
      {manifest.previewRoute && (
        <div className="relative h-36 overflow-hidden border-b bg-white">
          <iframe
            title={`${c.name} preview`}
            src={frameUrl(manifest.devUrl, `${manifest.previewRoute}?component=${encodeURIComponent(c.name)}`)}
            className="pointer-events-none absolute top-0 left-0 h-[288px] w-[200%] origin-top-left scale-50 border-0"
            loading="lazy"
            tabIndex={-1}
          />
        </div>
      )}
      <button
        type="button"
        onClick={() => onSelect(selected ? null : c.id)}
        aria-pressed={selected}
        className="flex flex-col gap-2 p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="flex items-center gap-2">
          <Icon size={16} weight={selected ? "fill" : "regular"} className={selected ? "" : "text-muted-foreground"} />
          <h3 className="font-semibold">{c.name}</h3>
          {selected && <Badge variant="scope" className="ml-auto">Scoped</Badge>}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">{c.file}</div>
        {Object.keys(c.variants).length > 0 && (
          <dl className="flex flex-col gap-1.5 pt-1">
            {Object.entries(c.variants).map(([k, vals]) => (
              <div key={k} className="flex flex-wrap items-center gap-1">
                <dt className="mr-1 text-xs text-muted-foreground">{k}</dt>
                {vals.map((v) => <dd key={v}><Badge variant="outline" className="font-mono">{v}</Badge></dd>)}
              </div>
            ))}
          </dl>
        )}
        {c.exports.length > 1 && <p className="text-xs text-muted-foreground">Also exports {c.exports.slice(1).join(", ")}</p>}
      </button>
      <div className="mt-auto border-t px-3.5 py-2.5">
        {views.length ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Used in</span>
            {views.slice(0, 6).map((v) => (
              <button key={v!.id} type="button" onClick={() => onOpenView(v!.id)} className="inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <Browser size={11} /> {v!.name}
              </button>
            ))}
            {views.length > 6 && <span className="text-xs text-muted-foreground">+{views.length - 6}</span>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">Not imported by any view</span>
        )}
      </div>
    </article>
  );
}

function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-2 rounded-xl border border-dashed border-wire bg-background/60 p-8 text-center">
      <Info size={22} className="text-muted-foreground" />
      <h1 className="font-semibold">{title}</h1>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}
