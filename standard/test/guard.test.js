import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function fixture() {
  const calls = [];
  const document = {
    documentElement: { dataset: {} },
    addEventListener() {},
    querySelectorAll() { return []; },
  };
  class XHR { open(...args) { calls.push(["xhr", ...args]); } }
  const window = {
    fetch: async (...args) => { calls.push(["fetch", ...args]); return { ok: true }; },
    open: (...args) => { calls.push(["open", ...args]); return {}; },
    WebSocket: class {},
    EventSource: class {},
    RTCPeerConnection: class {},
    WebTransport: class {},
  };
  const navigator = { sendBeacon() {}, serviceWorker: { register() {} } };
  const context = {
    window, document, navigator, XMLHttpRequest: XHR,
    URL, location: { href: "http://127.0.0.1:8765/", origin: "http://127.0.0.1:8765" },
    MutationObserver: class { observe() {} }, queueMicrotask,
  };
  vm.runInNewContext(fs.readFileSync(new URL("../runtime/guard.js", import.meta.url), "utf8"), context);
  return { window, document, navigator, XHR, calls };
}

test("only same-origin assets and non-network in-memory data are allowed", () => {
  const { window } = fixture();
  const allowed = window.PokeBonkOfflineNetwork.allowed;
  assert.equal(allowed("/assets/pmd/4.png"), true);
  assert.equal(allowed("/__offline/save"), true);
  assert.equal(allowed("blob:http://127.0.0.1:8765/texture"), true);
  assert.equal(allowed("data:image/png;base64,AAAA"), true);
  for (const url of [
    "https://api.pokebonk.com/profile", "https://pokebonk.com/",
    "https://example.com/", "http://127.0.0.1.evil.example/",
    "http://localhost:9000/", "blob:https://example.com/texture", "/api/profile",
    "javascript:alert(1)", "file:///etc/passwd",
  ]) assert.equal(allowed(url), false, url);
});

test("external fetches and XMLHttpRequests never reach the underlying network functions", async () => {
  const f = fixture();
  await assert.rejects(f.window.fetch("https://api.pokebonk.com/status"), /disabled/);
  assert.throws(() => new f.XHR().open("GET", "https://example.com/"), /disabled/);
  assert.equal(f.calls.length, 0);
  await f.window.fetch("/data/pokemon.json");
  new f.XHR().open("GET", "/assets/test.glb");
  assert.equal(f.calls.length, 2);
});

test("multiplayer transports, beacons, remote navigation and service workers are disabled", async () => {
  const f = fixture();
  for (const name of ["WebSocket", "EventSource", "RTCPeerConnection", "WebTransport"]) {
    assert.throws(() => new f.window[name]("wss://example.com"), /disabled/);
  }
  assert.equal(f.navigator.sendBeacon("https://example.com", "data"), false);
  await assert.rejects(f.navigator.serviceWorker.register("/worker.js"), /disabled/);
  assert.equal(f.window.open("https://example.com"), null);
  assert.equal(f.calls.length, 0);
  assert.ok(f.window.open("/creditos.txt"));
});
