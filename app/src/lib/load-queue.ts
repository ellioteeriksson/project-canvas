import { useEffect, useState } from "react";

/**
 * Loads a few frames at a time. Dev servers (Next.js especially) compile each route on first
 * request, and asking for every page at once can stall or crash them.
 */
type Waiter = { id: string; priority: number; grant: () => void };
let limit = 3;
const active = new Set<string>();
let waiting: Waiter[] = [];

function pump() {
  waiting.sort((a, b) => b.priority - a.priority);
  while (active.size < limit && waiting.length) {
    const w = waiting.shift()!;
    active.add(w.id);
    w.grant();
  }
}

export function setLoadLimit(n: number) {
  limit = Math.max(1, n);
  pump();
}

export function releaseSlot(id: string) {
  if (active.delete(id)) pump();
}

/** Returns true once this frame may start loading. `key` restarts the wait (e.g. on reload). */
export function useLoadSlot(id: string, priority: number, enabled: boolean, key: unknown) {
  const [granted, setGranted] = useState(false);
  useEffect(() => {
    setGranted(false);
    if (!enabled) return;
    const w: Waiter = { id, priority, grant: () => setGranted(true) };
    waiting.push(w);
    pump();
    // Never hold a slot forever if a page hangs
    const t = setTimeout(() => releaseSlot(id), 45_000);
    return () => {
      clearTimeout(t);
      waiting = waiting.filter((x) => x !== w);
      releaseSlot(id);
    };
  }, [id, enabled, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return granted;
}
