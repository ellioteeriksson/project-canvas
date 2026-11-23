import { useEffect, useRef } from "react";
import { usePref } from "@/lib/prefs";
import type { ChatState } from "@/lib/types";

/** Ask for permission to show notifications; call from a click or keypress */
export function askToNotify() {
  try { if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission(); } catch {}
}

let ctx: AudioContext | null = null;
/** Soft chimes: up for done, two taps for "needs you", down for failed */
function chime(kind: "done" | "wait" | "failed") {
  try {
    ctx ??= new AudioContext();
    const notes = kind === "done" ? [660, 880] : kind === "wait" ? [740, 740] : [440, 330];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      const t = ctx!.currentTime + i * 0.14;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(ctx!.destination); o.start(t); o.stop(t + 0.4);
    });
  } catch {}
}

const away = () => document.hidden || !document.hasFocus();

function notify(title: string, body: string) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted" || !away()) return;
    const n = new Notification(title, { body, tag: `loupe-${title}`, silent: true });
    n.onclick = () => { window.focus(); n.close(); };
  } catch {}
}

/**
 * Lets you know when a job finishes, fails, or a Claude waits for you: a chime, a notification
 * when Loupe isn't in front, and a count in the tab title.
 */
export function useJobAlerts(chat: ChatState | null, baseTitle: string) {
  const [sound] = usePref("sound", true);
  const [notes] = usePref("notifications", true);
  const seen = useRef<Map<string, string> | null>(null);
  const perms = useRef<Set<string>>(new Set());
  const unseen = useRef(0);

  const setTitle = () => {
    const n = (chat?.permissions.length ?? 0) + unseen.current;
    document.title = n ? `(${n}) ${baseTitle}` : baseTitle;
  };

  useEffect(() => {
    if (!chat) return;
    const first = seen.current === null;
    const prev = seen.current ?? new Map<string, string>();
    const next = new Map<string, string>();
    for (const p of chat.prompts) {
      next.set(p.id, p.status);
      const was = prev.get(p.id);
      if (first || !was || was === p.status || p.mode === "audit") continue;
      const short = p.text.length > 70 ? p.text.slice(0, 69) + "…" : p.text;
      if (p.status === "done") {
        if (sound) chime("done");
        if (notes) notify("Claude is done", p.reply ? `${short}\n${p.reply.slice(0, 120)}` : short);
        if (away()) unseen.current++;
      } else if (p.status === "failed") {
        if (sound) chime("failed");
        if (notes) notify("A job didn't finish", short);
        if (away()) unseen.current++;
      }
    }
    seen.current = next;
    for (const r of chat.permissions) {
      if (perms.current.has(r.request_id)) continue;
      perms.current.add(r.request_id);
      if (first) continue;
      if (sound) chime("wait");
      if (notes) notify("Claude is waiting for you", `${r.description}${r.input_preview ? `: ${r.input_preview.slice(0, 80)}` : ""}`);
    }
    setTitle();
  }, [chat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const back = () => { if (!away()) { unseen.current = 0; setTitle(); } };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => { window.removeEventListener("focus", back); document.removeEventListener("visibilitychange", back); };
  }, [chat, baseTitle]); // eslint-disable-line react-hooks/exhaustive-deps
}
