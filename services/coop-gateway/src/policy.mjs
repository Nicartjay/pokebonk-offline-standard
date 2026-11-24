export const POLICY = Object.freeze({
  maxPlayers: 4, maxRooms: 8, maxRoomCreatesPerHour:12, roomLifetimeMs: 2 * 60 * 60 * 1000,
  maxBodyBytes: 36 * 1024, maxSignalBytes: 32 * 1024,
  maxRoomSignalBytes: 16 * 1024 * 1024, maxMessagesPerMinute: 60,
  credentialTtlSeconds: 300, credentialRotateBeforeMs: 120000,
  maxRelayRequestsPerMinute: 8,
  // Either endpoint may need renewal first when trainers join at different
  // times. This bounds both schedules across the two-hour room lifetime.
  maxRelayMembers: 32, maxRelayLeases: 64, maxIceGeneration: 96,
  // Deliberately conservative until real four-player traffic is profiled.
  reservationBytes: 512 * 1000 * 1000,
  cutoffBytes: 800 * 1000 * 1000 * 1000,
  usageMaxAgeMs: 120000, usageRefreshMs: 45000, directAttemptMs: 12000,
  reservationLifetimeMs: 60000, maxFindAttempts: 3,
});
export const MATCH_RULES = "classic-forest-normal-v1";
export function roomCodeValid(value) {
  return typeof value==="string"&&/^(?:[A-Z2-7]{6}|[A-Z2-7]{8})$/.test(value);
}
export function coopProtocol(value=1) {
  requireValue(value===1||value===2,400,"invalid_coop_protocol");return value;
}
export function internetMode(value) {
  requireValue(["stun-only","turn-fallback"].includes(value),400,"invalid_connection_mode");
  return value;
}
export const STUN_SERVERS = Object.freeze([{urls: ["stun:stun.cloudflare.com:3478"]}]);
const TURN_URLS = new Set([
  "turn:turn.cloudflare.com:3478?transport=udp",
  "turn:turn.cloudflare.com:3478?transport=tcp",
  "turns:turn.cloudflare.com:5349?transport=tcp",
  "turns:turn.cloudflare.com:443?transport=tcp",
]);
export class Fault extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function requireValue(condition, status, code) { if (!condition) throw new Fault(status, code); }
export function json(value, status = 200) {
  return Response.json(value, {status, headers: {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer"}});
}
export async function body(request, max = POLICY.maxBodyBytes) {
  requireValue(request.headers.get("Content-Type")?.split(";")[0] === "application/json", 415, "json_required");
  const reader = request.body?.getReader(); requireValue(reader, 400, "body_required");
  let length = 0, text = ""; const decoder = new TextDecoder("utf-8", {fatal: true});
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.byteLength;
      requireValue(length <= max, 413, "body_too_large");
      text += decoder.decode(part.value, {stream: true});
    }
    const value = JSON.parse(text + decoder.decode());
    requireValue(value && typeof value === "object" && !Array.isArray(value), 400, "object_required");
    return value;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof Fault) throw error;
    throw new Fault(400, "invalid_json");
  } finally { reader.releaseLock(); }
}
export function randomToken(bytes = 32) {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))))
    .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
export async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function authorized(header, secret) {
  if (typeof secret !== "string" || secret.length < 32 || typeof header !== "string" || header.length > 256) return false;
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(header);
  if (!match) return false;
  const a = await hash(match[1]), b = await hash(secret);
  return equalHashes(a, b);
}
export function equalHashes(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== 64 || b.length !== 64) return false;
  let difference = 0; for (let i = 0; i < 64; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
export async function privateAddressKey(request, secret) {
  requireValue(typeof secret === "string" && secret.length >= 32, 503, "service_not_configured");
  const address = request.headers.get("CF-Connecting-IP");
  requireValue(address && address.length <= 64, 403, "edge_identity_required");
  const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(address)))]
    .map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
