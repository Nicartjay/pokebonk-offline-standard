// Shape adapter for the REAL upstream lobby view. No network API lives here.
// The native coordinator remains authoritative about capacity, picks and start.
import {coopSettings,coopSeats,coopMaps} from "../common/coop-rules.mjs";
export class LanLobby {
  constructor(source, transmit) {
    this.transmit = transmit; this.ev = {}; this.chat = []; this.update(source, false);
    this.mesh = {rtt: () => 0,broadcast:message=>{
      if(message?.t==="xl"&&message.l&&!this.preview)this.transmit("room-loadout",message.l);
    }};
  }
  update(source, notify = true) {
    // A facade belongs to one room only. Late native resets and the next
    // room's state must never revive its upstream navigation callbacks.
    if (this.retired || this.me && source.me && this.me !== source.me) return;
    this.preview = source.preview === true;
    this.phase=source.phase;
    this.connectionMode=source.connectionMode??"lan";
    this.transport=source.transport??(this.connectionMode==="lan"?"lan":"waiting");
    this.me = source.me; this.invitation = source.invitation ?? null;
    this.code = String(source.code??(this.connectionMode==="lan"?"LAN":"ONLINE")).toUpperCase();
    this.open = ["hosting", "connecting", "lobby", "preparing", "playing"].includes(source.phase);
    this.isHost = source.role === "host";
    this.isPublic = false; this.otherBuild = false;
    this.meshReady = this.allLinked = Boolean(source.linked);
    this.unlinkedPair = null;
    const settings=coopSettings(source.settings),seats=coopSeats(source.seats,(source.members??[]).length);
    const daily=settings.tier===6?globalThis.PokeBonkNativeApp?.backend?.modes?.dailyMutation?.(source.rulesAt):null;
    if(daily)settings.biome=daily.biome;
    this.room = {code: this.code, ...settings, pub: seats.discoverable?2:0, want: seats.capacity,
      rulesAt:source.rulesAt,
      state: source.phase === "playing" ? "playing" : "lobby",
      members: (source.members ?? []).map(member => ({...member,
        host: member.slot === 0, guest: false, maps: coopMaps(member.maps)}))};
    this.mine = this.room.members.find(member => member.id === this.me);
    const incoming = source.chat ?? [];
    const previous = this.chat.at(-1)?.id;
    this.chat = structuredClone(incoming);
    if (!notify) return;
    if (!this.open) {
      const closed = this.ev.closed;
      this.retire();
      closed?.(source.error ?? "The local room has closed.");
    }
    else {
      this.ev.change?.(); this.ev.link?.();
      if (this.chat.at(-1)?.id !== previous) {
        const index = this.chat.findIndex(message => message.id === previous);
        this.ev.chat?.(this.chat.slice(index + 1));
      }
    }
  }
  linkState(id) { return id === this.me || this.meshReady ? "open" : "connecting"; }
  oldBuild() { return false; }
  retire() { this.retired = true; this.open = false; this.ev = {}; }
  async leave() {
    if (this.retired) return;
    this.retire();
    this.transmit("leave");
  }
  async setReady(ready) {
    if (this.preview) throw new Error("Room preview only. No devices are connected.");
    if (this.mine?.ready !== ready) this.transmit("room-ready");
  }
  async start() {
    if (this.preview) throw new Error("Room preview only. No devices are connected.");
    this.transmit("room-start");
  }
  async setPick(species) { this.transmit("room-pick", species); }
  async say(text) {
    if (this.preview) throw new Error("Chat is disabled in the unconnected room preview.");
    if (!this.open) throw new Error("The local room has closed.");
    this.transmit("room-chat", text);
  }
  async setSettings(biome,tier) {
    if(!this.open||!this.isHost)throw Error("Only the host can change the destination.");
    if(tier===4&&!["wilds","safari"].includes(biome))biome="wilds";
    this.transmit("room-settings",coopSettings({biome,tier}));
  }
  async openSeats(open,want=4) {
    if(!this.open||!this.isHost)throw Error("Only the host can change Find teammates.");
    this.transmit("room-seats",coopSeats({discoverable:open,capacity:want},this.room.members.length));
  }
}
