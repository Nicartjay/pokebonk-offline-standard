// Prepared for one focused pass AFTER the maintainer approves screenshots.
import test from "node:test";
import assert from "node:assert/strict";
import {OfflineBackend} from "../runtime/backend.js";
import {validateState} from "../common/state.mjs";
import {portableCloudSave,mergeCloudSave} from "../common/cloud-save.mjs";
import {save,config} from "./fixtures.mjs";
import {readFile,readdir} from "node:fs/promises";
import {requireSeasonalCatalog,patchSeasonalCosmeticCatalog} from "../adapters/seasonal-mail.mjs";
import {SEASONAL_MAIL_POLICY,ensureSeasonalMail,seasonalMailbox,claimSeasonalGift,
  recordSeasonalParticipation,seasonalRunMarker} from "../common/seasonal-mail.mjs";

const now = Date.UTC(2026, 10, 26);
const fresh = () => { const value = save().state; value.profile.cosmetics = []; return value; };
const setup = value => { ensureSeasonalMail(value, now); return value; };
const run = (extra = {}) => ({id: "offline-seasonal-fixture", seed: 1,
  config: {mode: "standard", species: 4, biome: "forest", tier: 0},
  offlineSeason: seasonalRunMarker(), ...extra});

test("all three archive packs are delivered without past participation, currency changes or automatic unlocks", () => {
  const state = fresh(), before = structuredClone(state.profile);
  ensureSeasonalMail(state, now);
  const view = seasonalMailbox(state);
  assert.equal(view.current.number, 4);
  assert.equal(view.archiveThrough, 4);
  assert.equal(view.current.giftAnnounced, false);
  assert.deepEqual(view.messages.map(message => [message.season, message.state]),
    [[1, "available"], [2, "available"], [3, "available"]]);
  assert.equal(view.messages.flatMap(message => message.rewards).length, 9);
  assert.deepEqual(state.profile, before);
  assert.deepEqual(state.seasonalMail.participation, {});
  ensureSeasonalMail(state, now + 1000);
  assert.equal(state.seasonalMail.messages["season-2-archive"].deliveredAt, now);
  validateState(state);
});

test("claims grant only the reviewed pack, preserve equipped identity, and reject repeats and unknown IDs", () => {
  const state = setup(fresh());
  Object.assign(state.profile, {avatar: "mon:4", frame: "gold", title: "existing", cosmetics: ["frame:s2"]});
  const before = structuredClone(state.profile);
  claimSeasonalGift(state, "season-2-archive", now);
  assert.deepEqual(state.profile.cosmetics, ["frame:s2", "title:s2"]);
  assert.deepEqual({...state.profile, cosmetics: before.cosmetics}, before);
  assert.equal(seasonalMailbox(state).messages[1].state, "claimed");
  const claimed = structuredClone(state);
  assert.throws(() => claimSeasonalGift(state, "season-2-archive", now), /already claimed/);
  assert.throws(() => claimSeasonalGift(state, "frame:master", now), /not available/);
  assert.deepEqual(state, claimed);
  state.profile.cosmetics.push("tr:pioneer", "title:s1");
  assert.equal(seasonalMailbox(state).messages[0].state, "owned");
  assert.throws(() => claimSeasonalGift(state, "season-1-archive", now), /owned/);
  assert.equal(state.seasonalMail.messages["season-1-archive"].claimedAt, null);
});

test("participation uses pinned settled tickets, not clocks, counters, old saves, practice or prepared lobbies", () => {
  const state = setup(fresh());
  state.profile.counters = {runs: 999};
  recordSeasonalParticipation(state, {...run(), offlineSeason: undefined}, {time: 100}, now);
  recordSeasonalParticipation(state, run({config: {mode: "training"}}), {time: 100}, now);
  recordSeasonalParticipation(state, run({lan: {launched: false}}), {time: 100}, now);
  recordSeasonalParticipation(state, run(), {time: 59}, now);
  assert.deepEqual(state.seasonalMail.participation, {});
  recordSeasonalParticipation(state, run(), {time: 60}, now);
  recordSeasonalParticipation(state, run({lan: {launched: true}}), {victory: true, time: 1}, now - 100);
  assert.deepEqual(state.seasonalMail.participation["season-4"], {runs: 2, firstAt: now, lastAt: now});
  ensureSeasonalMail(state, now + 10 * 365 * 86400000);
  assert.equal(seasonalMailbox(state).current.number, 4);
  assert.equal(seasonalMailbox(state).messages.length, 3);
});