export function profile(value) {
  requireValue(typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 24 &&
    !/[\u0000-\u001f\u007f]/.test(value.name) && Number.isInteger(value.species) && value.species >= 1 && value.species <= 10000, 400, "invalid_player");
  return {name: value.name.trim(), species: value.species};
}
export function acceptedBuild(value, env) {
  let accepted; try { accepted = JSON.parse(env.ACCEPTED_BUILD_IDS); } catch { throw new Fault(503, "builds_not_configured"); }
  requireValue(Array.isArray(accepted) && accepted.length > 0 && accepted.length <= 8, 503, "builds_not_configured");
  requireValue(typeof value === "string" && /^[A-Za-z0-9|_.-]{16,256}$/.test(value) && accepted.includes(value), 409, "matching_build_required");
  return value;
}
export function signalDescription(value, mode = "turn-fallback") {
  requireValue(value && ["offer", "answer"].includes(value.type) && typeof value.sdp === "string" &&
    new TextEncoder().encode(value.sdp).byteLength <= POLICY.maxSignalBytes &&
    /^v=0\r?\n/.test(value.sdp) && /^m=application /m.test(value.sdp) &&
    !/^m=(?!application )/m.test(value.sdp) && !/^a=remote-candidates:/m.test(value.sdp) &&
    !/[\u0000]/.test(value.sdp) &&
    (mode !== "stun-only" || !/^a=candidate:.*\btyp relay\b/m.test(value.sdp)), 400, "data_channel_sdp_required");
  return {type: value.type, sdp: value.sdp};
}
export function turnServers(value) {
  const list = Array.isArray(value?.iceServers) ? value.iceServers : [value?.iceServers];
  const result = list.filter(Boolean).flatMap(server => {
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls]).filter(url => TURN_URLS.has(url));
    if (!urls.length) return [];
    requireValue(typeof server.username === "string" && /^[A-Za-z0-9_:=-]{1,512}$/.test(server.username) &&
      typeof server.credential === "string" && server.credential.length >= 16 && server.credential.length <= 512, 502, "invalid_issuer_response");
    return [{urls: [...new Set(urls)], username: server.username, credential: server.credential}];
  });
  requireValue(result.length === 1, 502, "invalid_issuer_response");
  return result;
}
export function freshUsage(report, now = Date.now()) {
  requireValue(report?.scope === "account-shared-realtime-egress" && report.complete === true &&
    Number.isSafeInteger(report.bytes) && report.bytes >= 0 &&
    Number.isSafeInteger(report.periodStart) && Number.isSafeInteger(report.periodEnd) &&
    report.periodEnd > report.periodStart && report.periodEnd - report.periodStart <= 32 * 86400000 &&
    report.periodStart <= now && now < report.periodEnd &&
    Number.isSafeInteger(report.asOf) && report.asOf >= report.periodStart &&
    report.asOf <= now && now - report.asOf <= POLICY.usageMaxAgeMs, 503, "fresh_account_usage_required");
  return report;
}
export function relayAdmission({env, usage, reservedBytes = 0, activeLeases = 0, disabled = false, reuse = false, now = Date.now()}) {
  requireValue(env.TURN_MODE === "guarded-payg" && env.TURN_PAYG_RISK_ACCEPTED === "true" && !disabled, 503, "turn_disabled");
  freshUsage(usage, now);
  const cutoff = Number(env.TURN_CUTOFF_BYTES ?? POLICY.cutoffBytes);
  requireValue(Number.isSafeInteger(cutoff) && cutoff > 0 && cutoff <= POLICY.cutoffBytes, 503, "invalid_budget");
  requireValue(Number.isSafeInteger(reservedBytes) && reservedBytes >= 0 &&
    usage.bytes + reservedBytes + (reuse ? 0 : POLICY.reservationBytes) <= cutoff, 503, "relay_budget_exhausted");
  requireValue(activeLeases < POLICY.maxRelayLeases, 429, "relay_capacity_reached");
  return {reservationBytes: reuse ? 0 : POLICY.reservationBytes, expiresAt: now + POLICY.credentialTtlSeconds * 1000};
}
