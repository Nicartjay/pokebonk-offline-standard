// Sandboxed preload: no paths, URLs, commands, Electron objects or raw IPC.
const {contextBridge, ipcRenderer} = require("electron");
contextBridge.exposeInMainWorld("PokeBonkStandard", Object.freeze({
  loadState: () => ipcRenderer.invoke("standard:load-state"),
  saveState: state => ipcRenderer.invoke("standard:save-state", state),
}));

// One-way, validated window presentation state. The game still receives only
// loadState/saveState as callable native methods, never arbitrary IPC.
let fullscreen = false;
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
ipcRenderer.on("standard:window-state", (_event, state) => {
  if (state && typeof state.fullscreen === "boolean") {
    fullscreen = state.fullscreen;
    applyWindowState();
  }
});
window.addEventListener("DOMContentLoaded", applyWindowState, {once: true});
