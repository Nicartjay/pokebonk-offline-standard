import {androidPresentationSettings, androidMinimapScale, androidBatteryFpsCap,
  skipAndroidBatteryFrame, isAndroidShell} from "./android-ui.js";
import {MODE_NAMES, BIOME_NAMES} from "./modes.js";
import {waitForStartupMusic} from "./startup.js";
const OFFLINE_CREATOR = "Nicartjay";

const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const button = (text, fn, className = "btn") => {
  const node = el("button", text, className);
  node.type = "button";
  node.addEventListener("click", fn);
  return node;
};
function modal(title, onClose) {
  const previousFocus = document.activeElement;
  const overlay = el("div", null, "season-modal offline-modal");
  const panel = el("section", null, "panel offline-card");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", title);
  const heading = el("header", null, "offline-card-head");
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    if (previousFocus?.isConnected) previousFocus.focus();
    onClose?.();
  };
  const closeButton = button("Close", close, "btn ghost small");
  heading.append(el("h2", title), closeButton);
  panel.append(heading);
  overlay.append(panel);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", event => event.stopPropagation());
  const onKey = event => {
    if (!overlay.isConnected) return document.removeEventListener("keydown", onKey, true);
    const layers = document.querySelectorAll(".offline-modal");
    if (layers[layers.length - 1] !== overlay) return;
    if (event.key === "Escape") { event.stopImmediatePropagation(); close(); }
    if (event.key === "Tab") {
      const nodes = [...panel.querySelectorAll("button:not(:disabled), a[href], input, select, [tabindex='0']")];
      const index = nodes.indexOf(document.activeElement);
      if (event.shiftKey && index <= 0 || !event.shiftKey && index === nodes.length - 1) {
        event.preventDefault();
        nodes[event.shiftKey ? nodes.length - 1 : 0]?.focus();
      }
    }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  closeButton.focus();
  return { panel, overlay, close };
}
const duration = value => {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const tenths = Math.round(value * 10);
  return `${Math.floor(tenths / 600)}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
};
const mapName = id => BIOME_NAMES[id] ?? String(id).replaceAll("-", " ").replaceAll("_", " ");
const icon = (name, className = "") => {
  const image = el("img", null, className);
  image.src = `assets/ui/icons/${name}.png`;
  image.alt = "";
  return image;
};
function saveFile(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = el("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
// Fixed, same-origin UI actions, not a JavaScript native-command bridge.
// Desktop's isolated preload / Android's navigation client require a real
// user gesture and the native host independently checks that play is idle.
function nativeAction(text, action, close) {
  if (!["check-for-updates", "export-backup", "import-backup", "report-bug"].includes(action)) throw new Error("Unknown native menu action.");
  const link = el("a", text, "btn offline-native-action");
  link.href = "/__native__/" + action;
  link.dataset.standardNativeAction = action;
  link.addEventListener("click", event => { if (event.isTrusted) close?.(); });
  return link;
}
function desktopAction(text, action, value = "", selected = false) {
  const link = el("a", text, "btn offline-native-action offline-desktop-option" + (selected ? " on" : ""));
  link.href = "/__native__/desktop/" + action + (value ? "/" + value : "");
  link.dataset.standardDesktopAction = action;
  link.dataset.standardDesktopValue = value;
  link.setAttribute("role", "button");
  link.setAttribute("aria-pressed", String(selected));
  return link;
}
const firstGuidePending = new WeakMap();

const fullscreenButtons = new WeakMap();
const FULLSCREEN_PATHS = {
  enter: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  exit: "M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5",
};
export function createFullscreenButton({document: doc = globalThis.document, window: win = globalThis.window, onError = console.error} = {}) {
  if (isAndroidShell(win)) return null; // The native Activity already owns immersive fullscreen.
  const node = doc.createElement("button");
  node.type = "button";
  node.className = "lang-btn fs-btn offline-fullscreen";
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.3");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.append(path);
  node.append(svg);
  const active = () => Boolean(doc.fullscreenElement) || doc.documentElement.dataset.standardFullscreen === "true";
  const update = () => {
    const exit = active(), label = exit ? "Exit fullscreen" : "Enter fullscreen";
    node.title = label;
    node.setAttribute("aria-label", label);
    node.setAttribute("aria-pressed", String(exit));
    path.setAttribute("d", exit ? FULLSCREEN_PATHS.exit : FULLSCREEN_PATHS.enter);
  };
  let buttons = fullscreenButtons.get(doc);
  if (!buttons) {
    buttons = new Map();
    fullscreenButtons.set(doc, buttons);
    const refresh = () => {
      for (const [button, update] of buttons) {
        if (button.isConnected) update(); else buttons.delete(button);
      }
    };
    doc.addEventListener("fullscreenchange", refresh);
    doc.addEventListener("standard:window-state", refresh);
  }
  buttons.set(node, update);
  node.addEventListener("click", async () => {
    node.disabled = true;
    try {
      if (doc.fullscreenElement) await doc.exitFullscreen();
      else {
        const nativeOnly = active();
        await doc.documentElement.requestFullscreen({navigationUI: "hide"});
        if (nativeOnly) await doc.exitFullscreen();
      }
    } catch (error) { onError(error); }
    finally { node.disabled = false; update(); }
  });
  update();
  return node;
}

export function installOfflineUI(config) {
  const api = {
    creatorCredit() {
      return el("span", `Offline by ${OFFLINE_CREATOR}`, "offline-creator");
    },
    versionBadge() {
      const node = button(null, () => api.history(), "logo-ver offline-version");
      node.title = "Offline version history";
      node.setAttribute("aria-label", `PokéBonk Offline v${config.version} — version history`);
      node.append(el("b", "OFFLINE"), el("span", `v${config.version}`));
      return node;
    },
    history() {
      if (document.querySelector(".offline-history-card")) return;
      const {panel} = modal("PokéBonk Offline — version history");
      panel.classList.add("offline-history-card");
      panel.append(el("p", `Installed offline app v${config.version} · bundled PokéBonk v${config.upstream.version} (${config.upstream.build})`, "offline-version-current"),
        el("p", "Offline app versions and original online game versions are tracked separately. This history is bundled with the app and works without a connection.", "muted"));
      const list = el("div", null, "offline-history");
      for (const release of config.history ?? []) {
        const entry = el("article", null, "offline-history-entry");
        const head = el("div", null, "offline-history-head");
        head.append(el("h3", `OFFLINE v${release.version}`), el("time", release.date));
        const changes = el("ul");
        for (const change of release.changes) changes.append(el("li", change));
        entry.append(head, el("p", release.status, "offline-history-status"),
          el("p", `PokéBonk v${release.upstream.version} · build ${release.upstream.build}`, "offline-history-upstream"), changes);
        list.append(entry);
      }
      panel.append(list);
    },
    presentationSettings(settings) { return androidPresentationSettings(settings); },
    minimapScale(requested, upstream) { return androidMinimapScale(requested, upstream); },
    batteryFpsCap(saver, upstream) { return androidBatteryFpsCap(saver, upstream); },
    skipBatteryFrame(app, timestamp) { return skipAndroidBatteryFrame(app, timestamp); },
    fullscreenButton() {
      return createFullscreenButton({onError: error => globalThis.PokeBonkNativeApp?.notice?.(error.message)});
    },
    waitForMusic: waitForStartupMusic,
    firstVisit(app, openGuide) {
      document.documentElement.dataset.standardReady = "true";
      const screen = app.screenEl;
      const needsName = () => app.backend.state?.onboarding?.playerName !== 1 &&
        app.backend.state?.profile?.name === "Player";
      const eligible = () => screen?.isConnected && app.screenEl === screen &&
        screen.matches(".offline-menu") &&
        !app.run && !app.backend.state?.activeRun && !app.backend.state?.suspended;
      if (!eligible() || app.backend.state?.onboarding?.trainerGuide === 1 && !needsName() ||
          firstGuidePending.get(app)?.screen === screen) return;
      const pending = {screen, retries: 0};
      firstGuidePending.set(app, pending);
      const finish = () => {
        if (firstGuidePending.get(app) === pending) firstGuidePending.delete(app);
      };
      const afterGuide = (attempt = 0) => {
        if (!eligible() || !needsName()) return;
        if (document.querySelector(".pb-guide, .wipe, .season-modal, .tour, .sv-card, .modal-back")) {
          if (attempt < 40) setTimeout(() => afterGuide(attempt + 1), 500);
          return;
        }
        api.firstName(app);
      };
      const show = async () => {
        if (firstGuidePending.get(app) !== pending) return;
        if (!eligible()) { finish(); return; }
        // Match the upstream homepage's 1.2 s delay and bounded overlay wait.
        // Never interrupt starter selection, another screen, or active play.
        if (document.querySelector(".wipe, .season-modal, .tour, .sv-card, .modal-back")) {
          if (++pending.retries < 40) setTimeout(show, 500);
          else finish();
          return;
        }
        try {
          if (app.backend.state?.onboarding?.trainerGuide === 1) {
            afterGuide();
            return;
          }
          // Record only a guide that was actually shown. An asynchronous disk
          // commit must not consume onboarding if the player changed screens.
          // A manually opened guide already satisfies this first visit.
          let ended = false;
          const alreadyOpen = Boolean(document.querySelector(".pb-guide"));
          if (!alreadyOpen) openGuide({onEnd: () => {
            ended = true;
            if (app.backend.state?.onboarding?.trainerGuide === 1) setTimeout(afterGuide, 240);
          }});
          await app.backend.claimFirstGuide();
          if (ended || alreadyOpen) setTimeout(afterGuide, 240);
        } catch (error) {
          app.notice("The first-use Guide marker could not be saved. You can still open Guide manually.");
          console.warn(error);
        } finally { finish(); }
      };
      setTimeout(show, 1200);
    },
    firstName(app) {
      const state = app.backend.state;
      if (state?.onboarding?.trainerGuide !== 1 || state?.onboarding?.playerName === 1 ||
          state?.profile?.name !== "Player" || app.run || state.activeRun || state.suspended ||
          !app.screenEl?.matches(".offline-menu") || !app.screenEl.isConnected ||
          document.querySelector(".pb-guide, .offline-modal")) return;
      const {panel, close} = modal("Choose your player name");
      panel.classList.add("offline-player-card", "offline-name-setup");
      panel.querySelector(".offline-card-head button").textContent = "Later";
      const body = el("form", null, "offline-player-body");
      const label = el("label", "Player name", "offline-name-label");
      const name = el("input", null, "field");
      name.id = "offline-first-player-name";
      name.name = "playerName";
      name.type = "text";
      name.required = true;
      name.maxLength = 24;
      name.autocomplete = "nickname";
      name.placeholder = "Your trainer name";
      label.htmlFor = name.id;
      const error = el("p", "", "err");
      error.setAttribute("role", "alert");
      const save = button("Start adventure", null, "btn red");
      save.type = "submit";
      const row = el("div", null, "offline-row");
      row.append(name, save);
      body.append(el("p", "Welcome, Trainer! Choose the name for your local adventure. You can change it later in Player & saves.", "muted"),
        label, row, error);
      body.addEventListener("submit", async event => {
        event.preventDefault();
        if (save.disabled) return;
        save.disabled = true;
        error.textContent = "";
        try {
          await app.meta.saveNow();
          app.meta.adopt(await app.backend.renameLocal(name.value));
          app.meta.account.name = app.meta.profile.name;
          close();
          app.toMenu();
        } catch (failure) {
          error.textContent = failure.message;
          save.disabled = false;
        }
      });
      panel.append(body);
      name.focus({preventScroll: true});
    },
    startupError(error) {
      const {panel, close} = modal("PokéBonk Offline could not load");
      panel.classList.add("offline-player-card", "offline-startup-recovery");
      panel.append(el("p", error.message, "err"),
        el("p", "Your existing native save has not been replaced. Keep the previous app for incompatible unfinished runs.", "muted"));
      if (isAndroidShell()) {
        const actions = el("nav", null, "offline-player-actions");
        actions.append(nativeAction("Export backup", "export-backup", close), nativeAction("Import backup", "import-backup", close),
          nativeAction("Check for updates", "check-for-updates", close));
        panel.append(actions);
      } else panel.append(el("p", "The native Saves menu supports backup recovery, and View can reset the graphics backend to Auto.", "muted"));
    },
    controls(options = {}) {
      const { panel } = modal("Offline controls", options.onEnd);
      const list = el("dl", null, "offline-record-list");
      for (const [key, action] of [
        ["WASD", "Move"], ["Mouse", "Turn the camera / aim"], ["Space", "Jump"],
        ["Shift", "Slide / dash"], ["E", "Interact / pick up"], ["R", "Ultimate"], ["F", "Maximum form"],
        ["Escape / P", "Pause and open the local game menu"],
      ]) {
        const row = el("div", null, "offline-record");
        row.append(el("dt", key), el("dd", action));
        list.append(row);
      }
      panel.append(el("p", "These are the default bindings. Change keyboard, mouse, or controller settings in Settings.", "muted"), list);
    },
    reportBug() {
      if (document.querySelector(".offline-report-card")) return;
      const {panel, close} = modal("Report a bug");
      panel.classList.add("offline-report-card");
      panel.append(el("p", "Report problems with PokéBonk Offline to this project’s GitHub Issues.", "muted"),
        el("p", "The issue form opens in your browser and needs a connection. No save, personal information, or logs are sent automatically. GitHub may ask you to sign in.", "muted"),
        nativeAction("Open GitHub issue form", "report-bug", close),
        el("p", `Offline v${config.version} · PokéBonk v${config.upstream.version} (${config.upstream.build})`, "offline-app-menu-version"));
    },
    expeditionPreview(app, {mount}) {
      // Design review only. Do not fabricate an inventory, discard equipment,
      // call server endpoints or enable a run before local settlement exists.
      const root = el("div", null, "offline-expedition-view");
      const head = el("header", null, "scr-head exb-top");
      const title = el("div", null, "scr-title");
      title.append(el("h1", "The Great Expedition"), el("span", "Solo offline adaptation"));
      head.append(button("‹ Back", () => app.toMenu(), "btn ghost small"), title);
      const banner = el("p", "DESIGN PREVIEW — Local inventory and extraction are not connected yet. No real items or saves are used here.", "offline-expedition-draft");
      const frame = el("div", null, "exb-frame");
      const nav = el("nav", null, "exb-nav");
      for (const [name, asset] of [["Expedition", "exp-flag"], ["Equipment", "exp-bag"], ["Bill’s Shop", "exp-coin"], ["My Extractions", "record"]]) {
        const tab = button(null, () => {}, "exb-tab" + (name === "Expedition" ? " on" : ""));
        tab.style.setProperty("--sc", "#2fbf5b");
        const image = el("span", null, "exb-tab-ic"); image.append(icon(asset));
        tab.append(image, el("span", name, "exb-tab-n"));
        tab.disabled = name !== "Expedition";
        nav.append(tab);
      }
      const body = el("div", null, "ex-body offline-expedition-body");
      const maps = [
        {id: "wilds", name: "Wild Valley", hero: "hero-wilds.jpg", minutes: 25, size: 840,
          desc: "Mountains, rivers and forests. Better loot—and tougher battles—wait deeper in the valley."},
        {id: "safari", name: "Safari Zone", hero: "hero-safari.jpg", minutes: 20, size: 600,
          desc: "Explore gated areas and rest houses, find unusual Pokémon, and watch out for the Stampede."},
      ];
      let selected = maps[0];
      const render = () => {
        const chart = el("section", null, "exb-chart");
        chart.style.setProperty("--art", `url("assets/ui/exp/${selected.hero}")`);
        const cards = el("div", null, "exb-maps");
        for (const map of maps) {
          const node = button(null, () => { selected = map; render(); }, "exb-mapcard" + (map === selected ? " on" : ""));
          node.style.setProperty("--art", `url("assets/ui/exp/${map.hero}")`);
          node.append(el("b", map.name), el("small", `${map.minutes} min · ${map.size} m`));
          cards.append(node);
        }
        const chartHead = el("div", null, "exb-chart-top"); chartHead.append(cards);
        const chartLow = el("div", null, "exb-chart-low"), mapTitle = el("div", null, "exb-chart-name");
        mapTitle.append(el("h2", selected.name), el("p", selected.desc));
        chartLow.append(mapTitle); chart.append(chartHead, chartLow);
        const lobby = el("div", null, "offline-expedition-lobby");
        const kit = el("section", null, "exb-w offline-expedition-kit");
        const kitHead = el("header"); kitHead.append(icon("exp-bag"), el("h3", "Your loadout"));
        kit.append(kitHead, el("p", "Choose an earned Pokémon, prepare equipment, and bring back the loot you extract with.", "muted"));
        const slots = el("div", null, "offline-expedition-slots");
        for (const name of ["Held item", "Band", "Charm", "Gem"]) {
          const slot = el("div"); slot.append(icon("lock"), el("small", name)); slots.append(slot);
        }
        kit.append(slots, el("p", "Preview only · your existing inventory has not been changed.", "offline-record-caption"));
        const go = el("section", null, "exb-go-tile offline-expedition-go");
        const play = button("Enter " + selected.name, () => {}, "ex-go");
        play.disabled = true; play.title = "Local inventory, extraction and save settlement must be completed before this can start.";
        go.append(icon("exp-flag"), el("h3", "Loot. Survive. Extract."),
          el("p", "Single-player only. Player trading, co-op, online rankings and competitive prizes will stay excluded.", "muted"),
          play, el("small", "Gameplay is not enabled in this design preview."));
        lobby.append(kit, go);
        body.replaceChildren(chart, lobby);
      };
      render(); frame.append(nav, body); root.append(head, banner, frame); mount(root);
      const back = event => {
        if (!root.isConnected) return removeEventListener("keydown", back, true);
        if (event.key === "Escape") {
          event.preventDefault(); event.stopImmediatePropagation();
          removeEventListener("keydown", back, true); app.toMenu();
        }
      };
      addEventListener("keydown", back, true);
    },
    profile(app) {
      if (document.querySelector(".offline-player-card")) return;
      const { panel, close } = modal("Player & saves");
      panel.classList.add("offline-player-card");
      const body = el("div", null, "offline-player-body");
      const name = el("input", null, "field");
      name.value = app.meta.profile.name;
      name.maxLength = 24;
      name.setAttribute("aria-label", "Local player name");
      const row = el("div", null, "offline-row");
      row.append(name, button("Save name", async () => {
        try {
          await app.meta.saveNow();
          app.meta.adopt(await app.backend.renameLocal(name.value));
          app.meta.account.name = app.meta.profile.name;
          close();
          app.toMenu();
        } catch (error) { app.notice(error.message); }
      }, "btn blue"));
      body.append(el("p", "Your trainer, backups and app options. Progress stays on this device—no account needed.", "muted"), row);
      const actions = el("div", null, "offline-row offline-player-actions");
      if (isAndroidShell()) {
        // Android uses the system document picker, not unsupported blob
        // downloads. Navigation requires a real gesture; no new JS bridge.
        actions.append(nativeAction("Export save backup", "export-backup", close),
          nativeAction("Import save backup", "import-backup", close));
      } else {
      actions.append(button("Export save backup", async () => {
        await app.meta.saveNow();
        saveFile("pokebonk-offline-save.json", await app.backend.exportSave());
      }, "btn green"));
      const input = el("input");
      input.type = "file";
      input.accept = ".json,application/json";
      input.hidden = true;
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 32 * 1024 * 1024) return app.notice("That save file is too large.");
        try {
          const value = JSON.parse(await file.text());
          if (!confirm("Replace the local progress on this device with this backup?")) return;
          await app.backend.importSave(value);
          location.reload();
        } catch (error) { app.notice(error.message); }
      });
      actions.append(button("Import save backup", () => input.click(), "btn ghost"), input);
      }
      body.append(actions, el("p", "Use Save and quit before exporting an unfinished run. Importing asks before replacing progress and keeps a recovery copy.", "muted"));
      const updates = el("div", null, "offline-player-updates");
      const utilities = el("div", null, "offline-player-actions");
      utilities.append(nativeAction("Check for updates", "check-for-updates", close),
        button("Report a bug", () => { close(); api.reportBug(); }, "btn ghost offline-report-entry"));
      if (!isAndroidShell()) utilities.append(desktopAction("Display & graphics", "settings"));
      updates.append(el("h3", "App options"), el("p", "Updates are verified and installed only with your approval. Playing never needs a connection.", "muted"), utilities);
      body.append(updates,
        el("small", `OFFLINE v${config.version} · by ${OFFLINE_CREATOR} · PokéBonk v${config.upstream.version}`, "offline-app-menu-version"));
      if (app.backend.state?.activeRun) body.append(button("End unfinished run without rewards", async () => {
        if (!confirm("Export a backup first if needed. Explicitly end this unfinished run without rewards?")) return;
        await app.backend.discardSaved();
        location.reload();
      }, "btn ghost"));
      if (app.backend.saveWarning) body.append(el("p", app.backend.saveWarning, "err"));
      panel.append(body);
    },
    desktopSettings() {
      if (isAndroidShell() || globalThis.PokeBonkNativeApp?.run || document.querySelector(".offline-desktop-card")) return false;
      const {panel} = modal("Display & graphics", () => document.removeEventListener("standard:desktop-state", render));
      panel.classList.add("offline-desktop-card");
      const body = el("div", null, "offline-desktop-body");
      function render() {
        let state;
        try { state = JSON.parse(document.documentElement.dataset.standardDesktop); } catch { return; }
        const focused = document.activeElement?.getAttribute("href");
        body.replaceChildren();
        body.append(el("p", "Window size and monitor are remembered. Oversized presets fit the display’s usable area.", "muted"));
        const grid = el("div", null, "offline-display-grid");
        const section = (title, description) => {
          const group = el("section", null, "offline-display-group");
          group.append(el("h3", title), el("p", description, "muted"));
          const options = el("div", null, "offline-desktop-options");
          group.append(options); grid.append(group); return options;
        };
        const monitors = section("Monitor", "Changing monitor or size returns to windowed mode.");
        for (const display of state.displays ?? []) monitors.append(desktopAction(display.label, "monitor", String(display.id), display.id === state.displayId));
        const sizes = section("Window size", `${state.bounds?.[0]} × ${state.bounds?.[1]} logical pixels${state.fullscreen ? " · fullscreen" : ""}`);
        for (const resolution of state.resolutions ?? []) sizes.append(desktopAction(resolution.label, "resolution", resolution.id,
          resolution.id === state.bounds?.join("x")));
        body.append(grid);
        const backends = el("section", null, "offline-display-group offline-graphics-group");
        backends.append(el("h3", "Graphics backend"), el("p", "Auto is recommended. Alternatives are for driver troubleshooting and require a restart. Availability depends on the GPU.", "muted"));
        const choices = el("div", null, "offline-desktop-options");
        for (const backend of state.backends ?? []) choices.append(desktopAction(backend.label, "backend", backend.id, backend.id === state.backend));
        backends.append(choices);
        if (state.restartNeeded) backends.append(el("p", `Using ${state.launchBackend} now. The selected backend applies after restarting.`, "offline-restart-note"),
          desktopAction("Restart app to apply", "restart"));
        body.append(backends);
        const awake = el("section", null, "offline-awake-options");
        awake.append(el("h3", "Keep screen awake while app is focused"),
          desktopAction(state.keepAwake ? "On" : "Off", "awake", state.keepAwake ? "off" : "on", state.keepAwake));
        body.append(awake);
        const info = el("section", null, "offline-gpu-info");
        info.append(el("h3", "Graphics information"), el("p", state.graphics?.renderer ?? "Reading graphics information…"),
          el("small", `Electron ${state.graphics?.electron ?? "—"} · Chromium ${state.graphics?.chromium ?? "—"} · GPU resets ${state.graphics?.crashes ?? 0}`));
        const features = el("dl");
        for (const [feature, value] of Object.entries(state.graphics?.features ?? {})) {
          features.append(el("dt", feature.replaceAll("_", " ")), el("dd", value.replaceAll("_", " ")));
        }
        info.append(features); body.append(info);
        if (state.recovery) body.append(el("p", state.recovery, "offline-restart-note"));
        if (focused) [...body.querySelectorAll("a")].find(node => node.getAttribute("href") === focused)?.focus({preventScroll: true});
      }
      panel.append(body); document.addEventListener("standard:desktop-state", render); render(); return true;
    },
    recordsPanel(app) {
      const panel = el("aside", null, "mm-season offline-record-panel");
      panel.setAttribute("aria-label", "Personal records");
      const head = el("header", null, "mm-sp-head");
      const title = el("div");
      title.append(el("h2", "Personal records"), el("small", "Your best runs · this device"));
      head.append(icon("record"), title);
      const tabs = el("div", null, "seg offline-home-tabs");
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "Home personal records");
      const filter = el("label", null, "offline-home-filter");
      const label = el("span", "Map");
      const maps = el("select", null, "field");
      maps.setAttribute("aria-label", "Home records map");
      filter.append(label, maps);
      const body = el("div", null, "offline-home-record-body");
      body.id = "offline-home-records";
      body.setAttribute("role", "tabpanel");
      let tab = "kos", biome = "";
      const render = () => {
        tabs.replaceChildren();
        for (const [key, text] of [["kos", "KOs"], ["survival", "Survival"], ["time", "Time Attack"]]) {
          const node = button(text, () => { tab = key; render(); tabs.querySelector(".on").focus(); },
            "pill" + (tab === key ? " on" : ""));
          node.id = "offline-home-tab-" + key;
          node.setAttribute("role", "tab");
          node.setAttribute("aria-selected", String(tab === key));
          node.setAttribute("aria-controls", body.id);
          tabs.append(node);
        }
        body.setAttribute("aria-labelledby", "offline-home-tab-" + tab);
        const records = app.backend.recordsLocal(tab), available = [...new Set(records.map(row => row.biome))];
        if (!available.includes(biome)) biome = "";
        maps.replaceChildren();
        for (const id of ["", ...available]) {
          const option = el("option", id ? mapName(id) : "All maps"); option.value = id; maps.append(option);
        }
        maps.value = biome;
        const rows = records.filter(row => !biome || row.biome === biome);
        const table = el("table", null, "offline-home-record-table");
        const thead = el("thead"), heading = el("tr");
        for (const text of ["#", "Run", tab === "kos" ? "KOs" : "Time"]) {
          const th = el("th", text); th.scope = "col"; heading.append(th);
        }
        thead.append(heading); table.append(thead);
        const tbody = el("tbody");
        for (const [index, record] of rows.slice(0, 6).entries()) {
          const row = el("tr"), who = el("td"), details = el("span");
          if (record.species) {
            const image = el("img");
            image.src = `assets/portraits/${record.finalSpecies ?? record.species}.png`;
            image.alt = ""; who.append(image);
          }
          details.append(el("b", config.pokemonNames?.[record.finalSpecies ?? record.species] ?? "Older record"),
            el("small", `${MODE_NAMES[record.mode]} · ${mapName(record.biome)}`));
          who.append(details);
          const metric = tab === "kos" ? record.kills?.toLocaleString() ?? "—" :
            duration(tab === "time" ? record.attackTime : record.time);
          row.append(el("td", String(index + 1), "offline-rank"), who, el("td", metric, "offline-metric"));
          tbody.append(row);
        }
        if (!rows.length) {
          const row = el("tr"), cell = el("td", tab === "time" ? "Complete Classic or Boss Rush to set a clear time." :
            tab === "survival" ? "Finish Endless or Relay to set a survival best." :
            "Finish a run to set your first personal best.", "offline-home-empty");
          cell.colSpan = 3; row.append(cell); tbody.append(row);
        }
        table.append(tbody); body.replaceChildren(table);
      };
      maps.addEventListener("change", () => { biome = maps.value; render(); });
      tabs.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        const nodes = [...tabs.querySelectorAll("button")], at = nodes.indexOf(event.target);
        nodes[(at + (event.key === "ArrowRight" ? 1 : nodes.length - 1)) % nodes.length]?.click();
      });
      panel.append(head, tabs, filter, body, button("View all personal records", () => api.records(app, {tab, biome}), "btn blue small offline-home-all"));
      render(); return panel;
    },
    eventStats(app, id) {
      if (!app?.meta) app = globalThis.PokeBonkNativeApp;
      const counters = app.meta.profile.events?.[id]?.c ?? {}, stats = el("div", null, "br-ranks offline-event-stats");
      for (const [label, value] of [["Local clears", counters.clears ?? 0], ["Bosses beaten", counters.bosses ?? 0]]) {
        const item = el("span"); item.append(el("small", label), el("b", Number(value).toLocaleString())); stats.append(item);
      }
      return stats;
    },
    records(app, options = {}) {
      if (document.querySelector(".offline-records-card")) return;
      const { panel } = modal("Personal records — this device only");
      panel.classList.add("offline-records-card");
      const profile = app.meta.profile;
      const stats = el("div", null, "offline-record-summary");
      for (const [name, value] of [["Progression runs", profile.counters.runs ?? 0], ["Classic wins", profile.counters.wins ?? 0], ["Progression KOs", profile.counters.kills ?? 0], ["League Pokémon", profile.league.length]]) {
        const stat = el("div");
        stat.append(el("strong", Number(value).toLocaleString()), el("small", name));
        stats.append(stat);
      }
      panel.append(el("p", "Only your saved runs. Bests are kept per Pokémon, map, difficulty and ruleset—not replaced when recent-run history fills up.", "muted"), stats);
      const tabs = el("div", null, "seg offline-record-tabs");
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "Personal record categories");
      const filters = el("div", null, "offline-record-filters");
      const body = el("section", null, "offline-record-body");
      body.id = "offline-personal-records-table";
      body.setAttribute("role", "tabpanel");
      let tab = ["kos", "survival", "time"].includes(options.tab) ? options.tab : "kos";
      let mode = options.mode ?? "", biome = options.biome ?? "", tier = "";
      const speciesName = id => config.pokemonNames?.[id] ?? (id ? `Pokémon #${id}` : "Not retained in older save");
      const render = () => {
        const records = app.backend.recordsLocal(tab);
        tabs.replaceChildren();
        for (const [key, label] of [["kos", "KOs"], ["survival", "Survival"], ["time", "Time Attack"]]) {
          const node = button(label, () => { tab = key; mode = ""; biome = ""; tier = ""; render(); tabs.querySelector(".on").focus(); },
            "pill" + (tab === key ? " on" : ""));
          node.id = `offline-record-tab-${key}`;
          node.setAttribute("role", "tab");
          node.setAttribute("aria-selected", String(tab === key));
          node.setAttribute("aria-controls", body.id);
          tabs.append(node);
        }
        body.setAttribute("aria-labelledby", `offline-record-tab-${tab}`);
        filters.replaceChildren();
        const filter = (label, values, current, change) => {
          const field = el("label");
          field.append(el("span", label));
          const select = el("select", null, "field");
          select.setAttribute("aria-label", `Filter records by ${label.toLowerCase()}`);
          const all = el("option", label === "Difficulty" ? "All difficulties" : `All ${label.toLowerCase()}s`);
          all.value = "";
          select.append(all);
          for (const [value, text] of values) {
            const option = el("option", text);
            option.value = value;
            select.append(option);
          }
          select.value = current;
          select.addEventListener("change", () => { change(select.value); draw(); });
          field.append(select); filters.append(field);
        };
        filter("Mode", [...new Set(records.map(row => row.mode))].map(value => [value, MODE_NAMES[value]]), mode, value => { mode = value; });
        filter("Map", [...new Set(records.map(row => row.biome))].map(value => [value, mapName(value)]), biome, value => { biome = value; });
        filter("Difficulty", [...new Set(records.map(row => row.tier))].sort().map(value => [String(value), ["Normal", "Hard", "Nightmare"][value] ?? `Tier ${value}`]), tier, value => { tier = value; });
        function draw() {
          body.replaceChildren();
          const rows = records.filter(row => (!mode || row.mode === mode) && (!biome || row.biome === biome) &&
            (!tier || String(row.tier) === tier));
          body.append(el("p", tab === "survival" ? "Longest Endless and Relay runs. Time is the main record; KOs break ties." :
            tab === "time" ? "Fastest victorious Classic and completed Boss Rush runs. Eligible overtime is excluded from Classic clear time." :
            "Highest KO totals, including the game’s eligible overtime bonus. Modes and challenge rotations stay separate.", "offline-record-caption"));
          if (!rows.length) {
            body.append(el("p", records.length ? "No personal bests match these filters." :
              tab === "time" ? "Win a Classic run or defeat all five Boss Rush opponents to record your first clear time." :
              tab === "survival" ? "Finish an Endless or Relay run to record your first survival best." :
              "Finish a run to record your first personal best.", "offline-empty"));
            return;
          }
          const scroll = el("div", null, "offline-table-scroll");
          scroll.tabIndex = 0;
          scroll.setAttribute("aria-label", "Scrollable personal bests table");
          const table = el("table", null, "offline-record-table");
          const caption = el("caption", `${rows.length} personal best${rows.length === 1 ? "" : "s"} · no other players`);
          table.append(caption);
          const head = el("thead"), header = el("tr");
          for (const text of ["#", "Pokémon", "Mode / map", "Difficulty", "KOs", tab === "time" ? "Clear time" : "Time", "Result", "Played"]) {
            const cell = el("th", text);
            cell.scope = "col"; header.append(cell);
          }
          head.append(header); table.append(head);
          const tbody = el("tbody");
          rows.forEach((record, index) => {
            const row = el("tr");
            row.append(el("td", String(index + 1), "offline-rank"));
            const who = el("td", null, "offline-record-pokemon");
            if (record.species) {
              const portrait = el("img");
              portrait.src = `assets/portraits/${record.finalSpecies ?? record.species}.png`;
              portrait.alt = "";
              portrait.loading = "lazy";
              who.append(portrait);
            }
            who.append(el("b", speciesName(record.finalSpecies ?? record.species)));
            const where = el("td");
            where.append(el("b", MODE_NAMES[record.mode]), el("small", mapName(record.biome)));
            if (record.variant) where.append(el("small", record.variant.replace("rotation:", "Rotation ").replace("day:", "Local day ")));
            const outcome = record.mode === "bossrush" ? `${record.beaten ?? 0}/5 bosses` :
              record.mode === "tower" ? `Floor ${record.floor ?? 1}` : record.victory ? "Victory" : "Finished";
            const date = record.date ? new Date(record.date).toLocaleDateString() : "Not retained";
            row.append(who, where, el("td", ["Normal", "Hard", "Nightmare"][record.tier] ?? `Tier ${record.tier}`),
              el("td", record.kills == null ? "—" : record.kills.toLocaleString(), "offline-metric"),
              el("td", duration(tab === "time" ? record.attackTime : record.time), "offline-metric"),
              el("td", outcome), el("td", date, "offline-record-date"));
            tbody.append(row);
          });
          table.append(tbody); scroll.append(table); body.append(scroll);
          if (rows.some(row => row.legacy)) body.append(el("p", "Older backups may retain a best value without all of its original run details. Missing Pokémon, KOs or dates are shown honestly; no history is invented.", "muted offline-legacy-note"));
        }
        draw();
      };
      tabs.addEventListener("keydown", event => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const buttons = [...tabs.querySelectorAll("button")];
        buttons[(buttons.indexOf(event.target) + (event.key === "ArrowRight" ? 1 : buttons.length - 1)) % buttons.length]?.click();
      });
      panel.append(tabs, filters, body); render();
    },
    challengeResult(ui, run, info, error) {
      const result = info?.record ?? run.result(false);
      const card = el("section", null, "panel offline-challenge-result");
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-label", "Offline challenge result");
      card.append(el("small", info?.localEventRewards ? "OFFLINE EVENT · EARNED REWARDS" : "OFFLINE CHALLENGE"),
        el("h2", `${MODE_NAMES[result.mode] ?? "Challenge"} — ${result.victory ? "completed!" : "run finished"}`));
      const stats = el("div", null, "offline-record-summary");
      for (const [label, value] of [["Time", duration(result.time)], ["KOs", Number(result.kills).toLocaleString()],
        [result.mode === "bossrush" ? "Bosses" : "Floor", result.mode === "bossrush" ? `${result.rush?.beaten ?? 0}/5` : String(result.stage)]]) {
        const stat = el("div"); stat.append(el("strong", value), el("small", label)); stats.append(stat);
      }
      const actions = el("div", null, "offline-row");
      actions.append(button("Menu", () => ui.onQuit?.(), "btn ghost"),
        button("Personal records", () => api.records(globalThis.PokeBonkNativeApp, {
          tab: result.mode === "bossrush" && result.victory ? "time" : "kos", mode: result.mode,
        }), "btn"),
        button("Play again", () => ui.onRestart?.(), "btn green big"));
      if (info?.localEventRewards) {
        const points = info.events.find(event => event.id === (result.mode === "bossrush" ? "rush26" : "halloween26"));
        const rewards = el("p", null, "offline-challenge-note");
        rewards.append(el("b", `+${Number(info.stardust ?? 0).toLocaleString()} Stardust · +${points?.gained ?? 0} ${result.mode === "bossrush" ? "Trophies" : "Candles"}`),
          el("span", "Open the event’s Challenge Pass and Missions to claim your earned rewards. No deadline or online ranking."));
        card.append(stats, rewards);
      } else card.append(stats);
      card.append(el("p", error ? `Could not save this challenge: ${error}. The unfinished run is preserved.` :
        info?.localEventRewards ? "Progress and event points saved on this device." :
        "This older records-only challenge was saved under its original rules. It does not retroactively award event rewards.",
      error ? "err" : "muted"), actions);
      // Use the engine's own modal lifecycle so restart/menu and touch input
      // cleanup remain identical to ordinary results screens.
      ui.modal(card).classList.add("offline-challenge-result-modal");
    },
    unavailable(app) { app?.notice?.("This online feature has been removed from the offline edition."); },
  };
  window.PokeBonkOfflineUI = Object.freeze(api);
  addEventListener("pokebonk:local-save-warning", event => {
    let notice = document.getElementById("offline-save-warning");
    if (!notice) {
      notice = el("div", null, "offline-save-warning");
      notice.id = "offline-save-warning";
      document.body.append(notice);
    }
    notice.textContent = event.detail + " A browser backup is being kept.";
  });
}
