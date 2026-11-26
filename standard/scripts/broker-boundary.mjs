// Only these modules may contain peer-transport machinery. They are loaded by
// the isolated native broker, never imported by the game renderer.
export const BROKER_MODULES=new Set([
  "offline/lan-broker.js","offline/lan-session.js","offline/lan-rtc.js",
  "offline/internet-broker.js","offline/internet-rtc.js","offline/stun-first.js",
  "common/internet-coop.mjs",
  "offline/cloud-broker.js","common/cloud-sync.mjs",
]);
const LITERALS=new Map([
  ["offline/stun-first.js",new Set(["stun:stun.cloudflare.com:3478"])],
  ["offline/internet-broker.js",new Set(["wss:"])],
  // This prefix validates IPv6 syntax with URL; it is not a fetch destination.
  ["common/internet-coop.mjs",new Set(["wss:","http://["])],
]);
export function brokerLiteral(file,value){return LITERALS.get(file)?.has(value)===true;}
export function assertBrokerImport(file,target){
  if(BROKER_MODULES.has(target)&&!BROKER_MODULES.has(file))
    throw Error(`Game renderer imported a native-only transport module: ${file} → ${target}`);
}
