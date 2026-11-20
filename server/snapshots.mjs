/**
 * Static page snapshots, cached in <project>/.canvas/snapshots (gitignored).
 * index.json maps a snapshot key ("<viewId>|<device>|<layer>") to { file, at, h, w }.
 * `at` is when the capture started, so an edit made during a capture still counts as newer.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function createSnapshotStore(root) {
  const dir = path.join(root, ".canvas", "snapshots");
  const indexFile = path.join(dir, "index.json");
  let index = {};
  try { index = JSON.parse(fs.readFileSync(indexFile, "utf8")); } catch {}

  // Drop entries whose image went missing
  for (const [k, v] of Object.entries(index)) if (!fs.existsSync(path.join(dir, v.file))) delete index[k];

  const save = () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(indexFile, JSON.stringify(index));
  };

  return {
    dir,
    get index() { return index; },

    put({ key, dataUrl, h, w, at, sections }) {
      const m = /^data:image\/(webp|png|jpeg);base64,(.+)$/.exec(dataUrl || "");
      if (!key || !m) throw new Error("Bad snapshot");
      fs.mkdirSync(dir, { recursive: true });
      const stamp = Number(at) || Date.now();
      const file = `${crypto.createHash("sha1").update(key).digest("hex").slice(0, 12)}-${stamp}.${m[1] === "jpeg" ? "jpg" : m[1]}`;
      fs.writeFileSync(path.join(dir, file), Buffer.from(m[2], "base64"));
      const prev = index[key];
      if (prev && prev.file !== file) try { fs.unlinkSync(path.join(dir, prev.file)); } catch {}
      index[key] = { file, at: stamp, h: Math.round(h), w: Math.round(w), sections: Array.isArray(sections) ? sections.slice(0, 60) : [] };
      save();
      return index[key];
    },

    clear() {
      for (const v of Object.values(index)) try { fs.unlinkSync(path.join(dir, v.file)); } catch {}
      index = {};
      save();
    },

    filePath(name) {
      const p = path.join(dir, path.basename(name));
      return p.startsWith(dir) ? p : null;
    },
  };
}

const mtime = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };

/**
 * When did each view last change on disk? Per view: its page file plus everything it imports.
 * "*" covers files that affect every view: global CSS and layouts.
 */
export function computeChangedAt(root, manifest) {
  const out = {};
  for (const v of manifest.views) {
    let t = 0;
    for (const f of [v.file, ...(v.files || []), ...(v.sharedFiles || [])]) if (f) t = Math.max(t, mtime(path.join(root, f)));
    out[v.id] = Math.round(t);
  }
  let g = 0;
  for (const f of manifest.globalFiles || []) g = Math.max(g, mtime(path.join(root, f)));
  for (const f of manifest.designSystem?.cssFiles || []) g = Math.max(g, mtime(path.join(root, f)));
  out["*"] = Math.round(g);
  return out;
}
