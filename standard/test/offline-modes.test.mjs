import test from "node:test";
import assert from "node:assert/strict";
import {OfflineBackend} from "../runtime/backend.js";
import {validateState} from "../common/state.mjs";
import {readFile} from "node:fs/promises";
import {OFFLINE_EVENTS} from "../runtime/modes.js";
import {EVENT_POLICY} from "../runtime/event-rewards.js";

Object.assign(globalThis, {window: globalThis, location: new URL("http://127.0.0.1:8765/"),
  addEventListener() {}, removeEventListener() {},
  localStorage: {getItem() { return null; }, setItem() {}, removeItem() {}},
  matchMedia: () => ({matches: false, addEventListener() {}, addListener() {}})});
const metadata = JSON.parse(await readFile("build/standard-game/offline-build.json", "utf8"));
const module = role => import(new URL("../../build/standard-game/" + metadata.modules[role], import.meta.url));
const rules = await module("backendRules"), config = await module("backendConfig"),
  cosmetics = await module("backendCosmetics"), modes = await module("backendModes");
async function fixture() {
  let disk = null, now = Date.UTC(2026, 10, 22, 12), fail = false;
  const runtime = {rules, config, cosmetics, modes, now: () => now,
    storage: {setItem() {}},
    transport: {async load() { return structuredClone(disk); },
      async save(value) { if (fail) throw new Error("disk full"); validateState(value); disk = structuredClone(value); }},
    data: () => ({has: id => id > 0 && id <= 251, family: id => id >= 4 && id <= 6 ? 4 : id,
      familyTypes: () => ["fire"], researchGoal: () => 100, legendary: () => false})};
  const backend = new OfflineBackend(runtime), account = await backend.restore();
  await backend.chooseStarter(account, 4);
  return {backend, account, runtime, get disk() { return disk; },
    set now(value) { now = value; }, set fail(value) { fail = value; }};
}
const result = (mode, values = {}) => ({mode, species: 4, finalSpecies: 4,
  biome: mode === "bossrush" ? "newisland" : mode === "tower" ? "graveyard" : "forest",
  tier: 0, stage: 4, time: 600, kills: 200, damage: 10000, level: 15, victory: true,
  bosses: 5, legendaries: 3, alphas: 0, reactions: 0, evolutions: 0,
  moves: ["ember"], items: [], splits: [180, 360, 540],
  progress: {counters: {}, research: {}, seen: [], league: [], shinies: [], classics: [], forms: []},
  ...(mode === "bossrush" ? {rush: {beaten: 5, zone: 10, done: true, week: 2, prep: 100}} : {}),
  ...(mode === "tower" ? {stage: 8, splits: [60, 120, 180, 240, 300, 360, 420],
    tower: {wave: 3, curses: [], marowak: true, won: true, reveals: 200, tricks: 5, candles: 10, offerings: []}} : {}),
  ...values});
