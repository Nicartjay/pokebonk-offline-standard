import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile, mkdtemp, rm, writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {DISTRIBUTIONS, PLATFORMS, artifactName, artifactURL, releasePlatform} from "../common/manifest.mjs";
import {updateDistribution, installationInstructions} from "../desktop/distribution.mjs";
import {desktopConfiguration} from "../packaging/desktop-config.mjs";
import {MAC_HELPER_SUFFIXES, validateMacBundleNames} from "../packaging/macos-bundle.mjs";
import {collectArtifacts, releaseFiles} from "../scripts/assemble-release.mjs";
import {fileHash, writeReceipt, receiptName} from "../scripts/release-files.mjs";
import {verifyReleaseFiles} from "../scripts/publish.mjs";
import {config, manifest} from "./fixtures.mjs";

test("every platform uses the approved PokéBonk name and artwork without changing save identity", async () => {
  const production = JSON.parse(await readFile("standard/config.json"));
  const pkg = JSON.parse(await readFile("package.json"));
  assert.equal(production.productName, "PokéBonk Offline");
  assert.equal(pkg.productName, production.productName);
  assert.equal(pkg.version, production.version);
  assert.equal(production.applicationId, "dev.nicartjay.pokebonk.offline.standard");
  assert.equal(production.repository, "Nicartjay/pokebonk-offline-standard");
  assert.equal(production.channelUrl, `https://github.com/${production.repository}/releases/download/standard-channel/standard-update.json`);
  const icon = await readFile("standard/resources/icon.png");
  assert.deepEqual(icon, await readFile("vendor/pokebonk-standard-0.10.20/game/icons/icon-512.png"));
  assert.equal(icon.readUInt32BE(16), 512); assert.equal(icon.readUInt32BE(20), 512);
  const c = desktopConfiguration(production, {app: "/stage", output: "/out", game: "/game", resources: "/icons", electronVersion: "45.0.0"});
  assert.equal(c.productName, production.productName);
  assert.equal(c.appId, production.applicationId);
  assert.deepEqual(c.mac.target, ["dmg", "zip"]);
  for (const arch of ["arm64", "x64"]) for (const ext of ["dmg", "zip"]) {
    const id = `darwin-${arch}${ext === "zip" ? "-zip" : ""}`;
    assert.equal(c.mac.artifactName.replace("${arch}", arch).replace("${ext}", ext), artifactName(production.version, id));
  }
  assert.deepEqual(c.win.target, ["nsis", "portable", "zip"]);
  assert.deepEqual(c.linux.target, ["AppImage", "deb"]);
  for (const os of ["mac", "win", "linux"]) assert.ok(c[os].icon.endsWith("icon.png"));
  assert.equal(c.mac.extendInfo.CFBundleDisplayName, production.productName);
  assert.equal(c.mac.extendInfo.CFBundleName, production.productName.normalize("NFD"));
  assert.equal(c.nsis.shortcutName, production.productName);
  assert.equal(c.linux.desktop.entry.Name, production.productName);
  assert.equal(c.linux.syncDesktopName, true);
  assert.equal(c.appImage.artifactName, artifactName(production.version, "linux-x64"));
  assert.equal(c.deb.artifactName, artifactName(production.version, "linux-x64-deb"));
  assert.equal(c.nsis.deleteAppDataOnUninstall, false);
  assert.equal(c.win.signAndEditExecutable, true); // false would leave Electron's icon.
  assert.equal(c.publish, null);
  const gradle = await readFile("standard/android/app/build.gradle.kts", "utf8");
  assert.match(gradle, /providers\.fileContents\(/);
  assert.match(gradle, /layout\.projectDirectory\.file\("\.\.\/config\.json"\)/);
  assert.match(gradle, /resValue\("string", "app_name", standard\["productName"\]/);
  assert.match(gradle, /applicationId = standard\["applicationId"\]/);
  assert.match(gradle, /this\.storePassword = signingStorePassword/);
  assert.match(gradle, /this\.keyAlias = signingKeyAlias/);
  assert.doesNotMatch(gradle, /this\.(\w+) = \1\b/);
  const stage = await readFile("standard/scripts/stage-android.mjs", "utf8");
  assert.match(stage, /updateDistributions: DISTRIBUTIONS/);
  assert.match(stage, /standard\/resources\/icon\.png/);
});

test("macOS rejects visually identical bundle/helper names with different Unicode bytes", () => {
  const productName = "PokéBonk Offline", internal = productName.normalize("NFD");
  const helpers = Object.fromEntries(MAC_HELPER_SUFFIXES.map(suffix =>
    [suffix, {bundle: `${internal}${suffix}.app`, executable: internal + suffix}]));
  const identity = {name: internal, displayName: productName, executable: internal, helpers};
  validateMacBundleNames(productName, identity);
  assert.throws(() => validateMacBundleNames(productName, {...identity, name: productName}), /Unicode/);
  assert.throws(() => validateMacBundleNames(productName, {...identity, executable: productName}), /Unicode/);
  assert.throws(() => validateMacBundleNames(productName, {...identity,
    helpers: {...helpers, " Helper (GPU)": {bundle: `${productName} Helper (GPU).app`, executable: productName + " Helper (GPU)"}}}), /helper/);
  assert.throws(() => validateMacBundleNames(productName, {...identity, helpers: {}}), /helper/);
});

test("installer, portable, ZIP, AppImage and DEB updates select the matching distribution", () => {
  assert.equal(updateDistribution({platform: "darwin", arch: "arm64"}), "darwin-arm64");
  assert.equal(updateDistribution({platform: "darwin", arch: "x64"}), "darwin-x64");
  assert.equal(updateDistribution({platform: "win32", arch: "x64", nsisInstalled: true}), "win32-x64");
  assert.equal(updateDistribution({platform: "win32", arch: "x64"}), "win32-x64-zip");
  assert.equal(updateDistribution({platform: "win32", arch: "x64", env: {PORTABLE_EXECUTABLE_FILE: "portable.exe"}}), "win32-x64-portable");
  assert.equal(updateDistribution({platform: "linux", arch: "x64", env: {APPIMAGE: "/game.AppImage"}}), "linux-x64");
  assert.equal(updateDistribution({platform: "linux", arch: "x64"}), "linux-x64-deb");
  for (const kind of ["dmg", "zip", "nsis", "portable", "AppImage", "deb"]) assert.match(installationInstructions(kind), /Nothing is installed automatically/);
  assert.throws(() => installationInstructions("arbitrary-command"));
  const names = Object.keys(DISTRIBUTIONS).map(id => artifactName("0.2.0", id));
  assert.equal(new Set(names).size, 10);
  assert.ok(names.every(name => /^[A-Za-z0-9_.-]+$/.test(name)));
});

test("macOS downloads and receipt filenames are readable without changing internal platform IDs", () => {
  const expected = {
    "darwin-arm64": "pokebonk-offline-0.2.0-macos-arm64.dmg",
    "darwin-arm64-zip": "pokebonk-offline-0.2.0-macos-arm64.zip",
    "darwin-x64": "pokebonk-offline-0.2.0-macos-x64.dmg",
    "darwin-x64-zip": "pokebonk-offline-0.2.0-macos-x64.zip",
  };
  for (const [id, name] of Object.entries(expected)) {
    assert.equal(artifactName("0.2.0", id), name);
    assert.ok(DISTRIBUTIONS[id].platform.startsWith("darwin-"));
    assert.ok(artifactURL(config, "0.2.0", name).endsWith("/" + name));
  }
  for (const arch of ["arm64", "x64"]) {
    assert.equal(releasePlatform(`darwin-${arch}`), `macos-${arch}`);
    assert.equal(receiptName(`darwin-${arch}`), `macos-${arch}.json`);
  }
  for (const platform of ["win32-x64", "linux-x64", "android-universal"]) {
    assert.equal(releasePlatform(platform), platform);
    assert.equal(receiptName(platform), `${platform}.json`);
  }
  assert.throws(() => releasePlatform("../darwin-arm64"), /Unsupported/);
});

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pokebonk-release-test-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const c = {...config, version: "0.2.0"}, m = manifest(c.version), payload = Buffer.from("packaged fixture bytes");
  for (const [id, artifact] of Object.entries(m.artifacts)) {
    artifact.bytes = payload.length; artifact.sha256 = createHash("sha256").update(payload).digest("hex");
    await writeFile(path.join(directory, artifact.name), payload);
  }
  for (const platform of PLATFORMS) {
    const artifacts = Object.fromEntries(Object.entries(m.artifacts).filter(([, a]) => a.platform === platform).map(([id, {url, ...a}]) => [id, a]));
    await writeReceipt(directory, platform, c, m.source.gameDigest, artifacts);
  }
  return {directory, c, m};
}
test("all ten formats are hashed and mixed-version/payload receipts fail closed", async t => {
  const {directory, c, m} = await fixture(t);
  assert.deepEqual(await collectArtifacts(directory, c, m.source.gameDigest), m.artifacts);
  await assert.rejects(collectArtifacts(directory, c, "f".repeat(64)), /Different game payload/);
  await assert.rejects(collectArtifacts(directory, {...c, version: "0.3.0"}, m.source.gameDigest), /Different game payload/);
  await writeFile(path.join(directory, m.artifacts["win32-x64-portable"].name), "bad download");
  await assert.rejects(collectArtifacts(directory, c, m.source.gameDigest), /hash\/size mismatch/);
});
test("a missing supplemental format cannot be assembled or published", async t => {
  const {directory, c, m} = await fixture(t);
  const file = path.join(directory, "linux-x64.json"), receipt = JSON.parse(await readFile(file));
  delete receipt.artifacts["linux-x64-deb"];
  await writeFile(file, JSON.stringify(receipt));
  await assert.rejects(collectArtifacts(directory, c, m.source.gameDigest), /Incomplete receipt/);
});
test("checksums cover installers, platform receipts, signed metadata and corresponding source", async t => {
  const {directory, c, m} = await fixture(t);
  assert.ok(releaseFiles(c, m.artifacts).every(name => !name.includes("darwin")));
  await writeFile(path.join(directory, "standard-provenance.json"), JSON.stringify(m));
  await writeFile(path.join(directory, "standard-update.json"), "signed envelope fixture");
  await writeFile(path.join(directory, `pokebonk-offline-${c.version}-source.zip`), "corresponding source fixture");
  const sums = [];
  for (const name of releaseFiles(c, m.artifacts).sort()) sums.push(`${await fileHash(path.join(directory, name))}  ${name}`);
  await writeFile(path.join(directory, "SHA256SUMS.txt"), sums.join("\n") + "\n");
  await verifyReleaseFiles(directory, c, m);
  await writeFile(path.join(directory, `pokebonk-offline-${c.version}-source.zip`), "corrupt source");
  await assert.rejects(verifyReleaseFiles(directory, c, m), /checksum/);
});
test("unsafe/stale artifact names are rejected before any release-file read", async t => {
  const {directory, c, m} = await fixture(t);
  const file = path.join(directory, receiptName("darwin-arm64")), receipt = JSON.parse(await readFile(file));
  receipt.artifacts["darwin-arm64"].name = "../outside.dmg";
  await writeFile(file, JSON.stringify(receipt));
  await assert.rejects(collectArtifacts(directory, c, m.source.gameDigest), /Invalid release artifact/);
  assert.throws(() => artifactName("0.2.0", "wrong-platform"), /Unknown/);
  assert.throws(() => artifactURL(c, "0.2.0", "../escape"), /Unsafe/);
});
