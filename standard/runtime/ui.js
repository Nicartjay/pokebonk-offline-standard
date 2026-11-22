import {androidPresentationSettings} from "./android-ui.js";

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
  const overlay = el("div", null, "season-modal offline-modal");
  const panel = el("section", null, "panel offline-card");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", title);
  const heading = el("header", null, "offline-card-head");
  const close = () => { document.removeEventListener("keydown", onKey, true); overlay.remove(); onClose?.(); };
  const closeButton = button("Close", close, "btn ghost small");
  heading.append(el("h2", title), closeButton);
  panel.append(heading);
  overlay.append(panel);
  overlay.addEventListener("click", event => { if (event.target === overlay) close(); });
  overlay.addEventListener("keydown", event => event.stopPropagation());
  const onKey = event => {
    if (!overlay.isConnected) return document.removeEventListener("keydown", onKey, true);
    if (event.key === "Escape") { event.stopImmediatePropagation(); close(); }
  };
  document.addEventListener("keydown", onKey, true);
  document.body.append(overlay);
  closeButton.focus();
  return { panel, overlay };
}
function saveFile(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = el("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fullscreenButtons = new WeakMap();
const FULLSCREEN_PATHS = {
  enter: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
  exit: "M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5",
};
export function createFullscreenButton({document: doc = globalThis.document, onError = console.error} = {}) {
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
    presentationSettings(settings) { return androidPresentationSettings(settings); },
    fullscreenButton() {
      return createFullscreenButton({onError: error => globalThis.PokeBonkNativeApp?.notice?.(error.message)});
    },
    startupError(error) {
      const {panel} = modal("PokéBonk Offline could not load");
      panel.append(el("p", error.message, "err"),
        el("p", "Your existing native save has not been replaced. Use the native Saves menu to import a compatible backup. Keep the previous app for incompatible unfinished runs.", "muted"));
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
    profile(app) {
      const { panel, overlay } = modal("Local player & saves");
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
          overlay.remove();
          app.toMenu();
        } catch (error) { app.notice(error.message); }
      }, "btn blue"));
      panel.append(el("p", "Normal progression, no account. Saves are stored in this edition’s native application-data directory, outside the installed app.", "muted"), row);
      const actions = el("div", null, "offline-row");
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
          if (!confirm("Replace the local progress on this PC with this backup?")) return;
          await app.backend.importSave(value);
          location.reload();
        } catch (error) { app.notice(error.message); }
      });
      actions.append(button("Import save backup", () => input.click(), "btn ghost"), input);
      panel.append(actions, el("p", "Use Save and quit before exporting an unfinished game. The native Saves menu also supports export/import and recovery if this screen cannot load.", "muted"));
      if (app.backend.state?.activeRun) panel.append(button("End unfinished run without rewards", async () => {
        if (!confirm("Export a backup first if needed. Explicitly end this unfinished run without rewards?")) return;
        await app.backend.discardSaved();
        location.reload();
      }, "btn ghost"));
      if (app.backend.saveWarning) panel.append(el("p", app.backend.saveWarning, "err"));
    },
    records(app) {
      const { panel } = modal("Personal records — this device only");
      const profile = app.meta.profile;
      const stats = el("div", null, "offline-record-summary");
      for (const [name, value] of [["Runs", profile.counters.runs ?? 0], ["Wins", profile.counters.wins ?? 0], ["KOs", profile.counters.kills ?? 0], ["Pokémon", profile.league.length]]) {
        const stat = el("div");
        stat.append(el("strong", Number(value).toLocaleString()), el("small", name));
        stats.append(stat);
      }
      panel.append(stats);
      const list = el("div", null, "offline-record-list");
      for (const record of profile.runs.slice(0, 30)) {
        const row = el("div", null, "offline-record");
        const minutes = `${Math.floor(record.time / 60)}:${String(Math.floor(record.time % 60)).padStart(2, "0")}`;
        row.append(
          el("b", `#${record.finalSpecies ?? record.species} · ${record.biome}`),
          el("span", record.mode === "endless" ? "Endless" : record.mode === "relay" ? "Relay" : record.victory ? "Victory" : "Classic"),
          el("span", `${Number(record.kills).toLocaleString()} KOs · ${minutes}`),
        );
        list.append(row);
      }
      if (!profile.runs.length) list.append(el("p", "Finish a run to see your history here.", "muted"));
      panel.append(list);
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
