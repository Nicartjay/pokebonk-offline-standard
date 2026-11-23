// Native presentation preferences, deliberately separate from progression.
// All geometry is in Electron display-independent pixels, never physical pixels.
import {readFileSync, statSync, mkdirSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync} from "node:fs";
import {mkdir, open, rename, unlink} from "node:fs/promises";
import path from "node:path";
import {randomUUID} from "node:crypto";

export const RESOLUTIONS = Object.freeze([
  {id: "fit", label: "Fit display"},
  {id: "960x540", label: "960 × 540"},
  {id: "1280x720", label: "1280 × 720"},
  {id: "1600x900", label: "1600 × 900"},
  {id: "1920x1080", label: "1920 × 1080"},
  {id: "2560x1440", label: "2560 × 1440"},
]);
const BACKENDS = {
  darwin: [["auto", "Auto (recommended)"], ["metal", "Metal"], ["gl", "OpenGL"]],
  win32: [["auto", "Auto (recommended)"], ["d3d11", "Direct3D 11"], ["gl", "OpenGL"], ["vulkan", "Vulkan (experimental)"]],
  linux: [["auto", "Auto (recommended)"], ["gl", "OpenGL"], ["vulkan", "Vulkan (experimental)"]],
};
export const graphicsBackends = platform => (BACKENDS[platform] ?? BACKENDS.linux).map(([id, label]) => ({id, label}));
export const validBackend = (id, platform) => graphicsBackends(platform).some(item => item.id === id);
export const validResolution = id => RESOLUTIONS.some(item => item.id === id);
export function graphicsSwitches(id, platform) {
  if (!validBackend(id, platform)) throw new Error("Unsupported graphics backend.");
  if (id === "auto") return [];
  return [["use-angle", id], ...(id === "vulkan" ? [["enable-features", "Vulkan"]] : [])];
}
const integer = (n, low, high) => Number.isSafeInteger(n) && n >= low && n <= high;
const validRect = r => r && integer(r.x, -131072, 131072) && integer(r.y, -131072, 131072) &&
  integer(r.width, 300, 32768) && integer(r.height, 200, 32768);
const defaults = () => ({schema: 1, window: null, keepAwake: true, backend: "auto", trial: null, recovery: ""});
export function parsePreferences(input, platform) {
  if (!input || input.schema !== 1) throw new Error("Unsupported native preference format.");
  const state = defaults();
  if (validRect(input.window)) state.window = {...Object.fromEntries(["x", "y", "width", "height"].map(k => [k, input.window[k]])),
    maximized: input.window.maximized === true, fullscreen: input.window.fullscreen === true};
  if (typeof input.keepAwake === "boolean") state.keepAwake = input.keepAwake;
  if (validBackend(input.backend, platform)) state.backend = input.backend;
  if (input.trial && validBackend(input.trial.backend, platform) && input.trial.backend !== "auto" &&
      typeof input.trial.started === "boolean") state.trial = {backend: input.trial.backend, started: input.trial.started};
  if (typeof input.recovery === "string") state.recovery = input.recovery.slice(0, 500);
  return state;
}
export function fitBounds(rect, area) {
  const width = Math.min(area.width, Math.max(Math.min(960, area.width), Math.round(rect.width)));
  const height = Math.min(area.height, Math.max(Math.min(540, area.height), Math.round(rect.height)));
  return {width, height,
    x: Math.round(Math.max(area.x, Math.min(rect.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(rect.y, area.y + area.height - height)))};
}
export function restoreBounds(saved, displays, primary) {
  // A disconnected monitor must not strand the titlebar outside every screen.
  const visible = saved && displays.find(display => {
    const a = display.workArea;
    return Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x) >= 80 &&
      Math.min(saved.y + 40, a.y + a.height) - Math.max(saved.y, a.y) >= 24;
  });
  const area = (visible ?? primary).workArea;
  const rect = saved && visible ? saved : {width: saved?.width ?? 1280, height: saved?.height ?? 720,
    x: area.x + (area.width - (saved?.width ?? 1280)) / 2, y: area.y + (area.height - (saved?.height ?? 720)) / 2};
  return fitBounds(rect, area);
}
export function resolutionBounds(id, display, {frameWidth = 0, frameHeight = 0} = {}) {
  if (!validResolution(id)) throw new Error("Unsupported resolution preset.");
  const a = display.workArea;
  const availableWidth = Math.max(1, a.width - frameWidth), availableHeight = Math.max(1, a.height - frameHeight);
  const [width, height] = id === "fit" ? [availableWidth, availableHeight] : id.split("x").map(Number);
  const scale = Math.min(1, availableWidth / width, availableHeight / height);
  const w = Math.round(width * scale) + frameWidth, h = Math.round(height * scale) + frameHeight;
  return {x: Math.round(a.x + (a.width - w) / 2), y: Math.round(a.y + (a.height - h) / 2), width: w, height: h};
}

