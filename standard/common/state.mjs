// Data only. Also imported by the sandboxed game; no Node or native APIs here.
export const FORMAT = "pokebonk-offline-standard";
export const MAX_STATE_BYTES = 32 * 1024 * 1024;
export const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = message => { throw new Error(message); };

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
  const ticket = value => {
    if (!isObject(value) || typeof value.id !== "string" || !value.id.startsWith("offline-") ||
        !Number.isSafeInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) fail("Invalid local run ticket.");
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
