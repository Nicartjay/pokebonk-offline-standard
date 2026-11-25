// Connection policy only; these values are not gameplay modes or server URLs.
import {coopSettings,coopRuleTime} from "./coop-rules.mjs";
export const COOP_CONNECTION_MODES = Object.freeze([
  Object.freeze({value:"lan", title:"LAN", subtitle:"Same Wi-Fi or hotspot"}),
  Object.freeze({value:"stun-only", title:"STUN only", subtitle:"Direct internet · never use TURN"}),
  Object.freeze({value:"turn-fallback", title:"STUN + TURN fallback", subtitle:"Direct first · relay only if needed"}),
]);
export function coopConnectionMode(value = "lan") {
  if (!COOP_CONNECTION_MODES.some(mode => mode.value === value)) throw Error("Invalid co-op connection mode.");
  return value;
}
export function coopRoomCodeLength(value = "lan") {
  return coopConnectionMode(value) === "lan" ? 4 : 6;
}
export function isCoopRoomCode(value, mode = "lan") {
  const length = coopRoomCodeLength(mode);
  return typeof value === "string" && new RegExp("^[A-Z0-9]{"+length+"}$").test(value);
}
// A public lookup hint, never a fragment of the LAN pairing key.
export function lanRoomCode(hostId) {
  if(typeof hostId!=="string"||!/^lan-[\w-]{1,80}$/.test(hostId))throw Error("Invalid LAN host identity.");
  let hash=0x811c9dc5;
  for(let index=0;index<hostId.length;index++)hash=Math.imul(hash^hostId.charCodeAt(index),16777619);
  return ((hash>>>0)%1679616).toString(36).toUpperCase().padStart(4,"0");
}
export function roomListing(value,mode="lan") {
  coopConnectionMode(mode);
  if(!value||!["idle","loading","ready","empty","error"].includes(value.status)||
    !Array.isArray(value.rooms)||value.rooms.length>(mode==="lan"?32:8))throw Error("Invalid room listing.");
  const codes=new Set(),rooms=value.rooms.map(room=>{
    if(!room||!isCoopRoomCode(room.code,mode)||codes.has(room.code)||
      typeof room.name!=="string"||room.name.length>24||/[\u0000-\u001f\u007f]/.test(room.name)||
      !Number.isInteger(room.players)||room.players<1||room.players>=4)throw Error("Invalid listed room.");
    if(room.capacity!==undefined&&(![2,3,4].includes(room.capacity)||room.players>=room.capacity))throw Error("Invalid room capacity.");
    codes.add(room.code);return {code:room.code,name:room.name,players:room.players,
      ...(room.capacity!==undefined?{capacity:room.capacity}:{}),
      ...(room.settings!==undefined?{settings:coopSettings(room.settings)}:{}),
      ...(room.rulesAt!==undefined?{rulesAt:coopRuleTime(room.rulesAt)}:{})};
  });
  return {status:value.status,rooms,...(typeof value.message==="string"?{message:value.message.slice(0,160)}:{})};
}
export function requireLanConnectionMode(value) {
  const mode = coopConnectionMode(value);
  if (mode !== "lan") throw Error("Internet co-op is not connected to the app yet. LAN was not started.");
  return mode;
}
export function coopModeMessage(value,{internetReady=false,relayReady=false}={}) {
  const mode = coopConnectionMode(value);
  if(internetReady&&mode!=="lan")return mode==="stun-only"?
    "Direct Internet co-op. Find a random match searches compatible open rooms; TURN is never used.":
    relayReady?"Internet co-op tries direct connections first. TURN fallback is subject to service availability and budget controls.":
      "Direct/STUN first. TURN relay is currently disabled; restrictive networks may not connect. LAN remains available.";
  return mode === "lan" ? "No room joined yet." :
    mode === "stun-only" ? "STUN only selected. Internet co-op setup is not complete yet; TURN will never be used in this mode." :
      "STUN + TURN fallback selected. Internet co-op setup is not complete yet; relay access remains disabled.";
}
export function coopRouteMessage(route){
  return {lan:"Using LAN · direct peer link",stun:"Using STUN · direct peer link",turn:"Using TURN · relayed peer link",
    direct:"Using a direct peer link",waiting:"Waiting for players",connecting:"Connecting peer links…"}[route]??"Connecting peer links…";
}
