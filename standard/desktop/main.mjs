import {app, BrowserWindow, Menu, dialog, protocol, session, ipcMain, shell, screen, powerSaveBlocker} from "electron";
import {createReadStream, existsSync, readFileSync} from "node:fs";
import {readFile, stat, realpath, writeFile} from "node:fs/promises";
import {Readable} from "node:stream";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {StateStore} from "../common/store.mjs";
import {importEnvelope, MAX_STATE_BYTES} from "../common/state.mjs";
import {StandardUpdater} from "./updater.mjs";
import {ORIGIN, CSP, MIME, isGameURL, resolveAsset, byteRange} from "./protocol.mjs";
import {windowChrome, connectWindowUI, quitAfterLastWindow} from "./window-ui.mjs";
import {updateDistribution, installationInstructions} from "./distribution.mjs";
import {issueFormURL} from "./report.mjs";
import {DesktopPreferences, graphicsSwitches, restoreBounds} from "./preferences.mjs";
import {createDesktopControls} from "./desktop-controls.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
// Graphics switches must be selected before Electron initializes Chromium.
const config = JSON.parse(readFileSync(path.join(root, "../config.json"), "utf8"));
app.setName(config.productName);
app.setAppUserModelId(config.applicationId);
if (process.platform === "linux") app.setDesktopName(`${config.applicationId}.desktop`);
const dataDirectory = !app.isPackaged && process.env.POKEBONK_STANDARD_USER_DATA
  ? path.resolve(process.env.POKEBONK_STANDARD_USER_DATA)
  : path.join(app.getPath("appData"), config.applicationId);
app.setPath("userData", dataDirectory);
const primaryInstance = app.requestSingleInstanceLock();
const preferences = new DesktopPreferences(dataDirectory, process.platform);
let launchBackend = preferences.state.backend;
if (primaryInstance) {
  try { launchBackend = preferences.beginGraphicsLaunch(); }
  catch (error) {
    // If a trial cannot be recorded durably, do not risk an unrecoverable
    // alternate-backend launch. This changes no save/profile data.
    launchBackend = "auto"; preferences.state.backend = "auto"; preferences.state.trial = null;
    console.warn("Using Auto graphics because native preferences could not be saved:", error.message);
  }
}
for (const [key, value] of graphicsSwitches(launchBackend, process.platform)) app.commandLine.appendSwitch(key, value);
protocol.registerSchemesAsPrivileged([{scheme: "pokebonk-standard",
  privileges: {standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true}}]);
const store = new StateStore(path.join(dataDirectory, "saves"), config);
const game = app.isPackaged ? path.join(process.resourcesPath, "game") : path.resolve(root, "../../build/standard-game");
const updater = new StandardUpdater({config, directory: dataDirectory,
  platform: `${process.platform}-${process.arch}`,
  distribution: updateDistribution({platform: process.platform, arch: process.arch, packaged: app.isPackaged,
    env: process.env, nsisInstalled: app.isPackaged && existsSync(path.join(path.dirname(process.execPath), ".pokebonk-offline-nsis"))}),
  loadSave: () => store.loadState()});
let window, desktopControls, pendingMessage, presentedVersion, showing = false, verifiedDownload;

