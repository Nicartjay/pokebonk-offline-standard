import {readFile} from "node:fs/promises";
import {existsSync} from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import os from "node:os";
import {artifactName} from "../common/manifest.mjs";

export const unsignedAPKName = config => artifactName(config.version, "android-universal").replace(/\.apk$/, "-UNSIGNED.apk");
export function runAndroidTool(file, args, options = {}) {
  if (process.platform !== "win32" || !/\.(?:bat|cmd)$/i.test(file)) return execFileSync(file, args, options);
  // cmd.exe is needed for .bat SDK/Gradle launchers, not for renderer code.
  const quote = value => {
    if (/["%!\r\n]/.test(value)) throw new Error("Use Android tool/keystore paths without quotes or cmd substitutions.");
    return `"${value}"`;
  };
  return execFileSync(process.env.ComSpec ?? "cmd.exe",
    ["/d", "/s", "/c", `"${[file, ...args].map(quote).join(" ")}"`], {...options, windowsVerbatimArguments: true});
}
export function androidTools() {
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ??
    (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "Android/Sdk") : path.join(os.homedir(), "Library/Android/sdk"));
  const base = path.join(sdk, "build-tools/36.0.0");
  const tools = {signer: path.join(base, process.platform === "win32" ? "apksigner.bat" : "apksigner"),
    aapt: path.join(base, process.platform === "win32" ? "aapt2.exe" : "aapt2"),
    zipalign: path.join(base, process.platform === "win32" ? "zipalign.exe" : "zipalign")};
  if (Object.values(tools).some(file => !existsSync(file))) throw new Error("Install Android build-tools 36.0.0 and set ANDROID_HOME.");
  return tools;
}
export async function localCredentials(file = "../pokebonk-standard-signing/credentials.json") {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}
export function verifyAPKIdentity(apk, config, {signed = true} = {}) {
  const {aapt, signer} = androidTools();
  const badging = runAndroidTool(aapt, ["dump", "badging", apk], {encoding: "utf8"});
  if (!badging.includes(`package: name='${config.applicationId}' versionCode='${config.androidVersionCode}' versionName='${config.version}'`) ||
      !badging.includes(`application-label:'${config.productName}'`)) throw new Error("APK package/version/display name does not match configuration.");
  let report;
  try { report = runAndroidTool(signer, ["verify", "--verbose", "--print-certs", apk], {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}); }
  catch (error) {
    if (!signed && Number.isInteger(error.status) && error.status !== 0) return;
    throw new Error("APK signature verification failed.", {cause: error});
  }
  if (!signed) throw new Error("Expected a clearly unsigned candidate, not a debug/other signed APK.");
  if (!report.includes(`certificate SHA-256 digest: ${config.androidCertificateSha256}`)) throw new Error("APK signing certificate differs from the original app.");
}
