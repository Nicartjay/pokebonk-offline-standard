import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {windowChrome, connectWindowUI, quitAfterLastWindow} from "../desktop/window-ui.mjs";
import {createFullscreenButton} from "../runtime/ui.js";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {issueFormURL} from "../desktop/report.mjs";

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
test("the sandboxed preload creates presentation chrome and keeps saves separate from LAN", async () => {
  const source = await readFile("standard/desktop/preload.cjs", "utf8");
  for (const platform of ["darwin", "win32", "linux"]) {
    const docEvents = new EventEmitter(), ipc = new EventEmitter(), exposed = new Map(), elements = [];
    const doc = {documentElement: {dataset: {}}, body: {append: element => elements.push(element)},
      getElementById: id => elements.find(element => element.id === id),
      createElement: tag => new Element(tag), dispatchEvent: event => docEvents.emit(event.type),
      addEventListener: (type, fn) => docEvents.on(type, fn)};
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
    assert.deepEqual([...exposed.keys()], ["PokeBonkStandard", "PokeBonkLAN"]);
    assert.deepEqual(Object.keys(exposed.get("PokeBonkLAN")), ["state", "send"]);
    ipc.emit("standard:window-state", {}, {fullscreen: "true"});
    assert.equal(doc.documentElement.dataset.standardFullscreen, "false");
    ipc.emit("standard:window-state", {}, {fullscreen: true});
    assert.equal(doc.documentElement.dataset.standardFullscreen, "true");
    assert.equal(elements.length, platform === "linux" ? 0 : 1);
  }
});
test("preload native actions require trusted primary clicks in the exact matching modal", async () => {
  const source = await readFile("standard/desktop/preload.cjs", "utf8");
  let onClick;
  const sent = [];
  vm.runInNewContext(source, {
    document: {addEventListener(type, listener) { if(type==="click")onClick = listener; }},
    window: {addEventListener() {}},
    require: () => ({contextBridge: {exposeInMainWorld() {}},
      ipcRenderer: {on() {}, send: (...args) => sent.push(args)}}),
  });
  const fire = (action, {trusted = true, button = 0, href = "/__native__/" + action, scope} = {}) => {
    let prevented = false;
    const link = {getAttribute: key => key === "href" ? href : action,
      closest: selector => selector === scope ? {} : null};
    onClick({isTrusted: trusted, button, target: {closest: selector => selector === "a[data-standard-native-action]" ? link : null},
      preventDefault() { prevented = true; }});
    return prevented;
  };
  for (const [action, scope, channel] of [
    ["check-for-updates", ".offline-player-card", "standard:check-updates"],
    ["report-bug", ".offline-report-card", "standard:report-bug"],
  ]) {
    for (const invalid of [{trusted: false}, {button: 1}, {scope: ".wrong-modal"},
      {href: "https://example.invalid"}, {href: "/__native__/" + action + "?url=arbitrary"}]) {
      assert.equal(fire(action, {scope, ...invalid}), false);
    }
    assert.equal(fire(action, {scope}), true);
    assert.deepEqual(sent.at(-1), [channel], "The renderer cannot supply URLs or other command arguments.");
  }
  for (const action of ["execute", "export-backup", "unknown"]) assert.equal(fire(action, {scope: ".offline-report-card"}), false);
  assert.equal(sent.length, 2);
});
test("desktop-control clicks validate exact scopes, verbs and enum URLs without adding callable bridge methods", async () => {
  let click;const sent=[],bridges=[];
  vm.runInNewContext(await readFile("standard/desktop/preload.cjs","utf8"),{
    document:{addEventListener(_type,fn){click=fn;}},window:{addEventListener(){}},
    require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>bridges.push([name,Object.keys(value)])},
      ipcRenderer:{on(){},send:(...args)=>sent.push(args)}}),
  });
  const fire=(action,value,{trusted=true,scope=true,href=`/__native__/desktop/${action}${value?"/"+value:""}`}={})=>{
    let prevented=false;
    const link={getAttribute:key=>key==="href"?href:key==="data-standard-desktop-action"?action:value,
      closest:()=>scope?{}:null};
    click({isTrusted:trusted,button:0,target:{closest:selector=>selector==="a[data-standard-desktop-action]"?link:null},
      preventDefault(){prevented=true;}});
    return prevented;
  };
  for(const [action,value]of [["settings",""],["backend","metal"],["monitor","-12"],["resolution","1280x720"],["awake","off"],["restart",""]]){
    assert.equal(fire(action,value,{trusted:false}),false);
    assert.equal(fire(action,value,{scope:false}),false);
    assert.equal(fire(action,value,{href:"https://example.invalid/command"}),false);
    assert.equal(fire(action,value),true);
    assert.deepEqual(sent.at(-1),["standard:desktop-action",action,value]);
  }
  for(const [action,value]of [["exec","cmd"],["backend","--no-sandbox"],["resolution","99999x99999"],["monitor","1/../2"]])
    assert.equal(fire(action,value),false);
  assert.deepEqual(bridges,[["PokeBonkStandard",["loadState","saveState"]],["PokeBonkLAN",["state","send"]]]);
});
test("update download/install require a trusted click in the updater and accept no arguments or destination", async () => {
  let click;
  const sent = [];
  vm.runInNewContext(await readFile("standard/desktop/preload.cjs", "utf8"), {
    document: {addEventListener(_type, fn) { click = fn; }}, window: {addEventListener() {}},
    require: () => ({contextBridge: {exposeInMainWorld() {}}, ipcRenderer: {on() {}, send: (...args) => sent.push(args)}}),
  });
  const fire = (action, {trusted = true, scope = true, disabled = false, href = "/__native__/" + action} = {}) => {
    const link = {closest: selector => scope && selector === ".offline-update-card" ? {} : null,
      getAttribute: key => key === "href" ? href : key === "aria-disabled" ? String(disabled) : action};
    click({isTrusted: trusted, button: 0,
      target: {closest: selector => selector === "a[data-standard-native-action]" ? link : null}, preventDefault() {}});
  };
  for (const action of ["download-update", "install-update"]) {
    const count = sent.length;
    for (const options of [{trusted: false}, {scope: false}, {disabled: true},
      {href: "https://example.invalid"}, {href: "/__native__/" + action + "?file=arbitrary"}]) fire(action, options);
    assert.equal(sent.length, count);
    fire(action); assert.deepEqual(sent.at(-1), ["standard:update-action", action]);
  }
});
test("the LAN bridge allows only bounded game messages and never exposes transport or filesystem commands", async () => {
  const bridges = new Map(), sent = [];
  vm.runInNewContext(await readFile("standard/desktop/preload.cjs", "utf8"), {
    structuredClone,
    document: {addEventListener() {}}, window: {addEventListener() {}},
    require: () => ({contextBridge: {exposeInMainWorld: (name, value) => bridges.set(name, value)},
      ipcRenderer: {on() {}, send: (...args) => sent.push(args)}}),
  });
  const lan = bridges.get("PokeBonkLAN");
  assert.equal(Object.isFrozen(lan), true);
  const snapshot = lan.state(); snapshot.phase = "forged";
  assert.equal(lan.state().phase, "idle");
  const channels = ["ctl", "snap", "prepared", "failed", "leave", "refresh", "cancel-find",
    "room-ready", "room-start", "room-pick", "room-chat"];
  for (const channel of channels) {
    lan.send(channel, {test: true});
    assert.deepEqual(sent.at(-1), ["standard:lan-game", channel, {test: true}]);
  }
  for (const channel of ["host", "connect", "exec", "readFile", "check-updates", "standard:lan-action"])
    lan.send(channel, {});
  lan.send("room-chat", "x".repeat(48001));
  assert.equal(sent.length, channels.length);
});
test("preload routes only a real fullscreen click to the native window and stops HTML fullscreen", async () => {
  let click;const sent=[];
  vm.runInNewContext(await readFile("standard/desktop/preload.cjs","utf8"),{
    document:{addEventListener(_type,fn){click=fn;}},window:{addEventListener(){}},
    require:()=>({contextBridge:{exposeInMainWorld(){}},ipcRenderer:{on(){},send:(...args)=>sent.push(args)}}),
  });
  let stopped=0,prevented=0;
  const fire=trusted=>click({isTrusted:trusted,button:0,target:{closest:selector=>selector==="button.offline-fullscreen"?{}:null},
    preventDefault(){prevented++;},stopImmediatePropagation(){stopped++;}});
  fire(false);assert.equal(sent.length,0);
  fire(true);assert.deepEqual(sent,[["standard:toggle-fullscreen"]]);
  assert.equal(stopped,1);assert.equal(prevented,1);
});
test("bug reports use a fixed repository and app metadata without attaching private save data", () => {
  const config = {repository: "Nicartjay/pokebonk-offline-standard", version: "1.0.0",
    upstream: {version: "0.10.23", build: "mwro88g3"}};
  const url = new URL(issueFormURL(config, "darwin"));
  assert.equal(url.origin, "https://github.com");
  assert.equal(url.pathname, "/Nicartjay/pokebonk-offline-standard/issues/new");
  assert.equal(url.searchParams.get("title"), "[Bug] PokéBonk Offline v1.0.0");
  assert.match(url.searchParams.get("body"), /0\.10\.23 \(mwro88g3\)/);
  assert.match(url.searchParams.get("body"), /Platform: darwin/);
  assert.throws(() => issueFormURL({...config, repository: "other/repository"}, "darwin"), /Unknown/);
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

test("closing the last macOS window quits the app after accepted native writes finish", async () => {
  const app = new EventEmitter();
  let releaseWrite, quits = 0;
  const write = new Promise(resolve => { releaseWrite = resolve; });
  app.quit = () => { quits++; };
  quitAfterLastWindow(app, {pendingWrites: () => write});
  app.emit("window-all-closed");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quits, 0);
  releaseWrite();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(quits, 1);
  const main = await readFile("standard/desktop/main.mjs", "utf8");
  assert.match(main, /quitAfterLastWindow\(app, \{pendingWrites: \(\) => Promise\.all\(\[store\.queue, preferences\.save\(\)\]\)\}\)/);
  assert.match(main, /app\.on\("will-quit"/, "Cmd+Q must also drain accepted native writes.");
  assert.doesNotMatch(main, /process\.platform !== "darwin"\) app\.quit/);
});

test("a failed prior save does not leave an invisible app running after its last window closes", async () => {
  const app = new EventEmitter(), errors = [];
  let quits = 0;
  app.quit = () => { quits++; };
  quitAfterLastWindow(app, {pendingWrites: () => Promise.reject(new Error("disk full")), onError: error => errors.push(error.message)});
  app.emit("window-all-closed");
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, ["disk full"]);
  assert.equal(quits, 1);
});

test("Android native fullscreen does not create a redundant fullscreen button", () => {
  assert.equal(createFullscreenButton({window: {PokeBonkStandardAndroid: {}},
    document: {createElement() { throw new Error("Should not create Android fullscreen controls."); }}}), null);
});
