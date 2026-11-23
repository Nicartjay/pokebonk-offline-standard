import test from "node:test";
import assert from "node:assert/strict";
import {addRecord, ensureRecords, personalRecords, recordRow} from "../runtime/records.js";

const state = () => ({profile: {runs: [], best: {}, kills: {}, times: {}, endless: {}}});
const run = (values = {}) => ({id: "offline-test", mode: "standard", species: 4, finalSpecies: 6,
  biome: "forest", tier: 0, kills: 100, time: 600, victory: true, date: 1000, ...values});
test("KOs, Survival and Time Attack have distinct eligibility and comparison rules", () => {
  const save = state(), records = ensureRecords(save);
  addRecord(records, run());
  addRecord(records, run({id: "offline-slower", kills: 200, time: 900}));
  addRecord(records, run({id: "offline-loss", kills: 1000, time: 100, victory: false}));
  addRecord(records, run({id: "offline-end", mode: "endless", kills: 50, time: 1000, victory: false}));
  addRecord(records, run({id: "offline-end-tie", mode: "endless", kills: 60, time: 1000, victory: false}));
  addRecord(records, run({id: "offline-relay", mode: "relay", kills: 90, time: 900, victory: false}));
  assert.equal(personalRecords(save, "kos")[0].id, "offline-loss");
  assert.equal(personalRecords(save, "survival")[0].id, "offline-end-tie");
  assert.equal(personalRecords(save, "survival").length, 2);
  assert.equal(personalRecords(save, "time")[0].id, "offline-test");
});
test("bests remain separate by Pokémon, map, difficulty and challenge ruleset", () => {
  const save = state(), records = ensureRecords(save);
  for (const values of [{}, {species: 7}, {biome: "desert"}, {tier: 1},
    {mode: "mutation", mutation: "daynight", mutationDay: 20},
    {mode: "mutation", mutation: "daynight", mutationDay: 21}]) addRecord(records, run(values));
  assert.equal(personalRecords(save).length, 6);
  addRecord(records, run({mode: "bossrush", rush: {beaten: 4, week: 1}}));
  assert.equal(personalRecords(save, "time").some(row => row.mode === "bossrush"), false);
  addRecord(records, run({mode: "bossrush", rush: {beaten: 5, week: 1}}));
  addRecord(records, run({mode: "bossrush", rush: {beaten: 5, week: 2}}));
  assert.equal(personalRecords(save, "time").filter(row => row.mode === "bossrush").length, 2);
});
test("hundreds of weaker recent runs cannot evict an older best", () => {
  const save = state(), records = ensureRecords(save);
  addRecord(records, run({id: "offline-longstanding-best", kills: 10000}));
  for (let index = 0; index < 150; index++) addRecord(records, run({id: `offline-${index}`, kills: index}));
  save.profile.runs = [run({kills: 1})];
  assert.equal(personalRecords(JSON.parse(JSON.stringify(save)))[0].id, "offline-longstanding-best");
});
test("eligible upstream metrics, not raw overtime time/KOs, determine Classic records", () => {
  const save = state(), records = ensureRecords(save);
  addRecord(records, run({kills: 100, time: 2000}), () => ({kills: 1500, time: 800, trial: true}));
  assert.equal(personalRecords(save)[0].kills, 1500);
  assert.equal(personalRecords(save, "time")[0].attackTime, 800);
  assert.equal(personalRecords(save, "time")[0].time, 2000);
  addRecord(records, run({biome: "desert"}), () => ({kills: 100, time: 100, trial: false}));
  assert.equal(personalRecords(save, "time").length, 1, "Direct overtime is not an eligible time trial.");
});
test("legacy backfill keeps known bests without inventing missing run details", () => {
  const save = state();
  save.profile.runs = [run({kills: 100})];
  save.profile.kills = {"forest-0": 1500, "desert-1": 200};
  save.profile.times = {"forest-0": {time: 400, date: 1200, species: 7}};
  save.profile.endless = {forest: {time: 2000, kills: 300, date: 1300, species: 4}};
  assert.equal(personalRecords(save)[0].species, null);
  assert.equal(personalRecords(save)[0].date, null);
  assert.equal(personalRecords(save, "time")[0].time, 400);
  assert.equal(personalRecords(save, "time")[0].species, 7);
  assert.equal(personalRecords(save, "time")[0].kills, null);
  assert.equal(personalRecords(save, "survival")[0].time, 2000);
});
test("invalid rows are ignored and unknown future record versions are preserved, not reset", () => {
  const save = state(), records = ensureRecords(save);
  for (const values of [{mode: "training"}, {mode: "duel"}, {biome: "__bad/path"},
    {kills: NaN, time: Infinity, victory: false}]) addRecord(records, run(values));
  assert.equal(personalRecords(save).length, 0);
  save.records = {version: 100, kos: {future: true}};
  const before = structuredClone(save);
  assert.throws(() => ensureRecords(save), /original app version/);
  assert.deepEqual(save, before);
  assert.equal(recordRow(null), null);
});
