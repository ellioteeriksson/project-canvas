import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsClockwise, Browser, Copy, DotsThree, FlowArrow, FolderOpen, FolderSimplePlus, MagnifyingGlass, Stop, TreeStructure, X } from "@phosphor-icons/react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { hub, shell } from "@/lib/shell";

type Project = {
  root: string; name: string; framework?: string; mode?: "sitemap" | "flow"; views: number; lastOpened?: number; thumb: string | null;
  running: boolean; url: string | null; chats: number; live: boolean; working: number; waiting: number;
};
type Filter = "recent" | "open" | "websites" | "products";

const ago = (t?: number) => {
  if (!t) return "";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  const d = Math.round(m / 1440);
  return d < 30 ? `${d} d ago` : new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short", year: d > 300 ? "numeric" : undefined });
};
const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));

export function Home() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [filter, setFilter] = useState<Filter>("recent");
  const [query, setQuery] = useState("");
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<{ root: string; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  const load = useCallback(() => fetch("/api/hub/projects").then((r) => r.json()).then((d) => setProjects(d.projects)).catch(() => {}), []);
  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
      if ((e.key === "f" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) { e.preventDefault(); search.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = async (p: Project) => {
    if (opening) return;
    setError(null);
    setOpening(p.root);
    const { ok, data } = await post("/api/hub/open", { root: p.root });
    setOpening(null);
    if (!ok) return setError({ root: p.root, text: data.error || "The canvas didn't start." });
    if (shell) shell.openProject({ url: data.url, root: p.root, name: p.name });
    else window.open(data.url, "_blank", "noopener");
    load();
  };

  const addFolder = async (root?: string | null) => {
    if (shell && root === undefined) root = await shell.pickFolder();
    if (!root) { if (!shell) setAdding(true); return; }
    const { ok, data } = await post("/api/hub/add", { root });
    if (!ok) return data.error as string;
    setAdding(false);
    await load();
    return null;
  };

  useEffect(() => {
    const onAdd = () => addFolder();
    window.addEventListener("loupe:add-project", onAdd);
    return () => window.removeEventListener("loupe:add-project", onAdd);
  });

  const counts = useMemo(() => {
    const all = projects ?? [];
    return { recent: all.length, open: all.filter((p) => p.running).length, websites: all.filter((p) => p.mode !== "flow").length, products: all.filter((p) => p.mode === "flow").length };
  }, [projects]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (projects ?? [])
      .filter((p) => filter === "recent" || (filter === "open" ? p.running : filter === "products" ? p.mode === "flow" : p.mode !== "flow"))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q) || (p.framework ?? "").toLowerCase().includes(q));
  }, [projects, filter, query]);

  const NAV: { id: Filter; label: string; icon: typeof Browser }[] = [
    { id: "recent", label: "Recent", icon: ArrowsClockwise },
    { id: "open", label: "Open now", icon: Browser },
    { id: "websites", label: "Websites", icon: TreeStructure },
    { id: "products", label: "Products", icon: FlowArrow },
  ];
  const title = NAV.find((n) => n.id === filter)!.label;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full bg-paper text-foreground">
        <div className="shell-drag fixed inset-x-0 top-0 z-10 h-3" />
        <aside className="island m-3 mr-0 flex w-[248px] shrink-0 flex-col overflow-hidden" aria-label="Loupe">
          <div className="shell-lights shell-drag flex h-[56px] shrink-0 items-center gap-2.5 px-3.5">
            <BrandMark size={26} />
            <div className="leading-tight">
              <h1 className="text-[14px] font-semibold">Loupe</h1>
              <p className="text-[11.5px] text-muted-foreground">Your projects</p>
            </div>
          </div>
          <nav className="flex flex-col gap-0.5 border-t p-2">
            {NAV.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setFilter(n.id)}
                aria-current={filter === n.id ? "page" : undefined}
                className={cn("flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring", filter === n.id ? "bg-segment font-medium" : "text-muted-foreground hover:bg-segment/60 hover:text-foreground")}
              >
                <n.icon size={15} /> {n.label}
                <span className="ml-auto font-mono text-[11px] text-muted-foreground tabular-nums">{counts[n.id] || ""}</span>
              </button>
            ))}
          </nav>
          <div className="mt-auto flex items-center gap-1 border-t p-2">
            <Button variant="ghost" size="sm" className="h-8 flex-1 justify-start gap-2 text-[13px] text-muted-foreground" onClick={() => addFolder()}>
              <FolderSimplePlus size={15} /> Add a project
            </Button>
            <ThemeToggle />
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="shell-drag flex h-[80px] shrink-0 items-center gap-3 px-8 pt-3">
            <h2 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h2>
            <label className="ml-auto flex h-9 w-[280px] items-center gap-2 rounded-full bg-chrome px-3.5 text-muted-foreground shadow-[var(--island-shadow)] focus-within:ring-2 focus-within:ring-ring">
              <MagnifyingGlass size={15} />
              <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a project" aria-label="Find a project" className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground" />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="grid size-5 place-items-center rounded-full hover:bg-segment"><X size={11} /></button>}
            </label>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-8 pt-2 pb-10">
            {projects === null ? (
              <Grid>{Array.from({ length: 6 }, (_, i) => <div key={i} className="aspect-[16/12] animate-pulse rounded-2xl bg-segment/60" />)}</Grid>
            ) : projects.length === 0 ? (
              <Empty onAdd={() => addFolder()} />
            ) : shown.length === 0 ? (
              <p className="pt-20 text-center text-muted-foreground">{query ? `No projects match "${query}".` : filter === "open" ? "No canvases are open. Click a project to open one." : `No ${title.toLowerCase()} yet.`}</p>
            ) : (
              <Grid>
                {shown.map((p) => (
                  <Card key={p.root} p={p} opening={opening === p.root} error={error?.root === p.root ? error.text : null} onOpen={() => open(p)} onChanged={load} />
                ))}
              </Grid>
            )}
          </div>
        </main>
      </div>
      <AddDialog open={adding} onClose={() => setAdding(false)} onAdd={(root) => addFolder(root)} />
    </TooltipProvider>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-x-5 gap-y-7">{children}</div>;
}

