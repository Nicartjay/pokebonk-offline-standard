import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync, createHash} from "node:crypto";
import {mkdtemp, readdir, readFile, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {Readable} from "node:stream";
import {verifyManifest, selectArtifact, checkSaveCompatibility, compareVersions} from "../common/manifest.mjs";
import {allowedNetworkURL, downloadArtifact, fetchManifest} from "../common/network.mjs";
import {StandardUpdater, CHECK_INTERVAL} from "../desktop/updater.mjs";
import {config, manifest, signed, save} from "./fixtures.mjs";
test("valid P-256/DER signature selects exactly the native platform", () => {
  const m = verifyManifest(signed(), config);
  assert.equal(selectArtifact(m, "darwin-arm64", config).platform, "darwin-arm64");
  assert.equal(selectArtifact(m, "win32-x64", config).kind, "nsis");
  assert.equal(selectArtifact(m, "linux-x64", config).kind, "AppImage");
  assert.equal(selectArtifact(m, "linux-x64", config, "linux-x64-deb").kind, "deb");
  assert.equal(selectArtifact(m, "win32-x64", config, "win32-x64-portable").kind, "portable");
  assert.throws(() => selectArtifact(m, "linux-arm64", config), /platform/);
  assert.throws(() => selectArtifact(m, "linux-x64", config, "win32-x64-portable"), /platform/);
});
test("tampered, unsigned, wrong-key, corrupt and oversized manifests are rejected", () => {
  const corrupt = JSON.parse(signed()); corrupt.payload = Buffer.from("{}").toString("base64");
  assert.throws(() => verifyManifest(JSON.stringify(corrupt), config), /signature/);
  assert.throws(() => verifyManifest("not json", config));
  assert.throws(() => verifyManifest("x".repeat(256 * 1024 + 1), config), /too large/);
  const other = generateKeyPairSync("ec", {namedCurve: "prime256v1"});
  assert.throws(() => verifyManifest(signed(manifest(), other.privateKey), config), /signature/);
  corrupt.algorithm = "none"; assert.throws(() => verifyManifest(JSON.stringify(corrupt), config), /signing key/);
  assert.throws(() => verifyManifest(signed(), {...config, updatePublicKey: null}), /public key/);
});
test("even correctly signed wrong-edition/platform/repository/APK metadata is rejected", () => {
  for (const mutate of [
    m => { m.edition = "unlocked"; },
    m => { m.repository = "VdustR/pokebonk-offline"; },
    m => { m.applicationId += ".other"; },
    m => { m.artifacts["darwin-arm64"].platform = "win32-x64"; },
    m => { m.artifacts["win32-x64"].url = "https://evil.invalid/update.zip"; },
    m => { m.artifacts["android-universal"].signingCertificateSha256 = "f".repeat(64); },
    m => { m.artifacts["android-universal"].applicationId += ".unlocked"; },
    m => { m.artifacts["android-universal"].versionCode = 0; },
    m => { delete m.artifacts["darwin-x64"]; },
    m => { delete m.artifacts["linux-x64-deb"]; },
    m => { m.artifacts["win32-x64-portable"].kind = "nsis"; },
    m => { m.artifacts["linux-x64"].name += ".exe"; },
    m => { m.artifacts["darwin-arm64-zip"].sha256 = "not a hash"; },
    m => { m.artifacts["darwin-x64"].bytes = 2 ** 40; },
    m => { m.artifacts["darwin-x64"].name = "../escape.zip"; },
  ]) {
    const m = manifest(); mutate(m); assert.throws(() => verifyManifest(signed(m), config));
  }
});
test("new updater does not offer incompatible save/run migrations", () => {
  const m = manifest(), s = save(); checkSaveCompatibility(m, s);
  s.schemaVersion = 2; assert.throws(() => checkSaveCompatibility(m, s), /schema/);
  s.schemaVersion = 1; s.upstream.build = "previous-build"; s.state.activeRun = {ticket: {id: "offline-run"}, status: "running"};
  assert.throws(() => checkSaveCompatibility(m, s), /unfinished run/);
  assert.equal(compareVersions("0.10.0", "0.2.0"), 1);
});
test("download redirects reject external hosts, HTTP, credentials and unusual ports", () => {
  allowedNetworkURL("https://github.com/Nicartjay/pokebonk-offline/releases/download/standard-v0.2.0/test.zip");
  allowedNetworkURL("https://release-assets.githubusercontent.com/test?token=opaque-github-redirect");
  for (const value of ["http://github.com/x", "https://github.com.evil.invalid/x", "https://user@github.com/x", "https://github.com:444/x", "https://127.0.0.1/x", "https://github.com/x#frag"]) assert.throws(() => allowedNetworkURL(value));
});
async function directory(t) {
  const d = await mkdtemp(path.join(os.tmpdir(), "standard-update-test-"));
  t.after(() => rm(d, {recursive: true, force: true})); return d;
}
test("streamed downloads verify signed bytes/hash before promotion; failures keep the old verified file", async t => {
  const d = await directory(t), bytes = Buffer.from("valid update bytes");
  const artifact = {name: "pokebonk-standard-test.zip", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), url: "https://github.com/test"};
  const file = await downloadArtifact(artifact, d, async () => Readable.from([bytes.subarray(0, 5), bytes.subarray(5)]));
  assert.deepEqual(await readFile(file), bytes);
  for (const content of [Buffer.from("bad"), Buffer.alloc(bytes.length + 1)]) {
    await assert.rejects(downloadArtifact(artifact, d, async () => Readable.from([content])), /size|SHA-256/);
    assert.deepEqual(await readFile(file), bytes);
    assert.ok(!(await readdir(d)).some(name => name.endsWith(".part")));
  }
  await assert.rejects(downloadArtifact(artifact, d, async () => Readable.from((async function* () { yield bytes.subarray(0, 3); throw new Error("connection interrupted"); })())), /interrupted/);
  assert.deepEqual(await readFile(file), bytes);
});
test("manifest reads are bounded, regardless of Content-Length", async () => {
  await assert.rejects(fetchManifest("test", async () => Readable.from([Buffer.alloc(300 * 1024)])), /too large/);
});
test("foreground checks are throttled for 24 hours, manual checks bypass, checks never download", async t => {
  const d = await directory(t); let now = 10 * CHECK_INTERVAL, checks = 0, downloads = 0;
  const u = new StandardUpdater({config, directory: d, platform: "darwin-arm64", loadSave: async () => save(), now: () => now,
    fetch: async () => { checks++; return signed(); }, download: async () => { downloads++; return "/verified.zip"; }});
  await u.check(); assert.equal(checks, 1); assert.equal(downloads, 0);
  now += CHECK_INTERVAL - 1; assert.equal((await u.check()).skipped, true);
  await u.check(true); assert.equal(checks, 2);
  now += CHECK_INTERVAL + 1; await u.check(); assert.equal(checks, 3);
  assert.equal(downloads, 0);
  await u.downloadPending(); assert.equal(downloads, 1);
});
test("offline failed checks are throttled and do not affect installed save access", async t => {
  const d = await directory(t), bytes = JSON.stringify(save());
  await writeFile(path.join(d, "installed-save.json"), bytes);
  let calls = 0;
  const u = new StandardUpdater({config, directory: d, platform: "win32-x64", loadSave: async () => save(),
    fetch: async () => { calls++; throw new Error("offline"); }});
  await assert.rejects(u.check(), /offline/);
  assert.equal((await u.check()).skipped, true); assert.equal(calls, 1);
  assert.equal(await readFile(path.join(d, "installed-save.json"), "utf8"), bytes);
});
test("persisted highest signed version rejects rollback across process restarts", async t => {
  const d = await directory(t);
  const args = {config, directory: d, platform: "darwin-x64", loadSave: async () => save()};
  await new StandardUpdater({...args, fetch: async () => signed(manifest("0.3.0"))}).check(true);
  await assert.rejects(new StandardUpdater({...args, fetch: async () => signed(manifest("0.2.0"))}).check(true), /rolled-back/);
});
