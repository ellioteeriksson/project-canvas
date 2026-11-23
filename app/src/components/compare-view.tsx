import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowsLeftRight, DesktopTower, DeviceMobile, Image as ImageIcon, LinkSimple, Sparkle, Trash, UploadSimple } from "@phosphor-icons/react";
import { api, frameUrl } from "@/lib/api";
import type { CanvasPrompt, ChangelogEntry, Manifest } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Ref = { id: string; kind: "image" | "url"; viewId: string; name: string; src: string; file?: string; at: number };
type Original = { id: string; label: string; group: string; kind: "image" | "url"; src: string; ref?: Ref; device?: string };

const W = { desktop: 1440, mobile: 390 } as const;
const host = (w: Window | null | undefined, msg: Record<string, unknown>) => { try { w?.postMessage({ source: "project-canvas-host", ...msg }, "*"); } catch {} };
const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * The original next to the latest draft: a page as it was before the changes (or any version, or a
 * reference picture or URL) on the left, the page as it is now, live, on the right. Scroll together.
 */
export function CompareView({ manifest, viewId, onView, changelog, onSent }: {
  manifest: Manifest; viewId: string | null; onView: (id: string) => void; changelog: ChangelogEntry[]; onSent?: (p: CanvasPrompt) => void;
}) {
  const views = useMemo(() => manifest.views.filter((v) => v.url && !v.dynamic), [manifest.views]);
  const view = views.find((v) => v.id === viewId) ?? views[0];
  const base = manifest.frameUrl || manifest.devUrl;
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [refs, setRefs] = useState<Ref[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [adding, setAdding] = useState<"url" | null>(null);
  const [urlText, setUrlText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLIFrameElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const [pane, setPane] = useState({ w: 600, h: 700 });
  const syncing = useRef(false);

  const loadRefs = () => view && fetch(`/api/references?view=${encodeURIComponent(view.id)}`).then((r) => r.json()).then((d) => setRefs(d.items ?? [])).catch(() => {});
  useEffect(() => { loadRefs(); setPick(null); setAsked(false); }, [view?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPane({ w: (el.clientWidth - 12) / 2, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // What the left side can show: references first, then the page's history
  const originals = useMemo<Original[]>(() => {
    if (!view) return [];
    const out: Original[] = refs.map((r) => ({ id: `ref:${r.id}`, label: r.name, group: "References", kind: r.kind, src: r.src, ref: r }));
    const hist = changelog.filter((e) => e.shots?.[view.id]).sort((a, b) => a.at - b.at);
    const first = hist.find((e) => e.shots![view.id].before);
    if (first) out.push({ id: `first`, label: `Before the first change (${when(first.at)})`, group: "This page earlier", kind: "image", src: `/api/snapshots/${first.shots![view.id].before}`, device: first.shots![view.id].device });
    for (const e of [...hist].reverse()) {
      const s = e.shots![view.id];
      const name = (e.prompt ?? "A change").replace(/\s+/g, " ").slice(0, 60);
      if (s.after) out.push({ id: `after:${e.id}`, label: `After “${name}” (${when(e.endAt ?? e.at)})`, group: "This page earlier", kind: "image", src: `/api/snapshots/${s.after}`, device: s.device });
      if (s.before && e !== first) out.push({ id: `before:${e.id}`, label: `Before “${name}” (${when(e.at)})`, group: "This page earlier", kind: "image", src: `/api/snapshots/${s.before}`, device: s.device });
    }
    return out;
  }, [refs, changelog, view]);
  const orig = originals.find((o) => o.id === pick) ?? originals.find((o) => o.id === "first") ?? originals[0] ?? null;

  // Scroll together: the live page reports where it is; the picture follows, and the other way round
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.source !== "project-canvas" || e.source !== right.current?.contentWindow || d.type !== "scrolled") return;
      const el = left.current;
      if (!el || syncing.current) return;
      syncing.current = true;
      el.scrollTop = d.ratio * (el.scrollHeight - el.clientHeight);
      requestAnimationFrame(() => { syncing.current = false; });
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  const onLeftScroll = () => {
    const el = left.current;
    if (!el || syncing.current) return;
    syncing.current = true;
    host(right.current?.contentWindow, { type: "scroll-to", ratio: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight) });
    setTimeout(() => { syncing.current = false; }, 60);
  };

  const upload = async (f: File) => {
    if (!view) return;
    setErr(null);
    const r = await fetch(`/api/references/upload?view=${encodeURIComponent(view.id)}&name=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ""))}`, { method: "POST", headers: { "content-type": f.type }, body: f }).then((x) => x.json()).catch(() => ({ error: "The canvas server didn't answer" }));
    if (!r.ok) return setErr(r.error ?? "Couldn't add the picture");
    await loadRefs();
    setPick(`ref:${r.item.id}`);
  };
  const addUrl = async () => {
    if (!view) return;
    setErr(null);
    const r = await fetch("/api/references/add", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ viewId: view.id, url: urlText }) }).then((x) => x.json());
    if (!r.ok) return setErr(r.error ?? "Couldn't add the address");
    setAdding(null); setUrlText("");
    await loadRefs();
    setPick(`ref:${r.item.id}`);
  };
  const remove = async (r: Ref) => {
    await fetch("/api/references/delete", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: r.id }) });
    setPick(null);
    loadRefs();
  };
  // Paste a picture anywhere in this view to use it as the reference
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) { e.preventDefault(); upload(f); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const askToMatch = async () => {
    if (!view || !orig) return;
    const what = orig.ref?.kind === "image" && orig.ref.file
      ? `the reference picture at .canvas/references/${orig.ref.file} (open it and look at it)`
      : orig.ref?.kind === "url" ? `the reference page at ${orig.src}` : `how the page looked before (${orig.label}), saved as .canvas/snapshots/history/${orig.src.split("/").pop()}`;
    const r = await api.prompt(`Make ${view.name} match ${what}. Look at it next to the page as it is now, list the differences that matter (layout, spacing, type, colors, content), then fix them in the code with the project's own components and tokens.`, "auto", "direct", { kind: "view", id: view.id }).catch(() => null);
    if (r?.ok && r.prompt) { setAsked(true); onSent?.(r.prompt); }
  };

  if (!view || !base) return <p className="p-8 text-center text-sm text-muted-foreground">No pages to compare yet.</p>;
  const scaleR = Math.min(1, pane.w / W[device]);
  const leftW = orig?.device === "mobile" ? W.mobile : W.desktop;
  const scaleL = orig?.kind === "url" ? Math.min(1, pane.w / W[device]) : 1;
  const groups = [...new Set(originals.map((o) => o.group))];

  return (
    <div
      className="flex h-full flex-col px-6 pt-2 pb-[150px]"
      onDragOver={(e) => { if ([...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) e.preventDefault(); }}
      onDrop={(e) => { const f = [...e.dataTransfer.files].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); upload(f); } }}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <select value={view.id} onChange={(e) => onView(e.target.value)} aria-label="Page" className="h-8 max-w-[220px] rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <span className="h-5 w-px bg-border" />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Original
          <select value={orig?.id ?? ""} onChange={(e) => setPick(e.target.value)} aria-label="What to compare with" className="h-8 max-w-[320px] rounded-md border border-input bg-background px-1.5 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {!originals.length && <option value="">Nothing yet</option>}
            {groups.map((g) => <optgroup key={g} label={g}>{originals.filter((o) => o.group === g).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>)}
          </select>
        </label>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => file.current?.click()}><UploadSimple size={13} /> Picture</Button>
        <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setAdding((a) => (a ? null : "url"))}><LinkSimple size={13} /> URL</Button>
        <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
        <span className="h-5 w-px bg-border" />
        <div className="flex items-center gap-0.5 rounded-[9px] bg-segment p-0.5 dark:bg-white/8" role="group" aria-label="Width of the live page">
          {(["desktop", "mobile"] as const).map((d) => (
            <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)} aria-label={d === "desktop" ? "Desktop" : "Mobile"} className={cn("grid size-7 place-items-center rounded-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring", device === d ? "bg-background shadow-sm dark:bg-white/14" : "text-muted-foreground")}>
              {d === "desktop" ? <DesktopTower size={14} /> : <DeviceMobile size={14} />}
            </button>
          ))}
        </div>
        {orig && (
          <Button size="sm" className="h-8 gap-1.5 rounded-full text-xs" onClick={askToMatch} disabled={asked}>
            <Sparkle size={13} weight="fill" /> {asked ? "Sent to Claude" : orig.ref ? "Ask Claude to match it" : "Ask Claude to bring it back"}
          </Button>
        )}
      </header>
      {adding && (
        <form className="mb-3 flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); addUrl(); }}>
          <Input autoFocus value={urlText} onChange={(e) => setUrlText(e.target.value)} placeholder="https://example.com/about" className="h-8 w-[360px] text-[13px]" aria-label="Reference address" />
          <Button type="submit" size="sm" className="h-8">Add</Button>
        </form>
      )}
      {err && <p role="alert" className="mb-2 text-xs text-destructive">{err}</p>}

      <div ref={box} className="flex min-h-0 flex-1 gap-3">
        {/* The original */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Original">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-xs">
            <span className="font-medium">Original</span>
            <span className="min-w-0 truncate text-muted-foreground">{orig ? orig.label : "Pick or add one"}</span>
            {orig?.ref && <button type="button" onClick={() => remove(orig.ref!)} className="ml-auto grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-destructive" aria-label="Remove this reference" title="Remove this reference"><Trash size={12} /></button>}
          </div>
          <div ref={left} onScroll={onLeftScroll} className="relative min-h-0 flex-1 overflow-auto rounded-[12px] bg-white shadow-soft-lg ring-1 ring-black/[0.08] dark:ring-white/10">
            {!orig ? (
              <div className="grid h-full place-items-center p-8 text-center text-[13px] text-muted-foreground">
                <div className="flex max-w-[320px] flex-col items-center gap-2">
                  <ImageIcon size={28} />
                  <p>Drop or paste a picture here (a design or a screenshot), add the address of the live site, or make a change first: Loupe keeps how the page looked before.</p>
                </div>
              </div>
            ) : orig.kind === "image" ? (
              <img src={orig.src} alt={`${view.name}: ${orig.label}`} className="block" draggable={false} style={{ width: orig.ref ? "100%" : Math.min(pane.w, leftW) }} />
            ) : (
              <iframe title={`Reference: ${orig.label}`} src={orig.src} style={{ width: W[device], height: pane.h / scaleL, transform: `scale(${scaleL})`, transformOrigin: "0 0", border: 0, display: "block" }} />
            )}
          </div>
          {orig?.kind === "url" && <p className="mt-1 px-1 text-[11px] text-muted-foreground">Scroll each side on its own. If it stays blank, that site doesn't allow being shown inside another page: add a screenshot of it instead.</p>}
        </section>

        <span aria-hidden className="grid w-0 place-items-center text-muted-foreground"><ArrowsLeftRight size={14} className="-mx-2 rounded-full bg-background" /></span>

        {/* The latest draft, live */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Latest draft">
          <div className="mb-1.5 flex items-center gap-2 px-1 text-xs">
            <span className="font-medium">Latest draft</span>
            <span className="flex items-center gap-1 text-muted-foreground"><span className="size-1.5 rounded-full bg-[var(--live)]" /> live</span>
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-[12px] bg-white shadow-soft-lg ring-1 ring-black/[0.08] dark:ring-white/10">
            <iframe
              key={`${view.id}-${device}`}
              ref={right}
              title={`${view.name}, latest draft`}
              src={frameUrl(base, view.url!)}
              onLoad={() => { const go = () => host(right.current?.contentWindow, { type: "scroll-sync", on: true }); setTimeout(go, 250); setTimeout(go, 1200); }}
              style={{ width: W[device], height: pane.h / scaleR, transform: `scale(${scaleR})`, transformOrigin: "0 0", border: 0, display: "block" }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
