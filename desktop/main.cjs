// Loupe for macOS: one window with Figma-style tabs. The first tab lists every project you've
// opened Loupe in; each project's canvas opens in a tab of its own. The canvases are the same
// local servers /loupe starts, so Claude Code sessions in those projects connect to them as usual,
// and they keep running after you quit the app.
const { app, BaseWindow, WebContentsView, Menu, dialog, ipcMain, nativeTheme, shell } = require("electron");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

const ROOT = app.isPackaged ? path.join(process.resourcesPath, "loupe") : path.resolve(__dirname, "..");
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;
const BAR = 40; // tab bar height

// Apps opened from the Dock get a bare PATH; the canvases need git and claude like in a terminal
process.env.PATH = [...new Set([...(process.env.PATH || "").split(":"), "/opt/homebrew/bin", "/usr/local/bin", `${os.homedir()}/.local/bin`, `${os.homedir()}/.claude/local`, "/usr/bin", "/bin"])].filter(Boolean).join(":");

if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => focusWindow());

let hubUrl = null;
let win = null;
let bar = null;
/** Open tabs, in order. The first is always Projects. */
let tabs = [];
let activeId = "home";
let status = {};

const background = () => (nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#ececef");

function guard(wc) {
  // Tabs only ever show the local Loupe servers; everything else opens in your browser
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (!LOCAL.test(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); }
  });
}

function makeView(url) {
  const view = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  view.setBackgroundColor(background());
  guard(view.webContents);
  view.webContents.loadURL(url);
  return view;
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  bar.setBounds({ x: 0, y: 0, width, height: BAR });
  const h = Math.max(0, height - BAR);
  for (const t of tabs) {
    // A mobile prototype is a phone-sized page in the middle of the tab
    if (t.play && t.mobile) {
      const ph = Math.min(844, Math.max(0, h - 32));
      t.view.setBounds({ x: Math.round((width - 390) / 2), y: BAR + Math.round((h - ph) / 2), width: 390, height: ph });
    } else t.view.setBounds({ x: 0, y: BAR, width, height: h });
  }
}

function sendState() {
  if (!bar) return;
  bar.webContents.send("tabs", {
    active: activeId,
    tabs: tabs.map((t) => ({ id: t.id, title: t.title, home: t.id === "home", play: !!t.play, ...(status[t.id] || {}) })),
  });
}

function select(id) {
  const t = tabs.find((x) => x.id === id);
  if (!t || !win) return;
  activeId = id;
  for (const x of tabs) x.view.setVisible(x.id === id);
  t.view.webContents.focus();
  win.setTitle(t.id === "home" ? "Loupe" : `${t.title} · Loupe`);
  win.setRepresentedFilename?.(t.id === "home" || t.play ? "" : t.id);
  sendState();
}

function close(id) {
  if (id === "home") return;
  const i = tabs.findIndex((x) => x.id === id);
  if (i < 0) return;
  const [t] = tabs.splice(i, 1);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  if (activeId === id) select(tabs[Math.min(i, tabs.length - 1)].id);
  else sendState();
}

function openProject({ url, root, name }) {
  if (!LOCAL.test(url) || typeof root !== "string") return;
  focusWindow();
  const open = tabs.find((t) => t.id === root);
  if (open) {
    if (!open.view.webContents.getURL().startsWith(url)) open.view.webContents.loadURL(url);
    return select(root);
  }
  const view = makeView(url);
  win.contentView.addChildView(view);
  tabs.push({ id: root, title: name || path.basename(root), view });
  layout();
  select(root);
}

function createWindow() {
  win = new BaseWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 580,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: background(),
    title: "Loupe",
  });
  bar = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, "tabbar-preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  bar.setBackgroundColor("#00000000");
  bar.webContents.loadFile(path.join(__dirname, "tabbar.html"));
  bar.webContents.on("did-finish-load", sendState);
  win.contentView.addChildView(bar);

  const home = makeView(hubUrl);
  win.contentView.addChildView(home);
  tabs = [{ id: "home", title: "Projects", view: home }];
  layout();
  select("home");

  win.on("resize", layout);
  win.on("enter-full-screen", () => bar?.webContents.send("fullscreen", true));
  win.on("leave-full-screen", () => bar?.webContents.send("fullscreen", false));
  win.on("closed", () => {
    for (const t of tabs) try { t.view.webContents.close(); } catch {}
    win = null; bar = null; tabs = [];
  });
}

function focusWindow() {
  if (!hubUrl) return;
  if (!win) createWindow();
  win.show(); win.focus();
}

