// PokéBonk: export YOUR signed-in online progress for Offline 1.3.1.
// Run only on https://pokebonk.com/ at the homepage, after online syncing finishes.
// READ-ONLY GETs to the official game/API. No login token is downloaded or logged.
// No remote scripts, storage writes, rewards claims, uploads, or online save edits.
// The original profile is preserved; unsupported data produces an ARCHIVE ONLY.
// Regenerate with: node standard/scripts/create-online-save-exporter.mjs
(async () => {
"use strict";
// Reviewed shared-engine room choices. No network, account or save access.
const COOP_MAPS = Object.freeze([
  "forest","desert","coast","glacier","canela","cave","encina","iris","plateado","furia",
]);
const COOP_EXPEDITION_MAPS = Object.freeze(["wilds","safari"]);
function coopLoadout(value) {
  if(!value||!Array.isArray(value.worn)||value.worn.length>4||
    !Number.isInteger(value.bag)||value.bag<0||value.bag>12||
    ![value.risk,value.ins].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000000)||
    value.worn.some(item=>!item||typeof item.b!=="string"||!/^[a-z0-9-]{1,80}$/.test(item.b)||
      !Number.isInteger(item.r)||item.r<0||item.r>4||!Number.isInteger(item.lv)||item.lv<1||item.lv>30)||
    value.card!==undefined&&(typeof value.card!=="string"||!/^card-[a-z0-9-]{1,60}$/.test(value.card)))
    throw Error("Invalid Expedition loadout summary.");
  return {worn:value.worn.map(({b,r,lv})=>({b,r,lv})),bag:value.bag,risk:value.risk,ins:value.ins,
    ...(value.card!==undefined?{card:value.card}:{})};
}
function coopDestination(value=""){
  if(value==="")return coopSettings();
  if(!COOP_EXPEDITION_MAPS.includes(value))throw Error("Choose a supported Expedition destination.");
  return coopSettings({biome:value,tier:4});
}
function coopRoomMatches(settings,destination=""){
  const wanted=coopDestination(destination),actual=coopSettings(settings);
  return destination===""||actual.tier===4&&actual.biome===wanted.biome;
}
function coopMaps(value) {
  const result={forest:0};
  for(const id of COOP_MAPS)if(Number.isInteger(value?.[id])&&value[id]>=0&&value[id]<=2)result[id]=value[id];
  return result;
}
function coopSettings(value={biome:"forest",tier:0}) {
  if(!value||![0,1,2,3,4,5,6,7].includes(value.tier)||
    !(value.tier===4?COOP_EXPEDITION_MAPS.includes(value.biome):
      COOP_MAPS.includes(value.biome)||[6,7].includes(value.tier)&&value.biome==="newisland"))
    throw Error("Choose a supported co-op mode and map.");
  return {biome:value.tier===7?"newisland":value.tier===6?"forest":value.biome,tier:value.tier};
}
function coopConfig(value) {
  const {biome,tier}=coopSettings(value);
  return {biome,tier:tier<3?tier:0,mode:({3:"endless",4:"expedition",5:"relay",6:"mutation",7:"bossrush"})[tier]??"standard"};
}
function coopRuleTime(value) {
  if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)throw Error("Invalid shared co-op rule clock.");
  return value;
}
function resolveCoopConfig(match,dailyMutation) {
  if(!coopGameConfig(match))throw Error("Unsupported shared co-op match.");
  if(match.mode!=="mutation")return {mode:match.mode,biome:match.biome,tier:match.tier};
  const daily=dailyMutation?.(coopRuleTime(match.rulesAt));
  if(!daily||!COOP_MAPS.includes(daily.biome)||!Number.isInteger(daily.mutation?.tier)||daily.mutation.tier<0||
    daily.mutation.tier>2||typeof daily.mutation.id!=="string"||daily.mutation.id.length>80)
    throw Error("This game build cannot resolve the shared Daily Mutation.");
  return {mode:"mutation",biome:daily.biome,tier:daily.mutation.tier,mutation:daily.mutation.id,mutationDay:daily.day};
}
function coopGameConfig(value) {
  return Boolean(value&&
    (value.mode==="expedition"&&COOP_EXPEDITION_MAPS.includes(value.biome)&&value.tier===0||
     value.mode==="bossrush"&&value.biome==="newisland"&&value.tier===0||
     COOP_MAPS.includes(value.biome)&&
       (["standard","mutation"].includes(value.mode)&&Number.isInteger(value.tier)&&value.tier>=0&&value.tier<=2||
        ["endless","relay"].includes(value.mode)&&value.tier===0)));
}
function coopSeats(value={discoverable:false,capacity:4},count=1) {
  if(!value||typeof value.discoverable!=="boolean"||![2,3,4].includes(value.capacity)||value.capacity<count)
    throw Error("Choose Duo, Trio or Squad without removing a teammate.");
  return {discoverable:value.discoverable,capacity:value.capacity};
}
function requireCoopUnlocks(value,members) {
  const settings=coopSettings(value),tier=settings.tier<3?settings.tier:0;
  if([4,6,7].includes(settings.tier))return settings; // Expedition/event destinations have their own gates.
  for(const member of members)if((coopMaps(member.maps)[settings.biome]??-1)<tier)
    throw Error(`${member.name??"A teammate"} has not unlocked this map or difficulty.`);
  return settings;
}
function coopModeUnavailable(tier) {
  return ![0,1,2,3,4,5,6,7].includes(tier)?"This mode is not supported in offline co-op yet.":null;
}

