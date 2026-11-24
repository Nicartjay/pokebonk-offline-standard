import {lanState,privateIPv4} from "./lan-policy.mjs";
import {coopConnectionMode,roomListing} from "./coop-mode.mjs";
export function gatewayOrigin(config) {
  const value=config?.internetCoop;
  if(value?.enabled!==true)return null;
  try{
    const u=new URL(value.url);
    if(u.protocol!=="https:"||u.username||u.password||u.port||u.pathname!=="/"||u.search||u.hash||
      !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(u.hostname))return null;
    return u.origin;
  }catch{return null;}
}
export function gatewayRequest(value,origin) {
  if(!origin)return false;
  try{const u=new URL(value),base=new URL(origin);
    return ["https:","wss:"].includes(u.protocol)&&u.host===base.host&&!u.username&&!u.password&&!u.search&&!u.hash&&
      /^\/v1\/[a-zA-Z0-9/-]+$/.test(u.pathname);
  }catch{return false;}
}
export function internetInvitation(value) {
  if(typeof value==="string"&&/^[A-Z0-9]{6}$/.test(value.trim().toUpperCase()))
    return {code:value.trim().toUpperCase()};
  const match=typeof value==="string"&&/^([A-Z2-7]{8})#([A-Za-z0-9_-]{43})$/.exec(value.trim());
  if(!match)throw Error("Enter the 6-character Internet room code.");
  return {code:match[1],joinSecret:match[2]};
}
function candidateAddress(value,type) {
  if(/^[a-z0-9-]{1,100}\.local$/i.test(value))return type==="host";
  if(/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)){
    const n=value.split(".").map(Number);
    return n.every((n,i)=>n<=255&&String(n)===value.split(".")[i])&&n[0]!==0&&n[0]!==127&&n[0]<224&&
      !(n[0]===169&&n[1]===254);
  }
  if(!/^[a-f0-9:]+$/i.test(value)||!value.includes(":")||["::","::1"].includes(value)||/^(?:ff|fe[89ab])/i.test(value))return false;
  try{return Boolean(new URL(`http://[${value}]/`).hostname);}catch{return false;}
}
export function internetDescription(value,mode) {
  if(!["stun-only","turn-fallback"].includes(coopConnectionMode(mode)))throw Error("Choose an Internet connection mode.");
  if(!value||!["offer","answer"].includes(value.type)||typeof value.sdp!=="string"||
    value.sdp.length>32000||!value.sdp.startsWith("v=0")||!/^m=application /m.test(value.sdp)||
    /^m=(?!application )/m.test(value.sdp)||/^a=remote-candidates:/m.test(value.sdp)||value.sdp.includes("\0"))
    throw Error("Invalid Internet data-channel description.");
  let candidates=0;
  const lines=value.sdp.split(/\r?\n/).filter(line=>{
    if(line.startsWith("c=IN IP")){
      const address=line.split(" ").at(-1);
      if(!["0.0.0.0","::"].includes(address)&&!candidateAddress(address,"host"))throw Error("Invalid peer address.");
    }
    if(!line.startsWith("a=candidate:"))return true;
    const parts=line.split(/\s+/),type=parts[parts.indexOf("typ")+1];
    if(!["host","srflx","prflx","relay"].includes(type)||
      !["udp","tcp"].includes(parts[2]?.toLowerCase())||!/^\d{1,5}$/.test(parts[5])||+parts[5]<1||+parts[5]>65535||
      type==="relay"&&mode!=="turn-fallback")throw Error("The selected connection mode does not allow this ICE candidate.");
    // A browser may gather link-local/loopback candidates alongside working
    // IPv4, global IPv6 or mDNS addresses. Omit only unusable candidates.
    // A relay in STUN-only is always rejected, never silently stripped.
    if(!candidateAddress(parts[4],type))return false;
    candidates++;return true;
  });
  if(!candidates)throw Error("No usable direct peer candidates.");
  return {type:value.type,sdp:lines.join("\r\n")};
}
export function internetState(value,mode) {
  coopConnectionMode(mode);
  const {invitation,...plain}=value??{};
  const state=lanState(plain);
  // Legacy invitation inputs remain native-only. Never expose their secret.
  if(invitation!==undefined)internetInvitation(invitation);
  state.connectionMode=mode;
  if(["lan","stun","turn","direct","waiting","connecting"].includes(value?.transport))state.transport=value.transport;
  const discovery=value?.discovery;
  if(discovery&&["idle","searching","joining","empty","error"].includes(discovery.status))
    state.discovery={status:discovery.status,rooms:Number.isSafeInteger(discovery.rooms)?Math.max(0,Math.min(8,discovery.rooms)):0,
      ...(typeof discovery.message==="string"?{message:discovery.message.slice(0,160)}:{})};
  if(value?.roomListing!==undefined)state.roomListing=roomListing(value.roomListing,mode);
  return state;
}
export function selectedInternetRoute(stats){
  const values=[...stats.values()];
  const transport=values.find(value=>value.type==="transport"&&value.selectedCandidatePairId);
  const pair=stats.get(transport?.selectedCandidatePairId)??values.find(value=>
    value.type==="candidate-pair"&&value.state==="succeeded"&&(value.selected||value.nominated));
  if(!pair)return "connecting";
  const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);
  if([local,remote].some(value=>value?.candidateType==="relay"))return "turn";
  if([local,remote].some(value=>["srflx","prflx"].includes(value?.candidateType)))return "stun";
  const privateHost=value=>value?.candidateType==="host"&&(privateIPv4(value.address??value.ip)||
    /^[\w-]+\.local$/i.test(value.address??"")||/^(?:f[cd][a-f0-9]{2}|fe[89ab][a-f0-9]):/i.test(value.address??""));
  return privateHost(local)&&privateHost(remote)?"lan":"direct";
}
