// The small bridge the Loupe UI uses inside the app (see app/src/lib/shell.ts)
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("loupeShell", {
  // "tabbed": the window's traffic lights sit in the tab bar, so the page needs no room for them
  platform: "tabbed",
  openProject: (p) => ipcRenderer.send("loupe:open-project", { url: String(p.url), root: String(p.root), name: String(p.name) }),
  showHome: () => ipcRenderer.send("loupe:show-home"),
  play: (p) => ipcRenderer.send("loupe:play", { url: String(p.url), device: String(p.device), title: String(p.title) }),
  pickFolder: () => ipcRenderer.invoke("loupe:pick-folder"),
  reveal: (root) => ipcRenderer.send("loupe:reveal", String(root)),
});