for (const mode of ["bossrush", "tower"]) {
  test(`${mode} earns local progression and exact event points once, even after the online event expires`, async () => {
    const f = await fixture();
    await f.backend.change(profile => { profile.bag["rare-candy"] = 2; });
    const before = structuredClone(f.disk.profile);
    f.now = Date.UTC(2030, 0, 1); // Well outside the original online event window.
    assert.equal(f.backend.events().find(event => event.mode === mode).live, true);
    assert.ok(f.backend.events().every(event => event.local && event.claimable));
    const ticket = await f.backend.startRun(f.account, {species: 4, mode, boosts: ["rare-candy"]});
    assert.equal(ticket.ranked, true); assert.equal(ticket.clean, true);
    assert.equal(ticket.eventPolicy, EVENT_POLICY);
    assert.deepEqual(ticket.boosts, []);
    const finished = result(mode);
    const info = await f.backend.finishRun(f.account, ticket, finished);
    assert.equal(info.localEventRewards, true); assert.equal(info.ranked, true); assert.equal(info.local, true);
    assert.ok(info.stardust > 0);
    assert.equal(f.disk.profile.stardust - before.stardust, info.stardust);
    assert.equal(f.disk.profile.counters.runs, (before.counters.runs ?? 0) + 1);
    assert.equal(f.disk.profile.bag["rare-candy"], 2);
    for (const local of OFFLINE_EVENTS) {
      const def = modes.eventDefinitions.find(event => event.id === local.id);
      const expected = Math.max(0, Math.round(def.pointsFor(finished)));
      assert.equal(f.disk.profile.events[local.id].pts, expected);
      assert.equal(info.events.find(event => event.id === local.id).gained, expected);
      for (const [key, value] of Object.entries(def.countersFor(finished))) {
        assert.equal(f.disk.profile.events[local.id].c[key] ?? 0, value);
      }
    }
    assert.equal(f.disk.activeRun, null);
    assert.equal(f.backend.recordsLocal("kos")[0].mode, mode);
    assert.equal(f.backend.recordsLocal("time").length, mode === "bossrush" ? 1 : 0);
    const settled = structuredClone(f.disk);
    await f.backend.finishRun(f.account, ticket, result(mode));
    assert.deepEqual(f.disk, settled, "A retry cannot award currency, event points or records twice.");
    assert.equal(f.backend.recordsLocal("kos").length, 1);
  });
  test(`${mode} legacy records-only tickets retain their original no-reward policy`, async () => {
    const f = await fixture();
    const ticket = await f.backend.startRun(f.account, {species: 4, mode});
    await f.backend.change(() => { delete f.backend.state.activeRun.ticket.eventPolicy; });
    const before = structuredClone(f.disk.profile);
    const info = await f.backend.finishRun(f.account, ticket, result(mode));
    assert.equal(info.offlineChallenge, true); assert.equal(info.ranked, false);
    assert.equal(info.stardust, 0); assert.equal(info.bonk, 0); assert.deepEqual(info.events, []);
    assert.deepEqual(f.disk.profile, before, "An imported legacy event must never gain retroactive rewards.");
    assert.equal(f.backend.recordsLocal("kos")[0].mode, mode);
    await f.backend.finishRun(f.account, ticket, result(mode));
    assert.deepEqual(f.disk.profile, before);
  });
  test(`${mode} pass and mission claims enforce earning, persist, and cannot be duplicated`, async () => {
    const f = await fixture(), local = OFFLINE_EVENTS.find(event => event.mode === mode);
    const def = modes.eventDefinitions.find(event => event.id === local.id);
    await assert.rejects(f.backend.claimEventTrack(f.account, local.id, 0), /Earn more/);
    await assert.rejects(f.backend.claimEventQuest(f.account, local.id, def.quests[0].id), /Complete/);
    const ticket = await f.backend.startRun(f.account, {species: 4, mode});
    await f.backend.finishRun(f.account, ticket, result(mode));
    assert.ok(f.disk.profile.events[local.id].pts >= def.track[0].at);
    const before = structuredClone(f.disk.profile);
    await f.backend.claimEventTrack(f.account, local.id, 0);
    await f.backend.claimEventQuest(f.account, local.id, def.quests[0].id);
    const rewards = [def.track[0].reward, def.quests[0].reward];
    assert.equal(f.disk.profile.stardust - before.stardust, rewards.reduce((total, reward) => total + (reward.dust ?? 0), 0));
    for (const reward of rewards) for (const id of reward.cosmetics ?? []) assert.ok(f.disk.profile.cosmetics.includes(id));
    const claimed = structuredClone(f.disk);
    await assert.rejects(f.backend.claimEventTrack(f.account, local.id, 0), /already claimed/);
    await assert.rejects(f.backend.claimEventQuest(f.account, local.id, def.quests[0].id), /already claimed/);
    assert.deepEqual(f.disk, claimed);
    const next = new OfflineBackend(f.runtime);
    await next.restore();
    assert.deepEqual(next.state.profile.events, claimed.profile.events);
    await assert.rejects(next.claimEventTrack(f.account, local.id, 0), /already claimed/);
    await assert.rejects(next.claimEventQuest(f.account, local.id, def.quests[0].id), /already claimed/);
  });
  test(`${mode} failed writes roll back event settlement and claims; simultaneous claims award once`, async () => {
    const f = await fixture(), local = OFFLINE_EVENTS.find(event => event.mode === mode);
    const ticket = await f.backend.startRun(f.account, {species: 4, mode});
    const active = structuredClone(f.disk);
    f.fail = true;
    await assert.rejects(f.backend.finishRun(f.account, ticket, result(mode)), /disk full/);
    assert.deepEqual(f.backend.state, active);
    assert.deepEqual(f.disk, active);
    f.fail = false;
    await f.backend.finishRun(f.account, ticket, result(mode));
    const before = structuredClone(f.disk);
    f.fail = true;
    await assert.rejects(f.backend.claimEventTrack(f.account, local.id, 0), /disk full/);
    assert.deepEqual(f.backend.state, before);
    assert.deepEqual(f.disk, before);
    f.fail = false;
    const claims = await Promise.allSettled([
      f.backend.claimEventTrack(f.account, local.id, 0), f.backend.claimEventTrack(f.account, local.id, 0),
    ]);
    assert.equal(claims.filter(claim => claim.status === "fulfilled").length, 1);
    assert.equal(claims.filter(claim => claim.status === "rejected").length, 1);
    assert.deepEqual(f.disk.profile.events[local.id].got, [0]);
  });
}
test("a forged event result cannot masquerade as Classic to receive normal rewards", async () => {
  const f = await fixture(), ticket = await f.backend.startRun(f.account, {species: 4, mode: "bossrush"});
  await assert.rejects(f.backend.finishRun(f.account, ticket, result("standard")), /does not match/);
  assert.equal(f.disk.profile.stardust, 10000);
  assert.equal(f.disk.activeRun.ticket.id, ticket.id);
});
test("Daily Mutation uses the upstream on-device rotation/seed and keeps earned progression local", async () => {
  const f = await fixture(), daily = f.backend.dailyChallenge();
  const before = f.disk.profile.stardust;
  assert.deepEqual(f.backend.dailyChallenge(), daily);
  await f.backend.change(profile => { profile.bag["rare-candy"] = 2; });
  const ticket = await f.backend.startRun(f.account, {species: 4, mode: "mutation",
    biome: daily.biome, tier: daily.mutation.tier, boosts: ["rare-candy"], mutation: "forged"});
  assert.equal(ticket.seed, daily.seed);
  assert.equal(ticket.mutation, daily.mutation.id);
  assert.deepEqual(ticket.boosts, []);
  const info = await f.backend.finishRun(f.account, ticket, result("mutation", {
    biome: daily.biome, tier: daily.mutation.tier, mutation: daily.mutation.id,
  }));
  assert.equal(info.local, true); assert.equal(info.ranked, true, "This is progression eligibility, not online ranking.");
  assert.ok(f.disk.profile.stardust > before);
  assert.equal(f.disk.profile.counters.runs, 1);
  assert.equal(f.disk.profile.bag["rare-candy"], 2);
  assert.equal(f.backend.recordsLocal()[0].mutation, daily.mutation.id);
  const balance = f.disk.profile.stardust;
  await f.backend.finishRun(f.account, ticket, result("mutation"));
  assert.equal(f.disk.profile.stardust, balance, "Retry cannot award mutation milestones twice.");
});
test("unreviewed event IDs, rewards, missions, policies and Expedition never award or replace progress", async () => {
  const f = await fixture(), before = structuredClone(f.disk);
  for (const id of ["expedicion26", "unknown", "__proto__"]) {
    await assert.rejects(f.backend.claimEventTrack(f.account, id, 0), /Unknown or unsupported/);
    await assert.rejects(f.backend.claimEventQuest(f.account, id, "out1"), /Unknown or unsupported/);
  }
  for (const index of [-2, 0.5, 100000]) await assert.rejects(f.backend.claimEventTrack(f.account, "rush26", index), /Unknown/);
  await assert.rejects(f.backend.claimEventQuest(f.account, "rush26", "invented"), /Unknown/);
  await assert.rejects(f.backend.startRun(f.account, {species: 4, mode: "expedition"}), /local single-player/);
  assert.deepEqual(f.disk, before);
  const ticket = await f.backend.startRun(f.account, {species: 4, mode: "bossrush"});
  await f.backend.change(() => { f.backend.state.activeRun.ticket.eventPolicy = "future-policy"; });
  const preserved = structuredClone(f.disk);
  await assert.rejects(f.backend.finishRun(f.account, ticket, result("bossrush")), /original app version/);
  assert.deepEqual(f.disk, preserved);
});
test("record settlement is atomic with native progress and survives restart/export/import", async () => {
  const f = await fixture(), ticket = await f.backend.startRun(f.account, {species: 4, mode: "standard", biome: "forest", tier: 0});
  f.fail = true;
  await assert.rejects(f.backend.finishRun(f.account, ticket, result("standard")), /disk full/);
  assert.equal(f.backend.recordsLocal().length, 0);
  assert.equal(f.backend.state.activeRun.ticket.id, ticket.id);
  f.fail = false;
  await f.backend.finishRun(f.account, ticket, result("standard"));
  const next = new OfflineBackend(f.runtime);
  await next.restore();
  const records = next.recordsLocal();
  assert.equal(records.length, 1);
  const backup = await next.exportSave();
  const other = await fixture();
  await other.backend.importSave(backup);
  assert.deepEqual(other.backend.recordsLocal(), records);
  const invalid = structuredClone(backup);
  invalid.records.version = 100;
  const original = structuredClone(other.disk);
  await assert.rejects(other.backend.importSave(invalid), /record/);
  assert.deepEqual(other.disk, original, "An incompatible import must not replace the current save.");
  const corrupt = structuredClone(backup);
  Object.values(corrupt.records.kos)[0].variant = {not: "display text"};
  await assert.rejects(other.backend.importSave(corrupt), /record/);
  assert.deepEqual(other.disk, original, "Malformed display metadata must be rejected before replacing a save.");
});
test("Daily Mutation rejects a changed ruleset and all runs reject server-dependent flags", async () => {
  const f = await fixture(), daily = f.backend.dailyChallenge();
  await assert.rejects(f.backend.startRun(f.account, {species: 4, mode: "mutation", biome: "wrong", tier: 0}), /changed/);
  for (const extra of [{party: "remote"}, {coop: true}, {competitive: true}, {duel: "x"}, {scav: true}]) {
    await assert.rejects(f.backend.startRun(f.account, {species: 4, mode: "standard", ...extra}), /local single-player/);
  }
  f.now = Date.UTC(2026, 10, 24, 12);
  assert.notEqual(f.backend.dailyChallenge().day, daily.day);
  assert.equal(f.disk.activeRun, null);
});
test("compatible original schema-1 tickets without config still settle original modes, never invented event rules", async () => {
  const f = await fixture(), ticket = await f.backend.startRun(f.account, {species: 4, mode: "standard", biome: "forest", tier: 0});
  await f.backend.change(() => { delete f.backend.state.activeRun.ticket.config; });
  await assert.rejects(f.backend.finishRun(f.account, ticket, result("bossrush")), /original app version/);
  assert.equal(f.disk.activeRun.ticket.id, ticket.id);
  const info = await f.backend.finishRun(f.account, ticket, result("standard"));
  assert.equal(info.local, true);
  assert.ok(f.disk.profile.stardust > 0);
  assert.equal(f.disk.profile.counters.runs, 1);
});
