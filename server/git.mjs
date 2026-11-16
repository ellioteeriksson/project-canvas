import { execFile, spawn } from "node:child_process";
import path from "node:path";

function run(cmd, args, cwd, { input, timeout = 60_000, env } = {}) {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { cwd, timeout, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env } }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, out: (stdout || "").trim(), err: (stderr || err?.message || "").trim(), cmd: [cmd, ...args].join(" ") });
    });
    if (input != null) { child.stdin.write(input); child.stdin.end(); }
  });
}

let ghCache = null;
async function ghReady(cwd) {
  if (ghCache && Date.now() - ghCache.at < 5 * 60_000) return ghCache.ok;
  const r = await run("gh", ["auth", "status"], cwd, { timeout: 10_000 });
  ghCache = { ok: r.ok, at: Date.now() };
  return r.ok;
}

async function defaultBranch(cwd) {
  const r = await run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
  if (r.ok && r.out) return r.out.replace(/^origin\//, "");
  for (const b of ["main", "master"]) if ((await run("git", ["rev-parse", "--verify", "--quiet", b], cwd)).ok) return b;
  return "main";
}

export async function gitStatus(cwd) {
  const inside = await run("git", ["rev-parse", "--is-inside-work-tree"], cwd);
  if (!inside.ok) return { repo: false };
  const [branch, porcelain, remote, upstream] = await Promise.all([
    run("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    run("git", ["status", "--porcelain=v1", "-uall"], cwd),
    run("git", ["remote", "get-url", "origin"], cwd),
    run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd),
  ]);
  const ahead = upstream.ok ? await run("git", ["rev-list", "--count", "@{u}..HEAD"], cwd) : null;
  const files = porcelain.out
    ? porcelain.out.split("\n").map((l) => l.trimStart().match(/^(\S+)\s+(.*)$/)).filter(Boolean).map((m) => ({ status: m[1], file: m[2].replace(/^"|"$/g, "").split(" -> ").pop() }))
    : [];
  return {
    repo: true,
    branch: branch.out,
    defaultBranch: await defaultBranch(cwd),
    files,
    remote: remote.ok ? remote.out : null,
    upstream: upstream.ok ? upstream.out : null,
    ahead: ahead?.ok ? Number(ahead.out) : null,
    gh: await ghReady(cwd),
  };
}

function slug(s) {
  return s.toLowerCase().replace(/^\w+(\(.+?\))?!?:\s*/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "update";
}

function compareUrl(remote, base, branch) {
  const m = remote?.match(/github\.com[:/](.+?)(?:\.git)?$/);
  return m ? `https://github.com/${m[1]}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}?expand=1` : null;
}

/** Heuristic commit message from changed files, mapped onto view names. */
export function heuristicMessage(status, manifest) {
  const files = status.files.map((f) => f.file);
  if (!files.length) return "";
  const touched = new Set();
  for (const v of manifest?.views || []) if (v.files?.some((f) => files.includes(f))) touched.add(v.name);
  const comps = (manifest?.designSystem?.components || []).filter((c) => files.includes(c.file)).map((c) => c.name);
  const added = status.files.filter((f) => f.status === "??" || f.status === "A").length;
  const parts = [];
  if (touched.size) parts.push([...touched].slice(0, 3).join(", ") + (touched.size > 3 ? ` +${touched.size - 3}` : "") + (touched.size === 1 ? " view" : " views"));
  if (comps.length) parts.push(comps.slice(0, 2).join(", ") + (comps.length > 2 ? ` +${comps.length - 2}` : ""));
  const verb = added === files.length ? "Add" : "Update";
  const subject = parts.length ? `${verb} ${parts.join(" and ")}` : `${verb} ${files.length} file${files.length > 1 ? "s" : ""}`;
  return `${subject}\n\n${files.slice(0, 15).map((f) => `- ${f}`).join("\n")}${files.length > 15 ? `\n- …and ${files.length - 15} more` : ""}`;
}

/** Ask the local Claude Code CLI to write the message from the diff. Falls back to heuristic. */
export async function aiMessage(cwd, manifest) {
  const status = await gitStatus(cwd);
  const fallback = heuristicMessage(status, manifest);
  const diff = await run("git", ["diff", "HEAD", "--stat", "--patch", "--no-color"], cwd);
  const untracked = status.files.filter((f) => f.status === "??").map((f) => f.file);
  const body = (diff.out + (untracked.length ? `\n\nNew untracked files:\n${untracked.join("\n")}` : "")).trim().slice(0, 40_000);
  if (!body) return { message: fallback, source: "heuristic" };
  const prompt = "Write a git commit message for the diff on stdin. Subject line in imperative mood, max 72 characters, then a blank line and at most 4 short bullet points. Output only the commit message, nothing else.";
  const r = await run("claude", ["-p", prompt], cwd, { input: body, timeout: 90_000, env: { PROJECT_CANVAS_HOOKS: "off" } });
  if (r.ok && r.out) return { message: r.out.replace(/^```\w*\n?|```$/g, "").trim(), source: "claude" };
  return { message: fallback, source: "heuristic", note: r.err?.slice(0, 200) };
}

/**
 * action: "commit" | "push" | "pr"
 * Creates a feature branch automatically when opening a PR from the default branch.
 */
export async function ship(cwd, { action, message, branch: branchName }) {
  const steps = [];
  const step = async (cmd, args, opts) => {
    const r = await run(cmd, args, cwd, opts);
    steps.push({ cmd: r.cmd, ok: r.ok, out: (r.out || r.err).slice(0, 2000) });
    return r;
  };
  const status = await gitStatus(cwd);
  if (!status.repo) return { ok: false, steps, error: "This project is not a git repository. Run `git init` first." };

  let branch = status.branch;
  if (action === "pr" && (branch === status.defaultBranch || branch === "HEAD")) {
    branch = branchName || `canvas/${slug((message || "update").split("\n")[0])}-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
    const r = await step("git", ["switch", "-c", branch]);
    if (!r.ok) return { ok: false, steps, error: "Could not create branch" };
  }

  if (status.files.length) {
    if (!message?.trim()) return { ok: false, steps, error: "A commit message is required" };
    await step("git", ["add", "-A"]);
    const c = await step("git", ["commit", "-m", message.trim()]);
    if (!c.ok) return { ok: false, steps, error: "Commit failed (pre-commit hook or identity?)" };
  } else if (action === "commit") {
    return { ok: false, steps, error: "Nothing to commit" };
  }

  if (action === "push" || action === "pr") {
    if (!status.remote) return { ok: false, steps, error: "No `origin` remote configured" };
    const p = await step("git", ["push", "-u", "origin", "HEAD"], { timeout: 120_000 });
    if (!p.ok) return { ok: false, steps, error: "Push failed" };
  }

  let prUrl = null;
  if (action === "pr") {
    const base = status.defaultBranch;
    if (status.gh) {
      const existing = await run("gh", ["pr", "view", "--json", "url", "-q", ".url"], cwd);
      if (existing.ok && existing.out) {
        prUrl = existing.out;
        steps.push({ cmd: "gh pr view", ok: true, out: `PR already open: ${prUrl}` });
      } else {
        const [title, ...rest] = (message || `Update from ${branch}`).trim().split("\n");
        const body = `${rest.join("\n").trim()}\n\n_Opened from Project Canvas_`.trim();
        const r = await step("gh", ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body], { timeout: 120_000 });
        if (r.ok) prUrl = r.out.split("\n").pop();
        else return { ok: false, steps, error: "gh pr create failed" };
      }
    } else {
      prUrl = compareUrl(status.remote, base, branch);
      steps.push({ cmd: "gh (not available)", ok: !!prUrl, out: prUrl ? `Open this link to create the PR: ${prUrl}` : "Install and authenticate GitHub CLI (gh auth login) to open PRs automatically." });
    }
  }
  return { ok: true, steps, branch, prUrl };
}
