import { useEffect, useRef, useState } from "react";
import { ArrowClockwise, CircleNotch, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { VERSION_EVENT, lastVersion } from "@/lib/api";

type Info = { version: string; newer: string | null };

/** Tells you when a newer Loupe is installed than the one running this canvas, and restarts into it. */
export function UpdateBanner({ running = 0 }: { running?: number }) {
  const [info, setInfo] = useState<Info | null>(lastVersion);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const first = useRef<string | null>(lastVersion?.version ?? null);

  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<Info>).detail;
      // The server behind this page changed version (restarted elsewhere): load the matching app
      if (first.current && d.version !== first.current) { location.reload(); return; }
      first.current ??= d.version;
      setInfo(d);
    };
    window.addEventListener(VERSION_EVENT, on);
    return () => window.removeEventListener(VERSION_EVENT, on);
  }, []);

  if (!info?.newer || hidden === info.newer) return null;

  const restart = async () => {
    setBusy(true); setErr(null);
    const r = await fetch("/api/restart", { method: "POST" }).then((x) => x.json()).catch(() => ({ ok: false, error: "The canvas server didn't answer" }));
    if (!r.ok) { setBusy(false); setErr(r.error ?? "Couldn't restart"); return; }
    for (let i = 0; i < 60; i++) {
      await new Promise((res) => setTimeout(res, 500));
      const st = await fetch("/api/state", { cache: "no-store" }).then((x) => x.json()).catch(() => null);
      if (st?.version === r.version) { location.reload(); return; }
    }
    setBusy(false); setErr("The new version didn't start. Run /loupe in Claude Code.");
  };

  return (
    <div role="status" className="island fixed top-[72px] left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full py-1.5 pr-1.5 pl-4 text-[13px]">
      <span>{err ?? <>Loupe {info.newer} is installed. This canvas still runs {info.version}.{running > 0 && <span className="text-[#b7791f]"> Restarting stops the {running === 1 ? "job" : `${running} jobs`} running now.</span>}</>}</span>
      <Button size="sm" className="h-7 gap-1.5 rounded-full" onClick={restart} disabled={busy}>
        {busy ? <CircleNotch size={13} className="animate-spin" /> : <ArrowClockwise size={13} />} {busy ? "Restarting" : "Restart now"}
      </Button>
      <button type="button" aria-label="Not now" onClick={() => setHidden(info.newer)} className="grid size-7 place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"><X size={13} /></button>
    </div>
  );
}
