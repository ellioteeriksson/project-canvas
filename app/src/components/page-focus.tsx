import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CaretDown, CaretUp, Columns, DesktopTower, DeviceMobile } from "@phosphor-icons/react";
import { frameUrl } from "@/lib/api";
import type { Agent, CanvasPrompt, ChangelogEntry, ChatState, Manifest, PageSection, PickedElement, Selection } from "@/lib/types";
import { api } from "@/lib/api";
import { ChangeReview, Note } from "@/components/change-review";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { LiveSteps } from "@/components/live-steps";
import { Composer, PermissionStack, PromptState, liveConns, resolveTarget } from "@/components/prompt-bar";

const host = (w: Window | null | undefined, msg: Record<string, unknown>) => { try { w?.postMessage({ source: "project-canvas-host", ...msg }, "*"); } catch {} };
const WIDTH = { desktop: 1440, mobile: 390 } as const;
const COMPOSER_W = 540;

type Props = {
  manifest: Manifest; viewId: string; device: "desktop" | "mobile"; chat: ChatState; agents: Agent[]; edits: Record<string, number>;
  selection: Selection | null; scopeName: string | null; target: string | null; insetLeft: number; insetRight: number;
  onView: (id: string) => void; onDevice: (d: "desktop" | "mobile") => void; onClose: () => void;
  onSection: (viewId: string, index: number | null, section?: PageSection, list?: PageSection[], add?: boolean) => void;
  onElements: (viewId: string, els: PickedElement[]) => void; onConcepts: (id: string) => void;
  basket: BasketItem[]; onClearBasket: () => void; changelog: ChangelogEntry[]; onCompare: (viewId: string) => void;
};

/** A section collected with ⇧-click for one prompt across sections (and pages) */
export type BasketItem = { id: string; viewId: string; viewName: string; index: number; name: string; device: "desktop" | "mobile"; live: PageSection | null; liveList: PageSection[] | null };

/**
 * A page up close: hover a section, click it, and write what should change right there.
 * ⌥-click picks a single element, ⌘-click uses the page as normal, ↑ ↓ step through sections.
 */
