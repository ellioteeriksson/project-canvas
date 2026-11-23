import { useEffect, useRef, useState } from "react";
import { BookmarkSimple, Microphone, PaperPlaneRight, Plus, Trash } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Saved = { id: string; text: string; label?: string | null };
type Lists = { project: Saved[]; mine: Saved[] };

/** Prompts most design work needs now and then */
const BUILT_IN: Saved[] = [
  { id: "b1", label: "Tighten the spacing", text: "Tighten the spacing: use the project's spacing scale, and keep the rhythm consistent with the rest of the page." },
  { id: "b2", label: "Make it work on mobile", text: "Make this work well on mobile (390px wide): nothing overflows, tap targets are at least 44px, and the type scales down sensibly." },
  { id: "b3", label: "Use the design tokens", text: "Replace hard-coded colors, sizes and spacing with the project's existing design tokens or CSS variables." },
  { id: "b4", label: "Fix contrast and accessibility", text: "Fix accessibility: text contrast at least WCAG AA, visible focus states, sensible heading order, alt text and labels." },
  { id: "b5", label: "Shorter, clearer copy", text: "Make the copy shorter and clearer, in the same voice. Keep the meaning." },
];

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

/** Saved prompts: yours for every project, this project's (shared with the team), and a few built in */
export function SavedPrompts({ text, onUse, disabled }: { text: string; onUse: (text: string, send: boolean) => void; disabled?: boolean }) {
  const [lists, setLists] = useState<Lists>({ project: [], mine: [] });
  const load = () => fetch("/api/saved-prompts").then((r) => r.json()).then(setLists).catch(() => {});
  const save = (scope: "project" | "mine") => post("/api/saved-prompts/add", { scope, text }).then((r) => r.ok && setLists(r));
  const remove = (scope: "project" | "mine", id: string) => post("/api/saved-prompts/delete", { scope, id }).then((r) => r.ok && setLists(r));
  const canSave = text.trim().length > 0;

  const Row = ({ p, scope }: { p: Saved; scope?: "project" | "mine" }) => (
    <DropdownMenuItem onSelect={() => onUse(p.text, false)} className="group flex items-start gap-2">
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block">{p.label || p.text}</span>
      </span>
      <button type="button" aria-label="Send now" title="Send now" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUse(p.text, true); }}
        className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 group-focus:opacity-100 hover:text-foreground">
        <PaperPlaneRight size={12} />
      </button>
      {scope && (
        <button type="button" aria-label="Remove" title="Remove" onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(scope, p.id); }}
          className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 group-focus:opacity-100 hover:text-destructive">
          <Trash size={12} />
        </button>
      )}
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu onOpenChange={(o) => o && load()}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" disabled={disabled} className="size-7 shrink-0 rounded-full text-muted-foreground" aria-label="Saved prompts">
              <BookmarkSimple size={14} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Saved prompts</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-h-[60vh] w-80 overflow-y-auto" onCloseAutoFocus={(e) => e.preventDefault()}>
        {canSave && (
          <>
            <DropdownMenuItem onSelect={() => save("mine")} className="gap-2"><Plus size={13} /> Save this prompt for all my projects</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => save("project")} className="gap-2"><Plus size={13} /> Save it for this project and team</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {lists.mine.length > 0 && <><DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Yours</DropdownMenuLabel>{lists.mine.map((p) => <Row key={p.id} p={p} scope="mine" />)}</>}
        {lists.project.length > 0 && <><DropdownMenuLabel className="text-xs font-normal text-muted-foreground">This project</DropdownMenuLabel>{lists.project.map((p) => <Row key={p.id} p={p} scope="project" />)}</>}
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Built in</DropdownMenuLabel>
        {BUILT_IN.map((p) => <Row key={p.id} p={p} />)}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ---------------- voice ---------------- */

type Rec = { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null };
const SR = (typeof window !== "undefined" && ((window as unknown as { SpeechRecognition?: new () => Rec }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition)) || null;
export const canListen = !!SR;

/** The composer that answers ⌘⇧Space: the last one focused (or mounted) */
let active: symbol | null = null;

/** Talk instead of typing: what you say goes into the prompt as you speak; Enter still sends. */
export function VoiceButton({ text, setText, focus, disabled, input }: { text: string; setText: (t: string) => void; focus: () => void; disabled?: boolean; input: React.RefObject<HTMLTextAreaElement | null> }) {
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<Rec | null>(null);
  const base = useRef("");
  const me = useRef(Symbol("composer"));
  const latest = useRef({ text, setText, focus });
  latest.current = { text, setText, focus };

  const stop = () => rec.current?.stop();
  const start = () => {
    if (!SR || disabled) return;
    setErr(null);
    const r = new SR();
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    base.current = latest.current.text.trim() ? latest.current.text.trimEnd() + " " : "";
    let final = "";
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) final += res[0].transcript; else interim += res[0].transcript;
      }
      latest.current.setText(base.current + (final + interim).replace(/^\s+/, ""));
    };
    r.onerror = (e) => { if (e.error !== "aborted" && e.error !== "no-speech") setErr(e.error === "not-allowed" ? "Allow the microphone for this page to talk" : "Couldn't hear you"); };
    r.onend = () => { setOn(false); rec.current = null; latest.current.focus(); };
    rec.current = r;
    try { r.start(); setOn(true); active = me.current; } catch { setOn(false); }
  };
  const toggle = () => (on ? stop() : start());

  // The newest composer on screen answers ⌘⇧Space, or the one you last typed in
  useEffect(() => {
    const id = me.current;
    active = id;
    const onFocus = (e: FocusEvent) => { if (e.target === input.current) active = id; };
    document.addEventListener("focusin", onFocus);
    return () => { document.removeEventListener("focusin", onFocus); if (active === id) active = null; rec.current?.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && (e.code === "Space" || e.key === " ") && active === me.current) { e.preventDefault(); toggleRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!SR) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="ghost" size="icon" onClick={toggle} disabled={disabled} aria-pressed={on} aria-label={on ? "Stop listening" : "Talk instead of typing"}
          onFocus={() => { active = me.current; }}
          className={cn("size-7 shrink-0 rounded-full", on ? "bg-destructive/12 text-destructive hover:bg-destructive/16 hover:text-destructive" : err ? "text-destructive" : "text-muted-foreground")}>
          <Microphone size={14} weight={on ? "fill" : "regular"} className={on ? "animate-pulse" : undefined} />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{err ?? (on ? "Listening. Click or ⌘⇧Space to stop" : "Talk instead of typing (⌘⇧Space)")}</TooltipContent>
    </Tooltip>
  );
}
