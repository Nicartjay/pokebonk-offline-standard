import test from "node:test";
import assert from "node:assert/strict";
import { OfflineBackend } from "../runtime/backend.js";

function fixture(options = {}) {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  let disk = null;
  const writes = [];
  const transport = {
    async load() { return structuredClone(disk); },
    async save(value) { disk = structuredClone(value); writes.push(structuredClone(value)); },
  };
  const base = {
    name: "Player", starter: 0, starterJ: 0, league: [], unlocked: [], seen: [], captured: {},
    settings: {}, bag: {}, stardust: 0, totalStardust: 0, bonk: 0, cosmetics: [], treasures: {},
    lab: {}, biomes: { forest: 0 }, runs: [], counters: {},
  };
  const rules = {
    wn: value => ({ ...structuredClone(base), ...value }),
    Jt(profile, id) {
      if (profile.stardust < 10) return false;
      profile.stardust -= 10; profile.lab[id] = (profile.lab[id] ?? 0) + 1; return true;
    },
    Ut(profile, result, data, context) {
      profile.counters.runs = (profile.counters.runs ?? 0) + 1;
      profile.stardust += 25;
      const record = { id: context.id, ...result };
      profile.runs.unshift(record);
      return { record, stardust: 25 };
    },
  };
  const runtime = {
    data: () => ({ has: () => true }), rules, config: { Nr: new Map(), Wn: () => ({ n: 3 }) },
    cosmetics: {}, storage, transport, now: () => 123456789,
    ...options,
  };
  return { backend: new OfflineBackend(runtime), runtime, writes, get disk() { return disk; } };
}

test("creates a local player without authentication or an official API", async () => {
  const f = fixture();
  const account = await f.backend.restore();
  assert.equal(f.backend.kind, "local");
  assert.equal(account.local, true);
  assert.equal(account.guest, false);
  assert.equal(account.token, undefined);
  assert.equal(f.disk.profile.starter, 0);
  assert.ok(f.writes.length > 0);
});

test("starter choices and progress survive a new backend instance", async () => {
  const f = fixture();
  const account = await f.backend.restore();
  const profile = await f.backend.chooseStarter(account, 4);
  assert.deepEqual(profile.league, [4]);
  const next = new OfflineBackend(f.runtime);
  assert.equal((await next.loadProfile()).starter, 4);
  assert.equal((await next.restore()).id, account.id);
  await assert.rejects(next.chooseStarter(account, 1), /available starter/);
  assert.equal((await next.chooseStarter(account, 155)).starterJ, 155);
});

test("preference saves do not accept client balance changes", async () => {
  const f = fixture();
  const account = await f.backend.restore();
  await f.backend.savePrefs(account, { settings: { music: 0.4 }, stardust: 9999999, lastBiome: "forest" });
  const profile = await f.backend.loadProfile();
  assert.equal(profile.settings.music, 0.4);
  assert.equal(profile.stardust, 0);
});

test("local actions are serialized and failed actions roll back", async () => {
  const f = fixture();
  const account = await f.backend.restore();
  f.backend.state.profile.stardust = 25;
  await Promise.all([f.backend.buyLab(account, "power"), f.backend.buyLab(account, "power")]);
  await assert.rejects(f.backend.buyLab(account, "power"), /not available/);
  const profile = await f.backend.loadProfile();
  assert.equal(profile.lab.power, 2);
  assert.equal(profile.stardust, 5);
  assert.equal((await f.backend.exportSave()).profile.stardust, 5);
});

test("run tickets are local and an end result is applied only once", async () => {
  const f = fixture();
  const account = await f.backend.restore();
  await f.backend.chooseStarter(account, 4);
  f.backend.state.profile.bag["rare-candy"] = 2;
  const ticket = await f.backend.startRun(account, { species: 4, biome: "forest", tier: 0, mode: "standard", boosts: ["rare-candy"] });
  assert.ok(ticket.id.startsWith("offline-"));
  assert.equal(ticket.offline, false);
  assert.equal(f.backend.state.profile.bag["rare-candy"], 1);
  await f.backend.finishRun(account, ticket, { kills: 4, time: 60 });
  await f.backend.finishRun(account, ticket, { kills: 4, time: 60 });
  const profile = await f.backend.loadProfile();
  assert.equal(profile.counters.runs, 1);
  assert.equal(profile.stardust, 25);
  assert.equal(profile.runs.length, 1);
});

test("online and server-managed modes cannot start", async () => {
  const f = fixture();
  const account = await f.backend.restore();
  await f.backend.chooseStarter(account, 4);
  for (const mode of ["duel", "coop", "expedition", "bossrush"]) {
    await assert.rejects(f.backend.startRun(account, { species: 4, mode }), /local single-player/);
  }
});

test("explicitly suspended games are portable in the local save file", async () => {
  const f = fixture();
  const account = await f.backend.restore();
  await f.backend.chooseStarter(account, 4);
  const ticket = await f.backend.startRun(account, { species: 4, mode: "standard" });
  await f.backend.suspendRun(account, ticket);
  await f.backend.uploadSave(account, ticket, "test-hash", '{"v":1,"local":true}');
  const next = new OfflineBackend(f.runtime);
  await next.restore();
  assert.equal((await next.savedOnServer()).id, ticket.id);
  assert.equal((await next.downloadSave(account, ticket.id)).text, '{"v":1,"local":true}');
});

test("profile backup export/import is validated", async () => {
  const f = fixture();
  const account = await f.backend.restore();
  await f.backend.chooseStarter(account, 7);
  const backup = await f.backend.exportSave();
  await assert.rejects(f.backend.importSave({ profile: {} }), /backup/);
  await f.backend.renameLocal("Local Trainer");
  await f.backend.importSave(backup);
  assert.equal((await f.backend.loadProfile()).name, "Player");
  assert.equal((await f.backend.loadProfile()).starter, 7);
});

test("an unreadable save is not replaced by a fresh player", async () => {
  let writes = 0;
  const f = fixture({ transport: {
    async load() { throw new Error("Unreadable save"); },
    async save() { writes++; },
  } });
  await assert.rejects(f.backend.restore(), /not been overwritten/);
  assert.equal(writes, 0);
});

test("a failed durable native write rolls back a purchase even when browser storage works", async () => {
  const f = fixture();
  const account = await f.backend.restore();
  f.backend.state.profile.stardust = 20;
  f.runtime.transport.save = async () => { throw new Error("disk full"); };
  await assert.rejects(f.backend.buyLab(account, "power"), /disk full/);
  assert.equal(f.backend.state.profile.stardust, 20);
  assert.equal(f.backend.state.profile.lab.power, undefined);
});
test("a retired or forged run ticket cannot claim additional rewards", async () => {
  const f = fixture(), account = await f.backend.restore();
  await f.backend.chooseStarter(account, 4);
  await assert.rejects(f.backend.finishRun(account, {id: "offline-forged"}, {kills: 1, time: 60}), /active local run/);
  assert.equal(f.backend.state.profile.stardust, 0);
});