test("a later reviewed participation gift uses the retained ledger without fabricating eligibility for new players", () => {
  const state = setup(fresh());
  recordSeasonalParticipation(state, run(), {time: 100}, now);
  // Synthetic future catalog only. No invented Season 4 reward is shipped.
  const policy = {...SEASONAL_MAIL_POLICY, current: "season-6",
    seasons: [...SEASONAL_MAIL_POLICY.seasons.slice(0, 3), {
      id: "season-4", number: 4, name: "Season 4", closed: true, gift: null,
    }, {
      id: "season-5", number: 5, name: "Season 5", closed: true,
      gift: {id: "fixture-season-5-gift", eligibility: "participation", title: "Fixture only", text: "",
        rewards: [{id: "title:fixture-only", name: "Fixture only"}]},
    }, {id: "season-6", number: 6, name: "Season 6", closed: false, gift: null}]};
  state.seasonalMail.participation["season-5"] = {runs: 1, firstAt: now, lastAt: now};
  ensureSeasonalMail(state, now + 1, policy);
  assert.equal(seasonalMailbox(state, policy).messages.at(-1).state, "available");
  const newcomer = fresh();
  ensureSeasonalMail(newcomer, now + 1, policy);
  assert.equal(seasonalMailbox(newcomer, policy).messages.length, 3);
  assert.throws(() => claimSeasonalGift(newcomer, "fixture-season-5-gift", now, policy), /not available/);
});

test("the approved Season 4 archive remains open even while Season 4 is active", () => {
  // Synthetic catalog only: verifies the requested policy without fabricating
  // a production Season 4 frame or title.
  const policy = {...SEASONAL_MAIL_POLICY, seasons: [...SEASONAL_MAIL_POLICY.seasons.slice(0, 3), {
    ...SEASONAL_MAIL_POLICY.seasons[3],
    gift: {id: "fixture-season-4-archive", title: "Fixture only", text: "", eligibility: "archive",
      rewards: [{id: "title:fixture-only", name: "Fixture only"}]},
  }]};
  const state = fresh();
  ensureSeasonalMail(state, now, policy);
  const view = seasonalMailbox(state, policy);
  assert.equal(view.messages[3].state, "available");
  assert.equal(view.current.giftAnnounced, true);
  assert.deepEqual(state.seasonalMail.participation, {});
  claimSeasonalGift(state, "fixture-season-4-archive", now, policy);
  assert.deepEqual(state.profile.cosmetics, ["title:fixture-only"]);
});

test("the source contract covers every defined personal Season 1–4 cosmetic and stops on a new unreviewed reward", async () => {
  const folder = "vendor/pokebonk-standard-0.10.31/game/assets/";
  const files = await readdir(folder);
  const cosmetics = await readFile(folder + files.find(name => /^cosmetics-.*\.js$/.test(name)), "utf8");
  let catalogs;
  for (const name of files.filter(name => /^assets-.*\.js$/.test(name))) {
    const source = await readFile(folder + name, "utf8");
    if (source.includes("slot-move") && source.includes("data/pokemon.json")) catalogs = source;
  }
  assert.ok(catalogs);
  assert.doesNotThrow(() => requireSeasonalCatalog(catalogs, cosmetics));
  const patched = patchSeasonalCosmeticCatalog(cosmetics);
  assert.equal((patched.match(/Offline Mailbox · Season /g) ?? []).length, 9);
  assert.throws(() => requireSeasonalCatalog(catalogs, cosmetics +
    '\nconst __fixtureOnly=[{id:"frame:s4-fixture",kind:"frame",name:"Fixture only",how:"Season 4 fixture"}];'),
  /Unreviewed Season 4 personal cosmetic/);
});

