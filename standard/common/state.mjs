// Data only. Also imported by the sandboxed game; no Node or native APIs here.
import {coopGameConfig,coopRuleTime} from "./coop-rules.mjs";
import {validateSeasonalMail,validateSeasonalTicket} from "./seasonal-mail.mjs";
export const FORMAT = "pokebonk-offline-standard";
export const MAX_STATE_BYTES = 32 * 1024 * 1024;
export const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw new Error(message); };

function validateExpedition(state) {
  const e = state.profile.exp;
  if (e == null) return;
  // Refuse unknown formats rather than replacing equipment or resetting a
  // future run. This is an additive, independently versioned save extension.
  if (!isObject(e) || e.offlineVersion !== 1) fail("Unsupported Expedition save version. Keep the original save.");
  const uint = (n, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(n) && n >= 0 && n <= max;
  for (const key of ["coins", "shards", "rep", "out", "best"]) if (!uint(e[key])) fail("Invalid Expedition balance.");
  if (!uint(e.next, 9999999) || !e.next || !uint(e.slots, 120) || e.slots < 40 ||
      !isObject(e.gear) || !Array.isArray(e.bag) || e.bag.length > 12 ||
      !Array.isArray(e.stash) || e.stash.length > e.slots || !Array.isArray(e.over) ||
      !Array.isArray(e.ins) || !Array.isArray(e.codex) || !Array.isArray(e.history) || e.history.length > 50 ||
      !isObject(e.ps) || !uint(e.ps.xp) || !Array.isArray(e.ps.got) ||
      e.ps.got.some(n => !uint(n, 30) || n < 1) || new Set(e.ps.got).size !== e.ps.got.length) fail("Invalid Expedition inventory or pass.");
  if (e.wl != null && (!Array.isArray(e.wl) || e.wl.length > 24 ||
      new Set(e.wl).size !== e.wl.length || e.wl.some(key =>
        typeof key !== "string" || !/^[a-z0-9-]{1,80}$/.test(key)))) fail("Invalid Expedition wanted-loot preferences.");
  const ids = new Set();
  const item = value => {
    if (!isObject(value) || !uint(value.id, 9999998) || value.id < 1 || value.id >= e.next ||
        typeof value.b !== "string" || !/^[a-z0-9-]{1,80}$/.test(value.b) ||
        !uint(value.lv, 30) || value.lv < 1 || !uint(value.r, 4) || !uint(value.s, 0xffffffff) ||
        value.q !== undefined && (!uint(value.q, 100) || value.q < 1) ||
        value.d !== undefined && !uint(value.d, 100)) fail("Invalid Expedition item.");
    if (ids.has(value.id)) fail("Duplicate Expedition item identity.");
    ids.add(value.id);
  };
  for (const [slot, value] of Object.entries(e.gear)) {
    if (!["held", "band", "charm", "gem"].includes(slot)) fail("Invalid Expedition slot.");
    item(value);
  }
  for (const value of [...e.stash, ...e.over, ...e.bag, ...e.pocket ? [e.pocket] : []]) item(value);
  if (e.raid != null) {
    const ticket = state.activeRun?.ticket;
    if (typeof e.raid !== "string" || ticket?.id !== e.raid || ticket.config?.mode !== "expedition" ||
        ticket.expeditionPolicy !== "local-expedition-v1" || !isObject(ticket.exp?.gear) ||
        !Array.isArray(ticket.exp?.bag) || !Array.isArray(ticket.expInsured)) fail("Invalid escrowed Expedition.");
    for (const value of [...Object.values(ticket.exp.gear), ...ticket.exp.bag,
      ...ticket.exp.pocket ? [ticket.exp.pocket] : []]) item(value);
  }
}
function safeJSON(value, depth = 0) {
  if (depth > 100) fail("Save nesting is too deep.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const child of value) safeJSON(child, depth + 1); return; }
  if (!isObject(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("Invalid save data.");
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) fail("Unsafe save property.");
    safeJSON(child, depth + 1);
  }
}
export function validateState(state) {
  safeJSON(state);
  if (!isObject(state) || state.version !== 1 || !isObject(state.profile) ||
      typeof state.playerId !== "string" || !/^offline-[\w-]{1,160}$/.test(state.playerId) ||
      !Number.isFinite(state.updatedAt) || state.updatedAt < 0) fail("Not a compatible offline progression save.");
  const p = state.profile;
  if (p.localSandbox || state.variant === "unlock-all" || state.edition === "unlocked") fail("Unlocked saves cannot be imported into Standard.");
  if (typeof p.name !== "string" || p.name.length > 200 ||
      !isObject(p.settings) || !Array.isArray(p.league) ||
      !Array.isArray(p.unlocked) || !Array.isArray(p.seen)) fail("Invalid progression profile.");
  for (const key of ["league", "unlocked", "seen"]) {
    if (p[key].some(id => !Number.isInteger(id) || id < 1 || id > 10000)) fail("Invalid Pokémon in save.");
  }
  for (const key of ["stardust", "totalStardust", "bonk"]) {
    if (p[key] !== undefined && (!Number.isFinite(p[key]) || p[key] < 0)) fail("Invalid save balance.");
  }
  for (const key of ["stash", "finished", "spins"]) if (!isObject(state[key])) fail(`Invalid ${key} in save.`);
  validateSeasonalMail(state.seasonalMail);
  if (state.onboarding != null) {
    if (!isObject(state.onboarding) ||
        state.onboarding.trainerGuide !== undefined && state.onboarding.trainerGuide !== 1) fail("Invalid first-use guide marker.");
    if (state.onboarding.playerName !== undefined && state.onboarding.playerName !== 1) fail("Invalid initial player-name marker.");
  }
  // Additive schema-1 extension: old backups are accepted and backfilled by
  // the local backend. Unknown future formats must never be reset to empty.
  for (const records of [state.records, state.lanRecords].filter(value => value != null)) {
    if (!isObject(records) || records.version !== 1) fail("Unsupported personal-records format. Keep the original save.");
    for (const tab of ["kos", "survival", "time"]) {
      const rows = records[tab];
      if (!isObject(rows) || Object.keys(rows).length > 20000) fail("Invalid personal records.");
      for (const row of Object.values(rows)) {
        if (!isObject(row) || !["standard", "endless", "relay", "mutation", "bossrush", "tower"].includes(row.mode) ||
            typeof row.biome !== "string" || !/^[\w:-]{1,100}$/.test(row.biome) ||
            !Number.isInteger(row.tier) || row.tier < 0 || row.tier > 10 ||
            row.species !== null && (!Number.isInteger(row.species) || row.species < 1 || row.species > 10000) ||
            row.finalSpecies !== null && (!Number.isInteger(row.finalSpecies) || row.finalSpecies < 1 || row.finalSpecies > 10000) ||
            typeof row.id !== "string" || row.id.length > 180 ||
            typeof row.victory !== "boolean" || typeof row.legacy !== "boolean" ||
            typeof row.mutation !== "string" || row.mutation.length > 100 ||
            typeof row.variant !== "string" || row.variant.length > 100) fail("Invalid personal-record row.");
        for (const key of ["kills", "time", "attackTime", "date", "floor", "beaten"]) {
          if (row[key] !== null && (!Number.isFinite(row[key]) || row[key] < 0)) fail("Invalid personal-record metric.");
        }
      }
    }
  }
  const ticket = value => {
    if (!isObject(value) || typeof value.id !== "string" || !value.id.startsWith("offline-") ||
        !Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) fail("Invalid local run ticket.");
    validateSeasonalTicket(value.offlineSeason);
    if (value.lan != null && (!isObject(value.lan) || ![1,2].includes(value.lan.version) ||
        value.lan.party !== value.party || typeof value.party !== "string" || !/^lan-[\w-]{1,80}$/.test(value.party) ||
        typeof value.lan.me !== "string" || !/^lan-[\w-]{1,80}$/.test(value.lan.me) ||
        !Number.isInteger(value.lan.size) || value.lan.size < 2 || value.lan.size > 4 || typeof value.lan.launched !== "boolean" ||
        !coopGameConfig(value.config) ||
        value.lan.version===1&&(value.config.mode!=="standard"||value.config.biome!=="forest"||value.config.tier!==0))) {
      fail("Unsupported local co-op ticket. Keep the original save.");
    }
    if(value.lan?.version===2)coopRuleTime(value.coopRulesAt);
  };
  if (state.activeRun != null) {
    if (!isObject(state.activeRun) || !["running", "suspended"].includes(state.activeRun.status)) fail("Invalid active run.");
    ticket(state.activeRun.ticket);
  }
  if (state.suspended != null) {
    if (!isObject(state.suspended) || typeof state.suspended.text !== "string" ||
        typeof state.suspended.hash !== "string" || !Number.isFinite(state.suspended.at)) fail("Invalid suspended run.");
    ticket(state.suspended.ticket);
    if (state.activeRun && state.activeRun.ticket.id !== state.suspended.ticket.id) fail("Suspended run identity mismatch.");
  }
  validateExpedition(state);
  if(state.expeditionTeams!=null){
    const book=state.expeditionTeams,id=value=>typeof value==="string"&&/^lan-[\w-]{1,80}$/.test(value);
    if(!isObject(book)||book.version!==1||!isObject(book.parties)||Object.keys(book.parties).length>100)
      fail("Unsupported Expedition co-op receipt format. Keep the original save.");
    for(const [party,group]of Object.entries(book.parties)){
      if(!id(party)||!isObject(group)||group.version!==1||typeof group.settled!=="boolean"||
        !Number.isSafeInteger(group.at)||!id(group.me)||!Array.isArray(group.members)||group.members.length<2||group.members.length>4||
        group.members.some(member=>!id(member))||new Set(group.members).size!==group.members.length||!group.members.includes(group.me)||
        group.ticket?.party!==party||group.ticket.lan?.me!==group.me||group.ticket.config?.mode!=="expedition"||
        !isObject(group.gifts)||Object.keys(group.gifts).length>24||!isObject(group.packs)||Object.keys(group.packs).length>16||
        !isObject(group.received)||Object.keys(group.received).length>16||!isObject(group.restored)||
        !Array.isArray(group.incomingGifts)||group.incomingGifts.length>24||
        !Array.isArray(group.incomingPacks)||group.incomingPacks.length>24||
        !Array.isArray(group.seen)||group.seen.length>240||
        !Array.isArray(group.pending)||group.pending.length>24)
        fail("Invalid Expedition co-op ownership receipts. Keep the original save.");
    }
  }
  return state;
}

export function envelope(state, config) {
  validateState(state);
  return {format: FORMAT, edition: "standard", schemaVersion: config.saveSchema,
    upstream: {...config.upstream}, state};
}
export function validateEnvelope(value, config) {
  if (!isObject(value) || value.format !== FORMAT || value.edition !== "standard") fail("Wrong save edition.");
  if (value.schemaVersion !== config.saveSchema) fail("Unsupported save schema. Open this save in its previous app version; it has not been modified.");
  if (!isObject(value.upstream) || typeof value.upstream.build !== "string" || typeof value.upstream.version !== "string") fail("Missing save build.");
  validateState(value.state);
  if ((value.state.suspended || value.state.activeRun) && !config.compatibleRunBuilds.includes(value.upstream.build)) {
    fail(`This unfinished run requires game ${value.upstream.version} (${value.upstream.build}). Complete it in the previous app version, then export again. The original save is preserved.`);
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_STATE_BYTES) fail("Save exceeds 32 MiB.");
  return value;
}

// Legacy imports are explicit, never discovered from another app's storage.
// The old progression edition is the ONLY accepted unwrapped format.
export function importEnvelope(value, config) {
  if (value?.format) return validateEnvelope(value, config);
  validateState(value);
  const legacy = {format: FORMAT, edition: "standard", schemaVersion: 1,
    upstream: {version: "0.10.20", build: "mwqb4pwz"}, state: value};
  return validateEnvelope(legacy, config);
}
