import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {installAndroidSafeArea, projectAndroidInsets} from "../runtime/android-ui.js";

const geometry = {width: 2400, height: 1080, left: 120, top: 48, right: 48, bottom: 66};
test("Android inset projection respects physical density and rounds toward safety", () => {
  assert.deepEqual(projectAndroidInsets(geometry, 800, 360), {left: 40, top: 16, right: 16, bottom: 22});
  assert.deepEqual(projectAndroidInsets({...geometry, left: 121}, 800, 360), {left: 41, top: 16, right: 16, bottom: 22});
  assert.deepEqual(projectAndroidInsets({...geometry, width: 1080, height: 2400}, 360, 800),
    {left: 40, top: 16, right: 16, bottom: 22});
});
test("native menu clearance follows the upstream's scaled mobile viewport", () => {
  assert.deepEqual(projectAndroidInsets({...geometry, menuSize: 144, menuGap: 24}, 1067, 480),
    {left: 54, top: 22, right: 22, bottom: 30, menuSize: 65, menuGap: 11});
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
  assert.equal(styles.size, 0); // CSS supplies the pre-measurement fallback.
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
