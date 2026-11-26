import {app, BrowserWindow, Menu, dialog, protocol, session, ipcMain, shell, screen, powerSaveBlocker, clipboard,safeStorage,systemPreferences} from "electron";
import {createReadStream, existsSync, readFileSync} from "node:fs";
import {readFile, stat, realpath, writeFile} from "node:fs/promises";
import {Readable} from "node:stream";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {StateStore} from "../common/store.mjs";
import {importEnvelope, MAX_STATE_BYTES} from "../common/state.mjs";
import {StandardUpdater} from "./updater.mjs";
import {ORIGIN, CSP, MIME, isGameURL, resolveAsset, byteRange,endsLanSessionForNavigation} from "./protocol.mjs";
import {windowChrome, connectWindowUI, quitAfterLastWindow} from "./window-ui.mjs";
import {updateDistribution} from "./distribution.mjs";
import {issueFormURL} from "./report.mjs";
import {DesktopPreferences, graphicsSwitches, restoreBounds} from "./preferences.mjs";
import {createDesktopControls} from "./desktop-controls.mjs";
import {NativeCoop} from "./coop.mjs";
import {gatewayOrigin} from "../common/internet-coop.mjs";
import {configureBrokerSession} from "./coop-session.mjs";
import {lanIdentity} from "../common/lan-policy.mjs";
import {coopMaps} from "../common/coop-rules.mjs";
import {CloudSync} from "../common/cloud-sync.mjs";
import {DesktopCloudHost} from "./cloud-host.mjs";
import {cloudError} from "../common/cloud-save.mjs";
import {CLOUD_RETURN_SCHEME,cloudReturnId} from "../common/cloud-return.mjs";
import {VOICE_ACTIONS,voiceRoomActive,voiceAvailable} from "../common/voice-state.mjs";
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
  loadSave: () => store.loadState(), onFeedback: value => {
    pendingFeedback = value;
    void showPending().catch(console.error);
  }});
