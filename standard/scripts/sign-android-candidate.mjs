import {readFile, mkdir, rename, rm} from "node:fs/promises";
import path from "node:path";
import {artifactName} from "../common/manifest.mjs";
import {androidTools, localCredentials, runAndroidTool, verifyAPKIdentity} from "./android-artifacts.mjs";
import {verifyUnsignedCandidate} from "./verify-candidates.mjs";
import {verifyAPKPayload} from "./apk-payload.mjs";
import {verifyPayload} from "./verify.mjs";
import {describeArtifact, writeReceipt} from "./release-files.mjs";
import {isMain} from "../../scripts/is-main.mjs";

export async function signAndroidCandidate(directory = "standard/candidate", credentialsFile) {
  const config = JSON.parse(await readFile("standard/config.json", "utf8"));
  const verified = await verifyPayload(), receipt = await verifyUnsignedCandidate(directory, config, verified);
  const apk = path.resolve(directory, receipt.artifact.name);
  verifyAPKIdentity(apk, config, {signed: false});
  await verifyAPKPayload(apk, config);
  const {zipalign, signer} = androidTools();
  runAndroidTool(zipalign, ["-c", "4", apk], {stdio: "inherit"});
  const credentials = await localCredentials(credentialsFile), out = "standard/release";
  const name = artifactName(config.version, "android-universal"), target = path.resolve(out, name), temporary = target + ".signing";
  await mkdir(out, {recursive: true});
  try {
    runAndroidTool(signer, ["sign", "--ks", credentials.keystoreFile, "--ks-key-alias", credentials.keyAlias,
      "--ks-pass", "env:STANDARD_APK_STORE_PASSWORD", "--key-pass", "env:STANDARD_APK_KEY_PASSWORD",
      "--v4-signing-enabled", "false", "--out", temporary, apk], {
      env: {...process.env, STANDARD_APK_STORE_PASSWORD: credentials.storePassword, STANDARD_APK_KEY_PASSWORD: credentials.keyPassword},
      stdio: ["ignore", "pipe", "pipe"],
    });
    verifyAPKIdentity(temporary, config);
    await verifyAPKPayload(temporary, config);
    await rename(temporary, target);
  } finally { await rm(temporary, {force: true}); }
  const artifact = await describeArtifact(out, "android-universal", config, {applicationId: config.applicationId,
    versionCode: config.androidVersionCode, signingCertificateSha256: config.androidCertificateSha256});
  await writeReceipt(out, "android-universal", config, verified.inventory.gameDigest, {"android-universal": artifact});
  console.log("Signed and verified the APK locally with the original certificate. No private key was uploaded.");
}
if (isMain(import.meta.url)) await signAndroidCandidate(process.argv[2], process.argv[3]);
