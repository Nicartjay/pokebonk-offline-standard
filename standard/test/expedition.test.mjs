import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {OfflineBackend} from "../runtime/backend.js";
import {validateState} from "../common/state.mjs";
import {EXPEDITION_POLICY} from "../runtime/expedition.js";

Object.assign(globalThis, {window: globalThis, location: new URL("http://127.0.0.1:8765/"),
  addEventListener() {}, removeEventListener() {},
  localStorage: {getItem() { return null; }, setItem() {}, removeItem() {}},
  matchMedia: () => ({matches: false, addEventListener() {}, addListener() {}})});
const metadata = JSON.parse(await readFile("build/standard-game/offline-build.json", "utf8"));
const load = role => import(new URL("../../build/standard-game/" + metadata.modules[role], import.meta.url));
const [rules, config, cosmetics, modes, expedition] = await Promise.all(
  ["backendRules", "backendConfig", "backendCosmetics", "backendModes", "backendExpedition"].map(load));
async function fixture() {
  let disk = null, fail = false, now = Date.UTC(2026, 10, 23, 12);
  const runtime = {rules, config, cosmetics, modes, expedition, now: () => now, storage: {setItem() {}},
    data: () => ({has: id => id > 0 && id <= 251, family: id => id >= 4 && id <= 6 ? 4 : id,
      familyTypes: () => ["fire"], researchGoal: () => 100, legendary: () => false}),
    transport: {async load() { return structuredClone(disk); },
      async save(value) { if (fail) throw Error("disk full"); validateState(value); disk = structuredClone(value); }}};
  const backend = new OfflineBackend(runtime), account = await backend.restore();
  await backend.chooseStarter(account, 4);
  await backend.expState();
  return {backend, account, runtime, get disk() { return disk; }, set fail(value) { fail = value; }, set now(value) { now = value; }};
}
async function kit(f) {
  await f.backend.change(p => {
    const e = p.exp;
    e.stash.push(
      expedition.normalizeItem({id: e.next++, b: "choice-band", lv: 1, r: 1, s: 123, d: 100}),
      expedition.normalizeItem({id: e.next++, b: "potion", lv: 1, r: 0, s: 456, q: 3}));
  });
  await f.backend.expAction(f.account, [{a: "equip", id: 1}, {a: "pocket", id: 2}, {a: "insure", id: 1}]);
}
const start = (f, biome = "wilds") => f.backend.startRun(f.account, {species: 4, mode: "expedition", biome, tier: 0});
const result = (ticket, out = true, extra = {}) => ({mode: "expedition", species: 4, finalSpecies: 4,
  biome: ticket.config.biome, tier: 0, stage: 1, time: 240, kills: 20, damage: 1000, level: 5,
  victory: false, bosses: 0, legendaries: 0, alphas: 0, reactions: 0,
  moves: ["ember"], items: [], splits: [],
  progress: {counters: {}, research: {}, seen: [], league: [], shinies: [], classics: [], forms: []},
  exp: {out, loot: [{k: "crate", i: 0, t: 1, m: 2}], gear: ticket.exp.gear.held ? {held: "e1"} : {},
    bag: ["l0"], pocket: ticket.exp.pocket ? "e2" : null, q: ticket.exp.pocket ? {e2: 2} : {}, crates: 1, bosses: 0, ...extra}});

