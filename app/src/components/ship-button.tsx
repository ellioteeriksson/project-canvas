import { useEffect, useState } from "react";
import { GitPullRequest, GitCommit, CloudArrowUp, CaretDown, Sparkle, CircleNotch, CheckCircle, XCircle, ArrowSquareOut, GitBranch } from "@phosphor-icons/react";
import type { GitStatus, ShipAction, ShipResult } from "@/lib/types";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const ACTIONS: Record<ShipAction, { label: string; verb: string; done: string; icon: typeof GitCommit; hint: string }> = {
  commit: { label: "Commit", verb: "Commit", done: "Committed", icon: GitCommit, hint: "Commit all changes on the current branch" },
  push: { label: "Commit & push", verb: "Commit and push", done: "Pushed", icon: CloudArrowUp, hint: "Commit, then push to origin" },
  pr: { label: "Open pull request", verb: "Open pull request", done: "Pull request ready", icon: GitPullRequest, hint: "Commit, push and open a PR on GitHub" },
};

export function ShipButton({ git, onDone }: { git: GitStatus | null; onDone: () => void }) {
  const [action, setAction] = useState<ShipAction | null>(null);
  const changes = git?.files?.length ?? 0;
  const disabled = !git?.repo;
  const ahead = git?.ahead ?? 0;

  return (
    <>
      <div className="flex items-center">
        <Button
          className="rounded-r-none"
          onClick={() => setAction("pr")}
          disabled={disabled}
          title={disabled ? "This project isn't a git repository" : ACTIONS.pr.hint}
        >
          <GitPullRequest size={15} weight="bold" />
          Ship
          {changes > 0 && <span className="ml-0.5 rounded-sm bg-scope px-1 text-[11px] font-semibold tabular-nums text-[#1c2230]" aria-label={`${changes} changed files`}>{changes}</span>}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="rounded-l-none border-l border-white/20 px-1.5" disabled={disabled} aria-label="More ship options">
              <CaretDown size={13} weight="bold" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <GitBranch size={13} /> <span className="truncate font-mono">{git?.branch}</span>
              <span className="ml-auto tabular-nums">{changes} changed{ahead ? ` · ${ahead} unpushed` : ""}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {(Object.keys(ACTIONS) as ShipAction[]).map((a) => {
              const A = ACTIONS[a];
              return (
                <DropdownMenuItem key={a} onSelect={() => setAction(a)} disabled={a === "commit" && changes === 0}>
                  <A.icon size={15} />
                  <div className="flex flex-col">
                    <span>{A.label}</span>
                    <span className="text-xs text-muted-foreground">{A.hint}</span>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {action && <ShipDialog action={action} git={git!} onClose={() => { setAction(null); onDone(); }} />}
    </>
  );
}

function ShipDialog({ action, git, onClose }: { action: ShipAction; git: GitStatus; onClose: () => void }) {
  const A = ACTIONS[action];
  const files = git.files ?? [];
  const [message, setMessage] = useState("");
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShipResult | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => { if (files.length) api.suggestMessage(false).then((r) => setMessage((m) => m || r.message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const willBranch = action === "pr" && git.branch === git.defaultBranch;
  const needsMessage = files.length > 0;

  const write = async () => {
    setWriting(true); setNote(null);
    const r = await api.suggestMessage(true);
    setMessage(r.message);
    if (r.source !== "claude") setNote("Claude Code CLI wasn't available, so this message is built from the changed files.");
    setWriting(false);
  };
  const run = async () => {
    setBusy(true);
    setResult(await api.ship(action, message));
    setBusy(false);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><A.icon size={18} /> {A.label}</DialogTitle>
          <DialogDescription>
            {files.length ? `${files.length} changed file${files.length > 1 ? "s" : ""} on ` : "No uncommitted changes on "}
            <span className="font-mono text-[12px] text-foreground">{git.branch}</span>
            {willBranch && <> · a new branch will be created from <span className="font-mono text-[12px] text-foreground">{git.defaultBranch}</span></>}
            {action !== "commit" && !git.remote && <> · <span className="text-destructive">no origin remote</span></>}
            {action === "pr" && !git.gh && git.remote && <> · GitHub CLI isn't signed in, so you'll get a link to open the PR yourself</>}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <>
            {files.length > 0 && (
              <ul className="max-h-32 overflow-auto rounded-md border bg-secondary/40 px-2.5 py-1.5 font-mono text-[11px]" aria-label="Changed files">
                {files.map((f) => (
                  <li key={f.file} className="flex gap-2"><span className="w-5 text-muted-foreground">{f.status}</span><span className="truncate">{f.file}</span></li>
                ))}
              </ul>
            )}
            {needsMessage && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="commit-msg" className="text-[13px] font-medium">Commit message</label>
                  <Button size="sm" variant="ghost" onClick={write} disabled={writing}>
                    {writing ? <CircleNotch size={14} className="animate-spin" /> : <Sparkle size={14} />} Write with Claude
                  </Button>
                </div>
                <Textarea id="commit-msg" value={message} onChange={(e) => setMessage(e.target.value)} rows={6} className="font-mono text-[12px]" />
                {note && <p className="text-xs text-muted-foreground">{note}</p>}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={run} disabled={busy || (needsMessage && !message.trim()) || (!needsMessage && action === "commit")}>
                {busy ? <CircleNotch size={15} className="animate-spin" /> : <A.icon size={15} />} {A.verb}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className={cn("flex items-center gap-2 font-medium", result.ok ? "text-ok" : "text-destructive")} role="status">
              {result.ok ? <CheckCircle size={18} weight="fill" /> : <XCircle size={18} weight="fill" />}
              {result.ok ? (action === "pr" && !result.prUrl ? "Pushed. Open the pull request from your git host." : A.done) : result.error}
            </div>
            <ol className="max-h-56 overflow-auto rounded-md border bg-secondary/40 p-2.5 font-mono text-[11px]">
              {result.steps.map((s, i) => (
                <li key={i} className="py-0.5">
                  <span className={s.ok ? "text-ok" : "text-destructive"}>$ </span>{s.cmd}
                  {s.out && <pre className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{s.out}</pre>}
                </li>
              ))}
            </ol>
            <DialogFooter>
              {result.prUrl && (
                <Button asChild variant="scope">
                  <a href={result.prUrl} target="_blank" rel="noreferrer"><ArrowSquareOut size={15} /> View pull request</a>
                </Button>
              )}
              <Button variant={result.prUrl ? "outline" : "default"} onClick={onClose}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
