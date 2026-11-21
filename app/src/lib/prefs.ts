import { useSyncExternalStore } from "react";

/** Personal preferences, kept in this browser (not in the project). */
const listeners = new Set<() => void>();
const read = <T,>(key: string, def: T): T => {
  try { const v = localStorage.getItem(`loupe-pref:${key}`); return v === null ? def : (JSON.parse(v) as T); } catch { return def; }
};
export function setPref<T>(key: string, value: T) {
  try { localStorage.setItem(`loupe-pref:${key}`, JSON.stringify(value)); } catch {}
  listeners.forEach((l) => l());
}
export function usePref<T>(key: string, def: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => JSON.stringify(read(key, def)),
  );
  return [JSON.parse(value) as T, (v: T) => setPref(key, v)];
}
