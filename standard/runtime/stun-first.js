// Transport policy for the trusted INTERNET broker, not the game
// renderer and not the existing LAN broker. No networking or keys live here.
import {coopConnectionMode} from "../common/coop-mode.mjs";
const STUN = Object.freeze([{urls: ["stun:stun.cloudflare.com:3478"]}]);
export {STUN as STUN_VOICE_SERVERS};
const turnURL = /^turns?:turn\.cloudflare\.com:(?:3478|5349|443)\?transport=(?:udp|tcp)$/;
export class StunFirstPolicy {
  constructor({requestRelay, now = () => Date.now(), directTimeoutMs = 12000, mode = "turn-fallback"}) {
    this.requestRelay = requestRelay; this.now = now;
    this.mode = coopConnectionMode(mode);
    this.directTimeoutMs = Math.max(8000, Math.min(20000, directTimeoutMs));
    this.epoch = 0; this.begin();
  }
  begin() {
    this.epoch++; this.startedAt = this.now(); this.phase = "direct";
    this.connected = false; this.failed = false; this.pending = null;
    return {iceServers: this.mode === "lan" ? [] : structuredClone(STUN), iceTransportPolicy: "all"};
  }
  selected(status) {
    // Only pass status derived from a selected, succeeded ICE pair.
    if (["lan", "stun", "direct", "turn"].includes(status?.kind)) this.connected = true;
    else if (status?.kind === "disconnected") { this.connected = false; this.failed = true; }
  }
  directFailed() { if (!this.connected) this.failed = true; }
  settings(reply) {
    if (!reply || !Number.isSafeInteger(reply.expiresAt) || reply.expiresAt < this.now() + 30000 ||
        reply.expiresAt > this.now() + 330000 ||
        !Array.isArray(reply.iceServers) || reply.iceServers.length !== 1) throw Error("Relay authorization is unavailable.");
    const server = reply.iceServers[0], urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!urls.length || urls.length > 4 || !urls.every(url => typeof url === "string" && turnURL.test(url)) ||
        typeof server.username !== "string" || !/^[A-Za-z0-9_:=-]{1,512}$/.test(server.username) ||
        typeof server.credential !== "string" || server.credential.length < 8 || server.credential.length > 512)
      throw Error("Invalid relay configuration.");
    return {iceServers: [...structuredClone(STUN), {urls: [...urls], username: server.username, credential: server.credential}],
      iceTransportPolicy: "all", restartIce: true, expiresAt:reply.expiresAt};
  }
  async renew() {
    if(this.mode!=="turn-fallback" || this.phase!=="fallback")return null;
    const epoch=this.epoch;
    try {
      const reply=await this.requestRelay();
      return epoch===this.epoch ? this.settings(reply) : null;
    } catch(error) {
      if(epoch===this.epoch)this.phase="blocked";
      throw error;
    }
  }
  async fallback({peerRequested=false}={}) {
    if(this.mode!=="turn-fallback")return null;
    if (this.pending) return this.pending;
    if ((this.connected && !peerRequested) || this.phase !== "direct") return null;
    if (!peerRequested && !this.failed && this.now() - this.startedAt < this.directTimeoutMs) return null;
    const epoch = this.epoch;
    const pending = (async () => {
      try {
        const reply = await Promise.resolve().then(() => this.requestRelay());
        if (epoch !== this.epoch || this.connected && !peerRequested) return null;
        const settings=this.settings(reply);
        this.phase = "fallback";
        // The caller must synchronize an ICE restart with this peer. This is
        // not a request to force already-direct peers in the room onto TURN.
        return settings;
      } catch (error) {
        // Fail closed instead of retrying issuance in a loop or bypassing the
        // service's budget denial. A new explicit connection attempt is needed.
        if (epoch === this.epoch) this.phase = "blocked";
        throw error;
      } finally { if (epoch === this.epoch) this.pending = null; }
    })();
    this.pending = pending;
    return pending;
  }
  close() { this.epoch++; this.phase = "closed"; this.connected = false; this.pending = null; }
}
