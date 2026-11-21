import { useMemo, useState } from "react";
import { ChatCircle, Check, Copy, DownloadSimple, FileText, Sparkle, SquaresFour, Trash } from "@phosphor-icons/react";
import { api } from "@/lib/api";
import type { ChangelogEntry, Manifest } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const day = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const time = (t: number) => new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

function toMarkdown(project: string, entries: ChangelogEntry[]) {
  const out = [`# Changelog: ${project}`, ""];
  let cur = "";
  for (const e of [...entries].reverse()) {
    const d = isoDay(e.at);
    if (d !== cur) { out.push(`## ${d}`, ""); cur = d; }
    const title = e.detail || e.prompt || "Changes made in Claude Code";
    out.push(`### ${time(e.at)} · ${title}`);
    const meta = [e.scope ? `Scope: ${e.scope}` : null, `From: ${e.source === "canvas" ? "Canvas" : "Claude Code chat"}`, e.detail && e.prompt ? `Request: ${e.prompt}` : null].filter(Boolean);
    out.push("", meta.map((m) => `- ${m}`).join("\n"));
    if (e.summary) out.push("", e.summary);
    if (e.files.length) out.push("", "Files:", ...e.files.map((f) => `- \`${f}\``));
    out.push("");
  }
  return out.join("\n");
}

/** Every change Claude made in the project, grouped by day, exportable as Markdown. */
export function ChangelogView({ manifest, entries }: { manifest: Manifest; entries: ChangelogEntry[] }) {
  const [copied, setCopied] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<string, ChangelogEntry[]>();
    for (const e of [...entries].reverse()) {
      const k = day(e.at);
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    return [...m.entries()];
  }, [entries]);
  const md = () => toMarkdown(manifest.project.name, entries);
  const download = () => {
    const url = URL.createObjectURL(new Blob([md()], { type: "text/markdown" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `changelog-${manifest.project.name}-${isoDay(Date.now())}.md` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(md()); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch {}
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-8 pt-6 pb-48">
        <header className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[26px] leading-tight font-semibold tracking-[-0.025em]">Changelog</h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {entries.length ? `${entries.length} change${entries.length === 1 ? "" : "s"} Claude made in ${manifest.project.name}` : `Changes Claude makes in ${manifest.project.name} are listed here`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={copy} disabled={!entries.length}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy Markdown"}</Button>
            <Button size="sm" onClick={download} disabled={!entries.length}><DownloadSimple size={14} weight="bold" /> Export .md</Button>
          </div>
        </header>

        {!entries.length ? (
          <div className="island mt-8 flex flex-col items-center px-8 py-14 text-center">
            <FileText size={28} className="text-muted-foreground" />
            <p className="mt-3 font-medium">Nothing changed yet</p>
            <p className="mt-1 max-w-sm text-[13px] text-muted-foreground">When Claude edits files, from the prompt bar or in the chat, each change is logged here with the request, a summary and the files it touched.</p>
          </div>
        ) : (
          groups.map(([d, list]) => (
            <section key={d} className="mt-9">
              <h3 className="sticky top-0 z-10 -mx-2 bg-paper/95 px-2 py-2 text-[12px] font-semibold text-muted-foreground first-letter:uppercase">{d}</h3>
              <ol className="relative mt-1 flex flex-col gap-3 border-l border-border pl-6">
                {list.map((e) => (
                  <li key={e.id} className="relative">
                    <span aria-hidden className={cn("absolute top-5 -left-[29px] size-[9px] rounded-full ring-4 ring-paper", e.inProgress ? "agent-dot bg-[var(--agent)]" : "bg-foreground/35")} />
                    <article className="island px-5 py-4">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <time className="font-mono tabular-nums" dateTime={new Date(e.at).toISOString()}>{time(e.at)}</time>
                        <span className="inline-flex items-center gap-1">
                          {e.mode === "apply" ? <SquaresFour size={12} weight="fill" className="text-scope" /> : e.source === "canvas" ? <Sparkle size={12} weight="fill" className="text-scope" /> : <ChatCircle size={12} />}
                          {e.mode === "apply" ? "Concept from the canvas" : e.source === "canvas" ? "From the canvas" : "From the chat"}
                        </span>
                        {e.scope && <span className="truncate">· {e.scope}</span>}
                        {e.inProgress && <span className="ml-auto text-[var(--agent)]">Claude is still working</span>}
                      </div>
                      <h4 className="mt-1.5 text-[15px] leading-snug font-medium tracking-[-0.01em]">{e.detail || e.prompt || "Changes made in Claude Code"}</h4>
                      {e.detail && e.prompt && <p className="mt-0.5 text-[13px] text-muted-foreground">For: {e.prompt}</p>}
                      {e.summary && <p className="mt-2 text-[13.5px] leading-[1.55]">{e.summary}</p>}
                      {!!e.files.length && (
                        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Files changed">
                          {e.files.map((f) => (
                            <li key={f} className="rounded-md bg-segment px-1.5 py-0.5 font-mono text-[11px]" title={f}>{f.split("/").slice(-2).join("/")}</li>
                          ))}
                        </ul>
                      )}
                    </article>
                  </li>
                ))}
              </ol>
            </section>
          ))
        )}

        {!!entries.length && (
          <div className="mt-10 flex justify-center">
            {confirmClear ? (
              <div className="flex items-center gap-2 text-[13px]">
                <span className="text-muted-foreground">Clear the whole changelog? This can't be undone.</span>
                <Button size="sm" variant="destructive" onClick={() => { api.clearChangelog(); setConfirmClear(false); }}>Clear</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>Keep it</Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmClear(true)}><Trash size={14} /> Clear changelog</Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
