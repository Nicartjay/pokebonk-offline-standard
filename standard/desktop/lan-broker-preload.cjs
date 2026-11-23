// Only the native-owned broker window loads this preload. No storage bridge,
// arbitrary IPC, configuration URLs, credentials or filesystem methods.
const {contextBridge, ipcRenderer} = require("electron");
contextBridge.exposeInMainWorld("PokeBonkLanBrokerNative", Object.freeze({
  emit: text => {
    if (typeof text === "string" && text.length <= 48000) ipcRenderer.send("standard:lan-broker", text);
  },
}));
ipcRenderer.on("standard:lan-broker-input", (_event, value) => {
  window.dispatchEvent(new CustomEvent("standard:lan-broker-input", {detail: JSON.stringify(value)}));
});
