import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {updateFeedbackView} from "../common/update-feedback.mjs";
import {androidBridgeMethods} from "./bridge-fixtures.mjs";

const config = {version: "1.1.0", upstream: {version: "0.10.26", build: "mwsewi0r"}};
test("checking feedback explains the operation, shows versions, and never invents a percentage", () => {
  const view = updateFeedbackView({state: "checking"}, config);
  assert.equal(view.checking, true);
  assert.match(view.title, /Checking for updates/);
  assert.match(view.summary, /GitHub/);
  assert.deepEqual(view.rows, [
    ["Installed app", "v1.1.0"], ["Latest public release", "Checking…"],
    ["Bundled game", "v0.10.26 (mwsewi0r)"],
  ]);
  assert.match(view.note, /Nothing is being downloaded or installed/);
  assert.equal(view.percent, undefined);
});
test("equal and ahead builds get distinct, understandable completion messages", () => {
  const equal = updateFeedbackView({state: "current", latestVersion: "1.1.0"}, config);
  const ahead = updateFeedbackView({state: "ahead", latestVersion: "1.0.0"}, config);
  assert.match(equal.title, /up to date/);
  assert.match(equal.summary, /No update is needed/);
  assert.match(ahead.title, /No newer public release/);
  assert.match(ahead.summary, /newer test build/);
  assert.equal(ahead.rows[1][1], "v1.0.0");
  for (const view of [equal, ahead]) {
    assert.equal(view.checking, false);
    assert.match(view.note, /not changes on the live game website/);
    assert.doesNotMatch(view.summary, /is current/);
  }
});
test("failed checks remain playable, technical text is bounded and malformed metadata is rejected", () => {
  const view = updateFeedbackView({state: "error", detail: "offline".repeat(1000)}, config);
  assert.match(view.title, /Couldn’t check/);
  assert.match(view.summary, /connection and try again/);
  assert.match(view.note, /keep playing offline/);
  assert.match(view.note, /saves have not changed/);
  assert.equal(view.detail.length, 600);
  for (const value of [null, {}, {state: "download-any-url"}, {state: "current"}, {state: "ahead", latestVersion: "../bad"}]) {
    assert.equal(updateFeedbackView(value, config), null);
  }
});
test("manual update networking remains native-only and UI feedback adds no callable bridge", async () => {
  const desktop = await readFile("standard/desktop/main.mjs", "utf8");
  const android = await readFile("standard/android/app/src/main/java/dev/nicartjay/pokebonk/offline/standard/MainActivity.java", "utf8");
  const bridge = await readFile("standard/desktop/preload.cjs", "utf8");
  assert.match(desktop, /pendingFeedback = \{state: "checking"\}/);
  assert.match(desktop, /showPending\(\)/);
  assert.match(desktop, /if \(showing \|\| !await idle\(\)\) return/);
  assert.match(android, /presentUpdateFeedback\(updater\.feedback\(\)\)/);
  assert.deepEqual(androidBridgeMethods(android, "StorageBridge"), ["loadState", "saveState"]);
  assert.deepEqual([...bridge.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map(m => m[1]), ["standard:load-state", "standard:save-state"]);
  const ui = await readFile("standard/runtime/ui.js", "utf8");
  assert.match(ui, /setAttribute\("role", "progressbar"\)/);
  assert.match(ui, /aria-valuenow/);
  assert.match(ui, /if \(!view \|\| globalThis\.PokeBonkNativeApp\?\.run\) return false/);
});
const update = {latestVersion: "1.4.0", kind: "apk", totalBytes: 100, receivedBytes: 37,
  upstreamVersion: "0.10.26", upstreamBuild: "mwsewi0r", notes: "Sample release"};
test("download percent comes only from bounded transferred bytes and the signed size", () => {
  const view = updateFeedbackView({...update, state: "downloading"}, config);
  assert.equal(view.percent, 37);
  assert.equal(view.busy, true);
  assert.equal(view.primary, null);
  assert.equal(updateFeedbackView({...update, state: "downloading", receivedBytes: 100}, config).percent, 100);
  for (const extra of [{receivedBytes: -1}, {receivedBytes: 101}, {receivedBytes: NaN},
    {totalBytes: 0}, {totalBytes: 2 ** 40}, {kind: "execute"}, {latestVersion: "../bad"}]) {
    assert.equal(updateFeedbackView({...update, state: "downloading", ...extra}, config), null);
  }
});
test("only a verified ready state offers the fixed Install action", () => {
  for (const state of ["checking", "downloading", "verifying", "installing"]) {
    const view = updateFeedbackView({...update, state}, config);
    assert.equal(view.primary, null);
    assert.equal(view.busy, true);
  }
  assert.deepEqual(updateFeedbackView({...update, state: "available"}, config).primary,
    {label: "Download update", action: "download-update"});
  assert.deepEqual(updateFeedbackView({...update, state: "ready"}, config).primary,
    {label: "Install update", action: "install-update"});
  assert.match(updateFeedbackView({...update, state: "ready"}, config).note, /Android.*confirm installation/);
});
test("transfer failures offer a bounded retry without inventing success", () => {
  const view = updateFeedbackView({...update, state: "error", errorStage: "download", retryAction: "download-update"}, config);
  assert.equal(view.title, "Download didn’t finish");
  assert.equal(view.primary.action, "download-update");
  assert.equal(updateFeedbackView({...update, state: "error", retryAction: "execute"}, config).primary.action, "check-for-updates");
});
test("app-controlled updater presentation never falls back to an Android system alert", async () => {
  const source = await readFile("standard/android/app/src/main/java/dev/nicartjay/pokebonk/offline/standard/MainActivity.java", "utf8");
  const block = source.slice(source.indexOf("private void presentUpdate()"), source.indexOf("private void exportSave()"));
  assert.doesNotMatch(block, /AlertDialog|Toast|showDialog/);
  assert.match(block, /retryFeedback/);
  assert.match(source, /dismissUpdate/);
});
