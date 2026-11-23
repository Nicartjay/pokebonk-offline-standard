// Sandboxed preload: no paths, URLs, commands, Electron objects or raw IPC.
const {contextBridge, ipcRenderer} = require("electron");
contextBridge.exposeInMainWorld("PokeBonkStandard", Object.freeze({
  loadState: () => ipcRenderer.invoke("standard:load-state"),
  saveState: state => ipcRenderer.invoke("standard:save-state", state),
}));

// One-way, validated window presentation state. The game still receives only
// loadState/saveState as callable native methods, never arbitrary IPC.
let fullscreen = false;
let desktopState = null;
function applyWindowState() {
  const root = document.documentElement;
  if (!root) return;
  root.dataset.standardPlatform = process.platform;
  root.dataset.standardFullscreen = String(fullscreen);
  if (["darwin", "win32"].includes(process.platform) && document.body && !document.getElementById("standard-titlebar")) {
    const titlebar = document.createElement("div");
    titlebar.id = "standard-titlebar";
    titlebar.setAttribute("aria-hidden", "true");
    document.body.append(titlebar);
  }
  document.dispatchEvent(new Event("standard:window-state"));
}
ipcRenderer.on("standard:desktop-state", (_event, value) => {
  if (!value || !Array.isArray(value.displays) || value.displays.length > 64 ||
      !Array.isArray(value.backends) || !Array.isArray(value.resolutions)) return;
  const json = JSON.stringify(value);
  if (json.length > 24000) return;
  desktopState = json;
  if (document.documentElement) document.documentElement.dataset.standardDesktop = json;
  document.dispatchEvent(new Event("standard:desktop-state"));
});
ipcRenderer.on("standard:window-state", (_event, state) => {
  if (state && typeof state.fullscreen === "boolean") {
    fullscreen = state.fullscreen;
    applyWindowState();
  }
});
window.addEventListener("DOMContentLoaded", () => {
  applyWindowState();
  if (desktopState) document.documentElement.dataset.standardDesktop = desktopState;
}, {once: true});

// A fixed native UI command, not an updater/IPC API exposed to game scripts.
// Synthetic .click()/dispatchEvent(), arbitrary URLs and non-player controls
// cannot request it. The main process separately validates sender and idle.
document.addEventListener("click", event => {
  if (!event.isTrusted || event.button !== 0) return;
  if (event.target.closest?.("button.offline-fullscreen")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send("standard:toggle-fullscreen");
    return;
  }
  const desktop = event.target.closest?.("a[data-standard-desktop-action]");
  if (desktop && desktop.closest(".offline-player-card,.offline-desktop-card")) {
    const action = desktop.getAttribute("data-standard-desktop-action");
    const value = desktop.getAttribute("data-standard-desktop-value") ?? "";
    const allowed = action === "settings" || action === "restart" ? value === "" :
      action === "monitor" ? /^-?\d{1,16}$/.test(value) :
      action === "resolution" ? ["fit", "960x540", "1280x720", "1600x900", "1920x1080", "2560x1440"].includes(value) :
      action === "backend" ? ["auto", "metal", "d3d11", "gl", "vulkan"].includes(value) :
      action === "awake" ? ["on", "off"].includes(value) : false;
    if (!allowed || desktop.getAttribute("href") !== "/__native__/desktop/" + action + (value ? "/" + value : "")) return;
    event.preventDefault();
    ipcRenderer.send("standard:desktop-action", action, value);
    return;
  }
  const link = event.target.closest?.("a[data-standard-native-action]");
  if (!link) return;
  const action = link.getAttribute("data-standard-native-action");
  const scope = action === "check-for-updates" ? ".offline-player-card" :
    action === "report-bug" ? ".offline-report-card" : null;
  if (!scope || !link.closest(scope) || link.getAttribute("href") !== "/__native__/" + action) return;
  event.preventDefault();
  if (action === "check-for-updates") ipcRenderer.send("standard:check-updates");
  else if (action === "report-bug") ipcRenderer.send("standard:report-bug");
}, true);
