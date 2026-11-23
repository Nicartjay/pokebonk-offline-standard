// Local acceptance report only. Does not create signed release/update metadata,
// tags, uploads, credentials or publication claims.
import assert from "node:assert/strict";
import {readFile,writeFile,readdir,stat,cp} from "node:fs/promises";
import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import path from "node:path";

const config=JSON.parse(await readFile("standard/config.json","utf8"));
const root=path.resolve(process.argv[2]??`build/local-test-${config.version}-${config.upstream.version}`);
assert.ok(root.startsWith(path.resolve("build")+path.sep),"Local reports must stay inside build/.");
const json=async file=>JSON.parse(await readFile(file,"utf8"));
const inventory=await json("build/standard-game/asset-manifest.json");
const metadata=await json("build/standard-game/offline-build.json");
const prefix=`evidence/refresh-${config.upstream.version}`;
const unitLog=await readFile(prefix+"-tests.log","utf8");
assert.ok(unitLog.includes("Regression payload: "+inventory.gameDigest),"Regression log is for another payload.");
const count=name=>Number(unitLog.match(new RegExp(`ℹ ${name} (\\d+)`))?.[1]);
assert.ok(count("tests")>0);assert.equal(count("tests"),count("pass"));assert.equal(count("fail"),0);
const digest=data=>assert.equal(data.gameDigest,inventory.gameDigest,"Verification report is for another game payload.");
const layouts={};
for(const platform of ["darwin","win32","android"]){
  const data=await json(`evidence/standard-layout/${platform}/checks.json`);digest(data);
  assert.equal(data.platform,platform);assert.deepEqual(data.errors,[]);assert.deepEqual(data.externalRequests,[]);
  layouts[platform]={observedAt:data.observedAt,passed:true,nativeOSFullscreenTested:false};
}
const ui=await json("evidence/offline-content/ui-checks.json"), engines=await json("evidence/offline-content/engine-checks.json");
for(const data of [ui,engines]){
  digest(data);assert.deepEqual(data.errors,[]);assert.deepEqual(data.missing,[]);assert.deepEqual(data.external,[]);
}
assert.equal(ui.scope,"ui-only");assert.equal(engines.scope,"engines-only");
assert.deepEqual(new Set(engines.results.filter(r=>r.phase==="real-engine-smoke").map(r=>r.mode)),new Set(["bossrush","tower","mutation"]));
const platformFixes=await json("evidence/platform-fixes/checks.json");digest(platformFixes);
assert.equal(platformFixes.compatibilityReview,false,"Review-only reader overrides cannot count as final acceptance.");
assert.deepEqual(platformFixes.errors,[]);assert.deepEqual(platformFixes.external,[]);assert.deepEqual(platformFixes.currentGameMissingResources,[]);
const replays=platformFixes.results.filter(r=>r.phase==="previous-engine-checkpoint-replay");
assert.deepEqual(new Set(replays.map(r=>r.previousBuild+":"+r.mode)),
  new Set(["mwqb4pwz:standard","mwqb4pwz:endless","mwro88g3:standard","mwro88g3:endless"]));
