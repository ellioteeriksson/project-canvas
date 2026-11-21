// The small bridge the Loupe UI uses inside the app (see app/src/lib/shell.ts)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("loupeShell", {
  platform: process.platform,
  openProject: (p) => ipcRenderer.send("loupe:open-project", { url: String(p.url), root: String(p.root), name: String(p.name) }),
  showHome: () => ipcRenderer.send("loupe:show-home"),
  pickFolder: () => ipcRenderer.invoke("loupe:pick-folder"),
  reveal: (root) => ipcRenderer.send("loupe:reveal", String(root)),
});
