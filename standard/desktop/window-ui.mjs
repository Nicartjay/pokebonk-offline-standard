// Window chrome is independent of saves and exposes no renderer-callable APIs.
export function windowChrome(platform) {
  if (platform === "darwin") return {
    titleBarStyle: "hiddenInset",
    trafficLightPosition: {x: 16, y: 14},
  };
  if (platform === "win32") return {
    titleBarStyle: "hidden",
    titleBarOverlay: {color: "#00000000", symbolColor: "#ffffff", height: 40},
    // Keep the native menus accessible with Alt, without an opaque menu row
    // permanently covering the game beneath the transparent caption buttons.
    autoHideMenuBar: true,
  };
  return {};
}

export function connectWindowUI(window, platform = process.platform) {
  const sendState = () => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
      window.webContents.send("standard:window-state", {fullscreen: window.isFullScreen()});
    }
  };
  window.on("enter-full-screen", sendState);
  window.on("leave-full-screen", sendState);
  window.webContents.on("did-finish-load", sendState);
  window.webContents.on("enter-html-full-screen", sendState);
  window.webContents.on("leave-html-full-screen", () => {
    // macOS can already be natively fullscreen when HTML fullscreen starts.
    // An explicit HTML exit must also exit that native-only state.
    if (!window.isDestroyed()) {
      window.setFullScreen(false);
      sendState();
    }
  });
  if (platform === "darwin") {
    // Keep the window controls over the game rather than an opaque OS title bar.
    window.setWindowButtonVisibility(true);
  }
}
