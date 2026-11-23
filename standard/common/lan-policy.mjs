// Data validation shared by the native LAN controller and bundled game adapter.
export const LAN_PROTOCOL = 2;
export const LAN_MAX_MESSAGE = 48 * 1024;
export const LAN_MAX_SNAPSHOT = 16 * 1024;
export function privateIPv4(value) {
  if (typeof value !== "string" || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return false;
  const n = value.split(".").map(Number);
  if (n.some((v, i) => v > 255 || String(v) !== value.split(".")[i])) return false;
  return n[0] === 10 || n[0] === 172 && n[1] >= 16 && n[1] <= 31 ||
    n[0] === 192 && n[1] === 168 || n[0] === 169 && n[1] === 254;
}
export function invitation(value) {
  const match = typeof value === "string" && /^([\d.]+):(\d{1,5})#([a-f0-9]{32})$/i.exec(value.trim());
  if (!match || !privateIPv4(match[1]) || +match[2] < 1024 || +match[2] > 65535) {
    throw new Error("Paste the host’s complete local invitation: address:port#pairing-key.");
  }
  return {address: match[1], port: +match[2], secret: match[3].toLowerCase()};
}
export function lanIdentity(config, digest) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("The local game payload has no verified identity.");
  return `PB-LAN${LAN_PROTOCOL}|${config.applicationId}|${config.version}|${config.upstream.build}|${digest}`;
}
export function lanDescription(value) {
  if (!value || !["offer", "answer"].includes(value.type) || typeof value.sdp !== "string" ||
      value.sdp.length > 32000 || !value.sdp.startsWith("v=0") ||
      /^m=(?!application\b)/m.test(value.sdp) ||
      /^a=remote-candidates:/m.test(value.sdp)) throw new Error("Invalid local peer description.");
  for (const connection of value.sdp.matchAll(/^c=IN IP[46] (\S+)/gm)) {
    if (!["0.0.0.0", "::"].includes(connection[1]) && !privateIPv4(connection[1]) &&
        !/^fe80:[a-f0-9:]+$/i.test(connection[1])) throw new Error("Non-local peer connection address.");
  }
  const lines = value.sdp.split(/\r?\n/).filter(line => {
    if (!line.startsWith("a=candidate:")) return true;
    const fields = line.split(/\s+/), type = fields.indexOf("typ");
    const address = fields[4];
    // LAN-only ICE. No STUN/TURN/relay candidates, arbitrary DNS names or
    // public addresses. .local names are WebRTC's private mDNS candidates.
    return fields[type + 1] === "host" && (privateIPv4(address) ||
      /^[a-z0-9-]{1,100}\.local$/i.test(address) || /^fe80:[a-f0-9:]+(?:%\w+)?$/i.test(address));
  });
  if (!lines.some(line => line.startsWith("a=candidate:"))) throw new Error("No local network candidates. Check Wi-Fi and Local Network permission.");
  return {type: value.type, sdp: lines.join("\r\n")};
}
export function sameSubnet(a,b,mask) {
  if (!privateIPv4(a)||!privateIPv4(b)||typeof mask!=="string"||!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(mask)) return false;
  const m=mask.split(".").map(Number);
  if(m.some(n=>n>255)||!/^1{8,}0*$/.test(m.map(n=>n.toString(2).padStart(8,"0")).join("")))return false;
  const x=a.split(".").map(Number),y=b.split(".").map(Number);
  return x.every((n,i)=>(n&m[i])===(y[i]&m[i]));
}
export function lanFrame(channel,data) {
  if(channel==="ctl")return data && typeof data==="object" && typeof data.t==="string" && data.t.length<=40 && JSON.stringify(data).length<=32768;
  return channel==="snap"&&typeof data==="string"&&data.length<=21856&&/^[A-Za-z0-9+/]*={0,2}$/.test(data);
}
export function lanState(value) {
  const id=n=>typeof n==="string"&&/^lan-[\w-]{1,80}$/.test(n);
  if(!value||!["idle","hosting","connecting","lobby","preparing","playing","closed","error"].includes(value.phase)||
    !Array.isArray(value.members)||value.members.length>4||JSON.stringify(value).length>24000)throw Error("Invalid native LAN state.");
  const members=value.members.map(m=>{
    if(!m||!id(m.id)||typeof m.name!=="string"||m.name.length>24||!Number.isInteger(m.species)||m.species<1||m.species>10000||
      !Number.isInteger(m.slot)||m.slot<0||m.slot>3||typeof m.ready!=="boolean")throw Error("Invalid native LAN member.");
    return {id:m.id,name:m.name,species:m.species,slot:m.slot,ready:m.ready};
  });
  if(new Set(members.map(m=>m.id)).size!==members.length||new Set(members.map(m=>m.slot)).size!==members.length)throw Error("Duplicate local player.");
  const result={phase:value.phase,members,linked:value.linked===true,
    disconnected:Array.isArray(value.disconnected)?value.disconnected.filter(id).slice(0,3):[],
    chat:Array.isArray(value.chat)?value.chat.slice(-40).map(m=>{
      if(!m||!id(m.from)||typeof m.id!=="string"||m.id.length>80||typeof m.name!=="string"||m.name.length>24||
        typeof m.text!=="string"||m.text.length>140||!Number.isFinite(m.at))throw Error("Invalid local chat.");
      return {id:m.id,from:m.from,name:m.name,text:m.text,at:m.at};
    }):[]};
  if(value.me!==undefined){if(!id(value.me)||!["host","client"].includes(value.role))throw Error("Invalid local identity.");result.me=value.me;result.role=value.role;}
  if(value.invitation!==undefined){invitation(value.invitation);result.invitation=value.invitation;}
  if(value.code!==undefined)result.code=String(value.code).slice(0,8);
  if(value.error!==undefined)result.error=String(value.error).slice(0,240);
  if(value.match!==undefined){
    const m=value.match;
    if(!m||!id(m.party)||!Number.isInteger(m.seed)||m.seed<0||m.seed>0xffffffff||m.mode!=="standard"||m.biome!=="forest"||m.tier!==0||
      !Array.isArray(m.players)||m.players.length<2||m.players.length>4||JSON.stringify(m.players)!==JSON.stringify(members.map(p=>p.id)))throw Error("Invalid shared LAN match.");
    result.match={party:m.party,seed:m.seed,mode:m.mode,biome:m.biome,tier:m.tier,players:[...m.players]};
  }
  return result;
}
