// A room facade for the original co-op engine, not a second simulation.
// Only the native shell can establish a session. No renderer RTC or sockets.
import {RunRecovery} from "./run-recovery.js";
import {ExpeditionTeamIO} from "./expedition-team.js";
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
    this.departed = new Set(session.departed??[]);
    this.me = session.me;
    this.room = {id: session.match.party, party: session.match.party, state: "playing",
      biome: session.match.biome, tier: session.match.tier, mode: session.match.mode, host: session.members[0].id,
      members: structuredClone(session.members)};
    this.recovery = new RunRecovery(this);
    if(session.match.mode==="expedition")this.expeditionIO=new ExpeditionTeamIO(this);
    this.mine = this.room.members.find(member => member.id === this.me);
    this.code = "LOCAL";
    const ctl=(id,data)=>this.open&&!this.gone.has(id)&&this.transmit("ctl",{to:id,payload:data})!==false;
    const sendCtl=(id,data)=>this.expeditionIO?.outgoing(id,data,ctl)||ctl(id,data);
    this.mesh = {autoRetry: 0, sendCtl,
      broadcast: data => {for(const peer of this.room.members)if(peer.id!==this.me&&!this.gone.has(peer.id))sendCtl(peer.id,data);},
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
    if (frame.channel === "ctl") {
      if(this.recovery.control(peer,frame.data))return;
      if(this.expeditionIO?.incoming(peer,frame.data,(id,data)=>this.handlers.ctl?.(id,data)))return;
      this.handlers.ctl?.(peer, frame.data);
    }
    else if (frame.channel === "snap" && typeof frame.data === "string" && frame.data.length <= 21856) {
      try {
        const text = atob(frame.data);
        if (text.length <= 16384) this.handlers.snap?.(peer, Uint8Array.from(text, c => c.charCodeAt(0)).buffer);
      } catch {}
    }
  }
  closed() {
    if (!this.open) return;
    this.open = false;this.recovery.fail();this.expeditionIO?.dispose();this.handlers?.closed?.();
  }
  update(session){
    if(session.match?.party!==this.room.party||session.me!==this.me)return;
    this.session=session;
    for(const id of session.departed??[])this.peerClosed(id,true);
    const links=session.peerLinks??(session.linked?this.room.members.filter(member=>member.id!==this.me).map(member=>member.id):[]);
    for(const member of this.room.members)if(member.id!==this.me&&!this.departed.has(member.id)){
      const open=links.includes(member.id);
      if(open)this.gone.delete(member.id);else this.gone.add(member.id);
      this.handlers?.link?.(member.id,open?"open":"connecting");
    }
    this.recovery.update();
  }
  peerClosed(peer,permanent=false) {
    if(peer===this.me||!this.room.members.some(member=>member.id===peer))return;
    this.gone.add(peer);
    if(permanent){
      this.departed.add(peer);
      this.expeditionIO?.peerLeft(peer);
      const member=this.recovery.run?.coop?.peers.get(peer);
      if(member){member.left=true;this.recovery.run.coop.peerGone(member);}
    }else this.recovery.interrupted(this.session.recovery?.until);
    this.handlers?.link?.(peer,permanent?"closed":"connecting");
  }
  leave() { this.transmit("leave");this.open=false;this.recovery.dispose();this.expeditionIO?.dispose();this.handlers?.closed?.(); }
  // The upstream engine calls this as a notification after finishing. Keep
  // the connection until dispose so final totals can still arrive.
  backToLobby() { this.inRun = false;this.recovery.dispose(); }
}
let preparing, launching, room, early = [];
function launchState() {
  const session = read(), app = globalThis.PokeBonkNativeApp;
  if (!app?.backend?.state) return;
  if(room&&session.lastParty===room.room.party&&["hosting","lobby"].includes(session.phase)){
    room.open=false;room.recovery.dispose();room.expeditionIO?.dispose();
    preparing=launching=null;
  }
  if(session.phase==="playing"&&room?.room.party===session.match?.party)room.update(session);
  if (session.phase === "preparing" && session.match?.party !== preparing) {
    if(app.run?.state==="over")app.toMenu();
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
    const chosen=app.backend.state.activeRun?.ticket?.config;
    if(!chosen){app.notice("The prepared co-op ticket is missing. Your save is preserved.");send("failed");return;}
    Object.assign(room.room,{biome:chosen.biome,tier:chosen.mode==="expedition"?4:chosen.tier,mode:chosen.mode});
    document.dispatchEvent(new Event("standard:lan-launch"));
    void app.startRun({...chosen,species:mine.species,
      boosts: [], coop: {party: session.match.party, room}}).then(ok => {
      if (!ok) throw new Error("Could not start the prepared local co-op run. The ticket is preserved.");
      room.recovery.attach(app.run);
      room.expeditionIO?.attach(app.run);
      room.update(read());
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
    try {const value=JSON.parse(event.detail);room?.peerClosed(value.peer,value.permanent===true);} catch {}
  });
  document.addEventListener("standard:lan-notice", event => {
    try {globalThis.PokeBonkNativeApp?.notice(JSON.parse(event.detail).message);} catch {}
  });
}
