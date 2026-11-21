// The tab bar's bridge to the main process
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tabs", {
  platform: process.platform,
  onState: (cb) => ipcRenderer.on("tabs", (_e, s) => cb(s)),
  onFullscreen: (cb) => ipcRenderer.on("fullscreen", (_e, on) => cb(!!on)),
  select: (id) => ipcRenderer.send("tabs:select", String(id)),
  close: (id) => ipcRenderer.send("tabs:close", String(id)),
  move: (id, to) => ipcRenderer.send("tabs:move", { id: String(id), to: Number(to) }),
});
