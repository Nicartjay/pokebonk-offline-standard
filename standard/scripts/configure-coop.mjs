// Prepare a reviewed test build's signaling allowlist; deployment is separate.
import {readFile,writeFile} from "node:fs/promises";
import {lanIdentity} from "../common/lan-policy.mjs";
import {gatewayOrigin} from "../common/internet-coop.mjs";
import {readAccountUsage} from "../../services/coop-gateway/src/usage.mjs";
import {POLICY} from "../../services/coop-gateway/src/policy.mjs";
const guarded=process.argv.includes("--enable-guarded-turn"),stun=process.argv.includes("--enable-stun");
if(guarded===stun)throw Error("Choose exactly one: --enable-stun or --enable-guarded-turn.");
if(guarded&&!process.argv.includes("--accept-payg-risk"))throw Error("Guarded TURN requires explicit --accept-payg-risk; this is not a hard billing cap.");
const config=JSON.parse(await readFile("standard/config.json","utf8"));
const inventory=JSON.parse(await readFile("build/standard-game/asset-manifest.json","utf8"));
const metadata=JSON.parse(await readFile("build/standard-game/offline-build.json","utf8"));
const file="services/coop-gateway/wrangler.jsonc",worker=JSON.parse(await readFile(file,"utf8"));
const origin=gatewayOrigin(config);
if(!origin||!new URL(origin).hostname.startsWith(worker.name+".")||inventory.edition!=="standard"||
  metadata.appVersion!==config.version||metadata.upstream.build!==config.upstream.build||
  metadata.coop?.relayEnabled!==guarded||config.internetCoop.relayEnabled!==guarded)
  throw Error("Native/gateway or prepared-payload relay configuration does not match. Set the intended native feature flag, then prepare the payload first.");
if(guarded){
  const privateData=JSON.parse(await readFile("../pokebonk-standard-signing/cloudflare-usage.json","utf8"));
  await readAccountUsage({...worker.vars,CF_ACCOUNT_ID:privateData.accountId,CF_USAGE_API_TOKEN:privateData.apiToken});
  worker.vars.TURN_MODE="guarded-payg";worker.vars.TURN_PAYG_RISK_ACCEPTED="true";
  worker.triggers={...worker.triggers,crons:["* * * * *"]};
}else{
  if(worker.vars.TURN_MODE!=="disabled"||worker.vars.TURN_PAYG_RISK_ACCEPTED!=="false")
    throw Error("Explicitly disable/revoke live TURN before preparing a STUN-only deployment.");
}
const identity=lanIdentity(config,inventory.gameDigest);
const previous=process.argv.includes("--replace-test-builds")?[]:JSON.parse(worker.vars.ACCEPTED_BUILD_IDS);
if(!Array.isArray(previous)||previous.some(id=>typeof id!=="string"||!/^[A-Za-z0-9|_.-]{16,256}$/.test(id)))throw Error("Invalid existing build allowlist.");
const accepted=[...new Set([identity,...previous])];
if(accepted.length>POLICY.maxAcceptedBuilds)
  throw Error("The build allowlist is full. Review retired builds explicitly; no releases were removed.");
worker.vars.ACCEPTED_BUILD_IDS=JSON.stringify(accepted);
worker.vars.SERVICE_ENABLED="true";worker.vars.PUBLIC_MATCHMAKING_ENABLED="true";
await writeFile(file,JSON.stringify(worker,null,2)+"\n");
console.log(`Configured ${guarded?"guarded TURN fallback":"STUN matchmaking"} for ${identity}. ${guarded?"Meter probe passed; deployment and operator gate review are still separate.":"TURN remains disabled. Deploy separately."}`);
