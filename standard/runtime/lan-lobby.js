// Shape adapter for the REAL upstream lobby view. No network API lives here.
// The native coordinator remains authoritative about capacity, picks and start.
export class LanLobby {
  constructor(source, transmit) {
    this.transmit = transmit; this.ev = {}; this.chat = []; this.update(source, false);
    this.mesh = {rtt: () => 0};
  }
  update(source, notify = true) {
    // A facade belongs to one room only. Late native resets and the next
    // room's state must never revive its upstream navigation callbacks.
    if (this.retired || this.me && source.me && this.me !== source.me) return;
    this.preview = source.preview === true;
    this.me = source.me; this.invitation = source.invitation ?? null;
    this.code = (source.invitation?.split("#")[1]?.slice(0, 4) ?? source.code ?? "LAN").toUpperCase();
    this.open = ["hosting", "connecting", "lobby", "preparing", "playing"].includes(source.phase);
    this.isHost = source.role === "host";
    this.isPublic = false; this.otherBuild = false;
    this.meshReady = this.allLinked = Boolean(source.linked);
    this.unlinkedPair = null;
    this.room = {code: this.code, biome: "forest", tier: 0, pub: 0, want: 4,
      state: source.phase === "playing" ? "playing" : "lobby",
      members: (source.members ?? []).map(member => ({...member,
        host: member.slot === 0, guest: false, maps: {forest: 0}}))};
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
    if (this.preview) throw new Error("Room preview only. LAN gameplay is not available in this build yet.");
    this.transmit("room-start");
  }
  async setPick(species) { this.transmit("room-pick", species); }
  async say(text) {
    if (this.preview) throw new Error("Chat is disabled in the unconnected room preview.");
    if (!this.open) throw new Error("The local room has closed.");
    this.transmit("room-chat", text);
  }
  async setSettings() { throw new Error("This LAN test supports Classic · Forest · Normal only."); }
}
