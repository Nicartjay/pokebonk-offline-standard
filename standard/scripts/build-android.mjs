import {readFile, cp, mkdir, writeFile, stat} from "node:fs/promises";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {artifactName} from "../common/manifest.mjs";
import {describeArtifact, writeReceipt, fileHash} from "./release-files.mjs";
import {androidTools, localCredentials, runAndroidTool, unsignedAPKName, verifyAPKIdentity} from "./android-artifacts.mjs";
import {verifyAPKPayload} from "./apk-payload.mjs";

const unsigned = process.argv.includes("--unsigned-candidate");
const credentials = unsigned ? null : await localCredentials(process.argv[2]);
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
if (!config.androidCertificateSha256 || !config.updatePublicKey) throw new Error("Restore the original public signing configuration.");
execFileSync(process.execPath, ["standard/scripts/stage-android.mjs"], {stdio: "inherit"});
const env = {...process.env, STANDARD_UNSIGNED_CANDIDATE: unsigned ? "1" : "0"};
for (const name of ["STANDARD_ANDROID_KEYSTORE", "STANDARD_ANDROID_STORE_PASSWORD", "STANDARD_ANDROID_KEY_PASSWORD", "STANDARD_ANDROID_KEY_ALIAS"]) delete env[name];
if (credentials) Object.assign(env, {STANDARD_ANDROID_KEYSTORE: credentials.keystoreFile,
  STANDARD_ANDROID_STORE_PASSWORD: credentials.storePassword, STANDARD_ANDROID_KEY_PASSWORD: credentials.keyPassword,
  STANDARD_ANDROID_KEY_ALIAS: credentials.keyAlias});
runAndroidTool(process.platform === "win32" ? "gradlew.bat" : "./gradlew",
  [":app:testDebugUnitTest", ":app:lintRelease", ":app:assembleRelease", "--no-daemon"], {cwd: "standard/android", env, stdio: "inherit"});
const apk = `standard/android/app/build/outputs/apk/release/app-release${unsigned ? "-unsigned" : ""}.apk`;
androidTools();
verifyAPKIdentity(apk, config, {signed: !unsigned});
const {inventory, metadata} = await verifyAPKPayload(apk, config);
if (unsigned) {
  // An unsigned candidate deliberately has neither a release filename nor a
  // release receipt. It cannot pass the assembler or installed-app updater.
  const out = "standard/candidate", name = unsignedAPKName(config);
  await mkdir(out, {recursive: true});
  await cp(apk, path.join(out, name));
  const info = await stat(path.join(out, name));
  await writeFile(path.join(out, "android-unsigned.json"), JSON.stringify({
    candidateVersion: 1, edition: "standard", applicationId: config.applicationId,
    productName: config.productName, version: config.version, versionCode: config.androidVersionCode,
    sourceCommit: metadata.sourceCommit, gameDigest: inventory.gameDigest,
    artifact: {name, platform: "android-universal", kind: "apk-unsigned", bytes: info.size, sha256: await fileHash(path.join(out, name))},
  }, null, 2) + "\n");
  console.log("Built an UNSIGNED Android candidate. It is not an installable signed release; finalize locally with the original keys.");
} else {
  const out = "standard/release", name = artifactName(config.version, "android-universal");
  await mkdir(out, {recursive: true}); await cp(apk, path.join(out, name));
  const artifact = await describeArtifact(out, "android-universal", config, {
    applicationId: config.applicationId, versionCode: config.androidVersionCode, signingCertificateSha256: config.androidCertificateSha256,
  });
  await writeReceipt(out, "android-universal", config, inventory.gameDigest, {"android-universal": artifact});
  console.log(`Signed ${config.productName} APK verified: ${path.resolve(out, name)}. Version code ${config.androidVersionCode}.`);
}
