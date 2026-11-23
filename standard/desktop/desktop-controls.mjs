import {graphicsBackends, validBackend, RESOLUTIONS, validResolution, fitBounds, resolutionBounds} from "./preferences.mjs";

// Accept only fixed UI verbs and bounded enum/monitor identifiers. No file
// paths, command lines, native objects or URLs cross this boundary.
export function parseDesktopAction(action, value, platform) {
  if (typeof action !== "string" || typeof value !== "string" || value.length > 40) return null;
  if (action === "monitor" && /^-?\d{1,16}$/.test(value) && Number.isSafeInteger(Number(value))) return {action, value: Number(value)};
  if (action === "resolution" && validResolution(value)) return {action, value};
  if (action === "backend" && validBackend(value, platform)) return {action, value};
  if (action === "awake" && ["on", "off"].includes(value)) return {action, value: value === "on"};
  if (["settings", "restart"].includes(action) && value === "") return {action, value};
  return null;
}

export function createDesktopControls({app, screen, powerSaveBlocker, dialog, preferences, getWindow, idle, notify,
  platform = process.platform}) {
  let blocker = null, gpuCrashes = 0, graphics = {}, launchBackend = preferences.state.backend;
  let actions = Promise.resolve();
  const enqueue = operation => {
    const result = actions.catch(() => {}).then(operation);
    actions = result;
    return result;
  };
  const awake = () => {
    const win = getWindow();
    const wanted = preferences.state.keepAwake && win && !win.isDestroyed() && win.isVisible() &&
      win.isFocused() && !win.isMinimized();
    if (wanted && blocker === null) blocker = powerSaveBlocker.start("prevent-display-sleep");
    else if (!wanted && blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; }
  };
  const stopAwake = () => { if (blocker !== null) { powerSaveBlocker.stop(blocker); blocker = null; } };
  const metadata = () => {
    const win = getWindow(), display = win && !win.isDestroyed() ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay();
    const displays = screen.getAllDisplays().map((d, i) => ({id: d.id,
      label: `${d.label || `Display ${i + 1}`} · ${d.size.width} × ${d.size.height} · ${Math.round(d.scaleFactor * 100)}%`,
      primary: d.id === screen.getPrimaryDisplay().id}));
    return {displays, displayId: display.id, resolutions: RESOLUTIONS, backends: graphicsBackends(platform),
      bounds: win && !win.isDestroyed() ? win.getContentSize() : [1280, 720],
      fullscreen: Boolean(win && !win.isDestroyed() && win.isFullScreen()),
      keepAwake: preferences.state.keepAwake, backend: preferences.state.backend, launchBackend,
      restartNeeded: preferences.state.backend !== launchBackend,
      recovery: preferences.state.recovery, graphics};
  };
  const send = () => {
    const win = getWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send("standard:desktop-state", metadata());
  };
  const remember = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    preferences.state.window = {...win.getNormalBounds(), maximized: win.isMaximized(), fullscreen: win.isFullScreen()};
    preferences.saveSoon(); send();
  };
  const resizeWindow = target => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    const apply = () => {
      if (win.isDestroyed()) return;
      if (win.isMaximized()) win.unmaximize();
      win.setBounds(target);
      remember();
    };
    if (win.isFullScreen()) { win.once("leave-full-screen", apply); win.setFullScreen(false); }
    else apply();
  };
  async function refreshGraphics(complete = false) {
    let deadline;
    try {
      const info = await Promise.race([app.getGPUInfo(complete ? "complete" : "basic"), new Promise((_,reject) => {
        deadline = setTimeout(() => reject(new Error("GPU information timed out.")), 4000);
        deadline.unref?.();
      })]);
      graphics = {renderer: String(info.auxAttributes?.glRenderer || info.gpuDevice?.map(d =>
        d.deviceString || `${d.vendorId.toString(16)}:${d.deviceId.toString(16)}`).join(", ") || "System GPU").slice(0, 300),
        features: Object.fromEntries(Object.entries(app.getGPUFeatureStatus()).filter(([key]) =>
          ["gpu_compositing", "webgl", "webgl2", "vulkan", "opengl"].includes(key))),
        electron: process.versions.electron, chromium: process.versions.chrome, crashes: gpuCrashes};
    } catch { graphics = {renderer: "GPU information unavailable", crashes: gpuCrashes}; }
    finally { clearTimeout(deadline); }
    send();
  }
  async function commitPreferences(changes) {
    const before = Object.fromEntries(Object.keys(changes).map(key => [key,preferences.state[key]]));
    Object.assign(preferences.state, changes);
    try { await preferences.save(); }
    catch (error) {
      // Roll back only our fields, preserving a concurrent native GPU-recovery
      // decision or a window move. A failed disk write must not pretend to apply.
      for (const key of Object.keys(changes)) if (preferences.state[key] === changes[key]) preferences.state[key] = before[key];
      send(); throw error;
    }
  }
  async function runAction(action, value = "") {
    const command = parseDesktopAction(action, value, platform);
    if (!command) return;
    if (!await idle()) return;
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (command.action === "settings") {
      await refreshGraphics(true);
      await win.webContents.executeJavaScript("globalThis.PokeBonkOfflineUI?.desktopSettings?.()");
    } else if (command.action === "monitor") {
      const display = screen.getAllDisplays().find(d => d.id === command.value);
      if (!display) { notify("That monitor is no longer connected."); return send(); }
      const bounds = win.getNormalBounds(), a = display.workArea;
      resizeWindow(fitBounds({...bounds, x: a.x + (a.width - bounds.width) / 2, y: a.y + (a.height - bounds.height) / 2}, a));
    } else if (command.action === "resolution") {
      const outer = win.getBounds(), [width, height] = win.getContentSize();
      resizeWindow(resolutionBounds(command.value, screen.getDisplayMatching(outer),
        {frameWidth: Math.max(0, outer.width - width), frameHeight: Math.max(0, outer.height - height)}));
    } else if (command.action === "awake") {
      await commitPreferences({keepAwake:command.value}); awake(); send();
    } else if (command.action === "backend") {
      if (preferences.state.backend === command.value) return;
      await commitPreferences({backend:command.value,
        trial:command.value === launchBackend || command.value === "auto" ? null : {backend:command.value,started:false},
        recovery:""});
      send();
    } else if (command.action === "restart" && preferences.state.backend !== launchBackend) {
      const choice = await dialog.showMessageBox(win, {type: "question", message: "Restart to change the graphics backend?",
        detail: "Only the app will restart. Progress and backups stay in their existing location. If this backend cannot start, the next launch restores Auto.",
        buttons: ["Later", "Restart now"], defaultId: 0, cancelId: 0});
      if (choice.response === 1 && await idle()) { await preferences.save(); app.relaunch(); app.quit(); }
    }
  }
  const perform = (action, value = "") => enqueue(() => runAction(action, value));
  // Native menu recovery remains available if the renderer cannot reach its
  // idle menu. This is deliberately NOT another renderer action/bridge method.
  const resetGraphics = () => enqueue(async () => {
    await commitPreferences({backend:"auto",trial:null,recovery:""}); send();
  });
  function connect(win) {
    for (const event of ["move", "resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) win.on(event, remember);
    for (const event of ["show", "focus", "restore"]) win.on(event, awake);
    for (const event of ["blur", "minimize", "hide"]) win.on(event, stopAwake);
    win.on("close", remember);
    win.on("closed", stopAwake);
    win.webContents.on("did-finish-load", () => { send(); void refreshGraphics(); });
    win.webContents.on("before-input-event", (event, input) => {
      // Native fullscreen leaves Escape available for the game's pause/back.
      if (input.key === "F11") {
        event.preventDefault();
        if (input.type === "keyDown" && !input.isAutoRepeat) win.setFullScreen(!win.isFullScreen());
      }
    });
    let checking = false;
    const healthy = setInterval(async () => {
      if (win.isDestroyed()) return clearInterval(healthy);
      if (checking || !preferences.state.trial?.started) return;
      checking = true;
      try {
        const ready = await win.webContents.executeJavaScript("Boolean(globalThis.PokeBonkNativeApp?.r && document.documentElement.dataset.standardReady==='true')");
        if (ready && !gpuCrashes) { preferences.state.trial = null; await preferences.save(); clearInterval(healthy); }
      } catch { /* Startup may still be loading. Never reload a running game. */ }
      finally { checking = false; }
    }, 15000);
    healthy.unref();
    win.once("closed", () => clearInterval(healthy));
  }
  const displayChanged = () => {
    const win = getWindow();
    if (win && !win.isDestroyed() && !win.isFullScreen() && !win.isMaximized()) {
      const bounds = win.getBounds(), displays = screen.getAllDisplays();
      if (!displays.some(d => bounds.x >= d.workArea.x && bounds.y >= d.workArea.y &&
          bounds.x + 80 <= d.workArea.x + d.workArea.width && bounds.y + 40 <= d.workArea.y + d.workArea.height)) {
        resizeWindow(fitBounds(bounds, screen.getPrimaryDisplay().workArea));
      }
    }
    send();
  };
  for (const event of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(event, displayChanged);
  app.on("child-process-gone", (_event, details) => {
    if (details.type !== "GPU" || ["clean-exit", "killed"].includes(details.reason)) return;
    gpuCrashes++; void refreshGraphics();
    if (gpuCrashes >= 3 && preferences.state.backend !== "auto") {
      preferences.state.backend = "auto"; preferences.state.trial = null;
      preferences.state.recovery = "Repeated GPU failures were detected. Auto will be used at the next launch. No run was discarded.";
      void preferences.save().catch(console.error);
      notify(preferences.state.recovery); send();
    }
  });
  app.on("before-quit", stopAwake);
  return {perform, resetGraphics, connect, send, metadata, stopAwake};
}
