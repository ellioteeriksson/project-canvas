import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";

const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = mac ? "⌘" : "Ctrl";
const GROUPS: { title: string; items: [string, string[]][] }[] = [
  { title: "Canvas", items: [
    ["Show the whole project", ["⇧", "1"]],
    ["Zoom to the view in the center", ["⇧", "2"]],
    ["Step out of a section, then the page", ["Esc"]],
    ["Interact with a page", ["Double-click"]],
    ["Rename a view", ["Double-click its name"]],
  ] },
  { title: "Prompting", items: [
    ["Write a prompt", [MOD, "K"]],
    ["Send", ["Enter"]],
    ["New line", ["⇧", "Enter"]],
    ["Tuck the concepts away", ["Esc"]],
  ] },
  { title: "Lou", items: [
    ["Open or close Lou", ["L"]],
    ["Check one page", ["Drag Lou onto it"]],
  ] },
  { title: "Help", items: [["Show these shortcuts", ["?"]]] },
];

/** Every keyboard shortcut in one place: press ? (or open it from settings). */
export function ShortcutsDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "?" || t.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      setOpen((o) => !o);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("loupe:shortcuts", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("loupe:shortcuts", onOpen); };
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[440px] gap-5">
        <div>
          <DialogTitle className="text-[17px] font-semibold tracking-[-0.015em]">Keyboard shortcuts</DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-muted-foreground">Shortcuts pause while you're typing.</DialogDescription>
        </div>
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className="mb-1.5 text-xs font-semibold text-muted-foreground">{g.title}</h3>
            <dl className="flex flex-col">
              {g.items.map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between gap-4 border-b border-border/60 py-1.5 text-[13px] last:border-b-0">
                  <dt>{label}</dt>
                  <dd className="flex shrink-0 items-center gap-1">{keys.map((k) => (k.length > 2 ? <span key={k} className="text-xs text-muted-foreground">{k}</span> : <Kbd key={k}>{k}</Kbd>))}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </DialogContent>
    </Dialog>
  );
}
