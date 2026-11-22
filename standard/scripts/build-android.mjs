import {readFile, cp, mkdir} from "node:fs/promises";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {artifactName} from "../common/manifest.mjs";
import {describeArtifact, writeReceipt} from "./release-files.mjs";
const credentials = process.env.STANDARD_ANDROID_KEYSTORE ? {
  keystoreFile: process.env.STANDARD_ANDROID_KEYSTORE,
  storePassword: process.env.STANDARD_ANDROID_STORE_PASSWORD,
  keyPassword: process.env.STANDARD_ANDROID_KEY_PASSWORD,
  keyAlias: process.env.STANDARD_ANDROID_KEY_ALIAS,
} : JSON.parse(await readFile(path.resolve(process.argv[2] ?? "../pokebonk-standard-signing/credentials.json"), "utf8"));
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
if (!config.androidCertificateSha256 || !config.updatePublicKey) throw new Error("Initialize/restore Standard signing first.");
execFileSync(process.execPath, ["standard/scripts/stage-android.mjs"], {stdio: "inherit"});
const env = {...process.env, STANDARD_ANDROID_KEYSTORE: credentials.keystoreFile,
  STANDARD_ANDROID_STORE_PASSWORD: credentials.storePassword, STANDARD_ANDROID_KEY_PASSWORD: credentials.keyPassword,
  STANDARD_ANDROID_KEY_ALIAS: credentials.keyAlias};
execFileSync(process.platform === "win32" ? "gradlew.bat" : "./gradlew",
  [":app:testDebugUnitTest", ":app:lintRelease", ":app:assembleRelease", "--no-daemon"], {cwd: "standard/android", env, stdio: "inherit"});
const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(process.env.HOME, "Library/Android/sdk");
const signer = path.join(sdk, "build-tools/36.0.0", process.platform === "win32" ? "apksigner.bat" : "apksigner");
const apk = "standard/android/app/build/outputs/apk/release/app-release.apk";
const report = execFileSync(signer, ["verify", "--verbose", "--print-certs", apk], {encoding: "utf8"});
if (!report.includes(`certificate SHA-256 digest: ${config.androidCertificateSha256}`)) throw new Error("APK release signing identity differs from the configured Standard certificate.");
const out = "standard/release"; await mkdir(out, {recursive: true});
const name = artifactName(config.version, "android-universal");
await cp(apk, path.join(out, name));
const inventory = JSON.parse(await readFile("build/standard-game/asset-manifest.json", "utf8"));
const artifact = await describeArtifact(out, "android-universal", config, {
  applicationId: config.applicationId, versionCode: config.androidVersionCode, signingCertificateSha256: config.androidCertificateSha256,
});
await writeReceipt(out, "android-universal", config, inventory.gameDigest, {"android-universal": artifact});
console.log(`Signed Standard APK verified: ${path.resolve(out, name)}. Version code ${config.androidVersionCode}.`);
