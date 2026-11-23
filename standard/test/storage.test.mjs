import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile, readdir, rm, symlink} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import os from "node:os";
import path from "node:path";
import {StateStore, atomicWrite} from "../common/store.mjs";
import {validateEnvelope, importEnvelope, envelope, MAX_STATE_BYTES} from "../common/state.mjs";
import {config, save, state} from "./fixtures.mjs";
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "standard-store-test-"));
  t.after(() => rm(directory, {recursive: true, force: true}));
  return {directory, store: new StateStore(directory, config)};
}
test("native commits preserve a previous-file backup and restart without Web Storage", async t => {
  const {directory, store} = await fixture(t);
  assert.equal(await store.loadState(), null);
  const first = save(); await store.saveState(first);
  const next = structuredClone(first); next.state.profile.stardust = 50;
  await store.saveState(next);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "previous.json"))), first);
  assert.deepEqual(await new StateStore(directory, config).loadState(), next);
  assert.ok(!(await readdir(directory)).some(name => name.endsWith(".tmp")));
});
test("a supported upstream upgrade preserves the original checkpoint as the previous-file backup", async t => {
  const {directory} = await fixture(t), previous = save(), ticket = {id: "offline-upgrade-fixture", seed: 42};
  // This tests the configured compatibility boundary, not the engine. Prior
  // production builds must be added only after actual checkpoint replay.
  const reader = {...config, compatibleRunBuilds: [...config.compatibleRunBuilds, "mwqb4pwz"]};
  const store = new StateStore(directory, reader);
  previous.upstream = {version: "0.10.20", build: "mwqb4pwz"};
  previous.state.activeRun = {ticket, status: "suspended"};
  previous.state.suspended = {ticket, text: '{"v":1,"fixture":true}', hash: "fixture", at: 123};
  assert.equal(validateEnvelope(previous, reader), previous);
  await store.saveState(previous);
  const updated = envelope(structuredClone(previous.state), config);
  await store.saveState(updated);
  assert.deepEqual(await new StateStore(directory, reader).loadState(), updated);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "previous.json"))), previous);
});
test("separate OS process reloads committed saves", async t => {
  const {directory, store} = await fixture(t); await store.saveState(save());
  const code = `import {StateStore} from ${JSON.stringify(new URL("../common/store.mjs", import.meta.url).href)};
    const store=new StateStore(${JSON.stringify(directory)},${JSON.stringify(config)});console.log((await store.loadState()).state.playerId);`;
  assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", code], {encoding: "utf8"}).trim(), "offline-test-player");
});
test("interrupted temporary writes do not damage primary or previous saves", async t => {
  const {directory, store} = await fixture(t); const first = save();
  await store.saveState(first); await store.saveState(first);
  await writeFile(path.join(directory, "state.json.interrupted.tmp"), '{"state":');
  assert.deepEqual(await new StateStore(directory, config).loadState(), first);
  assert.deepEqual(JSON.parse(await readFile(path.join(directory, "previous.json"))), first);
});
test("damaged primary fails closed, cannot fall back to fresh progress, and supports explicit recovery", async t => {
  const {directory, store} = await fixture(t), first = save();
  await store.saveState(first); await store.saveState(first);
  await writeFile(store.file, "corrupt-original");
  await assert.rejects(store.loadState(), /No save was replaced/);
  await assert.rejects(store.saveState(save()), /locked/);
  assert.equal(await readFile(store.file, "utf8"), "corrupt-original");
  await store.importState(first);
  const before = (await readdir(directory)).find(name => name.startsWith("before-import-"));
  assert.equal(await readFile(path.join(directory, before), "utf8"), "corrupt-original");
  assert.deepEqual(await store.loadState(), first);
});
test("missing primary with a backup is never treated as a new install", async t => {
  const {store} = await fixture(t);
  await atomicWrite(store.backup, JSON.stringify(save()));
  await assert.rejects(store.loadState(), /No save was replaced/);
});
test("schema and suspended-build incompatibility preserve original bytes", async t => {
  const {store} = await fixture(t), value = save();
  value.schemaVersion = 2; await writeFile(store.file, JSON.stringify(value));
  const before = await readFile(store.file, "utf8");
  await assert.rejects(store.loadState(), /schema/);
  await assert.rejects(store.saveState(save()), /locked/);
  assert.equal(await readFile(store.file, "utf8"), before);
  const pending = save();
  pending.upstream = {version: "0.9.0", build: "oldbuild"};
  const ticket = {id: "offline-saved", seed: 1};
  pending.state.activeRun = {ticket, status: "suspended"};
  pending.state.suspended = {ticket, text: "full-run", hash: "hash", at: 123};
  assert.throws(() => validateEnvelope(pending, config), /previous app version/);
});
test("explicit legacy progression imports work; unlocked/poisoned/invalid imports are rejected", () => {
  assert.equal(importEnvelope(state(), config).upstream.build, "mwqb4pwz");
  const unlocked = state(); unlocked.profile.localSandbox = true;
  assert.throws(() => importEnvelope(unlocked, config), /Unlocked/);
  assert.throws(() => importEnvelope({version: 1, profile: {}}, config));
  const wrong = save(); wrong.edition = "unlocked";
  assert.throws(() => importEnvelope(wrong, config), /edition/);
  const poison = state(); poison.stash = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => envelope(poison, config), /Unsafe/);
  const bad = state(); bad.profile.stardust = -1;
  assert.throws(() => envelope(bad, config), /balance/);
});
test("save size, symlinks and concurrent write boundaries are enforced", async t => {
  const {directory, store} = await fixture(t);
  const large = save(); large.state.stash.large = "x".repeat(MAX_STATE_BYTES);
  await assert.rejects(async () => store.saveState(large), /32 MiB/);
  const external = path.join(directory, "not-a-save");
  await writeFile(external, JSON.stringify(save()));
  await symlink(external, store.file);
  await assert.rejects(store.loadState(), /Invalid native save/);
  await rm(store.file);
  const clean = new StateStore(directory, config);
  await Promise.all([1, 2, 3].map(n => { const value = save(); value.state.updatedAt = n; return clean.saveState(value); }));
  assert.equal((await clean.loadState()).state.updatedAt, 3);
  assert.equal(JSON.parse(await readFile(clean.backup)).state.updatedAt, 2);
});
