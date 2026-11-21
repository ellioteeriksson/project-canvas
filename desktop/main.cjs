// Loupe for macOS: a home window with every project you've opened Loupe in, and one window per
// project canvas. The canvases are the same local servers /loupe starts, so Claude Code sessions
// in those projects connect to them as usual, and they keep running after you quit the app.
const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, shell } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = app.isPackaged ? path.join(process.resourcesPath, "loupe") : path.resolve(__dirname, "..");
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;

let hubUrl = null;
let homeWin = null;
const projectWins = new Map(); // project root → window

// Apps opened from the Dock get a bare PATH; the canvases need git and claude like in a terminal
const home = require("node:os").homedir();
process.env.PATH = [...new Set([...(process.env.PATH || "").split(":"), "/opt/homebrew/bin", "/usr/local/bin", `${home}/.local/bin`, `${home}/.claude/local`, "/usr/bin", "/bin"])].filter(Boolean).join(":");

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => showHome());

const background = () => (nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#ececef");

function makeWindow(opts) {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 880, minHeight: 560,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 29, y: 33 },
    backgroundColor: background(),
    show: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
    ...opts,
  });
  win.once("ready-to-show", () => win.show());
  // Our windows only ever show the local Loupe servers; everything else opens in your browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!LOCAL.test(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
  return win;
}

function showHome() {
  if (homeWin && !homeWin.isDestroyed()) { homeWin.show(); homeWin.focus(); return; }
  if (!hubUrl) return;
  homeWin = makeWindow({ width: 1180, height: 780, title: "Loupe" });
  homeWin.loadURL(hubUrl);
  homeWin.on("closed", () => { homeWin = null; });
}

function openProject({ url, root, name }) {
  if (!LOCAL.test(url)) return;
  const open = projectWins.get(root);
  if (open && !open.isDestroyed()) {
    if (!open.webContents.getURL().startsWith(url)) open.loadURL(url);
    open.show(); open.focus();
    return;
  }
  const win = makeWindow({ title: name });
  win.setRepresentedFilename?.(root);
  win.loadURL(url);
  win.on("page-title-updated", (e) => { e.preventDefault(); win.setTitle(name); });
  win.on("closed", () => projectWins.delete(root));
  projectWins.set(root, win);
}

ipcMain.on("loupe:open-project", (_e, p) => p && typeof p.url === "string" && openProject(p));
ipcMain.on("loupe:show-home", () => showHome());
ipcMain.on("loupe:reveal", (_e, root) => typeof root === "string" && shell.openPath(root));
ipcMain.handle("loupe:pick-folder", async (e) => {
  const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: "Add a project", buttonLabel: "Add project", properties: ["openDirectory"],
  });
  return res.canceled ? null : res.filePaths[0];
});

function menu() {
  const dev = !app.isPackaged;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        { label: "Projects", accelerator: "CmdOrCtrl+1", click: showHome },
        { label: "Add a Project…", accelerator: "CmdOrCtrl+O", click: async () => {
          showHome();
          homeWin?.webContents.executeJavaScript("window.dispatchEvent(new Event('loupe:add-project'))");
        } },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        ...(dev ? [{ role: "toggleDevTools" }] : []),
        { type: "separator" },
        { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    { role: "help", submenu: [{ label: "Loupe on GitHub", click: () => shell.openExternal("https://github.com/ellioteeriksson/loupe") }] },
  ]));
}

app.whenReady().then(async () => {
  menu();
  const { startHub } = await import(pathToFileURL(path.join(ROOT, "server", "hub.mjs")).href);
  try {
    hubUrl = (await startHub({ port: 4700 })).url;
  } catch (e) {
    dialog.showErrorBox("Loupe couldn't start", String(e?.message || e));
    app.quit();
    return;
  }
  showHome();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) showHome(); });
});

// The canvases keep serving Claude Code after the windows close; only the home server stops
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
