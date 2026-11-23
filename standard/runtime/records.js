// A bounded-size row per ruleset / Pokémon / map / difficulty, not a rolling
// top-N history. New recent runs cannot evict a long-standing personal best.
const MODES = new Set(["standard", "endless", "relay", "mutation", "bossrush", "tower"]);
export const RECORD_TABS = Object.freeze(["kos", "survival", "time"]);
const finite = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const number = value => finite(value) ? value : null;
const token = value => typeof value === "string" && /^[\w:-]{1,100}$/.test(value);
const modeOf = record => record.mode ?? "standard";
const defaultMetrics = record => ({kills: record.kills, time: record.time, trial: true});

export function recordRow(record, metrics = defaultMetrics) {
  if (!record || !MODES.has(modeOf(record)) || !token(record.biome)) return null;
  const species = Number.isInteger(record.species) && record.species > 0 ? record.species : null;
  const mode = modeOf(record);
  let measured;
  try { measured = metrics(record) ?? {}; } catch { measured = {}; }
  const variant = mode === "bossrush" && finite(record.rush?.week) ? `rotation:${record.rush.week}` :
    mode === "mutation" && finite(record.mutationDay) ? `day:${record.mutationDay}` : "";
  return {
    id: typeof record.id === "string" ? record.id.slice(0, 180) : "",
    mode, species, finalSpecies: Number.isInteger(record.finalSpecies) && record.finalSpecies > 0 ? record.finalSpecies : species,
    biome: record.biome, tier: Number.isInteger(record.tier) ? record.tier : 0,
    kills: number(measured.kills ?? record.kills), time: number(record.time),
    attackTime: measured.trial === false ? null : number(measured.time),
    victory: record.victory === true, date: number(record.date),
    mutation: token(record.mutation) ? record.mutation : "", variant,
    floor: mode === "tower" && finite(record.stage) ? record.stage : null,
    beaten: mode === "bossrush" && finite(record.rush?.beaten) ? record.rush.beaten : null,
    legacy: record.legacy === true,
  };
}
const rowKey = row => [row.mode, row.species ?? "unknown", row.biome, row.tier,
  row.mutation, row.variant].join("|");
const compare = (tab, a, b) => tab === "time" ?
  a.attackTime - b.attackTime || (b.kills ?? -1) - (a.kills ?? -1) :
  tab === "survival" ? b.time - a.time || (b.kills ?? -1) - (a.kills ?? -1) :
  b.kills - a.kills || Number(b.victory) - Number(a.victory) || (a.time ?? Infinity) - (b.time ?? Infinity);
const eligible = (tab, row) => tab === "kos" ? row.kills > 0 :
  tab === "survival" ? ["endless", "relay"].includes(row.mode) && row.time > 0 :
  row.victory && row.attackTime > 0 && (row.mode === "standard" ||
    row.mode === "bossrush" && row.beaten >= 5);

export function addRecord(records, record, metrics) {
  const row = recordRow(record, metrics);
  if (!row) return;
  for (const tab of RECORD_TABS) {
    if (!eligible(tab, row)) continue;
    const key = rowKey(row), previous = records[tab][key];
    if (!previous || compare(tab, row, previous) < 0 ||
        compare(tab, row, previous) === 0 && previous.legacy && !row.legacy) records[tab][key] = row;
  }
}
export function ensureRecords(state, metrics) {
  if (state.records != null) {
    if (state.records.version !== 1 || RECORD_TABS.some(tab => !state.records[tab] ||
        typeof state.records[tab] !== "object" || Array.isArray(state.records[tab]))) {
      throw new Error("This personal-records format requires its original app version. Your save has not been overwritten.");
    }
    return state.records;
  }
  const records = {version: 1, kos: {}, survival: {}, time: {}}, profile = state.profile;
  for (const record of [...Object.values(profile.best ?? {}), ...(profile.runs ?? [])]) {
    addRecord(records, record, metrics);
  }
  // Older saves sometimes retain just a metric, not the complete run. Keep the
  // known value with an honest missing Pokémon/date rather than inventing one.
  for (const [key, kills] of Object.entries(profile.kills ?? {})) {
    const split = /^(.*)-([0-2])$/.exec(key);
    if (split && finite(kills)) addRecord(records, {
      mode: "standard", biome: split[1], tier: +split[2], kills, legacy: true,
    });
  }
  for (const [key, best] of Object.entries(profile.times ?? {})) {
    const split = /^(.*)-([0-2])$/.exec(key);
    if (split && best && finite(best.time)) addRecord(records, {
      ...best, mode: "standard", biome: split[1], tier: +split[2],
      victory: true, legacy: true,
    });
  }
  for (const [biome, best] of Object.entries(profile.endless ?? {})) {
    if (best) addRecord(records, {...best, mode: "endless", biome, tier: 0, legacy: true});
  }
  // Once a fully described row already covers an old aggregate, don't show a
  // duplicate "unknown Pokémon" row for that same or weaker aggregate.
  for (const [key, row] of Object.entries(records.kos)) if (row.species === null &&
    Object.values(records.kos).some(other => other.species !== null && other.mode === row.mode &&
      other.biome === row.biome && other.tier === row.tier && other.kills >= row.kills)) delete records.kos[key];
  state.records = records;
  return records;
}
export function personalRecords(state, tab = "kos", metrics) {
  if (!RECORD_TABS.includes(tab)) throw new Error("Unknown personal-records tab.");
  return Object.values(ensureRecords(state, metrics)[tab]).sort((a, b) => compare(tab, a, b) ||
    a.biome.localeCompare(b.biome) || (a.species ?? 0) - (b.species ?? 0));
}
