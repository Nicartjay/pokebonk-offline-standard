import dgram from "node:dgram";
import {randomBytes} from "node:crypto";
import {invitation, sameSubnet} from "../common/lan-policy.mjs";
import {DISCOVERY_GROUP, DISCOVERY_PORT, DISCOVERY_MAGIC, DISCOVERY_BYTES, DISCOVERY_MS,
  discoveryQuery, discoveryRoom, advertisedRoom} from "../common/lan-discovery.mjs";
const encode = value => Buffer.from(JSON.stringify(value), "utf8");
const decode = bytes => {
  if (bytes.length > DISCOVERY_BYTES) return null;
  try { return JSON.parse(bytes.toString("utf8")); } catch { return null; }
};
export class LanDiscovery {
  constructor({identity, interfaces, progress = () => {}, socket = options => dgram.createSocket(options)}) {
    Object.assign(this, {identity, interfaces, progress, socket});
    this.replyTimes = new Map();
  }
  advertise(state) {
    this.room = advertisedRoom(state);
    if (!this.room) { try { this.host?.close(); } catch {} this.host = null; this.replyTimes.clear(); return; }
    if (this.host) return;
    const socket = this.socket({type: "udp4", reuseAddr: true}); this.host = socket;
    socket.on("error", () => { if (this.host === socket) { this.host = null; try { socket.close(); } catch {} } });
    socket.on("message", (bytes, remote) => {
      const room = this.room, query = decode(bytes);
      if (this.host !== socket || !room || !discoveryQuery(query, this.identity) ||
          remote.port < 1024 || remote.port > 65535) return;
      const address = invitation(room.invitation).address;
      if (!this.interfaces().some(n => n.address === address && sameSubnet(address, remote.address, n.netmask))) return;
      const now = Date.now(), last = this.replyTimes.get(remote.address) ?? 0;
      if (now - last < 500) return;
      for (const [ip, at] of this.replyTimes) if (now - at > 5000) this.replyTimes.delete(ip);
      if (this.replyTimes.size >= 64 && !this.replyTimes.has(remote.address)) return;
      this.replyTimes.set(remote.address, now);
      socket.send(encode({magic: DISCOVERY_MAGIC, op: "room", identity: this.identity,
        nonce: query.nonce, ...room}), remote.port, remote.address, () => {});
    });
    socket.bind(DISCOVERY_PORT, "0.0.0.0", () => {
      if (this.host !== socket) return;
      socket.setMulticastTTL(1);
      for (const network of this.interfaces()) {
        try { socket.addMembership(DISCOVERY_GROUP, network.address); } catch { /* Manual invites still work. */ }
      }
    });
  }
  find() {
    this.cancel();
    const nonce = randomBytes(16).toString("hex"), rooms = new Map();
    const socket = this.socket({type: "udp4"}), timers = [];
    return new Promise((resolve, reject) => {
      const finish = (cancelled = false, error) => {
        if (this.search?.socket !== socket) return;
        this.search = null; for (const timer of timers) clearTimeout(timer);
        try { socket.close(); } catch {}
        if (error) reject(error);
        else resolve({cancelled, rooms: [...rooms.values()].sort((a,b) => b.count-a.count || a.id.localeCompare(b.id))});
      };
      this.search = {socket, cancel: () => finish(true)};
      socket.on("error", () => finish(false, new Error("Local discovery is unavailable. Use a host invitation instead.")));
      socket.on("message", (bytes, remote) => {
        const room = discoveryRoom(decode(bytes), {identity: this.identity, nonce,
          remote: remote.address, interfaces: this.interfaces()});
        if (!room || this.search?.socket !== socket || rooms.size >= 32 && !rooms.has(room.id)) return;
        rooms.set(room.id, room); this.progress(rooms.size);
      });
      socket.bind(0, "0.0.0.0", () => {
        if (this.search?.socket !== socket) return;
        socket.setMulticastTTL(1);
        const query = encode({magic: DISCOVERY_MAGIC, op: "find", identity: this.identity, nonce});
        const send = () => {
          if (this.search?.socket !== socket) return;
          for (const network of this.interfaces()) {
            try {
              socket.setMulticastInterface(network.address);
              socket.send(query, DISCOVERY_PORT, DISCOVERY_GROUP, () => {});
            } catch { /* Continue on another private interface. */ }
          }
        };
        send(); timers.push(setTimeout(send, 800), setTimeout(send, 1800), setTimeout(() => finish(), DISCOVERY_MS));
      });
    });
  }
  cancel() { this.search?.cancel(); }
  close() { this.cancel(); this.advertise(null); }
}
