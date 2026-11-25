import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {readFile} from "node:fs/promises";
import {ANDROID_UI_SCALE, androidPresentationSettings, androidMinimapScale,
  installAndroidSafeArea, installAndroidStarterLayout, projectAndroidInsets} from "../runtime/android-ui.js";

const geometry = {width: 2400, height: 1080, left: 120, top: 48, right: 48, bottom: 66};
test("Android inset projection respects physical density and rounds toward safety", () => {
  assert.deepEqual(projectAndroidInsets(geometry, 800, 360), {left: 40, top: 16, right: 16, bottom: 22});
  assert.deepEqual(projectAndroidInsets({...geometry, left: 121}, 800, 360), {left: 41, top: 16, right: 16, bottom: 22});
  assert.deepEqual(projectAndroidInsets({...geometry, width: 1080, height: 2400}, 360, 800),
    {left: 40, top: 16, right: 16, bottom: 22});
});
test("removed native menu has zero clearance even with a scaled mobile viewport", () => {
  assert.deepEqual(projectAndroidInsets({...geometry, menuSize: 0, menuGap: 0}, 1067, 480),
    {left: 54, top: 22, right: 22, bottom: 30, menuSize: 0, menuGap: 0});
});
test("invalid native presentation metadata is ignored, not turned into CSS", () => {
  for (const value of [null, {}, {...geometry, left: -1}, {...geometry, top: Infinity},
    {...geometry, right: "10px"}, {...geometry, width: 0}, {...geometry, width: 99999},
    {...geometry, left: 2400}, {...geometry, bottom: 1080}, {...geometry, menuSize: "48px"}]) {
    assert.equal(projectAndroidInsets(value, 800, 360), null);
  }
});
test("only the Android shell opts in; desktop and ordinary browsers retain their spacing", () => {
  for (const native of [{}, {PokeBonkStandard: {}}, {PokeBonkStandard: {}, PokeBonkStandardAndroid: {}}]) {
    const doc = {documentElement: {dataset: {}}};
    assert.equal(installAndroidSafeArea({window: native, document: doc}), null);
    assert.deepEqual(doc.documentElement.dataset, {});
  }
});
test("one-way safe insets reapply on viewport changes without expanding the storage bridge", () => {
  const events = new EventEmitter(), styles = new Map(), bridge = {loadState() {}, saveState() {}};
  const win = {PokeBonkStandardAndroid: bridge, innerWidth: 800, innerHeight: 360,
    addEventListener: (event, fn) => events.on(event, fn), removeEventListener: (event, fn) => events.off(event, fn)};
  const doc = {documentElement: {dataset: {}, style: {setProperty: (key, value) => styles.set(key, value)}}};
  const dispose = installAndroidSafeArea({window: win, document: doc});
  assert.equal(doc.documentElement.dataset.standardPlatform, "android");
  assert.equal(styles.get("--standard-android-ui-scale"), "0.9");
  const detail = {...geometry};
  events.emit("standard:android-insets", {detail});
  assert.equal(styles.get("--standard-android-safe-left"), "40px");
  detail.left = 9999; // A previously delivered event cannot mutate the sample.
  events.emit("standard:android-insets", {detail: {...geometry, left: NaN}});
  assert.equal(styles.get("--standard-android-safe-left"), "40px");
  win.innerWidth = 1200;
  events.emit("resize");
  assert.equal(styles.get("--standard-android-safe-left"), "60px");
  assert.deepEqual(Object.keys(bridge), ["loadState", "saveState"]);
  dispose();
  assert.equal(events.listenerCount("resize"), 0);
  assert.equal(events.listenerCount("standard:android-insets"), 0);
});

test("Android HUD/touch scaling is ten percent smaller without changing saved preferences or desktop", () => {
  const native = {PokeBonkStandardAndroid: {}}, settings = {hudScale: 1, touchScale: 1.2, music: .7};
  assert.equal(ANDROID_UI_SCALE, .9);
  assert.deepEqual(androidPresentationSettings(settings, native), {hudScale: .9, touchScale: 1.08, music: .7});
  assert.deepEqual(settings, {hudScale: 1, touchScale: 1.2, music: .7});
  assert.deepEqual(androidPresentationSettings({}, native), {hudScale: .9, touchScale: .9});
  for (const win of [{}, {PokeBonkStandard: {}}, {...native, PokeBonkStandard: {}}]) {
    assert.equal(androidPresentationSettings(settings, win), settings);
  }
});

