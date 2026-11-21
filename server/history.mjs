/**
 * Version history for the project, kept apart from the project's own git.
 *
 * A private git repository in .canvas/history.git takes a picture of the project's files before and
 * after every change Claude makes (and of the user's own edits in between). That lets Loupe show what
 * a change did, undo one change, or put the whole project back the way it was at any point.
 * The project's .gitignore files are respected; Loupe's own folder and build output are left out.
 */
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const EXCLUDE = [".canvas/", ".git/", "node_modules/", ".next/", ".nuxt/", ".svelte-kit/", ".astro/", ".turbo/", ".vercel/", ".cache/", ".parcel-cache/", "dist/", "build/", "out/", "coverage/", "*.log", ".DS_Store"];
const ENV = { GIT_AUTHOR_NAME: "Loupe", GIT_AUTHOR_EMAIL: "loupe@localhost", GIT_COMMITTER_NAME: "Loupe", GIT_COMMITTER_EMAIL: "loupe@localhost", GIT_TERMINAL_PROMPT: "0" };

export function createHistory({ root, log = () => {} }) {
  const dir = path.join(root, ".canvas", "history.git");
  let ok = null; // null: not checked yet
  let chain = Promise.resolve();

  const git = (args, { input, max = 32 * 1024 * 1024 } = {}) =>
    new Promise((resolve, reject) => {
      const p = execFile("git", ["--git-dir", dir, "--work-tree", root, "-c", "core.quotepath=off", "-c", "core.autocrlf=false", "-c", "gc.auto=0", ...args],
        { cwd: root, env: { ...process.env, ...ENV }, maxBuffer: max, timeout: 60_000 },
        (err, stdout, stderr) => (err ? reject(Object.assign(err, { stderr: String(stderr) })) : resolve(String(stdout))));
      if (input != null) { p.stdin.end(input); }
    });
  /** One git operation at a time */
  const serial = (fn) => { const r = chain.then(fn, fn); chain = r.catch(() => {}); return r; };

  async function ready() {
    if (ok !== null) return ok;
    try {
      if (!fs.existsSync(path.join(dir, "HEAD"))) {
        fs.mkdirSync(dir, { recursive: true });
        await git(["init", "-q"]);
      }
      fs.mkdirSync(path.join(dir, "info"), { recursive: true });
      fs.writeFileSync(path.join(dir, "info", "exclude"), EXCLUDE.join("\n") + "\n");
      ok = true;
    } catch (e) {
      ok = false;
      log(`version history is off: ${e.message?.split("\n")[0] || e}`);
    }
    return ok;
  }
  const head = async () => { try { return (await git(["rev-parse", "-q", "--verify", "HEAD"])).trim(); } catch { return null; } };

  /** Take a picture of the project now. Returns its id (the same id as before if nothing changed). */
  function checkpoint(label) {
    return serial(async () => {
      if (!(await ready())) return null;
      await git(["add", "-A", "."]);
      const before = await head();
      if (before) {
        try { await git(["diff", "--cached", "--quiet", "HEAD"]); return before; } catch {}
      }
      await git(["commit", "-q", "--no-verify", "--allow-empty", "-m", String(label || "Checkpoint").slice(0, 300)]);
      return head();
    });
  }

  /** Files that differ between two pictures */
  async function changed(a, b) {
    if (!a || !b || a === b || !(await ready())) return [];
    try {
      const out = await git(["diff", "--name-status", "--no-renames", a, b]);
      return out.split("\n").filter(Boolean).map((l) => { const [st, ...f] = l.split("\t"); return { file: f.join("\t"), status: st[0] }; });
    } catch { return []; }
  }

  async function diff(a, b, files) {
    if (!a || !b || !(await ready())) return "";
    try { return await git(["diff", "--no-renames", "-U3", a, b, "--", ...(files?.length ? files : ["."])], { max: 4 * 1024 * 1024 }); }
    catch (e) { return e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ? "The changes are too large to show here." : ""; }
  }

  /** Put files back the way they were in a picture; files that didn't exist then are removed */
  async function putBack(id, files) {
    const existed = [];
    for (const f of files) {
      try { await git(["cat-file", "-e", `${id}:${f}`]); existed.push(f); }
      catch { try { fs.rmSync(path.join(root, f), { force: true }); } catch {} }
    }
    for (let i = 0; i < existed.length; i += 200) await git(["checkout", id, "--", ...existed.slice(i, i + 200)]);
  }

  /**
   * Undo one change: its files go back to how they were before it.
   * Files that have changed again since are listed, and left alone unless `force`.
   */
  function undo({ before, after, label, force }) {
    return serial(async () => {
      if (!(await ready())) return { ok: false, error: "Version history needs git, and Loupe couldn't run it." };
      const files = (await changed(before, after)).map((x) => x.file);
      if (!files.length) return { ok: false, error: "This change didn't leave any file changes to undo." };
      await git(["add", "-A", "."]);
      // Changed again since? Compare what's on disk now with what the change left
      const since = files.length ? (await git(["diff", "--cached", "--name-only", "--no-renames", after, "--", ...files])).split("\n").filter(Boolean) : [];
      if (since.length && !force) return { ok: false, conflict: since };
      if (!(await head()) || (await git(["status", "--porcelain"])).trim()) await git(["commit", "-q", "--no-verify", "--allow-empty", "-m", "Before undoing"]);
      await putBack(before, files);
      await git(["add", "-A", "."]);
      await git(["commit", "-q", "--no-verify", "--allow-empty", "-m", `Undid: ${String(label || "a change").slice(0, 200)}`]);
      return { ok: true, files, version: await head() };
    });
  }

  /** Put the whole project back to how it was at a picture */
  function restore({ id, label }) {
    return serial(async () => {
      if (!(await ready())) return { ok: false, error: "Version history needs git, and Loupe couldn't run it." };
      await git(["add", "-A", "."]);
      if ((await git(["status", "--porcelain"])).trim()) await git(["commit", "-q", "--no-verify", "-m", "Before restoring"]);
      const now = await head();
      const files = (await changed(id, now)).map((x) => x.file);
      if (!files.length) return { ok: true, files: [], version: now };
      await putBack(id, files);
      await git(["add", "-A", "."]);
      await git(["commit", "-q", "--no-verify", "--allow-empty", "-m", `Restored to: ${String(label || id.slice(0, 8)).slice(0, 200)}`]);
      return { ok: true, files, version: await head(), undoPoint: now };
    });
  }

  return { checkpoint, changed, diff, undo, restore, available: () => ready() };
}
