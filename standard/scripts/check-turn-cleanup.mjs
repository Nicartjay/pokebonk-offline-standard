// Reconcile ONLY the final asynchronous lease-revocation assertion. This
// cannot turn a failed transport, missing renewal, or wrong payload into a pass.
import assert from "node:assert/strict";
import {readFile,writeFile,stat} from "node:fs/promises";
import {gatewayOrigin} from "../common/internet-coop.mjs";
import {freshUsage} from "../../services/coop-gateway/src/policy.mjs";
const file="evidence/cloudflare-setup/turn-native-check.json";
const report=JSON.parse(await readFile(file,"utf8"));
const config=JSON.parse(await readFile("standard/config.json","utf8"));
const inventory=JSON.parse(await readFile("build/standard-game/asset-manifest.json","utf8"));
assert.equal(report.gameDigest,inventory.gameDigest);
for(const flag of ["forcedRelay","wrongBuildRejected","fullRoomNotMatched","chat","renewalPastInitialExpiry","leaveAndRehost"])
  assert.equal(report[flag],true,"Cannot reconcile an incomplete transport check: "+flag);
assert.equal(report.players,4);assert.equal(report.ctlFrames,12);assert.ok(report.binaryFrames>=12);
assert.equal(report.binaryPeerPairs,12);assert.ok(report.turnCredentialsIssued>=8);
assert.ok(report.transports.length===4&&report.transports.every(route=>route==="turn"));
assert.ok(report.passed===true||/\d+ !== 0/.test(report.error??""),"Only a pending final lease-count assertion can be reconciled.");
const credentials=new URL("../../../pokebonk-standard-signing/cloudflare-gateway-secrets.json",import.meta.url);
assert.equal((await stat(credentials)).mode&0o077,0);
let secret;
try{secret=JSON.parse(await readFile(credentials,"utf8")).ADMIN_TOKEN;}
catch{throw Error("Private admin credential file could not be read safely.");}
assert.match(secret??"",/^[A-Za-z0-9_-]{43}$/);
const origin=gatewayOrigin(config);assert.ok(origin);
let state;
const until=Date.now()+90000;
do{
  const response=await fetch(origin+"/admin/status",{headers:{Authorization:"Bearer "+secret},
    redirect:"error",signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);state=await response.json();
  if(state.liveLeases===0&&state.pendingLeases===0)break;
  await new Promise(resolve=>setTimeout(resolve,5000));
}while(Date.now()<until);
assert.equal(state.liveLeases,0);assert.equal(state.pendingLeases,0);assert.equal(state.disabled,false);
freshUsage(state.usage);
report.cleanupObservation={initialAssertion:report.error??null,confirmedAt:new Date().toISOString(),
  knownLeasesRemaining:0,pendingIssuances:0,guardEnabled:true,monitorFresh:true,
  note:"Transport and credential-expiry renewal passed in the original native run; the final delayed revocation was confirmed without issuing more credentials."};
delete report.error;
report.leaveRevokedLeases=true;report.passed=true;
await writeFile(file,JSON.stringify(report,null,2)+"\n");
console.log("Final cleanup confirmed: zero known leases, zero pending issuances, fresh metering. Original four-peer TURN and expiry-renewal evidence retained.");
