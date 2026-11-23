// A room facade for the original co-op engine, not a second simulation.
// Only the native shell can establish a session. No renderer RTC or sockets.
const bridge = globalThis.PokeBonkLAN ?? globalThis.PokeBonkLANAndroid;
const read = () => {
  try {
    const value = bridge?.state();
    return typeof value === "string" ? JSON.parse(value) : value ?? {phase: "unavailable", members: []};
  } catch { return {phase: "unavailable", members: []}; }
};
const send = (channel, data) => {
  if (!bridge) return false;
  if (globalThis.PokeBonkLANAndroid && !globalThis.PokeBonkLAN) bridge.send(channel, JSON.stringify(data ?? null));
  else bridge.send(channel, data);
  return true;
};
export class LocalRoom {
  constructor(session, transmit = send) {
    this.session = session; this.transmit = transmit; this.inRun = false;
    this.handlers = null; this.pending = []; this.open = true;
    this.gone = new Set();
    this.me = session.me;
    this.room = {id: session.match.party, party: session.match.party, state: "playing",
      biome: "forest", tier: 0, mode: "standard", host: session.members[0].id,
      members: structuredClone(session.members)};
    this.mine = this.room.members.find(member => member.id === this.me);
    this.code = "LOCAL";
    this.mesh = {autoRetry: 0, sendCtl: (id, data) => this.open&&!this.gone.has(id)&&this.transmit("ctl", {to:id,payload:data})!==false,
      broadcast: data => {for(const peer of this.room.members)if(peer.id!==this.me&&!this.gone.has(peer.id))this.transmit("ctl",{to:peer.id,payload:data});},
      sendSnap: (id, buffer) => {
        if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > 16384) return false;
        let text = ""; for (const byte of new Uint8Array(buffer)) text += String.fromCharCode(byte);
        return this.open&&!this.gone.has(id)&&this.transmit("snap", {to:id,payload:btoa(text)})!==false;
      }, backlog: () => 0, rtt:()=>0, relayed: () => false, unstable: () => !this.open};
  }
  set ev(value) {
    this.handlers = value;
    const pending=this.pending.splice(0);
    queueMicrotask(()=>{if(this.handlers===value)for(const frame of pending)this.frame(frame);});
  }
  get ev() { return this.handlers ?? {}; }
  linkState(id) { return this.open && !this.gone.has(id) ? "open" : "closed"; }
  frame(frame) {
    if (!this.open) return;
    if (!this.handlers) { if (this.pending.length < 64) this.pending.push(frame); return; }
    const peer = frame.peer;
    if (!this.room.members.some(member=>member.id===peer&&peer!==this.me)||this.gone.has(peer)) return;
    if (frame.channel === "ctl") this.handlers.ctl?.(peer, frame.data);
    else if (frame.channel === "snap" && typeof frame.data === "string" && frame.data.length <= 21856) {
      try {
        const text = atob(frame.data);
        if (text.length <= 16384) this.handlers.snap?.(peer, Uint8Array.from(text, c => c.charCodeAt(0)).buffer);
      } catch {}
    }
  }
  closed() {
    if (!this.open) return;
    this.open = false; this.handlers?.closed?.();
  }
  peerClosed(peer) {this.gone.add(peer);this.handlers?.link?.(peer,"closed");}
  leave() { this.transmit("leave"); this.closed(); }
  // The upstream engine calls this as a notification after finishing. Keep
  // the connection until dispose so final totals can still arrive.
  backToLobby() { this.inRun = false; }
}
let preparing, launching, room, early = [];
function launchState() {
  const session = read(), app = globalThis.PokeBonkNativeApp;
  if (!app?.backend?.state) return;
  if (session.phase === "preparing" && session.match?.party !== preparing) {
    if(app.run){app.notice("Return to the lobby before the host starts LAN co-op.");send("failed");return;}
    preparing = session.match.party;
    void app.backend.prepareLan(session).then(() => {
      const latest = read();
      if (latest.phase === "preparing" && latest.match?.party === preparing) send("prepared", preparing);
      else return app.backend.cancelPreparedLan(session.match.party);
    }).catch(error => { app.notice(error.message); send("failed"); });
  } else if (session.phase === "playing" && session.match?.party !== launching) {
    launching = session.match.party;
    room = new LocalRoom(session);
    app.coopRoom = room;
    for (const frame of early.splice(0)) room.frame(frame);
    const mine = session.members.find(member => member.id === session.me);
    document.dispatchEvent(new Event("standard:lan-launch"));
    void app.startRun({mode: "standard", species: mine.species, biome: "forest", tier: 0,
      boosts: [], coop: {party: session.match.party, room}}).then(ok => {
      if (!ok) throw new Error("Could not start the prepared local co-op run. The ticket is preserved.");
    }).catch(error => { app.notice(error.message); send("failed"); });
  } else if (["closed", "error", "idle"].includes(session.phase)) {
    room?.closed(); early = [];
    if (preparing) void app.backend.cancelPreparedLan(preparing).catch(error => app.notice(error.message));
    preparing = null;
  }
}
if (bridge) {
  Object.defineProperty(globalThis, "PokeBonkLocalCoop", {value: Object.freeze({state: read, send})});
  document.addEventListener("standard:lan-state", launchState);
  document.addEventListener("standard:lan-frame", event => {
    try {
      const frame = typeof event.detail === "string" ? JSON.parse(event.detail) : event.detail;
      if (room?.open) room.frame(frame);
      else if (read().phase === "playing" && early.length < 64) early.push(frame);
    } catch (error) { console.warn("Invalid local co-op frame", error); }
  });
  document.addEventListener("standard:lan-peer-closed", event => {
    try {const value=JSON.parse(event.detail);room?.peerClosed(value.peer);} catch {}
  });
  document.addEventListener("standard:lan-notice", event => {
    try {globalThis.PokeBonkNativeApp?.notice(JSON.parse(event.detail).message);} catch {}
  });
}