export function PageFocus(p: Props) {
  const views = useMemo(() => p.manifest.views.filter((v) => v.url && !v.dynamic), [p.manifest.views]);
  const view = views.find((v) => v.id === p.viewId) ?? views[0];
  const base = p.manifest.frameUrl || p.manifest.devUrl;
  const frame = useRef<HTMLIFrameElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });
  const [list, setList] = useState<PageSection[]>([]);
  const [rect, setRect] = useState<{ top: number; bottom: number; left: number; width: number } | null>(null);
  // What you've done from this view: prompts sent and text edits, until you keep or undo them
  const [mine, setMine] = useState<{ prompts: string[]; entries: string[] }>({ prompts: [], entries: [] });
  const [settled, setSettled] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<{ text: string; tone?: "plain" | "warn" } | null>(null);
  const settle = (...ids: (string | undefined)[]) => setSettled((s) => { const n = new Set(s); ids.forEach((i) => i && n.add(i)); return n; });
  const addPrompts = (ps: CanvasPrompt[]) => setMine((m) => ({ ...m, prompts: [...m.prompts, ...ps.map((x) => x.id)] }));
  const [reloadKey, setReloadKey] = useState(0);
  const scrollRatio = useRef(0);
  // While you edit text on the page, nothing may pull the keyboard to the prompt box
  const editingText = useRef(false);
  const focusInput = (ms: number) => setTimeout(() => { if (!editingText.current) input.current?.focus(); }, ms);

  const sel = p.selection;
  const selIndex = sel?.kind === "section" && sel.viewId === view?.id ? Number(String(sel.id).split("::")[1]) : null;
  const elementsHere = sel?.kind === "elements" && sel.viewId === view?.id;

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = WIDTH[p.device];
  const scale = Math.min(1, (size.w - 48) / W);
  const frameH = size.h / scale;

  // Messages from the page
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== "project-canvas" || e.source !== frame.current?.contentWindow || !view) return;
      if (d.type === "sections") setList(d.list ?? []);
      if (d.type === "section-picked") {
        p.onSection(view.id, d.index, d.section, d.list ?? (list.length ? list : undefined), !!d.add);
        focusInput(260);
      }
      if (d.type === "text-edit-unavailable") setNotice({ text: "Only plain text can be edited in place. Click its section and tell Claude instead.", tone: "warn" });
      if (d.type === "text-editing") editingText.current = !!d.on;
      if (d.type === "text-editing" && d.on) setNotice({ text: "Editing text: Enter saves, Shift+Enter adds a line break, Esc cancels." });
      if (d.type === "text-editing" && !d.on) setNotice(null);
      if (d.type === "text-edited") saveText(d);
      if (d.type === "section-rect") setRect(d.rect);
      if (d.type === "picked" && d.elements?.length) { setRect(null); p.onElements(view.id, d.elements); focusInput(30); }
      if (d.type === "scrolled") scrollRatio.current = d.ratio;
      if (d.type === "mutation" && d.id === pendingEdit.current) pendingEdit.current = null;
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  // Double-clicked text was changed on the page: write it to the source (or have Claude do it)
  const saveText = async (d: { before: string; after: string; element?: { selector?: string }; section?: number; sectionData?: PageSection | null; list?: PageSection[] }) => {
    if (!view) return;
    setNotice({ text: "Saving the text…" });
    const r = await api.textEdit({ viewId: view.id, before: d.before, after: d.after, selector: d.element?.selector, section: d.section, sectionData: d.sectionData, list: d.list, device: p.device })
      .catch(() => ({ ok: false, error: "The canvas server didn't answer" } as { ok: false; error: string }));
    if (!r.ok) { setNotice({ text: ("error" in r && r.error) || "Couldn't save the text", tone: "warn" }); return; }
    if (r.via === "file" && r.entry) { setMine((m) => ({ ...m, entries: [...m.entries, r.entry!] })); setNotice(null); }
    else if (r.prompt) { addPrompts([r.prompt]); setNotice({ text: r.reason === "ambiguous" ? "That text is used in several places, so Claude is changing the right one." : "That text isn't written in the page itself, so Claude is finding where it comes from." }); }
  };

  // Turn on section focus once the page has loaded (and again after it reloads)
  const marks = p.basket.filter((b) => b.viewId === view?.id).map((b) => b.index);
  const start = () => {
    const w = frame.current?.contentWindow;
    host(w, { type: "focus", on: true, section: selIndex });
    host(w, { type: "scroll-sync", on: true });
    host(w, { type: "focus-marks", indices: marks });
    if (scrollRatio.current) host(w, { type: "scroll-to", ratio: scrollRatio.current });
  };
  useEffect(() => { host(frame.current?.contentWindow, { type: "focus-marks", indices: marks }); }, [marks.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!notice || notice.text.startsWith("Editing")) return; const t = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(t); }, [notice]);
  useEffect(() => { setList([]); setRect(null); }, [view?.id, p.device]);

  // Claude changed this page: if hot reload doesn't show it, reload (keeping the scroll position and section)
  const editAt = Math.max(p.edits[view?.id ?? ""] ?? 0, p.edits["*"] ?? 0);
  const pendingEdit = useRef<number | null>(null);
  useEffect(() => {
    if (!editAt) return;
    const t = setTimeout(() => {
      pendingEdit.current = editAt;
      host(frame.current?.contentWindow, { type: "query-mutation", id: editAt });
      setTimeout(() => { if (pendingEdit.current === editAt) { pendingEdit.current = null; setReloadKey((k) => k + 1); } }, 1200);
    }, 2200);
    return () => clearTimeout(t);
  }, [editAt]);

  // Keys: ↑ ↓ through sections, Esc steps back out
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
      if (e.key === "Escape") {
        if (typing) { (e.target as HTMLElement).blur(); return; }
        e.preventDefault();
        if (sel && (selIndex !== null || elementsHere)) { p.onSection(view!.id, null); setRect(null); host(frame.current?.contentWindow, { type: "focus-section", index: null }); }
        else p.onClose();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && list.length) {
        e.preventDefault();
        const next = selIndex === null ? (e.key === "ArrowDown" ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, selIndex + (e.key === "ArrowDown" ? 1 : -1)));
        host(frame.current?.contentWindow, { type: "focus-section", index: next });
      }
      if (e.key === "Enter" && (selIndex !== null || elementsHere)) { e.preventDefault(); input.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const scoped = selIndex !== null || !!elementsHere;
  // Ready to type as soon as a section or element is picked
  useEffect(() => { if (scoped) focusInput(280); }, [scoped, sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!view || !base) return null;
  const i = views.findIndex((v) => v.id === view.id);
  // The composer sits right under the picked section, inside the visible area
  const frameLeft = (size.w - W * scale) / 2;
  const anchorTop = rect ? Math.min(Math.max(rect.bottom * scale + 10, 12), size.h - 170) : size.h - 170;
  const anchorLeft = rect ? Math.min(Math.max(frameLeft + (rect.left + rect.width / 2) * scale - COMPOSER_W / 2, 12), size.w - COMPOSER_W - 12) : (size.w - COMPOSER_W) / 2;
  const to = resolveTarget(liveConns(p.chat), p.target);
  const pages = new Set(p.basket.map((b) => b.viewId)).size;
  const batch = p.basket.length >= 2 ? {
    label: `${p.basket.length} sections${pages > 1 ? ` on ${pages} pages` : ""}`,
    items: p.basket.map((b) => ({ id: b.id, device: b.device, live: b.live, liveList: b.liveList })),
    onClear: p.onClearBasket,
  } : null;

  // Everything you started here that's still running or waiting for your OK, oldest first
  type Item = { key: string; at: number; prompt?: CanvasPrompt; entry?: ChangelogEntry };
  const items: Item[] = [];
  for (const id of mine.prompts) {
    const pr = p.chat.prompts.find((x) => x.id === id);
    if (!pr || settled.has(id) || pr.status === "cancelled" || (pr.mode === "concepts" && pr.status === "done")) continue;
    const entry = p.changelog.find((e) => e.promptId === id && !e.inProgress);
    if (entry && (entry.undone || settled.has(entry.id))) continue;
    items.push({ key: id, at: pr.at, prompt: pr, entry: entry?.after ? entry : undefined });
  }
  for (const id of mine.entries) {
    const entry = p.changelog.find((e) => e.id === id);
    if (!entry || entry.undone || settled.has(id)) continue;
    items.push({ key: id, at: entry.at, entry });
  }
  items.sort((a, b) => a.at - b.at);
  const near = scoped ? items[items.length - 1] : undefined;
  const rest = near ? items.slice(0, -1) : items;

  const renderItem = (it: Item) => {
    const pr = it.prompt;
    if (pr && ["queued", "sending", "delivered"].includes(pr.status)) {
      return pr.steps?.length
        ? <><p className="mb-1 truncate text-xs font-medium">{pr.text}</p><LiveSteps p={pr} /></>
        : <PromptState p={pr} conns={p.chat.conns} agents={p.agents} compact onConcepts={p.onConcepts} />;
    }
    if (it.entry) return <ChangeReview entry={it.entry} manifest={p.manifest} title={pr?.text} note={pr?.reply} onSettle={() => settle(it.key, it.entry?.id)} onFix={(np) => addPrompts([np])} onCompare={() => p.onCompare(view.id)} />;
    if (pr?.status === "done") return <Note onClose={() => settle(it.key)}><p className="truncate font-medium">{pr.text}</p><p className="line-clamp-3 text-muted-foreground">{pr.reply || "Done, no files changed."}</p></Note>;
    return <Note tone="warn" onClose={() => settle(it.key)}><PromptState p={pr!} conns={p.chat.conns} agents={p.agents} compact onConcepts={p.onConcepts} /></Note>;
  };

  return (
    <div className="absolute inset-y-0 z-30 flex flex-col bg-[var(--paper)] pt-3" style={{ left: p.insetLeft > 12 ? p.insetLeft : 0, right: p.insetRight }}>
      <header className="island mx-3 flex items-center gap-1.5 self-center px-1.5 py-1.5">
        <Button variant="ghost" size="sm" className="h-8" onClick={p.onClose}><ArrowLeft size={14} /> Canvas</Button>
        <span className="h-5 w-px bg-border" />
        <Button variant="ghost" size="icon" className="size-8" disabled={i <= 0} onClick={() => p.onView(views[i - 1].id)} aria-label="Previous page"><CaretUp size={14} /></Button>
        <select value={view.id} onChange={(e) => p.onView(e.target.value)} aria-label="Page" className="h-8 max-w-[240px] rounded-md bg-transparent px-1.5 text-[13px] font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
          {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <Button variant="ghost" size="icon" className="size-8" disabled={i >= views.length - 1} onClick={() => p.onView(views[i + 1].id)} aria-label="Next page"><CaretDown size={14} /></Button>
        <span className="h-5 w-px bg-border" />
        <div className="flex items-center gap-0.5 rounded-[9px] bg-segment p-0.5 dark:bg-white/8" role="group" aria-label="Width">
          {(["desktop", "mobile"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={p.device === d} onClick={() => p.onDevice(d)} aria-label={d === "desktop" ? "Desktop" : "Mobile"} className={cn("grid size-7 place-items-center rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring", p.device === d ? "bg-background shadow-sm dark:bg-white/14" : "text-muted-foreground")}>
              {d === "desktop" ? <DesktopTower size={14} /> : <DeviceMobile size={14} />}
            </button>
          ))}
        </div>
        <span className="h-5 w-px bg-border" />
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => p.onCompare(view.id)} title="See the original next to the latest draft"><Columns size={14} /> Compare</Button>
        <span className="hidden items-center gap-1 px-2 text-xs text-muted-foreground xl:flex">
          Click a section · <Kbd>⇧</Kbd> several · double-click text to edit · <Kbd>⌥</Kbd> an element · <Kbd>⌘</Kbd> use the page
        </span>
      </header>

      <div className="relative mt-3 flex min-h-0 flex-1">
        {/* Sections of the page, to jump straight to one */}
        {list.length > 1 && (
          <nav aria-label="Sections" className="absolute top-2 left-3 z-10 flex max-h-[calc(100%-16px)] w-44 flex-col gap-0.5 overflow-y-auto rounded-[12px] bg-background/90 p-1.5 shadow-soft-sm ring-1 ring-border backdrop-blur">
            {list.map((s, n) => (
              <button
                key={n} type="button" onClick={() => host(frame.current?.contentWindow, { type: "focus-section", index: n })}
                className={cn("truncate rounded-md px-2 py-1 text-left text-[12.5px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring", selIndex === n && "bg-scope/12 font-medium text-scope")}
              >
                {s.name}
              </button>
            ))}
          </nav>
        )}
        <div ref={area} className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute top-0 overflow-hidden rounded-t-[12px] bg-white shadow-soft-lg ring-1 ring-black/[0.08] dark:ring-white/10" style={{ left: frameLeft, width: W * scale, height: size.h }}>
            <iframe
              key={`${view.id}-${p.device}-${reloadKey}`}
              ref={frame}
              title={`${view.name}, click a section to prompt about it`}
              src={frameUrl(base, view.url!)}
              onLoad={() => { setTimeout(start, 250); setTimeout(start, 1200); }}
              style={{ width: W, height: frameH, transform: `scale(${scale})`, transformOrigin: "0 0", border: 0, display: "block" }}
            />
          </div>

          {/* Claude asking for permission shows up here too, since the prompt bar is hidden */}
          {p.chat.permissions.length > 0 && (
            <div className="absolute top-3 right-3 z-30 flex w-[min(460px,60%)] flex-col gap-2">
              <PermissionStack perms={p.chat.permissions} conns={p.chat.conns} />
            </div>
          )}
          {scoped && (
            <div className="absolute z-20 flex flex-col gap-2" style={{ top: anchorTop, left: anchorLeft, width: COMPOSER_W }}>
              <Composer
                to={to.id}
                inputRef={input}
                className="shadow-soft-lg ring-2 ring-scope/50"
                scopeName={p.scopeName}
                selection={p.selection}
                batch={batch}
                onClearScope={() => { p.onSection(view.id, null); setRect(null); host(frame.current?.contentWindow, { type: "focus-section", index: null }); }}
                onConcepts={p.onConcepts}
                placeholder={!to.id ? "Open Claude Code in this project (/loupe) to prompt" : batch ? `What should change in these ${p.basket.length} sections?` : `What should change in ${p.scopeName ?? "this section"}?`}
                onSent={(ps) => { addPrompts(ps); if (batch) p.onClearBasket(); }}
              />
              {near && <div className="island rounded-[14px] px-3.5 py-2.5">{renderItem(near)}</div>}
            </div>
          )}

          {/* The rest of what you started here, and notes */}
          {(rest.length > 0 || notice) && (
            <div className="absolute bottom-5 left-5 z-20 flex max-h-[55%] w-[min(440px,42%)] flex-col gap-2 overflow-y-auto">
              {rest.map((it) => <div key={it.key} className="island shrink-0 rounded-[14px] px-3.5 py-2.5">{renderItem(it)}</div>)}
              {notice && <div className="island shrink-0 rounded-[14px] px-3.5 py-2.5"><Note tone={notice.tone} onClose={() => setNotice(null)}>{notice.text}</Note></div>}
            </div>
          )}
          {!scoped && !items.length && !notice && (
            <p className="pointer-events-none absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-foreground/85 px-4 py-2 text-[13px] text-background shadow-lg">
              Click a section to change it · ⇧-click to pick several · double-click text to edit it
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
