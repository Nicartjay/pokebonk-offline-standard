// Local testing only: deliberately separate from release receipts/artifacts.
import {readFile, mkdir, cp, writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {localCredentials, runAndroidTool, verifyAPKIdentity} from "./android-artifacts.mjs";
import {verifyAPKPayload} from "./apk-payload.mjs";
import {fileHash} from "./release-files.mjs";
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
const [requestedOutput, ...extra] = process.argv.slice(2);
if (extra.length) throw new Error("Usage: package-android-test.mjs [build/output-directory]");
const out = path.resolve(requestedOutput ?? "build/local-test");
if (!out.startsWith(path.resolve("build") + path.sep)) throw new Error("Local APK output must stay inside build/.");
const credentials = await localCredentials();
execFileSync(process.execPath, ["standard/scripts/stage-android.mjs"], {stdio: "inherit"});
const env = {...process.env, STANDARD_UNSIGNED_CANDIDATE: "0",
  STANDARD_ANDROID_KEYSTORE: credentials.keystoreFile,
  STANDARD_ANDROID_STORE_PASSWORD: credentials.storePassword,
  STANDARD_ANDROID_KEY_PASSWORD: credentials.keyPassword,
  STANDARD_ANDROID_KEY_ALIAS: credentials.keyAlias};
runAndroidTool(process.platform === "win32" ? "gradlew.bat" : "./gradlew",
  [":app:assembleRelease", "--offline", "--no-daemon"], {cwd: "standard/android", env, stdio: "inherit"});
const apk = "standard/android/app/build/outputs/apk/release/app-release.apk";
verifyAPKIdentity(apk, config);
const {inventory, metadata} = await verifyAPKPayload(apk, config);
const name = `pokebonk-offline-${config.version}-android-LOCAL-TEST.apk`;
await mkdir(out, {recursive: true});
await cp(apk, path.join(out, name));
await writeFile(path.join(out, "android-local-test.json"), JSON.stringify({
  status: "Unpublished local test; not a release receipt", version: config.version,
  versionCode: config.androidVersionCode, applicationId: config.applicationId,
  upstream: config.upstream, gameDigest: inventory.gameDigest,
  ...(metadata.coop ? {coop: metadata.coop} : {}),
  artifact: name, sha256: await fileHash(path.join(out, name)),
}, null, 2) + "\n");
console.log(`Local test APK (not published): ${path.resolve(out, name)}`);