let window, desktopControls, pendingMessage, pendingFeedback, presentedVersion, showing = false, reopenUpdate = false;
let lan, brokerWindow, brokerReady, brokerResolve, brokerReject,brokerSession;
let voiceArmedKey=null,voicePermissionSerial=0,voicePrompting=false,voiceHudHeld=false;
const voiceKey=()=>lan&&`${lan.active}|${lan.controller.epoch}|${lan.value.me??""}`;
function suspendVoice(){
  voicePermissionSerial++;voiceArmedKey=null;voiceHudHeld=false;lan?.voiceAction("suspend");
}
async function voiceCommand(requested,hold=false){
  if(!window?.isFocused())return;
  const hud=hold||requested==="toggle";
  if(hud&&(!lan.voice.enabled||lan.value.phase!=="playing"))return;
  const action=requested==="toggle"?(lan.voice.mode==="open"?"mute":"open-mic"):requested;
  if(!VOICE_ACTIONS.includes(action))return;
  const generation=++voicePermissionSerial,key=voiceKey();
  if(["disable","mute"].includes(action)){voiceArmedKey=null;voiceHudHeld=false;lan.voiceAction(action);return;}
  if(!voiceAvailable(lan.state()))return;
  const selector=hud?
    '.offline-voice-hud a.offline-voice-button[data-standard-voice-action="toggle"][href="/__native__/voice/toggle"]':
    `.offline-voice-controls a[data-standard-voice-action="${action}"][href="/__native__/voice/${action}"]`;
  const visible=await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  if(!visible||generation!==voicePermissionSerial||key!==voiceKey()||!window?.isFocused()||hold&&!voiceHudHeld)return;
  if(action==="enable"){lan.voiceAction(action);return;}
  if(!lan.voice.enabled)return;
  if(process.platform==="darwin"){
    voicePrompting=true;
    let granted=false;
    try{
      const status=systemPreferences.getMediaAccessStatus("microphone");
      granted=status==="granted"||status==="not-determined"&&await systemPreferences.askForMediaAccess("microphone");
    }finally{voicePrompting=false;}
    if(generation!==voicePermissionSerial||key!==voiceKey()||hold&&!voiceHudHeld)return;
    if(!granted){lan.voiceAction("permission-denied");return;}
    if(!hold&&window&&!window.isFocused()){
      // Consent can resolve just before macOS gives focus back to the game.
      const target=window;
      await new Promise(resolve=>{
        const done=()=>{clearTimeout(timer);target.removeListener("focus",done);resolve();};
        const timer=setTimeout(done,1500);target.once("focus",done);
      });
    }
  }
  if(generation!==voicePermissionSerial||key!==voiceKey()||!window?.isFocused()||hold&&!voiceHudHeld)return;
  voiceArmedKey=key;lan.voiceAction(action);
}
let cloud,cloudHost,pendingCloud;
function returnFromCloud(url){
  if(cloudHost?.acceptsReturn(url))focusAfterCloud();
}
function focusAfterCloud(){
  if(!window||window.isDestroyed())return;
  if(window.isMinimized())window.restore();
  window.show();window.focus();
  // Only foreground the existing app. Native proof polling, never this URL,
  // establishes the session; no navigation, save mutation or game reload.
  void showPending().catch(console.error);
}
const BROKER_URL = `${ORIGIN}/offline/lan-broker.html`;
async function brokerInput(value) {
  if(value.type==="reset"&&(!brokerWindow||brokerWindow.isDestroyed()))return;
  if(!brokerWindow || brokerWindow.isDestroyed()){
    brokerReady=new Promise((resolve,reject)=>{brokerResolve=resolve;brokerReject=reject;});
    brokerWindow=new BrowserWindow({show:false,width:32,height:32,skipTaskbar:true,
      webPreferences:{preload:path.join(root,"lan-broker-preload.cjs"),sandbox:true,contextIsolation:true,nodeIntegration:false,
        session:brokerSession,webSecurity:true,backgroundThrottling:false,autoplayPolicy:"no-user-gesture-required",devTools:!app.isPackaged}});
    brokerWindow.webContents.setWindowOpenHandler(()=>({action:"deny"}));
    brokerWindow.webContents.on("will-navigate",event=>event.preventDefault());
    brokerWindow.webContents.on("will-redirect",event=>event.preventDefault());
    brokerWindow.webContents.on("will-attach-webview",event=>event.preventDefault());
    brokerWindow.webContents.on("render-process-gone",()=>{brokerReject?.(new Error("LAN transport stopped."));brokerWindow?.destroy();brokerWindow=null;lan?.stop("LAN transport stopped. Your save is preserved.",true,false);});
    brokerWindow.webContents.on("did-fail-load",()=>brokerReject?.(new Error("Bundled LAN transport could not load.")));
    void brokerWindow.loadURL(BROKER_URL).catch(error=>brokerReject?.(error));
  }
  await brokerReady;
  if(brokerWindow&&!brokerWindow.isDestroyed())brokerWindow.webContents.send("standard:lan-broker-input",value);
}
function lanEvent(value){
  if(window&&!window.isDestroyed()&&!window.webContents.isDestroyed())window.webContents.send("standard:lan-event",value);
}
async function lanProfile(){
  const saved=(await store.loadState())?.state;
  if(!saved)throw new Error("Choose your starters and create a local save first.");
  return {name:saved.profile.name,league:saved.profile.league,maps:coopMaps(saved.profile.biomes),
    completedParties:[...new Set(Object.values(saved.finished??{}).map(result=>result.record?.coop?.party).filter(Boolean))],
    unfinished:Boolean(saved.activeRun||saved.suspended),ticket:saved.activeRun?.ticket};
}

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
    if (pendingFeedback) {
      const value = pendingFeedback;
      const handled = await presentUpdateFeedback(value);
      // Keep feedback queued until the game UI can show it. Never substitute
      // an operating-system update alert or interrupt an active run.
      if (handled && pendingFeedback === value) pendingFeedback = null;
    } else if(pendingCloud){
      const value=pendingCloud;
      const handled=await window.webContents.executeJavaScript(`globalThis.PokeBonkOfflineUI?.cloudFeedback(${JSON.stringify(value)}) ?? false`).catch(()=>false);
      if(handled&&pendingCloud===value)pendingCloud=null;
    } else if (pendingMessage) {
      const detail = pendingMessage; pendingMessage = null;
      await dialog.showMessageBox(window, {type: "info", message: config.productName, detail, buttons: ["OK"]});
    } else if (updater.pending && !updater.downloading && !updater.ready && !updater.installing &&
        updater.pending.manifest.version !== presentedVersion) {
      const {manifest} = updater.pending;
      presentedVersion = manifest.version;
      updater.publish("available");
    }
  } finally { showing = false; }
}
async function presentUpdateFeedback(value) {
  if (!window || window.isDestroyed()) return false;
  // One-way UI data only. The renderer receives no updater methods, URLs or
  // arbitrary commands; download/installation remain explicit native actions.
  try {
    const handled = await window.webContents.executeJavaScript(
      `globalThis.PokeBonkOfflineUI?.updateFeedback(${JSON.stringify({...value, open: reopenUpdate})}) ?? false`);
    if (handled) reopenUpdate = false;
    return handled;
  } catch { return false; }
}
async function checkUpdates(manual = false) {
  if (manual) reopenUpdate = true;
  if (updater.downloading || updater.installing || updater.ready) {
    if (manual) { pendingFeedback = updater.feedback; await showPending(); }
    return;
  }
  if (manual) {
    pendingFeedback = {state: "checking"};
    presentedVersion = null;
    await showPending();
  }
  try {
    const result = await updater.check(manual);
    if (manual && result.current) pendingFeedback = {state: result.ahead ? "ahead" : "current", latestVersion: result.latestVersion};
    else if (manual && updater.pending) {
      presentedVersion = updater.pending.manifest.version;
      pendingFeedback = updater.publish("available");
    }
  } catch (error) {
    // Automatic errors are intentionally silent. Playing never depends on GitHub.
    if (manual) pendingFeedback = {state: "error", detail: error.message};
  }
  await showPending();
}
async function updateAction(action) {
  if (!await idle() || updater.installing) return;
  if (action === "download-update") {
    if (updater.downloading) return;
    try { await updater.downloadPending(); }
    catch (error) {
      // Includes compatibility failures raised before the transfer begins.
      updater.publish("error", {errorStage: "download", detail: error.message, retryAction: "download-update"});
    }
    return;
  }
  if (action !== "install-update" || !updater.ready || updater.downloading) return;
  updater.installing = true;
  try {
    if (["connecting", "hosting", "lobby", "preparing", "playing"].includes(lan?.value.phase))
      throw new Error("Leave your co-op room before installing an update.");
    updater.publish("installing");
    await Promise.all([store.queue, preferences.save()]);
    const ready = await updater.prepareInstall();
    // Hashing can take time. Recheck the game immediately before handoff.
    if (!await idle() || ["connecting", "hosting", "lobby", "preparing", "playing"].includes(lan?.value.phase))
      throw new Error("Return to the homepage and leave co-op before installing.");
    if (["dmg", "nsis", "deb"].includes(ready.artifact.kind)) {
      const error = await shell.openPath(ready.file);
      if (error) throw new Error("The system could not open the verified installer.");
    } else {
      // Portable EXEs/AppImages are games, not installers. Never run them out
      // of the download cache or silently overwrite an application folder.
      shell.showItemInFolder(ready.file);
    }
    app.quit();
  } catch (error) {
    updater.publish("error", {errorStage: "install", detail: error.message,
      retryAction: updater.ready ? "install-update" : "download-update"});
  } finally { updater.installing = false; }
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
    if (!isGameURL(event.url) || new URL(event.url).pathname.startsWith("/__native__/") ||
        new URL(event.url).pathname === "/offline/lan-broker.html") event.preventDefault();
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
    lan?.stop("The game renderer stopped. Your unfinished run is preserved.",true);
    if (window.isDestroyed() || details.reason === "clean-exit") return;
    const choice = await dialog.showMessageBox(window, {type: "warning", message: "The game renderer stopped",
      detail: "Your last durable checkpoint and earned progress remain on disk. Reloading may lose only changes since that checkpoint. If this repeats, reset graphics to Auto from View.",
      buttons: ["Close app", "Reload saved game"], defaultId: 0, cancelId: 0});
    if (window.isDestroyed()) return;
    if (choice.response === 1) window.webContents.reload();
    else window.close();
  });
  window.on("focus", () => { void checkUpdates(); });
  window.on("blur",()=>{if(!voicePrompting)suspendVoice();});
  window.on("minimize",suspendVoice);
  window.webContents.on("did-finish-load", () => { void checkUpdates(); });
  window.webContents.on("did-finish-load", () => lan?.publish());
  window.webContents.on("did-start-navigation", (details,_url,sameDocument,mainFrame) => {
    if(endsLanSessionForNavigation(details,sameDocument,mainFrame)&&
      ["hosting","connecting","lobby","preparing","playing"].includes(lan?.value.phase))
      lan.stop("The game reloaded. Your unfinished run is preserved.",true);
  });
  window.on("closed",()=>{
    lan?.stop();
    brokerWindow?.destroy();brokerWindow=null;brokerReady=null;
  });
  await window.loadURL(`${ORIGIN}/index.html?lang=en`);
}

