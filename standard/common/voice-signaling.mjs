// Trusted broker + authenticated signaling service only. Never import into the
// game renderer. Audio SDP is separate from the game's data-only SDP validator.
import {privateIPv4} from "./lan-policy.mjs";
const token = value => typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
const localAddress = value => privateIPv4(value) || /^[a-z0-9-]{1,100}\.local$/i.test(value) ||
  /^f[cd][a-f0-9]{2}:[a-f0-9:]+$/i.test(value) || /^fe80:[a-f0-9:]+(?:%\w+)?$/i.test(value);
function address(value, type, local) {
  if (/^[a-z0-9-]{1,100}\.local$/i.test(value)) return type === "host";
  if (local) return type === "host" && localAddress(value);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    const parts=value.split(".").map(Number);
    return parts.every((n,i)=>n<=255&&String(n)===value.split(".")[i]) &&
      parts[0]!==0 && parts[0]!==127 && parts[0]<224 && !(parts[0]===169&&parts[1]===254);
  }
  return /^[a-f0-9:]+$/i.test(value) && value.includes(":") &&
    !["::","::1"].includes(value) && !/^(?:ff|fe[89ab])/i.test(value);
}
export function voiceDescription(value, mode) {
  if (!["lan","stun-only","turn-fallback"].includes(mode) || !value || !["offer","answer"].includes(value.type) ||
      typeof value.sdp !== "string" || new TextEncoder().encode(value.sdp).length > 16000 ||
      !/^v=0\r?\n/.test(value.sdp) || value.sdp.includes("\0") || /^a=remote-candidates:/m.test(value.sdp))
    throw Error("Invalid direct audio description.");
  const media=value.sdp.match(/^m=.*$/gm)??[];
  if (media.length!==1 || !/^m=audio [1-9]\d{0,4} UDP\/TLS\/RTP\/SAVPF /i.test(media[0]) ||
      !/^a=rtpmap:\d+ opus\/48000\/2\r?$/mi.test(value.sdp) || !/^a=rtcp-mux\r?$/m.test(value.sdp))
    throw Error("Only a single secure Opus audio stream is allowed.");
  let candidates=0;
  const local=mode==="lan";
  const lines=value.sdp.split(/\r?\n/).filter(line=>{
    if (line.startsWith("c=IN IP")) {
      const ip=line.split(/\s+/).at(-1);
      if (!["0.0.0.0","::"].includes(ip) && !address(ip,"host",local)) throw Error("Invalid voice address.");
    }
    if (!line.startsWith("a=candidate:")) return true;
    const parts=line.split(/\s+/), type=parts[parts.indexOf("typ")+1];
    if (type==="relay") throw Error("TURN is forbidden for voice.");
    if (!["host","srflx","prflx"].includes(type) || local && type!=="host" ||
        !["udp","tcp"].includes(parts[2]?.toLowerCase()) ||
        !/^\d{1,5}$/.test(parts[5]) || +parts[5]<1 || +parts[5]>65535) throw Error("Invalid voice candidate.");
    if (!address(parts[4],type,local)) return false;
    candidates++;return true;
  });
  if (!candidates) throw Error("No direct voice candidates.");
  return {type:value.type,sdp:lines.join("\r\n")};
}
export function voiceSignal(value, mode) {
  if (!value || typeof value!=="object" || Array.isArray(value) || JSON.stringify(value).length>20000 ||
      value.v!==1 || !token(value.session)) throw Error("Invalid voice signaling.");
  const keys=Object.keys(value).sort().join(",");
  if (["hello","bye"].includes(value.kind) && keys==="kind,session,v")
    return {v:1,kind:value.kind,session:value.session};
  if (value.kind==="description" && token(value.for) && keys==="description,for,kind,session,v")
    return {v:1,kind:"description",session:value.session,for:value.for,description:voiceDescription(value.description,mode)};
  throw Error("Unsupported voice signaling.");
}
export function selectedVoicePair(stats, localOnly = false) {
  const values=[...stats.values()];
  const transport=values.find(row=>row.type==="transport"&&row.selectedCandidatePairId);
  const pair=stats.get(transport?.selectedCandidatePairId) ?? values.find(row=>
    row.type==="candidate-pair"&&row.state==="succeeded"&&(row.selected||row.nominated));
  if (!pair || pair.state!=="succeeded") return "connecting";
  const candidates=[stats.get(pair.localCandidateId),stats.get(pair.remoteCandidateId)];
  if (candidates.some(row=>row?.candidateType==="relay")) return "blocked";
  if (candidates.some(row=>!["host","srflx","prflx"].includes(row?.candidateType))) return "connecting";
  if (localOnly && candidates.some(row=>row.candidateType!=="host" ||
      (row.address??row.ip) && !localAddress(row.address??row.ip))) return "connecting";
  return "direct";
}
