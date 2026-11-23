import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {verify} from "node:crypto";
import path from "node:path";
import {requireAcceptance} from "../scripts/publish.mjs";
import {manifest, config} from "./fixtures.mjs";
import {resolveAsset, byteRange, isGameURL, CSP} from "../desktop/protocol.mjs";
test("native asset protocol cannot escape root or open remote/file origins", () => {
  const root = path.resolve("game-fixture");
  assert.equal(resolveAsset(root, "pokebonk-standard://game/"), path.join(root, "index.html"));
  assert.equal(resolveAsset(root, "pokebonk-standard://game/assets/assets/test.png"), path.join(root, "assets/test.png"));
  for (const value of ["file:///etc/passwd", "https://pokebonk.com/", "pokebonk-standard://user@game/foo",
    "pokebonk-standard://game/..%2fsecret", "pokebonk-standard://game/%5csecret", "pokebonk-standard://game/%00secret"]) {
    assert.throws(() => resolveAsset(root, value));
  }
  assert.equal(isGameURL("pokebonk-standard://game:81/a"), false);
  assert.equal(CSP.includes("frame-src 'none'"), true);
});
test("native streaming serves bounded media ranges", () => {
  assert.deepEqual(byteRange("bytes=1-3", 10), {start: 1, end: 3});
  assert.deepEqual(byteRange("bytes=-3", 10), {start: 7, end: 9});
  for (const value of ["bytes=10-", "bytes=4-2", "bytes=-0", "bytes=1-2,4-5", "invalid"]) assert.throws(() => byteRange(value, 10));
});
test("release publication cannot substitute packaging/CI for actual device and licensing approval", () => {
  const template = {version: "0.2.0", sourceCommit: "b".repeat(40), gameDigest: "d".repeat(64), approvedBy: "local reviewer", approvedAt: "2026-11-21T12:00:00Z",
    automatedTests: true, macArm64Gameplay: true, macIntelGameplay: true, windowsGameplay: true, linuxGameplay: true, physicalAndroidGameplay: true,
    offlineGameplay: true, fullscreenInputAudioTouch: true, saveExportImportRestart: true, backgroundProcessDeath: true,
    upgradePreservesIdentityAndProgress: true, corruptUpdatesRejected: true, licensingReviewed: true};
  requireAcceptance(template, manifest());
  for (const key of ["physicalAndroidGameplay", "windowsGameplay", "linuxGameplay", "licensingReviewed", "upgradePreservesIdentityAndProgress"]) assert.throws(() => requireAcceptance({...template, [key]: false}, manifest()), /required/);
  assert.throws(() => requireAcceptance({...template, gameDigest: "f".repeat(64)}, manifest()), /exact release/);
});
test("stable owner waiver is explicit, exact, truthful and cannot waive automated or corrupt-update checks", () => {
  const receipt = {version: "0.2.0", sourceCommit: "b".repeat(40), gameDigest: "d".repeat(64),
    approvedBy: "Nicartjay", approvedAt: "2026-11-23T03:00:00Z",
    automatedTests: true, corruptUpdatesRejected: true, macArm64Gameplay: false, macIntelGameplay: false,
    windowsGameplay: false, linuxGameplay: false, physicalAndroidGameplay: false, offlineGameplay: false,
    fullscreenInputAudioTouch: false, saveExportImportRestart: false, backgroundProcessDeath: false,
    upgradePreservesIdentityAndProgress: false, licensingReviewed: false};
  receipt.maintainerWaiver = {version: 1, approveStable: true, approvedBy: receipt.approvedBy,
    approvedAt: receipt.approvedAt, checks: Object.keys(receipt).filter(key => receipt[key] === false),
    reason: "The owner explicitly authorizes stable publication while retaining these checks as incomplete."};
  const options = {actor: "Nicartjay", allowWaiver: true};
  requireAcceptance(receipt, manifest(), options);
  assert.equal(receipt.windowsGameplay, false);
  assert.throws(() => requireAcceptance(receipt, manifest(), {...options, allowWaiver: false}), /required/);
  assert.throws(() => requireAcceptance(receipt, manifest(), {...options, actor: "another-user"}), /owner/);
  for (const key of ["automatedTests", "corruptUpdatesRejected"]) {
    const bad = structuredClone(receipt); bad[key] = false; bad.maintainerWaiver.checks.push(key);
    assert.throws(() => requireAcceptance(bad, manifest(), options), /required/);
  }
  for (const change of [
    value => value.maintainerWaiver.checks.pop(),
    value => value.maintainerWaiver.checks.push("madeUpCheck"),
    value => value.maintainerWaiver.approvedBy = "another-user",
    value => value.maintainerWaiver.approvedAt = "2026-11-22T03:00:00Z",
    value => value.maintainerWaiver.approveStable = false,
    value => value.licensingReviewed = undefined,
  ]) {
    const bad = structuredClone(receipt); change(bad);
    assert.throws(() => requireAcceptance(bad, manifest(), options), /owner/);
  }
  assert.throws(() => requireAcceptance({...receipt, gameDigest: "f".repeat(64)}, manifest(), options), /exact release/);
});
test("shared Java DER interoperability fixture is also valid in Node", async () => {
  const root = new URL("./fixtures/", import.meta.url);
  assert.equal(verify("sha256", await readFile(new URL("ecdsa-payload.txt", root)), await readFile(new URL("ecdsa-public.pem", root)),
    Buffer.from(await readFile(new URL("ecdsa-signature.txt", root), "utf8"), "base64")), true);
});
test("only validated storage, not updater/fs/shell APIs, is exposed to the game", async () => {
  const preload = await readFile("standard/desktop/preload.cjs", "utf8");
  assert.deepEqual([...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)].map(m => m[1]), ["standard:load-state", "standard:save-state"]);
  const java = await readFile("standard/android/app/src/main/java/dev/nicartjay/pokebonk/offline/standard/MainActivity.java", "utf8");
  assert.deepEqual([...java.matchAll(/@JavascriptInterface public String (\w+)/g)].map(m => m[1]), ["loadState", "saveState"]);
  const transport = await readFile("standard/runtime/transport.js", "utf8");
  assert.doesNotMatch(transport, /fetch\(|http:|https:|node:|checkUpdates|installUpdate/);
  assert.equal(config.applicationId, "dev.nicartjay.pokebonk.offline.standard");
});