for(const run of replays){
  assert.equal(run.after.ticket,run.before.ticket);assert.equal(run.after.gold,run.before.gold);
  assert.equal(run.after.stardust,run.before.stardust);assert.ok(run.played.time>run.before.time+.2);
  assert.equal(run.played.failing,0);
}
const native=await json("evidence/native-desktop/checks.json");digest(native);
assert.equal(native.isolated,true);assert.equal(native.platform,"darwin");
assert.deepEqual(native.nativeBackendNamesTested,["auto","metal"]);
assert.equal(native.results.some(r=>r.phase==="renderer-error"),false);
for(const result of native.results)if(result.exit)assert.deepEqual(result.exit,{code:0,signal:null});
const packaged=await json("evidence/native-desktop/packaged-checks.json");digest(packaged.bootState);
assert.equal(packaged.isolated,true);assert.deepEqual(packaged.result,{code:0,signal:null});
assert.deepEqual(packaged.bootState.upstream,config.upstream);
assert.deepEqual(packaged.bootState.page.bridge,["loadState","saveState"]);
assert.equal(packaged.bootState.page.error,null);assert.equal(packaged.bootState.page.booted,true);
const junit={tests:0,failures:0,errors:0,skipped:0};
const junitRoot="standard/android/app/build/test-results/testDebugUnitTest";
for(const file of (await readdir(junitRoot)).filter(name=>/^TEST-.*\.xml$/.test(name))){
  const xml=await readFile(path.join(junitRoot,file),"utf8");
  const attributes=Object.fromEntries([...xml.match(/<testsuite\b([^>]*)>/)[1].matchAll(/(\w+)="([^"]*)"/g)].map(([,key,value])=>[key,value]));
  for(const key of Object.keys(junit))junit[key]+=Number(attributes[key]??0);
}
assert.ok(junit.tests>0);assert.equal(junit.failures+junit.errors+junit.skipped,0);
const lint=await readFile("standard/android/app/build/reports/lint-results-release.xml","utf8");
assert.equal(/<issue(?:\s|>)/.test(lint),false,"Android lint has unresolved issues.");
const shaFile=async file=>{const hash=createHash("sha256");for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest("hex");};
const artifacts=[];
for(const [receiptName,directory]of [["macos-arm64","macos-arm64"],["android-universal",""]]){
  const receipt=await json(`standard/release/${receiptName}.json`);
  assert.equal(receipt.gameDigest,inventory.gameDigest);assert.equal(receipt.version,config.version);
  for(const [distribution,artifact]of Object.entries(receipt.artifacts)){
    const relative=path.join(directory,artifact.name),file=path.join(root,relative);
    if(artifact.kind==="apk")await cp(path.join("standard/release",artifact.name),file);
    const info=await stat(file);assert.equal(info.size,artifact.bytes);assert.equal(await shaFile(file),artifact.sha256);
    if(artifact.kind==="apk"){
      assert.equal(artifact.applicationId,config.applicationId);assert.equal(artifact.versionCode,config.androidVersionCode);
      assert.equal(artifact.signingCertificateSha256,config.androidCertificateSha256);
    }
    artifacts.push({distribution,file:relative,bytes:artifact.bytes,sha256:artifact.sha256,kind:artifact.kind});
  }
}
assert.equal(artifacts.length,3);
assert.equal(path.resolve(packaged.image),path.join(root,artifacts.find(a=>a.kind==="dmg").file));
const report={format:"pokebonk-offline-local-test",observedAt:new Date().toISOString(),
  status:"Ready for maintainer testing; publication on hold",productName:config.productName,version:config.version,
  upstream:config.upstream,androidVersionCode:config.androidVersionCode,applicationId:config.applicationId,
  pristineDigest:metadata.pristineDigest,gameDigest:inventory.gameDigest,
  source:{baseCommit:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),
    uncommittedWorkingTree:Boolean(execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim())},
  checks:{nodeRegressionTests:{passed:count("tests"),failed:0},androidJVMTests:junit,androidReleaseLintIssues:0,
    layouts,offlineEventUIAndEngineSmoke:true,olderCheckpointsReplayed:replays.map(r=>({build:r.previousBuild,mode:r.mode})),
    macOSNativeControlsAndMetal:true,packagedDMGExactGameAndHostHashesVerified:true,packagedMacCleanExit:true,
    originalAndroidSigningCertificateVerified:true,matchingPackagedGamePayloads:true},
  notClaimed:["Physical Android gameplay, process-death and install-over-existing testing",
    "Native Windows/Intel Mac/Linux gameplay and driver testing","Multiple physical monitors or every graphics backend",
    "Exhaustive human gameplay acceptance or public release approval"],
  knownLimitations:["The Great Expedition remains a disabled design preview, not a playable offline mode."],
  artifacts,publication:{published:false,tagCreated:false,workflowDispatched:false,updateChannelChanged:false}};
await writeFile(path.join(root,"LOCAL-BUILD.json"),JSON.stringify(report,null,2)+"\n");
await writeFile(path.join(root,"LOCAL-SHA256SUMS.txt"),artifacts.map(a=>`${a.sha256}  ${a.file}`).sort().join("\n")+"\n");
await writeFile(path.join(root,"LOCAL-TESTING.md"),`# PokéBonk Offline v${config.version} — local test build

Bundled game **${config.upstream.version} / ${config.upstream.build}**. Android code **${config.androidVersionCode}**.
This is not a GitHub release. Use this folder, not the older 0.10.23 test packages.

## macOS (Apple Silicon)

1. In your currently running game, use **Save and quit** if a run is in progress.
2. Fully quit the older app before launching this copy; the shared installation
   identity otherwise focuses the already-running version.
3. Open \`macos-arm64/pokebonk-offline-${config.version}-macos-arm64.dmg\` and open
   **PokéBonk Offline.app**. You can copy it to Applications when you choose.
   The app ZIP and unpacked app in this folder are alternatives.
4. The app is ad-hoc signed, not notarized. A macOS developer-verification
   warning is distinct from a crash. Do not remove security protections globally.

## Android

Transfer \`pokebonk-offline-${config.version}-android-universal.apk\` to the device,
then install it **over the existing Standard app**. Do not uninstall first.
The application ID and signing certificate are unchanged. Export a backup from
Player & saves before upgrading. Your confirmation in Android's installer is required.

## Please check

- First-use Guide opens once; manual Guide still works.
- Loading has no Continue button. Music readiness waits at most 12 seconds and
  failure continues automatically.
- Player & saves contains Android backups, updates and bug reporting; no ⋮ overlay.
- Boss Rush/League titles remain readable on the actual tablet.
- Starter pictures have equal-height panels, with no vertical scrolling on phones.
- Minimap scaling above 100%, the 30 FPS battery cap, audio, touch and airplane mode.
- Desktop fullscreen/Escape, window restoration and Display & graphics.

Auto is the recommended graphics backend. Alternatives require an explicit
restart and depend on the driver. Auto and Metal were exercised on this Mac;
other hardware/backends still need device testing.

Classic/Endless checkpoints from 0.10.20 and 0.10.23 were replayed in the new
engine with progress retained. Unknown unfinished-run formats remain preserved
and rejected. The Great Expedition is still a disabled design preview.

See LOCAL-BUILD.json for exact scope and LOCAL-SHA256SUMS.txt for installer hashes.
No installed game, real save, GitHub release or update channel was changed by these tests.
`);
console.log(JSON.stringify({output:root,gameDigest:inventory.gameDigest,nodeTests:count("tests"),
  androidTests:junit.tests,artifacts:artifacts.length,publication:report.publication},null,2));
