/* Install before any game module. All game traffic must remain on this PC. */
(() => {
  "use strict";
  let systemDark;
  Object.defineProperty(globalThis, "PokeBonkSystemTheme", {value: Object.freeze({
    isDark: fallback => typeof systemDark === "boolean" ? systemDark : Boolean(fallback),
  })});
  // Honor the game's own theme before first paint and prevent OEM automatic
  // darkening from independently changing text fills on Android tablets.
  try {
    const chosen = localStorage.getItem("pokebonk.theme");
    const dark = chosen === "dark" || chosen !== "light" && matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    for (const name of ["color-scheme", "supported-color-schemes"]) {
      document.querySelector(`meta[name="${name}"]`)?.setAttribute("content", dark ? "dark" : name === "color-scheme" ? "only light" : "light");
    }
  } catch { /* Theme storage is optional; native progression storage is not. */ }
  // Presentation-only, one-way native metadata. It adds no callable Android
  // interface. Explicit game preferences are still resolved by the game.
  globalThis.addEventListener?.("standard:system-theme", event => {
    if (!window.PokeBonkStandardAndroid || window.PokeBonkStandard || typeof event.detail?.dark !== "boolean") return;
    systemDark = event.detail.dark;
    try {
      const chosen = localStorage.getItem("pokebonk.theme");
      if (chosen !== "light" && chosen !== "dark") document.documentElement.dataset.theme = systemDark ? "dark" : "light";
    } catch {}
  });
  const blocked = [];
  const allowed = value => {
    try {
      const url = new URL(value?.url ?? value, location.href);
      if (url.protocol === "data:") return true;
      if (url.protocol === "blob:") return url.origin === location.origin;
      return url.origin === location.origin &&
        !/^\/(?:api(?:\/|$)|cdn-cgi(?:\/|$)|__remote(?:\/|$))/.test(url.pathname);
    } catch { return false; }
  };
  const deny = (kind, value) => {
    blocked.push({ kind, url: String(value?.url ?? value ?? ""), at: Date.now() });
    if (blocked.length > 100) blocked.shift();
    document.documentElement.dataset.offlineBlocked = String(blocked.length);
    return new Error("External connections are disabled in PokéBonk Offline.");
  };
  Object.defineProperty(window, "PokeBonkOfflineNetwork", {
    value: Object.freeze({ allowed, get blocked() { return blocked.slice(); } }),
    configurable: false,
  });
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => allowed(input) ? nativeFetch(input, init) : Promise.reject(deny("fetch", input));
  const openXHR = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    if (!allowed(url)) throw deny("XMLHttpRequest", url);
    return openXHR.call(this, method, url, ...rest);
  };
  for (const name of ["WebSocket", "EventSource", "RTCPeerConnection", "webkitRTCPeerConnection", "WebTransport"]) {
    if (name in window) {
      try { window[name] = class { constructor() { throw deny(name, "disabled"); } }; } catch {}
    }
  }
  try { navigator.sendBeacon = url => { deny("sendBeacon", url); return false; }; } catch {}
  try {
    if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(deny("serviceWorker", "disabled"));
  } catch {}
  const nativeOpen = window.open.bind(window);
  window.open = (url, ...rest) => {
    if (url && allowed(url)) return nativeOpen(url, ...rest);
    deny("window.open", url);
    return null;
  };
  document.addEventListener("click", event => {
    const link = event.target.closest?.("a[href]");
    if (link && !allowed(link.href)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener("submit", event => {
    if (event.target.action && !allowed(event.target.action)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  const removedLabels = new Set([
    "discord", "co-op", "cooperativo", "multiplayer", "online", "en línea",
    "clan", "clans", "friends", "amigos", "news", "noticias", "inbox", "buzón",
    "report", "reportar", "report a bug", "send feedback", "log in", "sign in",
    "log out", "cerrar sesión", "guardar en cuenta", "create account",
    "descargar", "download app", "apps",
  ]);
  let scheduled = false;
  const clean = () => {
    scheduled = false;
    for (const link of document.querySelectorAll("a[href]")) {
      if (!allowed(link.href) || link.getAttribute("href") === "#" && link.target === "_blank") {
        const text = document.createElement("span");
        text.className = link.className;
        text.textContent = link.textContent;
        link.replaceWith(text);
      }
    }
    for (const button of document.querySelectorAll("button")) {
      // The replacement opens a fixed, native-owned GitHub issue action,
      // never the removed website feedback service.
      if (button.classList.contains("offline-report-entry")) continue;
      const text = button.textContent.trim().toLowerCase();
      const title = button.getAttribute("title") ?? "";
      if (removedLabels.has(text) ||
          /^(?:report a bug|report an issue|reportar un fallo|buzón:|inbox:|noticias$|news$)/i.test(title)) {
        button.remove();
      }
    }
  };
  new MutationObserver(() => {
    if (!scheduled) { scheduled = true; queueMicrotask(clean); }
  }).observe(document.documentElement, { childList: true, subtree: true });
  document.documentElement.dataset.offline = "true";
  document.documentElement.dataset.offlineBlocked = "0";
})();
