// Native-only discovery. A query is link-scoped multicast, never an IP sweep.
import {invitation, privateIPv4, sameSubnet} from "./lan-policy.mjs";
import {lanRoomCode} from "./coop-mode.mjs";
import {coopSettings,coopRuleTime} from "./coop-rules.mjs";
export const DISCOVERY_GROUP = "239.255.80.66";
export const DISCOVERY_PORT = 48124;
export const DISCOVERY_MAGIC = "PBLAND1";
export const DISCOVERY_BYTES = 1400;
export const DISCOVERY_MS = 4000;
export const discoveryNonce = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
export function discoveryQuery(value, identity) {
  return Boolean(value && value.magic === DISCOVERY_MAGIC && value.op === "find" &&
    value.identity === identity && discoveryNonce(value.nonce)&&
    (value.code===undefined||typeof value.code==="string"&&/^[A-Z0-9]{4}$/.test(value.code)));
}
export function advertisedRoom(state) {
  if (state?.role !== "host" || !["hosting", "lobby"].includes(state.phase) ||
      !Array.isArray(state.members) || state.members.length < 1 || state.members.length >= (state.seats?.capacity??4) ||
      !/^lan-[\w-]{1,80}$/.test(state.me ?? "")) return null;
  try {
    const invite = invitation(state.invitation), host = state.members.find(member => member.id === state.me);
    if (!host || typeof host.name !== "string" || host.name.length > 24) return null;
    return {id: state.me, name: host.name, count: state.members.length,
      discoverable:state.seats?.discoverable!==false,capacity:state.seats?.capacity??4,
      settings:coopSettings(state.settings),
      ...(state.rulesAt!==undefined?{rulesAt:coopRuleTime(state.rulesAt)}:{}),
      invitation: `${invite.address}:${invite.port}#${invite.secret}`};
  } catch { return null; }
}
export function discoveryRoom(value, {identity, nonce, remote, interfaces,code}) {
  if (!value || value.magic !== DISCOVERY_MAGIC || value.op !== "room" ||
      value.identity !== identity || value.nonce !== nonce || !discoveryNonce(nonce) ||
      !privateIPv4(remote) || !/^lan-[\w-]{1,80}$/.test(value.id ?? "") ||
      typeof value.name !== "string" || value.name.length > 24 || /[\u0000-\u001f\u007f]/.test(value.name) ||
      !Number.isInteger(value.count) || value.count < 1 || value.count >= (value.capacity??4)||
      ![2,3,4].includes(value.capacity??4)||
      (code?lanRoomCode(value.id)!==code:value.discoverable===false)) return null;
  try {
    const invite = invitation(value.invitation);
    if (invite.address !== remote || !interfaces.some(n => sameSubnet(n.address, remote, n.netmask))) return null;
    return {id: value.id, name: value.name, count: value.count,capacity:value.capacity??4,
      settings:coopSettings(value.settings),
      ...(value.rulesAt!==undefined?{rulesAt:coopRuleTime(value.rulesAt)}:{}),
      invitation: `${remote}:${invite.port}#${invite.secret}`};
  } catch { return null; }
}
