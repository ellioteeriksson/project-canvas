/** The Loupe app for macOS adds this bridge (see desktop/preload.cjs). In a browser it's missing. */
export type Shell = {
  platform: string;
  openProject: (p: { url: string; root: string; name: string }) => void;
  showHome: () => void;
  pickFolder: () => Promise<string | null>;
  reveal: (root: string) => void;
};

export const shell: Shell | undefined = (window as unknown as { loupeShell?: Shell }).loupeShell;
export const hub: { version: string } | undefined = (window as unknown as { __LOUPE_HUB__?: { version: string } }).__LOUPE_HUB__;

if (shell) document.documentElement.dataset.shell = shell.platform;