// Data only. Also imported by the sandboxed game; no Node or native APIs here.

const FORMAT = "pokebonk-offline-standard";
const MAX_STATE_BYTES = 32 * 1024 * 1024;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
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
function validateState(state) {
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

function envelope(state, config) {
  validateState(state);
  return {format: FORMAT, edition: "standard", schemaVersion: config.saveSchema,
    upstream: {...config.upstream}, state};
}
function validateEnvelope(value, config) {
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
function importEnvelope(value, config) {
  if (value?.format) return validateEnvelope(value, config);
  validateState(value);
  const legacy = {format: FORMAT, edition: "standard", schemaVersion: 1,
    upstream: {version: "0.10.20", build: "mwqb4pwz"}, state: value};
  return validateEnvelope(legacy, config);
}

const convertOnlineArchive=function convertOnlineArchive(archive, review, {validateEnvelope, randomUUID, now}) {
  const stop = message => { throw new Error(message); };
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  if (archive?.format !== "pokebonk-online-profile-archive" || archive.archiveVersion !== 1 ||
      !review.sources.some(source => source.build === archive.upstream?.build &&
        source.version === archive.upstream?.version) ||
      !object(archive.profile) || !object(archive.stash)) {
    stop("This archive needs a reviewed source-format converter.");
  }
  const profile = structuredClone(archive.profile);
  // A missing starter triggers the original client's legacy unlock-all-starters
  // migration. Never use that migration to make an import appear successful.
  if (profile.v !== 1 || !Number.isInteger(profile.starter) || profile.starter < 0 ||
      !Number.isInteger(profile.starterJ) || profile.starterJ < 0) {
    stop("This profile needs a reviewed progression migration.");
  }
  const species = new Set(review.species);
  for (const key of ["league", "unlocked", "seen"]) {
    if (!Array.isArray(profile[key]) || profile[key].some(id => !species.has(id))) {
      stop("This profile contains Pokémon not supported by the target offline game.");
    }
  }
  for (const id of [profile.starter, profile.starterJ]) {
    if (id !== 0 && !species.has(id)) stop("The selected starter is not supported by the target offline game.");
  }
  if (!object(profile.settings)) stop("This profile has an unsupported settings format.");
  profile.settings.showLadder = false;
  profile.settings.teamChat = false;
  if (profile.exp != null) {
    const expedition = profile.exp;
    if (!object(expedition) || expedition.raid != null) {
      stop("Finish the online Expedition and collect its returns before exporting.");
    }
    if (expedition.offlineVersion !== undefined) stop("Unexpected existing offline Expedition marker.");
    if (expedition.v !== undefined && expedition.v !== 1) {
      stop("This online Expedition schema needs a reviewed converter.");
    }
    const owned = [...expedition.stash ?? [], ...expedition.over ?? [], ...expedition.bag ?? [],
      ...Object.values(expedition.gear ?? {}), ...expedition.pocket ? [expedition.pocket] : []];
    const catalog = new Set(review.expeditionItems);
    if (owned.some(item => !object(item) || !catalog.has(item.b)) ||
        (expedition.shop?.items ?? []).some(item => !object(item) || !catalog.has(item.b))) {
      stop("Some Expedition items are newer than this offline game's catalog.");
    }
    const ids = new Set(owned.map(item => item.id));
    if (!Array.isArray(expedition.ins) || expedition.ins.some(id => !ids.has(id))) {
      stop("Online Expedition insurance/returns need to be settled before converting.");
    }
    // The online profile stores lifetime extraction totals under stats.
    // The local runtime has explicit out/best fields: copy, never reset them.
    for (const key of ["out", "best"]) {
      if (expedition[key] === undefined && expedition.v === 1) {
        const value = expedition.stats?.[key];
        if (!Number.isSafeInteger(value) || value < 0) {
          stop("The online Expedition is missing its original statistics.");
        }
        expedition[key] = value;
      }
    }
    // The original pass UI reads ps?.xp ?? 0 and ps?.got ?? [].
    // sp is the borrowed-Pokémon selection, NOT a packed season-pass tuple.
    // Keep it intact; never reinterpret those Pokémon IDs as XP or claims.
    if (expedition.ps == null) expedition.ps = {xp: 0, got: []};
    // The online response has last, not the local last-50-runs ledger. Keep
    // last verbatim; do not invent its missing species/map/KO/date fields.
    if (expedition.history == null) expedition.history = [];
    expedition.offlineVersion = 1;
  }
  const state = {version: 1, playerId: "offline-" + randomUUID(), updatedAt: now,
    profile, stash: structuredClone(archive.stash), activeRun: null, suspended: null,
    finished: {}, spins: {}, onboarding: {trainerGuide: 1, playerName: 1}};
  const result = {format: "pokebonk-offline-standard", edition: "standard", schemaVersion: review.schema,
    upstream: {...archive.upstream}, state, onlineArchive: structuredClone(archive),
    importInfo: {targetAppVersion: review.appVersion, targetGame: review.targetGame,
      conversionVersion: 2,
      note: "One-way copy of completed progress; replaces local progress, never merges it."}};
  validateEnvelope(result, {saveSchema: review.schema, compatibleRunBuilds: []});
  return result;
};
await (async function exportOnlineSave(review, {validateEnvelope, MAX_STATE_BYTES, convertOnlineArchive}) {
  const stop = message => { throw new Error(message); };
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  if (location.protocol !== "https:" || !["pokebonk.com", "www.pokebonk.com"].includes(location.hostname)) {
    stop("Run this only in the DevTools Console of the official pokebonk.com game.");
  }
  const read = key => {
    const text = localStorage.getItem(key);
    if (text === null) return null;
    try { return JSON.parse(text); } catch { stop("Unreadable game storage. Reload the homepage and try again."); }
  };
  const session = read("pb.session"), device = read("pb.device");
  if (!object(session) || typeof session.token !== "string" || !session.token ||
      !["string", "number"].includes(typeof session.id)) {
    stop("Sign in to your own online account and wait for the homepage to finish loading.");
  }
  if (typeof device !== "string" || !/^[\w-]{16,64}$/.test(device)) {
    stop("The game has not established this device yet. Reload the homepage first.");
  }
  const unchanged = () => {
    const current = read("pb.session");
    if (current?.id !== session.id || current?.token !== session.token || read("pb.device") !== device) {
      stop("The signed-in account changed during export. Nothing was downloaded; try again.");
    }
    const pending = read("pb.pending");
    if (pending !== null && !Array.isArray(pending)) stop("Unrecognized pending-save data; export stopped.");
    if (pending?.some(row => row?.acc === session.id)) {
      stop("The online game still has unsynced run rewards. Let it finish syncing at the homepage first.");
    }
    if (read("pb.live")?.acc === session.id || read("pb.coop.run")?.acc === session.id) {
      stop("Finish your run and leave the co-op room, then export from the homepage.");
    }
  };
  unchanged();
  const renderedBuild = document.querySelector('meta[name="pokebonk-build"]')?.content;
  const source = review.sources.find(value => value.build === renderedBuild);
  if (!source) stop("This online build has not been reviewed by this exporter. Ask for an updated script.");

  // Exact, fixed, read-only URLs. Tokens go only to the game's own API in a
  // request header, never in URLs, logs, downloads or third-party services.
  const get = async (route, authenticated = true, limit = MAX_STATE_BYTES) => {
    const permitted = authenticated ? ["/auth/me", "/profile", "/profile/stash"] : ["/version.json"];
    if (!permitted.includes(route)) stop("Unexpected export endpoint.");
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
    try {
      let response;
      try {
        response = await fetch((authenticated ? "https://api.pokebonk.com" : location.origin) + route, {
          method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
          signal: controller.signal,
          headers: authenticated ? {Accept: "application/json", Authorization: `Bearer ${session.token}`,
            "X-Device": device, "X-Client": String(source.client)} : {Accept: "application/json"},
        });
      } catch { stop("The read-only export request failed or timed out. Your online save was not changed."); }
      if (response.status === 401) stop("Your online session expired. Sign in again and rerun the script.");
      if (!response.ok) stop(`The game refused the export read (HTTP ${response.status}). Try again later.`);
      const reader = response.body?.getReader();
      if (!reader) stop("The game returned an unreadable response.");
      const decoder = new TextDecoder("utf-8", {fatal: true});
      let bytes = 0, text = "";
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > limit) {
            await reader.cancel();
            stop("The game response is too large to export safely.");
          }
          text += decoder.decode(part.value, {stream: true});
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      try { return JSON.parse(text); } catch { stop("The game returned invalid JSON; no backup was created."); }
    } finally { clearTimeout(timer); }
  };
  const version = await get("/version.json", false, 4096);
  if (version?.build !== source.build || version.version !== source.version) {
    stop("The online game updated after this page loaded. Reload it and use a reviewed exporter.");
  }
  const me = await get("/auth/me", true, 65536);
  if (me?.id !== session.id) stop("The server account does not match this browser session; export stopped.");
  const response = await get("/profile"), stash = await get("/profile/stash");
  unchanged();
  const finalVersion = await get("/version.json", false, 4096);
  if (finalVersion.build !== version.build || finalVersion.version !== version.version) {
    stop("The online build changed during export. Nothing was downloaded; reload and try again.");
  }
  unchanged();
  const rawProfile = response?.profile;
  if (!object(rawProfile) || !object(stash)) stop("The game returned an unsupported profile or build-library format.");

  // Reject unsafe keys and unexpectedly mixed-in authentication data rather
  // than exporting all of localStorage or silently stripping unknown data.
  const privateKeys = new Set(["token", "access_token", "refresh_token", "id_token",
    "password", "client_secret", "authorization", "cookie", "cookies", "session"]);
  const inspect = (value, depth = 0) => {
    if (depth > 90) stop("Profile nesting is too deep.");
    if (value === null || ["string", "boolean"].includes(typeof value)) return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (Array.isArray(value)) { for (const child of value) inspect(child, depth + 1); return; }
    if (!object(value)) stop("The export contains unsupported values.");
    for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key) || privateKeys.has(key.toLowerCase())) {
        stop("Unexpected sensitive or unsafe data was returned. No file was downloaded.");
      }
      inspect(child, depth + 1);
    }
  };
  inspect(rawProfile);
  inspect(stash);
  const now = Date.now(), upstream = {version: source.version, build: source.build};
  const archive = {format: "pokebonk-online-profile-archive", archiveVersion: 1,
    exportedAt: new Date(now).toISOString(), upstream, profile: rawProfile, stash,
    excluded: ["login credentials", "unfinished runs", "live rooms", "server-only services"]};
  let result, compatible = false, reason = "";
  try {
    result = convertOnlineArchive(archive, review, {validateEnvelope,
      randomUUID: () => crypto.randomUUID(), now});
    compatible = true;
  } catch (error) {
    // Preserve the complete original profile instead of silently deleting
    // unsupported progression to force a successful native import.
    reason = error instanceof Error ? error.message : "Unsupported save shape.";
    result = {...archive, compatibility: {importable: false, targetAppVersion: review.appVersion,
      reason: reason.slice(0, 300)}};
  }
  const text = JSON.stringify(result, null, 2);
  if (new TextEncoder().encode(text).length > MAX_STATE_BYTES) {
    stop("This backup exceeds the offline importer's 32 MiB limit. No file was downloaded.");
  }
  const name = `pokebonk-${compatible ? "OFFLINE-IMPORT" : "ONLINE-ARCHIVE-NOT-IMPORTABLE"}-${new Date(now)
    .toISOString().replace(/[:.]/g, "-")}.json`;
  const url = URL.createObjectURL(new Blob([text], {type: "application/json"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  if (compatible) {
    console.info(`Downloaded ${name}. In PokéBonk Offline ${review.appVersion}, export your existing backup first, then use Player & saves → Import backup. This replaces local progress, not merges it. Newer online-only features may not be usable. The original profile is included in onlineArchive.`);
  } else {
    console.warn(`Downloaded an ORIGINAL ARCHIVE ONLY, not an importable offline save. ${reason} Keep the file; do not import it or edit out the incompatible data. Ask for a reviewed converter.`);
  }
})({"appVersion":"1.3.1","schema":1,"targetGame":{"version":"0.10.31","build":"mwv6wzyo"},"sources":[{"version":"0.10.35","build":"mwwhf156","client":8}],"species":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255,256,257,258,259,260,261,262,263,264,265,266,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,282,283,284,285,286,287,288,289,290,291,292,293,294,295,296,297,298,299,300,301,302,303,304,305,306,307,308,309,310,311,312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,339,340,341,342,343,344,345,346,347,348,349,350,351,352,353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383,384,385,386,387,388,389,390,391,392,393,394,395,396,397,398,399,400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,419,420,421,422,423,424,425,426,427,428,429,430,431,432,433,434,435,436,437,438,439,440,441,442,443,444,445,446,447,448,449,450,451,452,453,454,455,456,457,458,459,460,461,462,463,464,465,466,467,468,469,470,471,472,473,474,475,476,477,478,479,480,481,482,483,484,485,486,487,488,489,490,491,492,493,494,495,496,497,498,499,500,501,502,503,504,505,506,507,508,509,510,511,512,513,514,515,516,517,518,519,520,521,522,523,524,525,526,527,528,529,530,531,532,533,534,535,536,537,538,539,540,541,542,543,544,545,546,547,548,549,550,551,552,553,554,555,556,557,558,559,560,561,562,563,564,565,566,567,568,569,570,571,572,573,574,575,576,577,578,579,580,581,582,583,584,585,586,587,588,589,590,591,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642,643,644,645,646,647,648,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,664,665,666,667,668,669,670,671,672,673,674,675,676,677,678,679,680,681,682,683,684,685,686,687,688,689,690,691,692,693,694,695,696,697,698,699,700,701,702,703,704,705,706,707,708,709,710,711,712,713,714,715,716,717,718,719,720,721,722,723,724,725,726,727,728,729,730,731,732,733,734,735,736,737,738,739,740,741,742,743,744,745,746,747,748,749,750,751,752,753,754,755,756,757,758,759,760,761,762,763,764,765,766,767,768,769,770,771,772,773,774,775,776,777,778,779,780,781,782,783,784,785,786,787,788,789,790,791,792,793,794,795,796,797,798,799,800,801,802,803,804,805,806,807,808,809,810,811,812,813,814,815,816,817,818,819,820,821,822,823,824,825,826,827,828,829,830,831,832,833,834,835,836,837,838,839,840,841,842,843,844,845,846,847,848,849,850,851,852,853,854,855,856,857,858,859,860,861,862,863,864,865,866,867,868,869,870,871,872,873,874,875,876,877,878,879,880,881,882,883,884,885,886,887,888,889,890,891,892,893,894,895,896,897,898,899,900,901,902,903,904,905,906,907,908,909,910,911,912,913,914,915,916,917,918,919,920,921,922,923,924,925,926,927,928,929,930,931,932,933,934,935,936,937,938,939,940,941,942,943,944,945,946,947,948,949,950,951,952,953,954,955,956,957,958,959,960,961,962,963,964,965,966,967,968,969,970,971,972,973,974,975,976,977,978,979,980,981,982,983,984,985,986,987,988,989,990,991,992,993,994,995,996,997,998,999,1000,1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1011,1012,1013,1014,1015,1016,1017,1018,1019,1020,1021,1022,1023,1024,1025],"expeditionItems":["amulet-coin","assault-vest","big-nugget","big-pearl","big-root","black-belt","blunder-policy","bright-powder","card-boss","card-elite","card-night","card-silent","card-stampede","card-treasure","charcoal","choice-band","choice-scarf","choice-specs","cleanse-tag","coin-case","comet-shard","dire-hit","dome-fossil","dowsing-machine","dragon-fang","elixir","escape-rope","ether","eviolite","exp-share","expert-belt","explorer-map","focus-band","full-heal","gold-teeth","grip-claw","hard-stone","heavy-boots","helix-fossil","honey","key-deep","key-lab","key-master","key-rest","key-rocket","kings-rock","leftovers","leg-aerodactyl","leg-alakazam","leg-arcanine","leg-articuno","leg-chansey","leg-cloyster","leg-ditto","leg-dragonite","leg-electrode","leg-gengar","leg-gyarados","leg-hitmonchan","leg-jynx","leg-kabutops","leg-kangaskhan","leg-lapras","leg-magmar","leg-marowak","leg-mew","leg-mewtwo","leg-moltres","leg-omastar","leg-pinsir","leg-porygon","leg-raichu","leg-rhydon","leg-scyther","leg-snorlax","leg-tauros","leg-zapdos","life-orb","light-clay","loaded-dice","lucky-egg","magnet","mat-bone","mat-cloth","mat-comet","mat-crystal","mat-dust","mat-herb","mat-ore","mat-part","mat-scale","max-potion","metal-powder","metronome","miracle-seed","muscle-band","mystic-water","never-melt-ice","nugget","pearl","poison-barb","poke-flute","poke-radar","potion","power-bracer","protector","quick-claw","rare-bone","razor-claw","razor-fang","repel","revive","rocket-compass","rocky-helmet","safari-bait","safari-boots","safari-rock","safety-goggles","scope-lens","set-dojo-band","set-dojo-charm","set-dojo-gem","set-dojo-held","set-rocket-band","set-rocket-charm","set-rocket-gem","set-rocket-held","set-safari-band","set-safari-charm","set-safari-gem","set-safari-held","set-silph-band","set-silph-charm","set-silph-gem","set-silph-held","sg-bug-1","sg-bug-2","sg-bug-3","sg-dragon-1","sg-dragon-2","sg-dragon-3","sg-electric-1","sg-electric-2","sg-electric-3","sg-fighting-1","sg-fighting-2","sg-fighting-3","sg-fire-1","sg-fire-2","sg-fire-3","sg-flying-1","sg-flying-2","sg-flying-3","sg-ghost-1","sg-ghost-2","sg-ghost-3","sg-grass-1","sg-grass-2","sg-grass-3","sg-ground-1","sg-ground-2","sg-ground-3","sg-ice-1","sg-ice-2","sg-ice-3","sg-normal-1","sg-normal-2","sg-normal-3","sg-poison-1","sg-poison-2","sg-poison-3","sg-psychic-1","sg-psychic-2","sg-psychic-3","sg-rock-1","sg-rock-2","sg-rock-3","sg-water-1","sg-water-2","sg-water-3","sharp-beak","shed-shell","shell-bell","shoal-shell","silk-scarf","silph-scope","silver-powder","smoke-ball","soft-sand","soothe-bell","spell-tag","star-piece","stardust","super-potion","super-repel","trophy-safari","trophy-valley","twisted-spoon","wide-lens","wise-glasses","x-attack","x-defense","x-speed","zoom-lens"]}, {validateEnvelope,MAX_STATE_BYTES,convertOnlineArchive});
})().catch(error => console.error("PokéBonk save export stopped:", error instanceof Error ? error.message : "Export failed. No save was changed."));