const activeTab = () => tabs.find((t) => t.id === activeId);
const step = (d) => { const i = tabs.findIndex((t) => t.id === activeId); if (i >= 0) select(tabs[(i + d + tabs.length) % tabs.length].id); };

ipcMain.on("loupe:open-project", (_e, p) => p && typeof p.url === "string" && openProject(p));
ipcMain.on("loupe:show-home", () => { focusWindow(); select("home"); });
ipcMain.on("loupe:reveal", (_e, root) => typeof root === "string" && shell.openPath(root));
ipcMain.handle("loupe:pick-folder", async () => {
  const res = await dialog.showOpenDialog(win, { title: "Add a project", buttonLabel: "Add project", properties: ["openDirectory"] });
  return res.canceled ? null : res.filePaths[0];
});
// Play: the site on its own, like a visitor sees it, in a tab of its own (like Figma's prototype tab).
// One play tab per site; playing again from another page reuses it. Mobile shows a phone-sized page.
ipcMain.on("loupe:play", (_e, p) => {
  if (!p || typeof p.url !== "string" || !LOCAL.test(p.url)) return;
  focusWindow();
  const id = `play:${new URL(p.url).origin}`;
  const mobile = p.device === "mobile";
  const title = String(p.title || "Prototype").slice(0, 120);
  let t = tabs.find((x) => x.id === id);
  if (t) {
    t.view.webContents.loadURL(p.url);
    Object.assign(t, { title, mobile });
  } else {
    const view = new WebContentsView({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
    view.setBackgroundColor("#ffffff");
    guard(view.webContents);
    view.webContents.loadURL(p.url);
    win.contentView.addChildView(view);
    t = { id, title, view, play: true, mobile };
    tabs.push(t);
  }
  layout();
  select(id);
});
ipcMain.on("tabs:select", (_e, id) => select(id));
ipcMain.on("tabs:close", (_e, id) => close(id));
ipcMain.on("tabs:move", (_e, { id, to }) => {
  const i = tabs.findIndex((t) => t.id === id);
  if (i < 1 || to < 1 || to >= tabs.length) return;
  const [t] = tabs.splice(i, 1);
  tabs.splice(to, 0, t);
  sendState();
});

// Claude's status per project, for the dots on the tabs
async function pollStatus() {
  if (!hubUrl) return;
  try {
    const d = await fetch(`${hubUrl}/api/hub/projects`).then((r) => r.json());
    const next = {};
    for (const p of d.projects) next[p.root] = { working: p.working > 0, waiting: p.waiting > 0, live: p.live };
    if (JSON.stringify(next) !== JSON.stringify(status)) { status = next; sendState(); }
  } catch {}
}

function menu() {
  const dev = !app.isPackaged;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    {
      label: "File",
      submenu: [
        { label: "Projects", accelerator: "CmdOrCtrl+1", click: () => { focusWindow(); select("home"); } },
        { label: "Add a Project…", accelerator: "CmdOrCtrl+O", click: () => {
          focusWindow(); select("home");
          tabs[0]?.view.webContents.executeJavaScript("window.dispatchEvent(new Event('loupe:add-project'))");
        } },
        { type: "separator" },
        { label: "Close Tab", accelerator: "CmdOrCtrl+W", click: () => { if (activeId !== "home") close(activeId); else win?.close(); } },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Reload", accelerator: "CmdOrCtrl+R", click: () => activeTab()?.view.webContents.reload() },
        ...(dev ? [{ label: "Developer Tools", accelerator: "Alt+CmdOrCtrl+I", click: () => activeTab()?.view.webContents.toggleDevTools() }] : []),
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" }, { role: "zoom" },
        { type: "separator" },
        { label: "Next Tab", accelerator: "Ctrl+Tab", click: () => step(1) },
        { label: "Previous Tab", accelerator: "Ctrl+Shift+Tab", click: () => step(-1) },
        { label: "Show Next Tab", accelerator: "CmdOrCtrl+Shift+]", visible: false, click: () => step(1) },
        { label: "Show Previous Tab", accelerator: "CmdOrCtrl+Shift+[", visible: false, click: () => step(-1) },
        ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ label: `Tab ${n}`, accelerator: `CmdOrCtrl+${n}`, visible: false, click: () => tabs[n - 1] && select(tabs[n - 1].id) })),
        { type: "separator" },
        { role: "front" },
      ],
    },
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
  createWindow();
  setInterval(pollStatus, 3000);
  pollStatus();
  nativeTheme.on("updated", () => { for (const t of tabs) t.view.setBackgroundColor(background()); });
  app.on("activate", () => focusWindow());
});

// The canvases keep serving Claude Code after the window closes
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