export class DesktopPreferences {
  constructor(directory, platform) {
    this.directory = directory;
    this.platform = platform;
    this.file = path.join(directory, "desktop-preferences.json");
    this.state = defaults();
    this.queue = Promise.resolve();
    this.timer = null;
    this.goodBytes = null;
    for (const file of [this.file, this.file + ".previous"]) {
      try {
        if (statSync(file).size > 65536) continue;
        const bytes = readFileSync(file);
        this.state = parsePreferences(JSON.parse(bytes), platform);
        this.goodBytes = bytes;
        break;
      } catch { /* Preferences never prevent offline startup or touch saves. */ }
    }
  }
  // Called synchronously before Electron is ready and before switches apply.
  beginGraphicsLaunch() {
    const changed = Boolean(this.state.trial);
    if (this.state.trial?.started) {
      this.state.backend = "auto";
      this.state.trial = null;
      this.state.recovery = "The previous alternate-backend launch did not finish. Auto graphics was restored; your saves were not changed.";
    } else if (this.state.trial) this.state.trial.started = true;
    // Persist the trial BEFORE Chromium/GPU startup, not merely whenReady().
    // Otherwise a driver crash before ready could retry the bad backend forever.
    if (changed) this.saveStartup();
    return this.state.backend;
  }
  saveStartup() {
    mkdirSync(this.directory, {recursive: true, mode: 0o700});
    const atomic = (destination, bytes) => {
      const temporary = destination + "." + randomUUID() + ".tmp";
      try {
        const file = openSync(temporary, "wx", 0o600);
        try { writeFileSync(file, bytes); fsyncSync(file); } finally { closeSync(file); }
        renameSync(temporary, destination);
      } finally { try { unlinkSync(temporary); } catch {} }
    };
    const bytes = Buffer.from(JSON.stringify(parsePreferences(this.state, this.platform), null, 2) + "\n");
    if (this.goodBytes) atomic(this.file + ".previous", this.goodBytes);
    atomic(this.file, bytes); this.goodBytes = bytes;
  }
  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; void this.save().catch(console.error); }, 350);
    this.timer.unref?.();
  }
  save() {
    clearTimeout(this.timer); this.timer = null;
    const bytes = Buffer.from(JSON.stringify(parsePreferences(this.state, this.platform), null, 2) + "\n");
    const operation = this.queue.catch(() => {}).then(async () => {
      await mkdir(this.directory, {recursive: true});
      const atomic = async (destination, data) => {
        const temporary = destination + "." + randomUUID() + ".tmp";
        try {
          const file = await open(temporary, "wx", 0o600);
          try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
          await rename(temporary, destination);
        } finally { await unlink(temporary).catch(() => {}); }
      };
      if (this.goodBytes) await atomic(this.file + ".previous", this.goodBytes);
      await atomic(this.file, bytes);
      this.goodBytes = bytes;
      const directory = await open(this.directory, "r").catch(() => null);
      try { await directory?.sync(); } catch { /* Not supported on all Windows filesystems. */ }
      finally { await directory?.close(); }
    });
    this.queue = operation;
    return operation;
  }
}
