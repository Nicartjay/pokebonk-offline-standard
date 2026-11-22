import {readFile, writeFile, lstat} from "node:fs/promises";
import path from "node:path";
import {PLATFORMS} from "../common/manifest.mjs";
import {collectArtifacts} from "./assemble-release.mjs";
import {fileHash} from "./release-files.mjs";
import {unsignedAPKName} from "./android-artifacts.mjs";
import {verifyAPKPayload} from "./apk-payload.mjs";
import {verifyPayload} from "./verify.mjs";
import {isMain} from "../../scripts/is-main.mjs";

export const DESKTOP_PLATFORMS = PLATFORMS.filter(p => p !== "android-universal");
export function requireCandidateRun(run, head, repository) {
  if (run.head_sha !== head || run.status !== "completed" || run.conclusion !== "success" ||
      run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      run.path !== ".github/workflows/build-release.yml" || !["push", "workflow_dispatch"].includes(run.event)) {
    throw new Error("Choose a successful complete installer run in this repository for this exact reviewed commit.");
  }
}
export async function verifyUnsignedCandidate(directory, config, verified) {
  const receipt = JSON.parse(await readFile(path.join(directory, "android-unsigned.json"), "utf8"));
  const a = receipt.artifact;
  if (receipt.candidateVersion !== 1 || receipt.edition !== "standard" || receipt.applicationId !== config.applicationId ||
      receipt.productName !== config.productName || receipt.version !== config.version || receipt.versionCode !== config.androidVersionCode ||
      receipt.sourceCommit !== verified.metadata.sourceCommit || receipt.gameDigest !== verified.inventory.gameDigest ||
      !a || a.name !== unsignedAPKName(config) || a.kind !== "apk-unsigned" || a.platform !== "android-universal" ||
      !Number.isSafeInteger(a.bytes) || a.bytes <= 0 || a.bytes > 1024 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(a.sha256)) throw new Error("Wrong unsigned Android candidate identity or payload.");
  const file = path.join(directory, a.name), info = await lstat(file);
  if (!info.isFile() || info.size !== a.bytes || await fileHash(file) !== a.sha256) throw new Error("Unsigned APK candidate hash/size mismatch.");
  return receipt;
}
export async function verifyCandidates({desktop = "standard/release", android = "standard/candidate"} = {}) {
  const config = JSON.parse(await readFile("standard/config.json", "utf8"));
  const verified = await verifyPayload();
  const artifacts = await collectArtifacts(desktop, config, verified.inventory.gameDigest, {platforms: DESKTOP_PLATFORMS});
  const unsignedAndroid = await verifyUnsignedCandidate(android, config, verified);
  await verifyAPKPayload(path.join(android, unsignedAndroid.artifact.name), config);
  return {candidateVersion: 1, requiresLocalFinalization: true, applicationId: config.applicationId,
    productName: config.productName, version: config.version, upstream: config.upstream, saveSchema: config.saveSchema,
    source: {commit: verified.metadata.sourceCommit, pristineDigest: verified.metadata.pristineDigest, gameDigest: verified.inventory.gameDigest},
    artifacts, unsignedAndroid};
}
if (isMain(import.meta.url)) {
  const summary = await verifyCandidates();
  await writeFile("standard/candidate/candidate-summary.json", JSON.stringify(summary, null, 2) + "\n");
  console.log("Verified nine desktop packages and the clearly unsigned APK against one game payload. Local signing is still required; nothing was published.");
}
