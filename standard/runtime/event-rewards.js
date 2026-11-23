// Only the bundled event pass and mission definitions can grant rewards.
// Competitive board/clan prizes and Expedition are deliberately not consulted.
import {OFFLINE_EVENTS} from "./modes.js";

export const EVENT_POLICY = "local-earned-v1";
const nonnegative = value => Number.isFinite(value) && value >= 0;
export function eventDefinition(catalog, id) {
  const local = OFFLINE_EVENTS.find(event => event.id === id);
  const matches = Array.isArray(catalog) ? catalog.filter(event => event.id === id && event.mode === local?.mode) : [];
  if (!local || matches.length !== 1) throw new Error("Unknown or unsupported offline event.");
  return matches[0];
}
export function eventState(profile, id) {
  profile.events ??= {};
  const state = profile.events[id] ??= {pts: 0, got: [], quests: [], c: {}, best: 0};
  if (!nonnegative(state.pts) || !nonnegative(state.best) || !Array.isArray(state.got) ||
      !Array.isArray(state.quests) || !state.c || typeof state.c !== "object" || Array.isArray(state.c)) {
    throw new Error("This event save needs its original app version. It has not been replaced.");
  }
  return state;
}
export function applyEventProgress(profile, result, catalog) {
  return OFFLINE_EVENTS.map(local => {
    const def = eventDefinition(catalog, local.id), state = eventState(profile, def.id);
    // These are the actual reviewed engine formulas, without an expired
    // server-calendar gate. Other progression modes earn the original small
    // participation amount too, exactly once per settled run.
    const gained = Math.max(0, Math.round(def.pointsFor(result)));
    if (!nonnegative(gained)) throw new Error("Invalid bundled event points.");
    state.pts += gained;
    const max = new Set(def.quests.filter(quest => quest.max).map(quest => quest.counter));
    for (const [key, value] of Object.entries(def.countersFor(result))) {
      if (!nonnegative(value)) throw new Error("Invalid bundled event counter.");
      if (value > 0) state.c[key] = max.has(key) ? Math.max(state.c[key] ?? 0, value) : (state.c[key] ?? 0) + value;
    }
    const best = def.boardValue?.(result);
    if (best != null && nonnegative(best) && best > state.best) state.best = best;
    return {id: def.id, gained, total: state.pts};
  });
}
function grant(profile, reward) {
  if (reward.dust != null) {
    if (!Number.isSafeInteger(reward.dust) || reward.dust < 0) throw new Error("Invalid bundled event reward.");
    profile.stardust += reward.dust;
    profile.totalStardust += reward.dust;
  }
  for (const id of reward.cosmetics ?? []) if (!profile.cosmetics.includes(id)) profile.cosmetics.push(id);
  for (const id of reward.bag ?? []) profile.bag[id] = Math.min(9, (profile.bag[id] ?? 0) + 1);
}
export function claimTrack(profile, catalog, id, index) {
  const def = eventDefinition(catalog, id), state = eventState(profile, id);
  if (!Number.isInteger(index) || index < -1 || index >= def.track.length) throw new Error("Unknown event pass reward.");
  const ready = n => state.pts >= def.track[n].at && !state.got.includes(n);
  const indices = index === -1 ? def.track.map((_, n) => n).filter(ready) : [index];
  if (!indices.length) throw new Error("No event pass rewards are ready to claim.");
  for (const n of indices) {
    if (state.got.includes(n)) throw new Error("This event pass reward was already claimed.");
    if (!ready(n)) throw new Error("Earn more event points before claiming this reward.");
    grant(profile, def.track[n].reward);
    state.got.push(n);
  }
}
export function claimMission(profile, catalog, id, mission) {
  const def = eventDefinition(catalog, id), state = eventState(profile, id);
  const quest = typeof mission === "string" ? def.quests.find(quest => quest.id === mission) : null;
  if (!quest) throw new Error("Unknown event mission.");
  if (state.quests.includes(quest.id)) throw new Error("This event mission was already claimed.");
  if ((state.c[quest.counter] ?? 0) < quest.goal) throw new Error("Complete this mission before claiming its reward.");
  grant(profile, quest.reward);
  state.quests.push(quest.id);
}