function Status({ p }: { p: Project }) {
  if (!p.running) return null;
  const [dot, text] = p.waiting ? ["bg-amber-500", "Needs you"] : p.working ? ["bg-scope animate-pulse", "Claude is working"] : p.live ? ["bg-emerald-500", "Claude connected"] : ["bg-muted-foreground/60", "Canvas open"];
  return (
    <span className="island absolute top-2.5 left-2.5 flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium">
      <span className={cn("size-1.5 rounded-full", dot)} /> {text}
    </span>
  );
}

function Card({ p, opening, error, onOpen, onChanged }: { p: Project; opening: boolean; error: string | null; onOpen: () => void; onChanged: () => void }) {
  const [broken, setBroken] = useState(false);
  const kind = p.mode === "flow" ? "Product" : "Website";
  return (
    <div className="group relative flex flex-col">
      <button
        type="button"
        onClick={onOpen}
        disabled={opening}
        aria-label={`Open ${p.name}`}
        className="relative aspect-[16/10] overflow-hidden rounded-2xl bg-chrome shadow-[var(--island-shadow)] ring-scope/0 outline-none transition-[box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:ring-2 group-hover:ring-scope/70 focus-visible:ring-2 focus-visible:ring-scope"
      >
        {p.thumb && !broken ? (
          <img src={p.thumb} alt="" onError={() => setBroken(true)} className="absolute inset-0 size-full object-cover object-top" draggable={false} />
        ) : (
          <span className="absolute inset-0 grid place-items-center bg-[radial-gradient(var(--paper-dot)_1px,transparent_1px)] [background-size:14px_14px]">
            <span className="grid size-12 place-items-center rounded-xl bg-segment text-[18px] font-semibold text-muted-foreground">{p.name.slice(0, 1).toUpperCase()}</span>
          </span>
        )}
        <Status p={p} />
        {opening && (
          <span className="absolute inset-0 grid place-items-center bg-chrome/70 backdrop-blur-[2px]">
            <span className="flex items-center gap-2 text-[13px] font-medium"><ArrowsClockwise size={15} className="animate-spin" /> Opening canvas…</span>
          </span>
        )}
      </button>
      <div className="mt-3 flex items-start gap-2 px-0.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-semibold tracking-[-0.006em]">{p.name}</h3>
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            {kind}{p.framework && p.framework !== "unknown" ? ` · ${p.framework}` : ""}{p.views ? ` · ${p.views} ${p.views === 1 ? "view" : "views"}` : ""}{p.lastOpened ? ` · ${ago(p.lastOpened)}` : ""}
          </p>
          <Tooltip>
            <TooltipTrigger asChild><p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80">{home(p.root)}</p></TooltipTrigger>
            <TooltipContent>{p.root}</TooltipContent>
          </Tooltip>
          {error && <p className="mt-1.5 text-[12px] text-destructive">{error}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="-mr-1 size-7 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" aria-label={`More for ${p.name}`}>
              <DotsThree size={18} weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem onSelect={onOpen}><Browser size={15} /> Open canvas</DropdownMenuItem>
            {shell && <DropdownMenuItem onSelect={() => shell!.reveal(p.root)}><FolderOpen size={15} /> Show in Finder</DropdownMenuItem>}
            <DropdownMenuItem onSelect={() => navigator.clipboard.writeText(p.root)}><Copy size={15} /> Copy path</DropdownMenuItem>
            {p.running && <DropdownMenuItem onSelect={() => post("/api/hub/stop", { root: p.root }).then(onChanged)}><Stop size={15} /> Close canvas</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => post("/api/hub/forget", { root: p.root }).then(onChanged)}><X size={15} /> Remove from Loupe</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function Empty({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="mx-auto flex max-w-[420px] flex-col items-center pt-[14vh] text-center">
      <BrandMark size={56} />
      <h3 className="mt-6 text-[17px] font-semibold">Your Loupe projects show up here</h3>
      <p className="mt-2 text-muted-foreground">Run <code className="rounded bg-segment px-1.5 py-0.5 font-mono text-[12px] text-foreground">/loupe</code> in Claude Code inside a project, or add a project folder.</p>
      <Button className="mt-6 gap-2 rounded-full" onClick={onAdd}><FolderSimplePlus size={15} /> Add a project</Button>
    </div>
  );
}

function AddDialog({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd: (root: string) => Promise<string | null | undefined> }) {
  const [root, setRoot] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); setErr(null); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add a project</DialogTitle>
          <DialogDescription>The folder of a website or app. Loupe maps its pages when you open it.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={async (e) => { e.preventDefault(); setErr((await onAdd(root.trim())) ?? null); }}>
          <Input autoFocus value={root} onChange={(e) => setRoot(e.target.value)} placeholder="~/Documents/GitHub/my-site" aria-label="Project folder" className="font-mono text-[13px]" />
          {err && <p className="text-[12.5px] text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={!root.trim()}>Add project</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export const isHub = !!hub;
