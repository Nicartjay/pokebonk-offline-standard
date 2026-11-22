import test from "node:test";
import assert from "node:assert/strict";
import {crc32} from "node:zlib";
import {createHash} from "node:crypto";
import {mkdtemp, writeFile, readFile, readdir, rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {auditAPKEntries} from "../scripts/apk-payload.mjs";
import {unsignedAPKName} from "../scripts/android-artifacts.mjs";
import {verifyUnsignedCandidate, requireCandidateRun} from "../scripts/verify-candidates.mjs";
import {artifactName, validateArtifact, artifactURL} from "../common/manifest.mjs";
import {config} from "./fixtures.mjs";

const sha = data => createHash("sha256").update(data).digest("hex");
// Tiny stored ZIP fixtures; production archives are read by the pinned ZIP library.
function zip(entries) {
  const bodies = [], central = [];
  let offset = 0, directorySize = 0;
  for (const [name, input] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(input), crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(33, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(33, 14); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28); entry.writeUInt32LE(offset, 42);
    bodies.push(local, filename, data); central.push(entry, filename);
    offset += local.length + filename.length + data.length; directorySize += entry.length + filename.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directorySize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...bodies, ...central, end]);
}
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pokebonk-apk-audit-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const expected = new Map([["index.html", Buffer.from("game")], ["offline/app.js", Buffer.from("export{}")]]
    .map(([name, data]) => [name, {bytes: data.length, sha256: sha(data)}]));
  const native = {edition: "standard", repository: config.repository, publicMaterialOnly: true};
  const entries = [["assets/www/index.html", "game"], ["assets/www/offline/app.js", "export{}"],
    ["assets/standard-config.json", JSON.stringify(native)], ["classes.dex", "native-code-fixture"]];
  const file = path.join(directory, "candidate.apk");
  await writeFile(file, zip(entries));
  return {directory, expected, native, entries, file};
}
test("APK audit streams and verifies every bundled game byte without extracting files", async t => {
  const f = await fixture(t);
  await auditAPKEntries(f.file, f.expected, f.native);
  assert.deepEqual(await readdir(f.directory), ["candidate.apk"]);
});
test("changed, extra, missing, duplicate and wrong-native-config APK entries are rejected", async t => {
  const f = await fixture(t);
  const cases = [
    [["assets/www/index.html", "evil"], ...f.entries.slice(1)],
    [...f.entries, ["assets/www/remote-loader.js", "unreviewed"]],
    f.entries.filter(([name]) => !name.endsWith("app.js")),
    [...f.entries, f.entries[0]],
    f.entries.map(([name, value]) => [name, name.endsWith("standard-config.json") ? '{"edition":"unlocked"}' : value]),
    f.entries.map(([name, value]) => [name, name.endsWith("standard-config.json") ? "x".repeat(65537) : value]),
  ];
  for (const entries of cases) {
    await writeFile(f.file, zip(entries));
    await assert.rejects(auditAPKEntries(f.file, f.expected, f.native), /APK|Duplicate|Incomplete/);
  }
});
test("unsigned candidates have a separate identity and can never pass the release artifact contract", async t => {
  const f = await fixture(t), name = unsignedAPKName(config), bytes = await readFile(f.file);
  await writeFile(path.join(f.directory, name), bytes);
  const verified = {metadata: {sourceCommit: "b".repeat(40)}, inventory: {gameDigest: "d".repeat(64)}};
  const receipt = {candidateVersion: 1, edition: "standard", applicationId: config.applicationId, productName: config.productName,
    version: config.version, versionCode: config.androidVersionCode, sourceCommit: verified.metadata.sourceCommit,
    gameDigest: verified.inventory.gameDigest,
    artifact: {name, kind: "apk-unsigned", platform: "android-universal", bytes: bytes.length, sha256: sha(bytes)}};
  await writeFile(path.join(f.directory, "android-unsigned.json"), JSON.stringify(receipt));
  await verifyUnsignedCandidate(f.directory, config, verified);
  assert.throws(() => validateArtifact({...receipt.artifact, url: artifactURL(config, config.version, name)}, "android-universal", config, config.version));
  receipt.artifact.name = artifactName(config.version, "android-universal");
  await writeFile(path.join(f.directory, "android-unsigned.json"), JSON.stringify(receipt));
  await assert.rejects(verifyUnsignedCandidate(f.directory, config, verified), /identity/);
});
test("local signing only accepts successful owned installer runs for the exact clean-source commit", () => {
  const head = "b".repeat(40), repository = config.repository;
  const run = {head_sha: head, repository: {full_name: repository}, head_repository: {full_name: repository},
    status: "completed", conclusion: "success", path: ".github/workflows/build-release.yml", event: "workflow_dispatch"};
  requireCandidateRun(run, head, repository);
  for (const change of [{head_sha: "c".repeat(40)}, {conclusion: "failure"}, {status: "in_progress"}, {event: "pull_request"},
    {path: ".github/workflows/untrusted.yml"}, {head_repository: {full_name: "other/fork"}}]) {
    assert.throws(() => requireCandidateRun({...run, ...change}, head, repository), /exact reviewed commit/);
  }
});