if (!primaryInstance) app.quit();
else {
  app.on("open-url",(event,url)=>{event.preventDefault();returnFromCloud(url);});
  app.on("second-instance", (_event,argv) => {
    const returned=argv.find(value=>cloudReturnId(value));
    if(returned)returnFromCloud(returned);
    else {window?.show();window?.focus();}
  });
  app.whenReady().then(async () => {
    if(app.isPackaged&&process.platform!=="darwin")app.setAsDefaultProtocolClient(CLOUD_RETURN_SCHEME);
    await stat(path.join(game, "index.html"));
    await preferences.save().catch(error => console.warn("Native presentation preferences:", error.message));
    desktopControls = createDesktopControls({app, screen, powerSaveBlocker, dialog, preferences, config,
      getWindow: () => window, idle, notify: message => { pendingMessage = message; }});
    const offline = session.defaultSession;
    brokerSession=session.fromPartition("pokebonk-standard-native-coop");
    const assetIdentity=JSON.parse(await readFile(path.join(game,"asset-manifest.json"),"utf8")).gameDigest;
    lan=new NativeCoop({config,identity:lanIdentity(config,assetIdentity),profile:lanProfile,emit:lanEvent,broker:brokerInput});
    const cloudIdle=async()=>await idle()&&!["hosting","connecting","lobby","preparing","playing"].includes(lan?.value.phase);
    cloudHost=new DesktopCloudHost({config,directory:dataDirectory,safeStorage:process.platform==="darwin"?undefined:safeStorage,idle:cloudIdle,
      openBrowser:url=>shell.openExternal(url),reload:()=>window?.webContents.reload(),
      onReturn:focusAfterCloud,
      onLogin:loginCode=>cloud.publish("connecting",{loginCode,open:true})});
    cloudHost.snapshot=async()=>{try{return await store.cloudSnapshot();}catch(error){throw cloudError(error.code==="ENOENT"?"no_local_save":"save_read_failed");}};
    cloudHost.restore=async value=>{
      if(!await cloudIdle())throw cloudError("room_active");
      await store.restoreCloud(value);if(window&&!window.isDestroyed())window.webContents.reload();
    };
    cloud=new CloudSync({config,host:cloudHost,emit:value=>{pendingCloud=value;void showPending().catch(console.error);}});
    offline.webRequest.onBeforeRequest({urls: ["http://*/*", "https://*/*", "ws://*/*", "wss://*/*", "ftp://*/*"]},
      (_request, callback) => callback({cancel:true}));
    configureBrokerSession(brokerSession,{gateway:gatewayOrigin(config),phase:()=>lan.value.phase,
      microphone:()=>voiceArmedKey===voiceKey()&&voiceRoomActive(lan.state())&&Boolean(window?.isFocused()),
      trusted:contents=>Boolean(brokerWindow&&!brokerWindow.isDestroyed()&&contents===brokerWindow.webContents&&contents.getURL()===BROKER_URL)});
    offline.setPermissionCheckHandler((contents, permission, origin, details) =>
      (contents === window?.webContents && details.isMainFrame && isGameURL(origin) &&
      ["pointerLock", "fullscreen"].includes(permission)));
    offline.setPermissionRequestHandler((contents, permission, callback, details) =>
      callback((contents === window?.webContents && details.isMainFrame &&
        isGameURL(details.requestingUrl) && ["pointerLock", "fullscreen"].includes(permission))));
    offline.on("will-download", (_event, item) => {
      if (!item.getURL().startsWith(`blob:${ORIGIN}/`)) { item.cancel(); return; }
      item.setSaveDialogOptions({title: "Export local backup", defaultPath: "pokebonk-offline-save.json"});
    });
    const assetResponse=async request => {
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
          "Content-Security-Policy": new URL(request.url).pathname==="/offline/lan-broker.html"&&gatewayOrigin(config)?
            CSP.replace("connect-src 'self' blob: data:",`connect-src 'self' blob: data: ${gatewayOrigin(config)} ${gatewayOrigin(config).replace("https:","wss:")}`):CSP,
          "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store",
          "Accept-Ranges": "bytes", "Content-Length": String(Math.max(0, end - start + 1))};
        if (range) headers["Content-Range"] = `bytes ${start}-${end}/${info.size}`;
        return new Response(request.method === "HEAD" || !info.size ? null : Readable.toWeb(createReadStream(actual, {start, end})),
          {status: range ? 206 : 200, headers});
      } catch { return new Response("Local asset not found", {status: 404}); }
    };
    offline.protocol.handle("pokebonk-standard",assetResponse);
    brokerSession.protocol.handle("pokebonk-standard",assetResponse);
    ipcMain.handle("standard:load-state", async event => { sender(event); return store.clientLoadState(); });
    ipcMain.handle("standard:save-state", async (event, value) => { sender(event); return store.clientSaveState(value); });
    let lanCommands=Promise.resolve(),lanSearchRequest=0;
    ipcMain.on("standard:lan-action",(event,action,data,...extra)=>{
      try{
        sender(event);
        if(extra.length||!["host","join","leave","copy","find","browse","cancel-find"].includes(action)||!data||JSON.stringify(data).length>512)return;
        if(action==="cancel-find"){lanSearchRequest++;lan.cancelFind();return;}
        const searchRequest=lanSearchRequest;
        lanCommands=lanCommands.catch(()=>{}).then(async()=>{
          if(!window||window.isDestroyed()||!window.isFocused())return;
          if(action==="copy"){
            const current=lan.state(),code=current.code;
            if(typeof code==="string"&&(current.connectionMode==="lan"?/^[A-Z0-9]{4}$/:/^[A-Z0-9]{6}$/).test(code)){
              clipboard.writeText(code);lanEvent({type:"notice",message:"Room code copied."});
            }return;
          }
          const allowed=await window.webContents.executeJavaScript("!globalThis.PokeBonkNativeApp?.run&&Boolean(document.querySelector('.offline-lan-card,.offline-lan-home,.offline-lan-room'))");
          if(allowed&&(!["find","browse"].includes(action)||searchRequest===lanSearchRequest))await lan.command(action,data);
        }).catch(error=>{lanEvent({type:"notice",message:error.message});if(["host","join"].includes(action))lan.stop(error.message,true);});
      }catch{}
    });
    ipcMain.on("standard:lan-game",(event,channel,data,...extra)=>{
      try{sender(event);if(extra.length||typeof channel!=="string"||JSON.stringify(data??null).length>48000)return;
        if(channel==="cancel-find")lanSearchRequest++;
        void lan.fromGame(channel,data).catch(error=>lanEvent({type:"notice",message:error.message}));
      }catch{}
    });
    ipcMain.on("standard:voice-action",(event,action,...extra)=>{
      try{
        sender(event);
        if(extra.length||!(VOICE_ACTIONS.includes(action)||action==="toggle"))return;
        void voiceCommand(action).catch(()=>{voicePrompting=false;voiceArmedKey=null;lan.voiceAction("permission-denied");});
      }catch{}
    });
    ipcMain.on("standard:voice-gesture",(event,action,...extra)=>{
      try{
        sender(event);if(extra.length||!["hold-start","hold-end"].includes(action))return;
        if(action==="hold-end"){
          voiceHudHeld=false;voicePermissionSerial++;voiceArmedKey=null;
          lan.voiceAction("release");lan.voiceAction("mute");return;
        }
        if(!window?.isFocused()||!lan.voice.enabled||lan.value.phase!=="playing")return;
        voiceHudHeld=true;
        void voiceCommand("ptt",true).catch(()=>{voiceHudHeld=false;voiceArmedKey=null;lan.voiceAction("mute");});
      }catch{}
    });
    ipcMain.on("standard:voice-hold",(event,pressed,...extra)=>{
      try{
        sender(event);if(extra.length||typeof pressed!=="boolean")return;
        if(!pressed){lan.voiceAction("release");return;}
        if(window?.isFocused()&&voiceArmedKey===voiceKey()&&lan.voice.enabled&&lan.voice.mode==="ptt")
          lan.voiceAction("press");
      }catch{}
    });
    ipcMain.on("standard:lan-broker",(event,text)=>{
      if(!brokerWindow||event.sender!==brokerWindow.webContents||event.senderFrame!==brokerWindow.webContents.mainFrame||
        event.senderFrame.url!==BROKER_URL||typeof text!=="string"||text.length>48000)return;
      try{const value=JSON.parse(text);if(value.type==="ready")brokerResolve?.();else lan.fromBroker(value);}catch{}
    });
    ipcMain.on("standard:cloud-status",(event,...args)=>{
      try{
        sender(event);if(args.length)return;
        void idle().then(ok=>{if(ok)return cloud.command("open");}).catch(console.error);
      }catch{/* Fixed native cloud operation; no renderer-supplied destination. */}
    });
    ipcMain.on("standard:cloud-action",(event,action,selection,...extra)=>{
      try{
        sender(event);if(extra.length||!["connect","cancel","sync","auto-on","auto-off","disconnect","backups","review-local","review-cloud","confirm-local","confirm-cloud","review-backup"].includes(action)||
          (action==="review-backup"?!/^[a-f0-9]{32}$/.test(selection??""):selection!==undefined))return;
        void idle().then(ok=>{if(ok)return cloud.command(action,selection);}).catch(console.error);
      }catch{/* Fixed user-gesture actions only; no URLs or bearer credentials. */}
    });
    ipcMain.on("standard:check-updates", (event, ...args) => {
      try {
        sender(event);
        if (args.length) return;
        void idle().then(ok => { if (ok) return checkUpdates(true); }).catch(console.error);
      } catch { /* Untrusted frames cannot use native update networking. */ }
    });
    ipcMain.on("standard:update-action", (event, action, ...extra) => {
      try {
        sender(event);
        if (extra.length || !["download-update", "install-update"].includes(action)) return;
        void updateAction(action).catch(console.error);
      } catch { /* Fixed actions only; no renderer-supplied path or URL. */ }
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
    void cloud.init().catch(()=>{pendingCloud={state:"error",connected:false,automatic:false,reason:"secure_storage_unavailable"};});
    setInterval(()=>void cloud.tick(),5000).unref();
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
    quitFlush ??= Promise.all([store.queue, preferences.save(),cloudHost?.close()]).catch(console.error).finally(() => {
      quitFlushed = true;
      app.quit();
    });
  });
}
