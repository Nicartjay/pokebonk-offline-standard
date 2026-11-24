// Refuse stale test evidence or packages. No release/signing metadata is made.
import assert from "node:assert/strict";
import {readFile,writeFile,stat} from "node:fs/promises";
import path from "node:path";
const read=async file=>JSON.parse(await readFile(file,"utf8"));
const config=await read("standard/config.json"),inventory=await read("build/standard-game/asset-manifest.json");
const root=path.resolve("build/local-test"),out=path.resolve("evidence/cloudflare-setup");
const native=await read(path.join(out,"turn-native-check.json"));
const workerVersion=process.argv[2];
assert.match(workerVersion??"",/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,"Pass the verified deployed Worker version UUID.");
assert.equal(config.internetCoop.relayEnabled,true);
assert.equal(native.gameDigest,inventory.gameDigest);
for(const key of ["passed","forcedRelay","wrongBuildRejected","fullRoomNotMatched","chat","leaveAndRehost","leaveRevokedLeases","renewalPastInitialExpiry"])
  assert.equal(native[key],true,"Native evidence missing: "+key);
assert.equal(native.players,4);assert.equal(native.ctlFrames,12);assert.ok(native.binaryFrames>=12);assert.equal(native.binaryPeerPairs,12);
assert.ok(native.transports.every(route=>route==="turn"));
assert.equal(native.realSavesTouched,false);assert.equal(native.physicalAndroidTested,false);
const auditLines=(await readFile(path.join(out,"turn-secret-audit.txt"),"utf8")).trim().split("\n");
const audit=JSON.parse(auditLines.at(-1));
assert.equal(audit.audit,"service-credentials");assert.equal(audit.passed,true);
assert.equal(audit.history,true);assert.equal(audit.payloadDigest,inventory.gameDigest);
assert.ok(audit.knownSecretsChecked>=5);assert.equal(audit.artifacts.length,2);
const mac=await read(path.join(root,"macos-arm64/macos-local-test.json"));
const android=await read(path.join(root,"android/android-local-test.json"));
for(const value of [mac,android]) {
  assert.equal(value.gameDigest,inventory.gameDigest);
  assert.equal(value.version,config.version);assert.equal(value.applicationId,config.applicationId);
}
assert.equal(android.signingCertificateSha256,config.androidCertificateSha256);
const artifacts=[];
for(const [directory,name] of [["macos-arm64",mac.archive],["android",android.artifact.name]]) {
  const file=path.join(root,directory,name),proof=audit.artifacts.find(value=>value.path===file);
  assert.ok(proof,"Artifact was not scanned.");assert.equal((await stat(file)).size,proof.bytes);
  if(directory==="android")assert.equal(proof.sha256,android.artifact.sha256);
  artifacts.push(proof);
}
const report={completedAt:new Date().toISOString(),status:"Ready for user testing; not published",version:config.version,
  gameDigest:inventory.gameDigest,gateway:config.internetCoop.url,workerVersion,internetMatchmaking:true,relayEnabled:true,
  turnCredentialsIssuedInNativeCheck:native.turnCredentialsIssued,sourceIsUncommitted:true,
  checks:{nativeFourPeerForcedRelay:true,renewalPastInitialExpiry:true,leaveRevokedLeases:true,
    chat:true,fullRoomRejected:true,leaveAndRehost:true,ctlFrames:12,binaryFrames:native.binaryFrames,binaryPeerPairs:12,
    realSavesTouched:false,physicalAndroidTested:false,differentNetworksTested:false,
    knownCredentialLeakAudit:{source:true,history:true,payload:true,archives:2,knownSecretsChecked:audit.knownSecretsChecked}},
  macApp:path.resolve(root,"macos-arm64",mac.bundle),artifacts,
  budget:{cutoffBytes:800000000000,hardBillingCap:false},published:false};
await writeFile(path.join(root,"coop-test-ready.json"),JSON.stringify(report,null,2)+"\n");
await writeFile(path.join(root,"SHA256SUMS.txt"),artifacts.map(value=>`${value.sha256}  ${path.relative(root,value.path)}`).join("\n")+"\n");
await writeFile(path.join(root,"START-HERE.txt"),`PokéBonk Offline v${config.version} — unpublished guarded TURN test

Quit any running copy normally before opening the new app.
macOS Apple Silicon: open macos-arm64/${mac.bundle}
Android: install android/${android.artifact.name} OVER the existing Standard app.
Do not uninstall first. Export a backup from Player & saves before upgrading.

Use this SAME test build and connection mode on every device.
Co-op → STUN + TURN fallback → one player creates a room.
Others use Find a match or paste the complete invitation.
Choose Pokémon in the room, ready up, then let the host start (up to four).

Direct/STUN is tried first. TURN is only a fallback. The existing Connection
control in the room reports the actual route. Nothing is added to gameplay.
STUN only never requests a relay. LAN and solo play still work without Internet.

The isolated four-peer native check used real TURN and passed renewal beyond
the initial five-minute credentials, chat, peer frames, ready/start, leave and
rehost. Physical Android gameplay and different-network acceptance are YOUR
device tests, not claims made by this transport check.

Permanent issuer/monitor/admin keys are not in these packages. Only temporary
ICE credentials enter the isolated native broker. Source/history/payload and
both archives passed the local known-secret scan. No scan guarantees immunity
from every exploit. The 800 GB cutoff is a soft risk control, not a guaranteed
1,000 GB billing cap. No release, tag, signing-key upload or app installation
was performed.

Payload: ${inventory.gameDigest}
`);
console.log("Latest macOS ARM/Android test report and checksums match the verified forced-TURN payload. Nothing published.");
