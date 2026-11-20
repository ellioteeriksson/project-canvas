import { useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "project-canvas-theme";

function read(): ThemePref {
  try { return (localStorage.getItem(KEY) as ThemePref) || "system"; } catch { return "system"; }
}

/** Canvas colour theme. Stored per browser; "system" follows the OS. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(read);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = pref === "dark" || (pref === "system" && mq.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
    };
    apply();
    try { localStorage.setItem(KEY, pref); } catch {}
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [pref]);
  return [pref, setPref] as const;
}