test("Expedition initializes once without unlocking Pokémon or equipment, and requires reviewed rules/maps", async () => {
  const f = await fixture(), initial = structuredClone(f.disk);
  assert.equal(initial.profile.exp.coins, expedition.allowance.start);
  assert.deepEqual(initial.profile.exp.stash, []); assert.deepEqual(initial.profile.exp.gear, {});
  assert.deepEqual(initial.profile.league, [4]); assert.deepEqual(initial.profile.unlocked, [4]);
  await f.backend.expState();
  assert.deepEqual(f.disk.profile.exp, initial.profile.exp);
  for (const biome of ["forest", "wrong"]) await assert.rejects(start(f, biome), /Wild Valley or Safari/);
  for (const flag of ["scav", "competitive", "coop", "party", "duel"]) {
    await assert.rejects(f.backend.startRun(f.account, {species: 4, mode: "expedition", biome: "wilds", tier: 0, [flag]: true}),
      flag === "party" ? /No matching, durably prepared local co-op run/ : /single-player/);
    assert.deepEqual(f.disk, initial, "Rejected co-op/server flags must not change Expedition progress.");
  }
  const withoutRules = new OfflineBackend({...f.runtime, expedition: undefined});
  await withoutRules.restore();
  await assert.rejects(withoutRules.expState(), /reviewed/);
  assert.deepEqual(f.disk.profile.exp, initial.profile.exp);
});
test("shop purchase, insufficient funds, inventory moves, locks and insurance persist atomically", async () => {
  const f = await fixture();
  const offer = f.disk.profile.exp.shop.items[0], price = expedition.buyPrice(offer);
  await f.backend.expAction(f.account, [{a: "buy", k: 0}]);
  assert.equal(f.disk.profile.exp.coins, expedition.allowance.start - price);
  assert.equal(f.disk.profile.exp.stash.length, 1);
  const purchased = structuredClone(f.disk);
  await assert.rejects(f.backend.expAction(f.account, [{a: "buy", k: 0}]), /no longer available/);
  await f.backend.change(p => { p.exp.coins = 0; });
  const poor = structuredClone(f.disk);
  await assert.rejects(f.backend.expAction(f.account, [{a: "buy", k: 1}]), /Not enough/);
  assert.deepEqual(f.disk, poor);
  await f.backend.importSave(purchased);
  await f.backend.expAction(f.account, [{a: "pocket", id: 1}]);
  assert.equal(f.disk.profile.exp.pocket.id, 1);
  await f.backend.expAction(f.account, [{a: "unpocket"}, {a: "lock", id: 1}]);
  await assert.rejects(f.backend.expAction(f.account, [{a: "sell", ids: [1]}]), /unlocked/);
  f.fail = true;
  const before = structuredClone(f.disk);
  await assert.rejects(f.backend.expAction(f.account, [{a: "lock", id: 1}, {a: "sell", ids: [1]}]), /disk full/);
  assert.deepEqual(f.backend.state, before); assert.deepEqual(f.disk, before);
});
test("wanted loot uses the upstream allowlist and persists without granting inventory", async () => {
  const f = await fixture(), before = structuredClone(f.disk.profile.exp);
  await f.backend.expAction(f.account, [{a: "want", b: "mat-ore", on: true}]);
  await f.backend.expAction(f.account, [{a: "want", b: "mat-ore", on: true}]);
  assert.deepEqual(f.disk.profile.exp.wl, ["mat-ore"]);
  assert.deepEqual(f.disk.profile.exp.stash, before.stash);
  assert.equal(f.disk.profile.exp.coins, before.coins);
  const next = new OfflineBackend(f.runtime); await next.restore();
  assert.deepEqual(next.state.profile.exp.wl, ["mat-ore"]);
  for (const b of ["unknown-loot", "choice-band", "trophy-valley"]) {
    await assert.rejects(f.backend.expAction(f.account, [{a: "want", b, on: true}]), /supported Expedition loot/);
  }
  const prior = structuredClone(f.disk); f.fail = true;
  await assert.rejects(f.backend.expAction(f.account, [{a: "wants", list: []}]), /disk full/);
  assert.deepEqual(f.disk, prior);
  f.fail = false;
  await f.backend.expAction(f.account, [{a: "wants", list: []}]);
  assert.deepEqual(f.disk.profile.exp.wl, []);
});
test("sort and stack conserves quantities, locked stacks, equipment and safe-pocket identity", async () => {
  const f = await fixture(); await kit(f);
  await f.backend.change(p => {
    const e = p.exp;
    for (const q of [2, 3, 4]) e.stash.push(expedition.normalizeItem({
      id: e.next++, b: "potion", lv: 1, r: 0, s: 123, q}));
    e.stash.at(-1).lk = 1;
    e.stash.at(-2).n = 1;
    e.bag.push(expedition.normalizeItem({id: e.next++, b: "potion", lv: 1, r: 0, s: 456, q: 1}));
  });
  const prior = structuredClone(f.disk.profile.exp), sum = e =>
    [...e.stash, ...e.over, ...e.bag, e.pocket].filter(i => i?.b === "potion").reduce((n, i) => n + i.q, 0);
  await f.backend.expAction(f.account, [{a: "tidy"}]);
  const after = f.disk.profile.exp;
  assert.equal(sum(after), sum(prior));
  assert.equal(after.stash.length, prior.stash.length - 1);
  assert.deepEqual(after.stash.find(i => i.lk), prior.stash.find(i => i.lk));
  assert.deepEqual(after.gear, prior.gear); assert.deepEqual(after.ins, prior.ins);
  assert.deepEqual(after.pocket, prior.pocket); assert.equal(after.next, prior.next);
  assert.equal(after.bag[0].q, 1);
  const settled = structuredClone(f.disk);
  await f.backend.expAction(f.account, [{a: "tidy"}]);
  assert.deepEqual(f.disk.profile.exp, settled.profile.exp);
  f.fail = true;
  await assert.rejects(f.backend.expAction(f.account, [{a: "tidy"}]), /disk full/);
  assert.deepEqual(f.backend.state, settled);
});
test("real seeded loot and worn gear survive extraction once, restart, export and import", async () => {
  const f = await fixture(); await kit(f);
  const before = structuredClone(f.disk), ticket = await start(f);
  assert.equal(ticket.expeditionPolicy, EXPEDITION_POLICY);
  assert.deepEqual(ticket.exp.echoes, []); assert.equal(ticket.offline, false);
  assert.equal(f.disk.profile.exp.gear.held, undefined); assert.equal(f.disk.profile.exp.pocket, null);
  assert.equal(f.disk.profile.exp.raid, ticket.id);
  assert.equal(f.disk.profile.exp.coins, before.profile.exp.coins - expedition.insuranceCost(ticket.exp.gear.held));
  await assert.rejects(start(f), /unfinished/);
  await assert.rejects(f.backend.expAction(f.account, [{a: "aid"}]), /active Expedition/);
  const r = result(ticket), info = await f.backend.finishRun(f.account, ticket, r);
  assert.equal(info.exp.out, true);
  const original = expedition.generateLoot(ticket.seed, r.exp.loot[0], expedition.lootFind([ticket.exp.gear.held, ticket.exp.pocket]), expedition.lootLevel([ticket.exp.gear.held, ticket.exp.pocket]));
  assert.equal(info.exp.got.find(i => i.id === 3).b, original.b);
  assert.equal(f.disk.profile.exp.gear.held.id, 1); assert.equal(f.disk.profile.exp.pocket.q, 2);
  assert.equal(f.disk.profile.exp.out, 1); assert.ok(f.disk.profile.exp.ps.xp > 0);
  const settled = structuredClone(f.disk);
  await f.backend.finishRun(f.account, ticket, r); assert.deepEqual(f.disk, settled);
  const next = new OfflineBackend(f.runtime); await next.restore();
  assert.deepEqual(next.state.profile.exp, settled.profile.exp);
  const backup = await next.exportSave(), other = await fixture();
  await other.backend.importSave(backup); assert.deepEqual(other.disk.profile.exp, settled.profile.exp);
});
test("death saves only the safe pocket and insured entry equipment with wear, not ordinary loot", async () => {
  const f = await fixture(); await kit(f);
  const ticket = await start(f, "safari"), info = await f.backend.finishRun(f.account, ticket, result(ticket, false));
  const e = f.disk.profile.exp;
  assert.equal(info.exp.out, false); assert.equal(info.exp.value, 0); assert.equal(e.out, 0);
  assert.equal(e.pocket.b, "potion"); assert.equal(e.pocket.q, 2);
  assert.equal(e.stash[0].id, 1); assert.equal(e.stash[0].d, 75);
  assert.equal(info.exp.ins[0].id, 1); assert.equal(e.history.length, 1);
  assert.ok(e.con.list.every(t => !t.done)); assert.ok(![...e.bag, ...e.stash].some(i => i.id === 3));
});
test("bad refs, duplicate loot, wrong slots, quantities and unknown policies preserve the active run", async () => {
  const f = await fixture(); await kit(f); const ticket = await start(f), before = structuredClone(f.disk);
  for (const exp of [{bag: ["l999"]}, {bag: ["e1"], gear: {held: "e1"}}, {gear: {band: "e1"}},
    {q: {e2: 99}}, {loot: [{k: "crate", i: 0, t: 1, m: 2}, {k: "crate", i: 0, t: 1, m: 2}]},
    {take: [{ref: "x"}]}, {pocket: "e1"}]) {
    await assert.rejects(f.backend.finishRun(f.account, ticket, result(ticket, true, exp)), /Expedition|item|loot|slot|pocket|quantity/i);
    assert.deepEqual(f.disk, before);
  }
  await assert.rejects(f.backend.change(() => { f.backend.state.activeRun.ticket.expeditionPolicy = "future"; }), /escrowed Expedition/);
  assert.deepEqual(f.disk, before, "An unknown run policy cannot replace a recoverable native save.");
});
test("interrupted native writes retry safely; a persisted background checkpoint settles as defeat after process death", async () => {
  const f = await fixture(); await kit(f); const ticket = await start(f), r = result(ticket);
  const active = structuredClone(f.disk); f.fail = true;
  await assert.rejects(f.backend.finishRun(f.account, ticket, r), /disk full/);
  assert.deepEqual(f.disk, active); assert.deepEqual(f.backend.state, active);
  f.fail = false;
  await f.backend.checkpointExpedition(ticket, r);
  const next = new OfflineBackend(f.runtime); await next.restore();
  assert.equal(next.state.activeRun.lastResult.exp.bag[0], "l0");
  await next.discardSaved();
  assert.equal(f.disk.activeRun, null); assert.equal(f.disk.profile.exp.last.out, false);
  assert.equal(f.disk.profile.exp.ps.xp, 0); assert.equal(f.disk.profile.exp.pocket.q, 2);
  assert.equal(f.disk.profile.exp.stash[0].d, 75);
});
test("contracts and permanent pass rewards require earning and cannot be claimed twice", async () => {
  const f = await fixture();
  await assert.rejects(f.backend.expAction(f.account, [{a: "claim", k: 0}]), /Complete/);
  await assert.rejects(f.backend.expAction(f.account, [{a: "pclaim", k: 1}]), /Earn/);
  const ticket = await start(f); await f.backend.finishRun(f.account, ticket, result(ticket));
  await f.backend.expAction(f.account, [{a: "claim", k: 0}]);
  await f.backend.expAction(f.account, [{a: "pclaim", k: 1}]);
  const paid = structuredClone(f.disk);
  await assert.rejects(f.backend.expAction(f.account, [{a: "claim", k: 0}]), /once/);
  await assert.rejects(f.backend.expAction(f.account, [{a: "pclaim", k: 1}]), /once/);
  assert.deepEqual(f.disk, paid);
  const incompatible = structuredClone(paid); incompatible.profile.exp.offlineVersion = 999;
  await assert.rejects(f.backend.importSave(incompatible), /Expedition save version/);
  assert.deepEqual(f.disk, paid);
});