test("unknown future formats are refused while unknown same-version receipts survive export and cloud restore", () => {
  const state = setup(fresh());
  state.seasonalMail.messages["future-message"] = {read: false, deliveredAt: now, claimedAt: null};
  state.seasonalMail.participation["season-99"] = {runs: 1, firstAt: now, lastAt: now};
  claimSeasonalGift(state, "season-3-archive", now);
  const original = {...save(), state};
  const portable = portableCloudSave(original, config);
  const restored = mergeCloudSave(portable, save(), config);
  assert.deepEqual(restored.state.seasonalMail, state.seasonalMail);
  assert.deepEqual(restored.state.profile.cosmetics, state.profile.cosmetics);
  ensureSeasonalMail(restored.state, now + 1);
  assert.deepEqual(restored.state.seasonalMail, state.seasonalMail);
  restored.state.seasonalMail.version = 99;
  const untouched = structuredClone(restored.state);
  assert.throws(() => validateState(restored.state), /Unsupported seasonal/);
  assert.throws(() => ensureSeasonalMail(restored.state, now), /Unsupported seasonal/);
  assert.deepEqual(restored.state, untouched);
});

function backendFixture() {
  let disk = fresh();
  disk.profile.captured = {};
  disk.profile.bag = {};
  disk.profile.counters = {};
  const transport = {load: async () => structuredClone(disk),
    save: async value => { validateState(value); disk = structuredClone(value); }};
  const rules = {wn: value => structuredClone(value),
    Ut(profile, result, data, ticket) {
      profile.counters.runs = (profile.counters.runs ?? 0) + 1;
      return {record: {...result, id: ticket.id, date: now}};
    }};
  const options = {rules, data: () => ({}), transport, now: () => now};
  return {backend: new OfflineBackend(options), options, transport, get disk() { return disk; }};
}

test("duplicate concurrent claims serialize and an interrupted native commit rolls back both receipt and cosmetics", async () => {
  const fixture = backendFixture(), backend = fixture.backend;
  await backend.restore();
  const before = structuredClone(backend.state), originalSave = fixture.transport.save;
  fixture.transport.save = async () => { throw Error("interrupted native write"); };
  await assert.rejects(backend.claimSeasonalGift(null, "season-2-archive"), /interrupted/);
  assert.deepEqual(backend.state, before);
  assert.deepEqual(fixture.disk, before);
  fixture.transport.save = originalSave;
  const results = await Promise.allSettled([backend.claimSeasonalGift(null, "season-2-archive"),
    backend.claimSeasonalGift(null, "season-2-archive")]);
  assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected"]);
  assert.deepEqual(fixture.disk.profile.cosmetics, ["frame:s2", "title:s2"]);
  await backend.readSeasonalMail();
  const restarted = new OfflineBackend(fixture.options);
  await restarted.restore();
  assert.equal(restarted.seasonalMailbox().unread, 0);
  assert.equal(restarted.seasonalMailbox().messages[1].state, "claimed");
  const exported = await restarted.exportSave();
  await restarted.importSave(exported);
  assert.equal(restarted.seasonalMailbox().messages[1].state, "claimed");
});

test("season participation is committed exactly once with a successful completed-run settlement", async () => {
  const fixture = backendFixture(), backend = fixture.backend;
  const account = await backend.restore();
  const ticket = await backend.startRun(account, run().config);
  const result = {species: 4, mode: "standard", biome: "forest", tier: 0, time: 65,
    kills: 1, victory: false, progress: {}};
  assert.equal(backend.state.seasonalMail.participation["season-4"], undefined);
  const originalSave = fixture.transport.save;
  fixture.transport.save = async () => { throw Error("native write failed"); };
  await assert.rejects(backend.finishRun(account, ticket, result), /native write/);
  assert.equal(backend.state.seasonalMail.participation["season-4"], undefined);
  assert.equal(backend.state.activeRun.ticket.id, ticket.id);
  fixture.transport.save = originalSave;
  await backend.finishRun(account, ticket, result);
  await backend.finishRun(account, ticket, result);
  assert.equal(fixture.disk.seasonalMail.participation["season-4"].runs, 1);
  assert.equal(fixture.disk.profile.counters.runs, 1);
  assert.deepEqual(fixture.disk.profile.cosmetics, []);
  assert.equal(backend.seasonalMailbox().messages.length, 3);
});
