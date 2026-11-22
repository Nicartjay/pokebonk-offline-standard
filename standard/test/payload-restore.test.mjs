import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, writeFile, readFile, rm, symlink} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {restorePayload} from "../scripts/restore-payload.mjs";
import {productionConfig} from "./fixtures.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pokebonk-restore-test-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const source = path.join(directory, "source"), output = path.join(directory, "game");
  await mkdir(path.join(source, "standard-game"), {recursive: true});
  await mkdir(output);
  await writeFile(path.join(source, "standard-game/index.html"), "new game");
  await writeFile(path.join(output, "obsolete-upstream-module.js"), "previous release");
  const archive = path.join(directory, "game.tar");
  execFileSync("tar", ["-cf", archive, "-C", source, "standard-game"]);
  const metadata = {sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim(),
    appVersion: productionConfig.version};
  return {directory, source, output, archive, metadata};
}
test("upstream payload replacement removes obsolete files and preserves the previous tree", async t => {
  const f = await fixture(t);
  await restorePayload(f.archive, {destination: f.output, verify: async root => {
    assert.equal(await readFile(path.join(root, "index.html"), "utf8"), "new game");
    return {metadata: f.metadata};
  }});
  assert.equal(await readFile(path.join(f.output, "index.html"), "utf8"), "new game");
  await assert.rejects(readFile(path.join(f.output, "obsolete-upstream-module.js")));
  assert.equal(await readFile(path.join(f.output + ".previous", "obsolete-upstream-module.js"), "utf8"), "previous release");
});
test("invalid or wrong-commit candidates do not overwrite the last accepted payload", async t => {
  const f = await fixture(t);
  await assert.rejects(restorePayload(f.archive, {destination: f.output, verify: async () => { throw new Error("invalid payload"); }}), /invalid payload/);
  await assert.rejects(restorePayload(f.archive, {destination: f.output, verify: async () => ({metadata: {...f.metadata, sourceCommit: "f".repeat(40)}})}), /another commit/);
  assert.equal(await readFile(path.join(f.output, "obsolete-upstream-module.js"), "utf8"), "previous release");
});
test("archive links and paths outside the game subtree are rejected before extraction", async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.source, "outside.txt"), "not a game file");
  execFileSync("tar", ["-cf", f.archive, "-C", f.source, "outside.txt"]);
  await assert.rejects(restorePayload(f.archive, {destination: f.output}), /Unsafe/);
  await symlink(path.join(f.output, "obsolete-upstream-module.js"), path.join(f.source, "standard-game/link.js"));
  execFileSync("tar", ["-cf", f.archive, "-C", f.source, "standard-game"]);
  await assert.rejects(restorePayload(f.archive, {destination: f.output}), /links or special/);
  assert.equal(await readFile(path.join(f.output, "obsolete-upstream-module.js"), "utf8"), "previous release");
});
