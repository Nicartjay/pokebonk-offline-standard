import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {windowChrome, connectWindowUI} from "../desktop/window-ui.mjs";
import {createFullscreenButton} from "../runtime/ui.js";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = new Map(); this.events = {}; this.isConnected = true; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  getAttribute(name) { return this.attributes.get(name); }
  append(child) { this.children.push(child); }
  addEventListener(type, listener) { this.events[type] = listener; }
}
function fixture(native = false) {
  const events = new EventEmitter(), calls = [];
  const doc = {
    fullscreenElement: null,
    documentElement: {dataset: {standardFullscreen: String(native)}},
    createElement: tag => new Element(tag),
    createElementNS: (_namespace, tag) => new Element(tag),
    addEventListener: (type, listener) => events.on(type, listener),
    async exitFullscreen() { calls.push("exit"); doc.fullscreenElement = null; doc.documentElement.dataset.standardFullscreen = "false"; events.emit("fullscreenchange"); },
  };
  doc.documentElement.requestFullscreen = async () => { calls.push("enter"); doc.fullscreenElement = doc.documentElement; events.emit("fullscreenchange"); };
  const errors = [], button = createFullscreenButton({document: doc, onError: error => errors.push(error)});
  return {doc, button, calls, errors, events, path: button.children[0].children[0]};
}
test("macOS uses transparent inset title chrome without making the whole window transparent", () => {
  assert.deepEqual(windowChrome("darwin"), {titleBarStyle: "hiddenInset", trafficLightPosition: {x: 16, y: 14}});
  assert.equal(windowChrome("darwin").transparent, undefined);
  assert.deepEqual(windowChrome("linux"), {});
});
test("Windows overlays native caption buttons on a transparent title bar, without a permanent menu row", () => {
  assert.deepEqual(windowChrome("win32"), {titleBarStyle: "hidden",
    titleBarOverlay: {color: "#00000000", symbolColor: "#ffffff", height: 40}, autoHideMenuBar: true});
  assert.equal(windowChrome("win32").transparent, undefined);
  assert.equal(windowChrome("win32").frame, undefined);
});
test("the actual sandboxed preload creates presentation chrome on Mac/Windows but exposes only saves", async () => {
  const source = await readFile("standard/desktop/preload.cjs", "utf8");
  for (const platform of ["darwin", "win32", "linux"]) {
    const docEvents = new EventEmitter(), ipc = new EventEmitter(), exposed = new Map(), elements = [];
    const doc = {documentElement: {dataset: {}}, body: {append: element => elements.push(element)},
      getElementById: id => elements.find(element => element.id === id),
      createElement: tag => new Element(tag), dispatchEvent: event => docEvents.emit(event.type)};
    const context = vm.createContext({document: doc, process: {platform}, Event,
      window: {addEventListener: (type, fn) => docEvents.on(type, fn)},
      require: name => {
        assert.equal(name, "electron");
        return {contextBridge: {exposeInMainWorld: (name, value) => exposed.set(name, value)}, ipcRenderer: ipc};
      }});
    vm.runInContext(source, context);
    docEvents.emit("DOMContentLoaded");
    assert.equal(doc.documentElement.dataset.standardPlatform, platform);
    assert.equal(elements.length, platform === "linux" ? 0 : 1);
    assert.deepEqual(Object.keys(exposed.get("PokeBonkStandard")), ["loadState", "saveState"]);
    ipc.emit("standard:window-state", {}, {fullscreen: "true"});
    assert.equal(doc.documentElement.dataset.standardFullscreen, "false");
    ipc.emit("standard:window-state", {}, {fullscreen: true});
    assert.equal(doc.documentElement.dataset.standardFullscreen, "true");
    assert.equal(elements.length, platform === "linux" ? 0 : 1);
  }
});
test("inline fullscreen icon changes between enter and exit without loading any image", async () => {
  const f = fixture(), enterPath = f.path.getAttribute("d");
  assert.equal(f.button.children[0].tagName, "svg");
  assert.equal(f.button.getAttribute("aria-label"), "Enter fullscreen");
  await f.button.events.click();
  assert.equal(f.button.getAttribute("aria-label"), "Exit fullscreen");
  assert.notEqual(f.path.getAttribute("d"), enterPath);
  await f.button.events.click();
  assert.equal(f.button.getAttribute("aria-label"), "Enter fullscreen");
  assert.deepEqual(f.calls, ["enter", "exit"]);
  assert.equal(f.path.getAttribute("d"), enterPath);
  assert.deepEqual(f.errors, []);
});
test("the exit button also exits native-only fullscreen, such as the macOS green button", async () => {
  const f = fixture(true);
  assert.equal(f.button.getAttribute("aria-label"), "Exit fullscreen");
  await f.button.events.click();
  assert.deepEqual(f.calls, ["enter", "exit"]);
  assert.equal(f.button.getAttribute("aria-pressed"), "false");
});
test("fullscreen rejection leaves the button enabled and reports an error", async () => {
  const f = fixture();
  f.doc.documentElement.requestFullscreen = async () => { throw new Error("permission denied"); };
  await f.button.events.click();
  assert.equal(f.button.disabled, false);
  assert.equal(f.errors[0].message, "permission denied");
  assert.equal(f.button.getAttribute("aria-label"), "Enter fullscreen");
});
test("native window state reaches the preload and an HTML exit clears native fullscreen", () => {
  const window = new EventEmitter(), contents = new EventEmitter(), messages = [];
  Object.assign(contents, {isDestroyed: () => false, send: (...args) => messages.push(args)});
  let fullscreen = true;
  Object.assign(window, {webContents: contents, isDestroyed: () => false, isFullScreen: () => fullscreen,
    setFullScreen(value) { fullscreen = value; }, setWindowButtonVisibility() {}});
  connectWindowUI(window, "darwin");
  contents.emit("did-finish-load");
  assert.deepEqual(messages.at(-1), ["standard:window-state", {fullscreen: true}]);
  contents.emit("leave-html-full-screen");
  assert.equal(fullscreen, false);
  assert.deepEqual(messages.at(-1), ["standard:window-state", {fullscreen: false}]);
});
test("Windows fullscreen wiring never calls macOS-only window methods", () => {
  const window = new EventEmitter(), webContents = new EventEmitter(), messages = [];
  Object.assign(webContents, {isDestroyed: () => false, send: (...args) => messages.push(args)});
  Object.assign(window, {webContents, isDestroyed: () => false, isFullScreen: () => true});
  connectWindowUI(window, "win32"); // Deliberately no setWindowButtonVisibility.
  window.emit("enter-full-screen");
  assert.deepEqual(messages.at(-1), ["standard:window-state", {fullscreen: true}]);
});