async function idle() {
  if (!window || window.isDestroyed() || !window.isFocused() || window.webContents.isLoading()) return false;
  try {
    return await window.webContents.executeJavaScript(`!globalThis.PokeBonkNativeApp?.run &&
      Boolean(document.querySelector(".offline-menu,.offline-card,.offline-boot-error"))`);
  } catch { return false; }
}
async function showPending() {
  if (showing || !await idle()) return;
  showing = true;
  try {
    if (pendingMessage) {
      const detail = pendingMessage; pendingMessage = null;
      await dialog.showMessageBox(window, {type: "info", message: `${config.productName} updates`, detail, buttons: ["OK"]});
    } else if (verifiedDownload) {
      const ready = verifiedDownload; verifiedDownload = null;
      const choice = await dialog.showMessageBox(window, {type: "info", message: "Verified update downloaded",
        detail: installationInstructions(ready.artifact.kind),
        buttons: ["Show verified download", "Later"], defaultId: 1, cancelId: 1});
      if (choice.response === 0) shell.showItemInFolder(ready.file);
    } else if (updater.pending && updater.pending.manifest.version !== presentedVersion) {
      const {manifest} = updater.pending;
      presentedVersion = manifest.version;
      const choice = await dialog.showMessageBox(window, {type: "info", message: `${config.productName} ${manifest.version} is available`,
        detail: `Bundled game ${manifest.upstream.version} (${manifest.upstream.build})\n\n${manifest.notes}\n\nDownloading does not install or replace the game.`,
        buttons: ["Download update", "Later"], defaultId: 1, cancelId: 1});
      if (choice.response === 0) {
        // No automatic download; this branch only follows the explicit button.
        void updater.downloadPending().then(value => { verifiedDownload = value; })
          .catch(error => { pendingMessage = `${error.message}\nThe installed game is still available offline.`; });
      }
    }
  } finally { showing = false; }
}
async function checkUpdates(manual = false) {
  try {
    const result = await updater.check(manual);
    if (manual && result.current) pendingMessage = `You have the latest verified ${config.productName} release.`;
    if (manual) presentedVersion = null;
  } catch (error) {
    // Automatic errors are intentionally silent. Playing never depends on GitHub.
    if (manual) pendingMessage = `Could not check for updates: ${error.message}\nKeep playing the installed version offline.`;
  }
  await showPending();
}
function sender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
      !isGameURL(event.senderFrame.url)) throw new Error("Untrusted storage caller.");
}
async function importSave() {
  if (!await idle()) { pendingMessage = "Return to the main menu before importing a backup."; return; }
  const selected = await dialog.showOpenDialog(window, {title: "Import progression backup",
    properties: ["openFile"], filters: [{name: "Save JSON", extensions: ["json"]}]});
  if (selected.canceled || !selected.filePaths[0]) return;
  try {
    const file = selected.filePaths[0];
    if ((await stat(file)).size > MAX_STATE_BYTES) throw new Error("Backup exceeds 32 MiB.");
    const value = importEnvelope(JSON.parse(await readFile(file, "utf8")), config);
    const choice = await dialog.showMessageBox(window, {type: "warning", message: "Replace this edition's local progress?",
      detail: "An immutable pre-import copy will be kept in the saves directory. Unlocked saves are not accepted.",
      buttons: ["Cancel", "Import backup"], defaultId: 0, cancelId: 0});
    if (choice.response !== 1 || !await idle()) return;
    await store.importState(value);
    window.webContents.reload();
  } catch (error) { await dialog.showMessageBox(window, {type: "error", message: "Backup not imported", detail: error.message}); }
}
async function exportSave() {
  try {
    const value = await store.loadState();
    if (!value) throw new Error("There is no native save yet.");
    const target = await dialog.showSaveDialog(window, {defaultPath: "pokebonk-offline-save.json", filters: [{name: "JSON", extensions: ["json"]}]});
    if (!target.canceled && target.filePath) await writeFile(target.filePath, JSON.stringify(value, null, 2));
  } catch (error) { await dialog.showMessageBox(window, {type: "error", message: "Could not export save", detail: error.message}); }
}
function menus() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === "darwin" ? [{label: config.productName, submenu: [{role: "about"}, {type: "separator"}, {label: "Check for updates…", click: () => void checkUpdates(true)}, {role: "quit"}]}] : []),
    {label: "File", submenu: [{label: "Check for updates…", click: () => void checkUpdates(true)}, {role: "quit"}]},
    {label: "Saves", submenu: [{label: "Export backup…", click: () => void exportSave()},
      {label: "Import backup…", click: () => void importSave()},
      {label: "Show saves folder", click: () => { void shell.openPath(store.directory); }}]},
    {role: "editMenu"},
    {label: "View", submenu: [{label: "Toggle Full Screen", accelerator: process.platform === "darwin" ? "Control+Command+F" : "F11",
      click: () => window?.setFullScreen(!window.isFullScreen())},
      {label: "Display & graphics…", click: () => void desktopControls?.perform("settings")},
      {type: "separator"},
      {label: "Reset graphics to Auto on next launch", click: () => {
        void desktopControls.resetGraphics().then(() => {
          pendingMessage = "Auto graphics will be used the next time you open the app. Your current game was not restarted.";
          return showPending();
        }).catch(error => { pendingMessage = `Could not save graphics preferences: ${error.message}`; });
      }}]},
    {role: "windowMenu"},
  ]));
}
async function createWindow() {
  const restoreMaximized = preferences.state.window?.maximized;
  const restoreFullscreen = preferences.state.window?.fullscreen;
  const restored = restoreBounds(preferences.state.window, screen.getAllDisplays(), screen.getPrimaryDisplay());
  const area = screen.getDisplayMatching(restored).workArea;
  window = new BrowserWindow({...restored, minWidth: Math.min(960, area.width), minHeight: Math.min(540, area.height),
    title: config.productName, backgroundColor: "#151022", show: false, autoHideMenuBar: false,
    ...windowChrome(process.platform),
    icon: path.join(game, "icons/icon-512.png"),
    webPreferences: {preload: path.join(root, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, devTools: !app.isPackaged}});
  connectWindowUI(window);
  desktopControls.connect(window);
  window.webContents.setWindowOpenHandler(() => ({action: "deny"}));
  window.webContents.on("will-navigate", event => {
    if (!isGameURL(event.url) || new URL(event.url).pathname.startsWith("/__native__/")) event.preventDefault();
  });
  window.webContents.on("will-redirect", event => { if (!isGameURL(event.url)) event.preventDefault(); });
  window.webContents.on("will-attach-webview", event => event.preventDefault());
  window.webContents.on("will-prevent-unload", event => {
    const result = dialog.showMessageBoxSync(window, {type: "question", message: `Close ${config.productName}?`,
      detail: "Use Save and quit in the game for an exact checkpoint. The last native checkpoint and earned progress remain saved.",
      buttons: ["Keep playing", "Close"], defaultId: 0, cancelId: 0});
    if (result === 1) event.preventDefault();
  });
  window.once("ready-to-show", () => {
    if (restoreMaximized) window.maximize();
    window.show();
    if (restoreFullscreen) window.setFullScreen(true);
  });
  window.webContents.on("render-process-gone", async (_event, details) => {
    if (window.isDestroyed() || details.reason === "clean-exit") return;
    const choice = await dialog.showMessageBox(window, {type: "warning", message: "The game renderer stopped",
      detail: "Your last durable checkpoint and earned progress remain on disk. Reloading may lose only changes since that checkpoint. If this repeats, reset graphics to Auto from View.",
      buttons: ["Close app", "Reload saved game"], defaultId: 0, cancelId: 0});
    if (window.isDestroyed()) return;
    if (choice.response === 1) window.webContents.reload();
    else window.close();
  });
  window.on("focus", () => { void checkUpdates(); });
  window.webContents.on("did-finish-load", () => { void checkUpdates(); });
  await window.loadURL(`${ORIGIN}/index.html?lang=en`);
}

if (!primaryInstance) app.quit();
else {
  app.on("second-instance", () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    await stat(path.join(game, "index.html"));
    await preferences.save().catch(error => console.warn("Native presentation preferences:", error.message));
    desktopControls = createDesktopControls({app, screen, powerSaveBlocker, dialog, preferences, config,
      getWindow: () => window, idle, notify: message => { pendingMessage = message; }});
    const offline = session.defaultSession;
    offline.webRequest.onBeforeRequest({urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "ftp://*/*"]},
      (_request, callback) => callback({cancel: true}));
    offline.setPermissionCheckHandler((contents, permission, origin, details) =>
      contents === window?.webContents && details.isMainFrame && isGameURL(origin) &&
      ["pointerLock", "fullscreen"].includes(permission));
    offline.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback(contents === window?.webContents && details.isMainFrame &&
        isGameURL(details.requestingUrl) && ["pointerLock", "fullscreen"].includes(permission)));
    offline.on("will-download", (_event, item) => {
      if (!item.getURL().startsWith(`blob:${ORIGIN}/`)) { item.cancel(); return; }
      item.setSaveDialogOptions({title: "Export local backup", defaultPath: "pokebonk-offline-save.json"});
    });
    offline.protocol.handle("pokebonk-standard", async request => {
      try {
        if (!["GET", "HEAD"].includes(request.method)) return new Response(null, {status: 405});
        const file = resolveAsset(game, request.url);
        const actual = await realpath(file), boundary = await realpath(game);
        if (!actual.startsWith(boundary + path.sep)) return new Response(null, {status: 403});
        const info = await stat(actual);
        if (!info.isFile()) return new Response(null, {status: 404});
        let range;
        try { if (request.headers.has("range")) range = byteRange(request.headers.get("range"), info.size); }
        catch { return new Response(null, {status: 416, headers: {"Content-Range": `bytes */${info.size}`}}); }
        const start = range?.start ?? 0, end = range?.end ?? info.size - 1;
        const headers = {"Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
          "Content-Security-Policy": CSP, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
          "Accept-Ranges": "bytes", "Content-Length": String(Math.max(0, end - start + 1))};
        if (range) headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
        return new Response(request.method === "HEAD" || !info.size ? null : Readable.toWeb(createReadStream(actual, {start, end})),
          {status: range ? 206 : 200, headers});
      } catch { return new Response("Local asset not found", {status: 404}); }
    });
    ipcMain.handle("standard:load-state", async event => { sender(event); return store.loadState(); });
    ipcMain.handle("standard:save-state", async (event, value) => { sender(event); return store.saveState(value); });
    ipcMain.on("standard:check-updates", (event, ...args) => {
      try {
        sender(event);
        if (args.length) return;
        void idle().then(ok => { if (ok) return checkUpdates(true); }).catch(console.error);
      } catch { /* Untrusted frames cannot use native update networking. */ }
    });
    ipcMain.on("standard:report-bug", (event, ...args) => {
      try {
        sender(event);
        if (args.length) return;
        void idle().then(ok => {
          if (ok) return shell.openExternal(issueFormURL(config, process.platform));
        }).catch(console.error);
      } catch { /* No renderer-supplied URL or issue content is accepted. */ }
    });
    ipcMain.on("standard:toggle-fullscreen", (event, ...args) => {
      try { sender(event); if (!args.length) window.setFullScreen(!window.isFullScreen()); }
      catch { /* Only our main game frame can request the fixed window action. */ }
    });
    ipcMain.on("standard:desktop-action", (event, action, value, ...extra) => {
      try {
        sender(event);
        if (!extra.length) void desktopControls.perform(action, value).catch(error => {
          pendingMessage = `Could not change presentation settings: ${error.message}`;
        });
      } catch { /* No arbitrary commands or preference keys are accepted. */ }
    });
    app.setAboutPanelOptions({applicationName: config.productName, applicationVersion: config.version,
      iconPath: path.join(game, "icons/icon-512.png"), copyright: "Original game: Charcher. Shell: VdustR. Offline integration: Nicartjay."});
    menus();
    await createWindow();
    setInterval(() => void showPending().catch(console.error), 2000).unref();
  }).catch(error => { console.error(error); dialog.showErrorBox(`${config.productName} could not start`, error.message); app.exit(1); });
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
  quitAfterLastWindow(app, {pendingWrites: () => Promise.all([store.queue, preferences.save()])});
  // Cmd+Q/File→Quit also waits, not just the last window's close button.
  // At will-quit, all windows are gone and no renderer can enqueue new writes.
  let quitFlushed = false, quitFlush;
  app.on("will-quit", event => {
    if (quitFlushed) return;
    event.preventDefault();
    quitFlush ??= Promise.all([store.queue, preferences.save()]).catch(console.error).finally(() => {
      quitFlushed = true;
      app.quit();
    });
  });
}
