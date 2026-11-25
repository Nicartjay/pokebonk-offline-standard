// Shared bounded recovery policy. No invitations, bearer tokens or network APIs.
export const COOP_RECONNECT_MS = 90000;
export const COOP_RETRY_MAX_MS = 8000;
export const COOP_MAX_PEER_ROUND = 32;
export const coopPair = (a, b) => [a, b].sort().join("|");
export const retryDelay = attempt => Math.min(COOP_RETRY_MAX_MS, 500 * 2 ** Math.min(4, Math.max(0, attempt)));
export function recoveryState(value) {
  if (value === undefined) return undefined;
  if (!value || !["reconnecting", "resynchronizing"].includes(value.status) ||
      !Number.isSafeInteger(value.until) || value.until <= 0 ||
      !Number.isSafeInteger(value.attempt) || value.attempt < 0 || value.attempt > 1000)
    throw Error("Invalid co-op recovery state.");
  return {status: value.status, until: value.until, attempt: value.attempt};
}
export function peerLinks(value, members, me) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 3 || new Set(value).size !== value.length ||
      value.some(id => id === me || !members.some(member => member.id === id)))
    throw Error("Invalid connected co-op peers.");
  return [...value];
}