test("Android no longer maps measured corners into game margins or adds HUD/screen insets", async () => {
  const css = await readFile("standard/runtime/offline.css", "utf8");
  const android = css.slice(css.indexOf("/* ANDROID ONLY."));
  assert.doesNotMatch(android, /--s[lrbt]\s*:|--standard-android-inset-|#hud|#ui \.screen|scroll-padding/);
  assert.match(android, /\.tc \.tc-sm/);
});

test("Android minimap size follows the complete 60–200% slider instead of the small-phone cap", () => {
  const win = {PokeBonkStandardAndroid: {}};
  for (const scale of [.6, .8, 1, 1.1, 1.2, 1.5, 1.75, 2]) {
    assert.equal(androidMinimapScale(scale, Math.min(scale, 1.2), win), scale);
  }
  assert.equal(androidMinimapScale(99, 1.2, win), 2);
  assert.equal(androidMinimapScale(-1, .6, win), .6);
  assert.equal(androidMinimapScale(NaN, 1, win), 1);
  for (const win of [{}, {PokeBonkStandard: {}}, {PokeBonkStandard: {}, PokeBonkStandardAndroid: {}}]) {
    assert.equal(androidMinimapScale(2, 1.2, win), 1.2);
  }
});

test("Android hides both menu and in-game fullscreen controls, and tablet card headers explicitly stretch", async () => {
  const css = await readFile("standard/runtime/offline.css", "utf8");
  assert.match(css, /data-standard-platform="android"[^{}]*:is\(\.offline-fullscreen, \.fs-btn, \.tc-fs\)[^{]*\{\s*display:\s*none\s*!important/);
  assert.match(css, /#ui \.sp-card,\s*#ui \.card\s*\{\s*align-items:\s*stretch/);
  assert.match(css, /#ui \.card > \.top\s*\{[^}]*width:\s*100%/);
});

test("Android under-character HP digits use white fill and a thin behind-text shadow, without changing the bar", async () => {
  const css = await readFile("standard/runtime/home.css", "utf8");
  const rule = css.match(/:root\[data-standard-platform="android"\] \.under \.hpbar > b\s*\{([^}]+)\}/)?.[1];
  assert.ok(rule, "The HP typography override must be limited to the Android shell.");
  assert.match(rule, /-webkit-text-stroke:\s*0 transparent !important/);
  assert.match(rule, /-webkit-text-fill-color:\s*#fff/);
  assert.match(rule, /(?:^|;)\s*color:\s*#fff/);
  assert.match(rule, /text-shadow:[^;]*\.65px[^;]*#2a2440[^;]*!important/);
  assert.doesNotMatch(rule, /paint-order|font-size|font-weight|padding|height|width|background|border/);
});

test("Android friendship badge numbers use the behind-fill outline at every badge size", async () => {
  const css = await readFile("standard/runtime/home.css", "utf8");
  const outline = [...css.matchAll(/:root\[data-standard-platform="android"\] :is\(([^{}]+)\)\s*\{([^}]+)\}/g)]
    .find(rule => rule[1].includes(".fr-badge > b"));
  assert.ok(outline);
  assert.match(outline[1], /\.fr-badge > b/);
  assert.match(outline[2], /-webkit-text-stroke:\s*0 transparent !important/);
  assert.match(outline[2], /-webkit-text-fill-color:\s*currentColor/);
  assert.match(outline[2], /text-shadow:[^;]*\.06em[^;]*!important/);
  assert.match(css, /:root\[data-standard-platform="android"\] \.fr-badge > b\s*\{[^}]*--standard-outline:\s*#2a2440;\s*color:\s*#fff/);
});

test("Android no longer adds a native menu overlay, uses current APK assets and retains filled launcher art", async () => {
  const base = "standard/android/app/src/main/";
  const java = await readFile(base + "java/dev/nicartjay/pokebonk/offline/standard/MainActivity.java", "utf8");
  assert.doesNotMatch(java, /ImageButton|root\.addView\(menu|app_menu_icon|app_menu_background/);
  assert.match(java, /Player & saves → Export save backup/);
  assert.match(java, /menuSize:0,menuGap:0/);
  assert.match(java, /setCacheMode\(WebSettings\.LOAD_NO_CACHE\)/);
  assert.match(java, /setAlgorithmicDarkeningAllowed\(false\)/);
  const ui = await readFile("standard/runtime/ui.js", "utf8");
  assert.match(ui, /nativeAction\("Export save backup", "export-backup"/);
  assert.match(ui, /nativeAction\("Import save backup", "import-backup"/);
  assert.doesNotMatch(ui, /appMenu\(\)/);
  assert.match(await readFile(base + "res/drawable/launcher_foreground.xml", "utf8"), /android:inset="10dp"/);
});

test("starter fitting never changes desktop or ordinary browser layouts", () => {
  for (const win of [{}, {PokeBonkStandard: {}}, {PokeBonkStandard: {}, PokeBonkStandardAndroid: {}}]) {
    assert.equal(installAndroidStarterLayout({window: win, document: {
      getElementById() { throw new Error("Non-Android layout must not be inspected."); },
    }}), null);
  }
});

test("starter cards compact only when measured space is insufficient, sharing an animation-independent track", () => {
  const events = new EventEmitter(), viewport = new EventEmitter(), frames = new Map(), styles = new Map(), classes = new Set();
  const mutations = [], observations = [];
  let height = 800, serial = 0, screen;
  const compact = () => classes.has("standard-starter-compact");
  const info = [150, 118, 142].map((natural, index) => ({
    get offsetHeight() { return compact() ? [114, 90, 104][index] : natural; },
    getBoundingClientRect() { throw new Error("Scale-in animation must not affect layout measurements."); },
  }));
  const row = {
    clientWidth: 1000,
    get clientHeight() { return height - (compact() ? 130 : 180); },
    querySelectorAll: () => info,
    style: {removeProperty: key => styles.delete(key), setProperty: (key, value) => styles.set(key, value)},
  };
  screen = {
    classList: {remove: key => classes.delete(key),
      toggle(key, on) { if (on) classes.add(key); else classes.delete(key); }},
    querySelector: () => row,
    querySelectorAll: () => [row, ...info],
  };
  const ui = {querySelector: () => screen};
  const win = {PokeBonkStandardAndroid: {},
    requestAnimationFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame: id => frames.delete(id),
    getComputedStyle: () => ({getPropertyValue: () => "220px"}),
    addEventListener: (type, listener) => events.on(type, listener),
    removeEventListener: (type, listener) => events.off(type, listener),
    visualViewport: {addEventListener: (type, listener) => viewport.on(type, listener),
      removeEventListener: (type, listener) => viewport.off(type, listener)},
    MutationObserver: class {
      constructor(callback) { this.callback = callback; mutations.push(this); }
      observe(node, options) { assert.equal(node, ui); assert.deepEqual(options, {childList: true}); }
      disconnect() { this.disconnected = true; }
    },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; observations.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
  };
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); };
  const dispose = installAndroidStarterLayout({window: win, document: {getElementById: () => ui}});
  flush();
  assert.equal(compact(), false, "A spacious tablet must keep the roomy presentation.");
  assert.equal(styles.get("--standard-starter-info-height"), "151px");
  height = 360;
  events.emit("resize"); viewport.emit("resize"); observations[0].callback();
  assert.equal(frames.size, 1, "Repeated resize notifications must coalesce.");
  flush();
  assert.equal(compact(), true);
  assert.equal(styles.get("--standard-starter-info-height"), "115px");
  height = 800;
  events.emit("resize"); flush();
  assert.equal(compact(), false, "A larger viewport must restore the roomy layout.");
  assert.equal(styles.get("--standard-starter-info-height"), "151px");
  screen = null;
  mutations[0].callback(); flush();
  assert.equal(frames.size, 0);
  events.emit("resize");
  dispose();
  assert.equal(frames.size, 0);
  assert.equal(events.listenerCount("resize"), 0);
  assert.equal(viewport.listenerCount("resize"), 0);
  assert.equal(mutations[0].disconnected, true);
});
