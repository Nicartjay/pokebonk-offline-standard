// Source for the standalone console script. The generator injects the actual
// offline validator; importing this module never accesses a browser/account.
export function convertOnlineArchive(archive, review, {validateEnvelope, randomUUID, now}) {
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
}

export async function exportOnlineSave(review, {validateEnvelope, MAX_STATE_BYTES, convertOnlineArchive}) {
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
}
