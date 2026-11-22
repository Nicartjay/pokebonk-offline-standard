import test from "node:test";
import assert from "node:assert/strict";
import { OfflineBackend } from "../runtime/backend.js";
import {validateState} from "../common/state.mjs";

// Only browser-environment probes are stubbed. These tests execute the
// published client's real normalization/reward functions, not mocked rules.
Object.defineProperty(globalThis, "localStorage", {
  configurable: true, value: { getItem() { return null; }, setItem() {}, removeItem() {} },
});
Object.assign(globalThis, {
  window: globalThis,
  location: new URL("http://127.0.0.1:8765/"),
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
});
const rules = await import("../../build/standard-game/assets/buildshare-Dad4qqsr-mwqb4pwz.js");
const config = await import("../../build/standard-game/assets/assets-BEbT5z0g-mwqb4pwz.js");
const cosmetics = await import("../../build/standard-game/assets/cosmetics-DR7yHN4A-mwqb4pwz.js");

async function fixture() {
  let disk = null;
  const values = new Map();
  const backend = new OfflineBackend({
    rules, config, cosmetics,
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) },
    transport: {
      async load() { return structuredClone(disk); },
      async save(value) { validateState(value); disk = structuredClone(value); },
    },
    now: () => Date.UTC(2026, 10, 21, 12),
    data: () => ({
      has: id => Number.isInteger(id) && id > 0 && id <= 251,
      family: id => id >= 4 && id <= 6 ? 4 : id,
      familyTypes: () => ["fire"],
      researchGoal: () => 100,
      legendary: () => false,
    }),
  });
  const account = await backend.restore();
  await backend.chooseStarter(account, 4);
  return { backend, account, get disk() { return disk; } };
}

function result(mode = "standard", extra = {}) {
  return {
    mode, species: 4, finalSpecies: 4, biome: "forest", tier: 0, stage: 1,
    time: 65, kills: 10, damage: 100, level: 2, victory: false,
    alphas: 0, bosses: 0, legendaries: 0, reactions: 0, evolutions: 0,
    moves: ["ember"], items: [], splits: [],
    progress: { counters: {}, research: {}, seen: [4], league: [], shinies: [], classics: [], forms: [] },
    ...extra,
  };
}

for (const mode of ["standard", "endless", "relay"]) {
  test(`real ${mode} progression records a local run and rewards exactly once`, async () => {
    const f = await fixture();
    const ticket = await f.backend.startRun(f.account, { species: 4, biome: "forest", tier: 0, mode });
    const info = await f.backend.finishRun(f.account, ticket, result(mode));
    const dust = f.disk.profile.stardust;
    assert.ok(dust > 0);
    assert.equal(info.local, true);
    assert.equal(f.disk.profile.counters.runs, 1);
    assert.equal(f.disk.profile.runs.length, 1);
    assert.equal(f.disk.profile.runs[0].mode ?? "standard", mode);
    assert.equal(f.disk.profile.settings.showLadder, false);
    await f.backend.finishRun(f.account, ticket, result(mode));
    assert.equal(f.disk.profile.stardust, dust);
    assert.equal(f.disk.profile.counters.runs, 1);
  });
}

test("real Classic victory unlocks the next local difficulty and map", async () => {
  const f = await fixture();
  const ticket = await f.backend.startRun(f.account, { species: 4, biome: "forest", tier: 0, mode: "standard" });
  await f.backend.finishRun(f.account, ticket, result("standard", {
    victory: true, stage: 4, time: 600, splits: [180, 180, 180],
    level: 15, kills: 300, bosses: 3, legendaries: 1, damage: 10000,
  }));
  assert.equal(f.disk.profile.counters.wins, 1);
  assert.equal(f.disk.profile.biomes.forest, 1);
  assert.equal(f.disk.profile.biomes.desert, 0);
  assert.ok(f.disk.profile.medals["forest-0"] >= 1);
  assert.ok(f.disk.profile.times["forest-0"].time > 0);
});

test("native treasure prizes are awarded locally and retries do not charge twice", async () => {
  const f = await fixture();
  f.backend.state.profile.bonk = cosmetics.Wn * 3;
  const wheel = cosmetics.Yn("fire");
  const first = await f.backend.spinTreasure(f.account, wheel.id, 0, "native-spin-once");
  const prize = wheel.prizes.find(prize => prize.id === first.spin.prize);
  assert.ok(prize);
  assert.equal(f.disk.profile.bonk, cosmetics.Wn * 2);
  assert.deepEqual(f.disk.profile.treasures[wheel.id].won, [prize.id]);
  const retry = await f.backend.spinTreasure(f.account, wheel.id, 0, "native-spin-once");
  assert.deepEqual(retry.spin, first.spin);
  assert.equal(f.disk.profile.bonk, cosmetics.Wn * 2);
  if (prize.bag) assert.equal(f.disk.profile.bag[prize.bag.id], prize.bag.n);
  for (const id of prize.cosmetics) assert.ok(f.disk.profile.cosmetics.includes(id));
});

test("real Lab purchases enforce funds, deduct earned currency, and cannot buy past max", async () => {
  const f = await fixture();
  const upgrade = config.Z.find(upgrade => upgrade.id === "slot-move");
  await assert.rejects(f.backend.buyLab(f.account, upgrade.id), /not available/);
  f.backend.state.profile.stardust = upgrade.cost(0);
  await f.backend.buyLab(f.account, upgrade.id);
  assert.equal(f.disk.profile.stardust, 0);
  assert.equal(f.disk.profile.lab[upgrade.id], 1);
  await assert.rejects(f.backend.buyLab(f.account, upgrade.id), /not available/);
  assert.equal(f.disk.profile.lab[upgrade.id], 1);
});
test("real achievement claims cannot mint currency twice", async () => {
  const f = await fixture();
  const quest = config.rt.find(q => q.counter === "wins" && q.goal === 1);
  await assert.rejects(f.backend.claimQuest(f.account, quest.id), /not available/);
  const ticket = await f.backend.startRun(f.account, {species: 4, biome: "forest", tier: 0, mode: "standard"});
  await f.backend.finishRun(f.account, ticket, result("standard", {victory: true, stage: 4, time: 600, splits: [180, 180, 180], kills: 300, bosses: 3}));
  await f.backend.claimQuest(f.account, quest.id);
  const dust = f.disk.profile.stardust;
  await assert.rejects(f.backend.claimQuest(f.account, quest.id), /not available/);
  assert.equal(f.disk.profile.stardust, dust);
});
test("native restart resumes the last checkpoint even after a previous resume", async () => {
  const f = await fixture(), ticket = await f.backend.startRun(f.account, {species: 4, mode: "standard"});
  await f.backend.uploadSave(f.account, ticket, "hash", '{"v":1,"snapshot":"complete"}');
  await f.backend.resumeRun(f.account, ticket);
  assert.equal((await f.backend.savedOnServer()).id, ticket.id);
  assert.equal(f.disk.suspended.text, '{"v":1,"snapshot":"complete"}');
  await assert.rejects(f.backend.startRun(f.account, {species: 4, mode: "standard"}), /unfinished/);
});
