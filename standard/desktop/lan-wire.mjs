import {randomBytes, createHmac, timingSafeEqual, createCipheriv, createDecipheriv} from "node:crypto";
import {LAN_MAX_MESSAGE} from "../common/lan-policy.mjs";
const mac = (key, ...parts) => createHmac("sha256", key).update(Buffer.concat(parts.map(p => Buffer.isBuffer(p) ? p : Buffer.from(p)))).digest();
// Native-only pairing/signaling channel. The invitation key never goes over
// the network. Challenge proofs authenticate both ends; AES-GCM protects the
// room messages. Gameplay itself remains on the original WebRTC channels.
export function lanWire(socket, {host, identity, secret}, {open, message, close}) {
  const secretBytes = Buffer.from(secret, "hex");
  if (secretBytes.length !== 16) throw new Error("Invalid local pairing key.");
  let buffer = Buffer.alloc(0), phase = host ? 1 : 0, hostNonce = host ? randomBytes(16) : null, clientNonce;
  let sendKey, receiveKey, tx = 0, rx = 0, ended = false, heartbeat;
  socket.setNoDelay(true); socket.setTimeout(10000);
  function write(bytes) {
    if (ended || bytes.length > LAN_MAX_MESSAGE || socket.writableLength > 128 * 1024) throw new Error("Local connection queue exceeded its limit.");
    const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
    socket.write(Buffer.concat([length, bytes]));
  }
  function stop(reason = "The local connection closed.") {
    if (ended) return;
    ended = true; clearInterval(heartbeat); socket.destroy(); close?.(reason);
  }
  function keys() {
    const master = mac(secretBytes, "key", identity, hostNonce, clientNonce);
    sendKey = mac(master, host ? "host" : "client");
    receiveKey = mac(master, host ? "client" : "host");
    phase = 3; socket.setTimeout(15000);
    heartbeat = setInterval(() => { try { send({op: "ping"}); } catch (error) { stop(error.message); } }, 3000);
    heartbeat.unref();
    open?.();
  }
  function send(value) {
    if (phase !== 3 || ended) return false;
    const text = Buffer.from(JSON.stringify(value));
    if (text.length > LAN_MAX_MESSAGE - 64) throw new Error("Local message is too large.");
    const nonce = Buffer.alloc(12); nonce.writeBigUInt64BE(BigInt(++tx), 4);
    const cipher = createCipheriv("aes-256-gcm", sendKey, nonce);
    cipher.setAAD(Buffer.from(identity));
    const counter = nonce.subarray(4);
    write(Buffer.concat([Buffer.from([4]), counter, cipher.update(text), cipher.final(), cipher.getAuthTag()]));
    return true;
  }
  function packet(bytes) {
    if (phase === 0) {
      const identityBytes = Buffer.from(identity);
      if (bytes[0] !== 1 || bytes.length < 19 || bytes.readUInt16BE(17) !== identityBytes.length ||
          bytes.length !== 19 + identityBytes.length || !bytes.subarray(19).equals(identityBytes)) {
        throw new Error("Different app/game builds. Install the same local test build on both devices.");
      }
      hostNonce = bytes.subarray(1, 17); clientNonce = randomBytes(16);
      write(Buffer.concat([Buffer.from([2]), clientNonce, mac(secretBytes, "client", identity, hostNonce, clientNonce)]));
      phase = 2;
    } else if (phase === 1) {
      if (bytes[0] !== 2 || bytes.length !== 49) throw new Error("Invalid local pairing response.");
      clientNonce = bytes.subarray(1, 17);
      if (!timingSafeEqual(bytes.subarray(17), mac(secretBytes, "client", identity, hostNonce, clientNonce))) throw new Error("Incorrect pairing key.");
      write(Buffer.concat([Buffer.from([3]), mac(secretBytes, "server", identity, hostNonce, clientNonce)]));
      keys();
    } else if (phase === 2) {
      if (bytes[0] !== 3 || bytes.length !== 33 ||
          !timingSafeEqual(bytes.subarray(1), mac(secretBytes, "server", identity, hostNonce, clientNonce))) throw new Error("The host could not prove its pairing identity.");
      keys();
    } else {
      if (bytes[0] !== 4 || bytes.length < 25 || bytes.readBigUInt64BE(1) !== BigInt(rx + 1)) throw new Error("Invalid or replayed local message.");
      const nonce = Buffer.alloc(12); bytes.copy(nonce, 4, 1, 9);
      const decipher = createDecipheriv("aes-256-gcm", receiveKey, nonce);
      decipher.setAAD(Buffer.from(identity)); decipher.setAuthTag(bytes.subarray(-16));
      const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(9, -16)), decipher.final()]).toString("utf8"));
      rx++;
      if (value?.op !== "ping") message?.(value);
    }
  }
  socket.on("data", chunk => {
    try {
      if (buffer.length + chunk.length > LAN_MAX_MESSAGE * 4) throw new Error("Oversized local connection input.");
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length < 1 || length > LAN_MAX_MESSAGE) throw new Error("Invalid local packet size.");
        if (buffer.length < length + 4) break;
        const data = buffer.subarray(4, length + 4); buffer = buffer.subarray(length + 4); packet(data);
      }
    } catch (error) { stop(error.message); }
  });
  socket.on("timeout", () => stop("The local connection timed out. Keep both apps open and check the local network."));
  socket.on("error", error => stop(error.message));
  socket.on("close", () => stop());
  if (host) {
    const text = Buffer.from(identity), length = Buffer.alloc(2); length.writeUInt16BE(text.length);
    write(Buffer.concat([Buffer.from([1]), hostNonce, length, text]));
  }
  return {send, close: stop};
}
