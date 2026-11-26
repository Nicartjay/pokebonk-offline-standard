// Renderer-safe projections only: no media APIs, SDP, candidates or credentials.
export const VOICE_ACTIONS = Object.freeze(["enable","disable","mute","ptt","open-mic"]);
export const DEFAULT_VOICE_VOLUME = 100;
export const validVoiceVolume = value => Number.isInteger(value) && value >= 0 && value <= 100;
export const voiceVolumePreference = stored => typeof stored === "string" && /^(?:0|[1-9]\d?|100)$/.test(stored)
  ? Number(stored) : DEFAULT_VOICE_VOLUME;
export const VOICE_ERRORS = Object.freeze(["","permission-denied","microphone-unavailable",
  "direct-unavailable","relay-blocked","service-unavailable","audio-blocked","suspended"]);
export const voiceRoomActive = room => ["hosting","lobby","preparing","playing"].includes(room?.phase);
export const voiceAvailable = room => voiceRoomActive(room) &&
  (room.connectionMode === "lan" || room.voiceAvailable === true || room.capabilities?.voiceReady === true);
export function emptyVoiceState() {
  return {version:1,enabled:false,mode:"muted",microphone:"off",transmitting:false,peers:[],error:""};
}
export function voiceState(value, members = [], me) {
  if (value == null) return emptyVoiceState();
  if (JSON.stringify(value).length > 4096 || value.version !== 1 || typeof value.enabled !== "boolean" ||
      !["muted","ptt","open"].includes(value.mode) || !["off","requesting","ready","denied","error"].includes(value.microphone) ||
      typeof value.transmitting !== "boolean" || !VOICE_ERRORS.includes(value.error) ||
      !Array.isArray(value.peers) || value.peers.length > 3) throw Error("Invalid voice status.");
  const ids = new Set(), peers = value.peers.map(peer => {
    if (!peer || typeof peer.id !== "string" || peer.id === me || ids.has(peer.id) ||
        !members.some(member => member.id === peer.id) ||
        !["connecting","connected","unavailable"].includes(peer.status)) throw Error("Invalid voice peer.");
    ids.add(peer.id); return {id:peer.id,status:peer.status};
  });
  if (!value.enabled && (value.mode !== "muted" || value.microphone === "ready" || value.transmitting || peers.length) ||
      value.transmitting && (value.mode === "muted" || value.microphone !== "ready")) throw Error("Invalid microphone status.");
  return {version:1,enabled:value.enabled,mode:value.mode,microphone:value.microphone,
    transmitting:value.transmitting,peers,error:value.error};
}
export function voiceStatus(view, available = true) {
  if (!available) return "Voice needs the matching app and voice-enabled room service. Gameplay is unaffected.";
  if (view.error === "permission-denied") return "Microphone permission denied. You can still listen; allow it in system settings to speak.";
  if (view.error === "microphone-unavailable") return "Microphone unavailable. Check that it is connected and not in use.";
  if (view.error === "relay-blocked") return "A relayed audio route was blocked. Voice never uses TURN.";
  if (view.error === "direct-unavailable") return "Direct voice could not connect on this network. Gameplay can continue.";
  if (view.error === "audio-blocked") return "Audio playback was blocked. Disable and enable voice to retry.";
  if (view.error === "suspended") return "Voice stopped when the app went to the background. Enable it again when ready.";
  if (!view.enabled) return "Optional direct audio · no TURN relay · off until you enable it.";
  if (view.microphone === "requesting") return "Waiting for microphone permission…";
  const connected = view.peers.filter(peer => peer.status === "connected").length;
  if (view.transmitting) return `Mic live · ${connected} connected ${connected === 1 ? "teammate" : "teammates"}`;
  if (connected) return `${connected} connected ${connected === 1 ? "teammate" : "teammates"} · ${view.mode === "muted" ? "your mic is muted" : view.mode === "ptt" ? "hold to talk" : "mic on"}`;
  if (view.peers.some(peer => peer.status === "connecting")) return "Connecting direct voice…";
  return "Waiting for teammates to enable voice.";
}
