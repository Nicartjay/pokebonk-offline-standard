// EXPLICIT publishing only. Never called by scheduled jobs or app startup.
import {readFile, writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import {verifyManifest, compareVersions} from "../common/manifest.mjs";
import {fetchManifest} from "../common/network.mjs";
import {collectArtifacts, releaseFiles} from "./assemble-release.mjs";
import {fileHash} from "./release-files.mjs";
import {isMain} from "../../scripts/is-main.mjs";
export function requireAcceptance(receipt, manifest, {actor, allowWaiver = false} = {}) {
  if (receipt.version !== manifest.version || receipt.sourceCommit !== manifest.source.commit ||
      receipt.gameDigest !== manifest.source.gameDigest || typeof receipt.approvedBy !== "string" || !receipt.approvedBy.trim() ||
      !Number.isFinite(Date.parse(receipt.approvedAt))) throw new Error("Acceptance receipt does not identify this exact release.");
  const checks = ["automatedTests", "macArm64Gameplay", "macIntelGameplay", "windowsGameplay", "linuxGameplay", "physicalAndroidGameplay",
    "offlineGameplay", "fullscreenInputAudioTouch", "saveExportImportRestart", "backgroundProcessDeath",
    "upgradePreservesIdentityAndProgress", "corruptUpdatesRejected", "licensingReviewed"];
  const missing = checks.filter(key => receipt[key] !== true);
  if (!missing.length) {
    if (actor && receipt.approvedBy !== actor) throw new Error("Acceptance reviewer must match the authenticated publisher.");
    return;
  }
  const required = missing.find(key => ["automatedTests", "corruptUpdatesRejected"].includes(key));
  if (required || !allowWaiver || !receipt.maintainerWaiver) throw new Error(`Acceptance still required: ${required ?? missing[0]}.`);
  const waiver = receipt.maintainerWaiver, owner = manifest.repository.split("/")[0];
  // An explicit owner decision is not a passing test result. It never waives
  // automated/security gates, signatures, payload checks, clean source or tags.
  if (checks.some(key => typeof receipt[key] !== "boolean") ||
      actor !== owner || receipt.approvedBy !== actor ||
      waiver.version !== 1 || waiver.approveStable !== true ||
      waiver.approvedBy !== actor || waiver.approvedAt !== receipt.approvedAt ||
      typeof waiver.reason !== "string" || waiver.reason.trim().length < 20 ||
      !Array.isArray(waiver.checks) || !isDeepStrictEqual([...waiver.checks].sort(), [...missing].sort())) {
    throw new Error("Explicit exact-release owner acceptance of the remaining checks is required.");
  }
}
export async function verifyReleaseFiles(directory, config, manifest) {
  const artifacts = await collectArtifacts(directory, config, manifest.source.gameDigest);
  if (!isDeepStrictEqual(artifacts, manifest.artifacts)) throw new Error("Receipt artifacts differ from signed metadata.");
  const provenance = JSON.parse(await readFile(path.join(directory, "standard-provenance.json"), "utf8"));
  if (!isDeepStrictEqual(provenance, manifest)) throw new Error("Readable provenance differs from signed metadata.");
  const expected = releaseFiles(config, artifacts).sort();
  const lines = (await readFile(path.join(directory, "SHA256SUMS.txt"), "utf8")).trim().split("\n");
  const actual = [];
  for (const name of expected) actual.push(`${await fileHash(path.join(directory, name))}  ${name}`);
  if (!isDeepStrictEqual(lines, actual)) throw new Error("Release checksum list is incomplete or mismatched.");
  return artifacts;
}
async function publish() {
  const draftOnly = process.argv.includes("--prepare-draft"), approved = process.argv.includes("--approve-publication");
  const allowWaiver = process.argv.includes("--accept-maintainer-waiver");
  if (draftOnly === approved) throw new Error("Choose --prepare-draft OR --approve-publication. Public publication also requires a completed release acceptance receipt.");
  const config = JSON.parse(await readFile("standard/config.json", "utf8")), directory = "standard/release";
  const manifest = verifyManifest(await readFile(path.join(directory, "standard-update.json")), config);
  const capture = (command, args) => execFileSync(command, args, {encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]}).trim();
  const gh = args => execFileSync("gh", args, {stdio: "inherit"});
  const head = capture("git", ["rev-parse", "HEAD"]);
  if (capture("git", ["status", "--porcelain"]) || head !== manifest.source.commit || manifest.version !== config.version) throw new Error("Publish source must be the exact clean accepted commit.");
  const repo = JSON.parse(capture("gh", ["repo", "view", config.repository, "--json", "nameWithOwner,visibility,viewerPermission"]));
  if (repo.nameWithOwner !== "Nicartjay/pokebonk-offline-standard" || repo.nameWithOwner !== config.repository || repo.visibility !== "PUBLIC" ||
      !["ADMIN", "MAINTAIN", "WRITE"].includes(repo.viewerPermission)) throw new Error("Verified public publishing fork is required.");
  if (!draftOnly) {
    const actor = process.env.GITHUB_ACTIONS === "true" ? process.env.GITHUB_ACTOR : capture("gh", ["api", "user", "--jq", ".login"]);
    requireAcceptance(JSON.parse(await readFile(path.join(directory, "acceptance.json"), "utf8")), manifest, {actor, allowWaiver});
  }
  const artifacts = await verifyReleaseFiles(directory, config, manifest);
  if (!draftOnly) try {
    const previous = verifyManifest(await fetchManifest(config.channelUrl), config);
    if (compareVersions(manifest.version, previous.version) <= 0 ||
        artifacts["android-universal"].versionCode <= previous.artifacts["android-universal"].versionCode) throw new Error("App version and Android versionCode must both increase.");
  } catch (error) {
    if (!process.argv.includes("--first-release") || !String(error.message).includes("(404)")) throw error;
  }
  const tag = `standard-v${manifest.version}`;
  if (capture("git", ["rev-parse", `${tag}^{commit}`]) !== head) throw new Error("Create and push the exact Standard version tag after review.");
  if (capture("gh", ["api", `repos/${config.repository}/commits/${tag}`, "--jq", ".sha"]) !== head) throw new Error("Remote release tag does not identify this source commit.");
  let existing;
  try { existing = JSON.parse(capture("gh", ["api", `repos/${config.repository}/releases/tags/${tag}`])); }
  catch (error) { if (!String(error.stderr).includes("HTTP 404")) throw error; }
  if (existing && !existing.draft) throw new Error("Published versioned releases are immutable. Increase both app version and Android versionCode.");
  // --verify-tag prevents implicitly creating a remote tag or pushing source.
  const notes = path.join(directory, "release-notes-approved.md");
  await writeFile(notes, manifest.notes);
  if (!existing) gh(["release", "create", tag, "--repo", config.repository, "--verify-tag", "--draft", "--title", `${config.productName} ${manifest.version}`, "--notes-file", notes]);
  const files = [...releaseFiles(config, artifacts), "SHA256SUMS.txt"].map(name => path.join(directory, name));
  // Replacement is allowed ONLY while this release is still an unpublished draft.
  gh(["release", "upload", tag, ...files, "--repo", config.repository, "--clobber"]);
  if (draftOnly) {
    console.log("Prepared an unpublished draft for testing. The public update channel was NOT changed.");
    return;
  }
  gh(["release", "edit", tag, "--repo", config.repository, "--draft=false", "--prerelease=false", "--latest"]);
  const published = JSON.parse(capture("gh", ["release", "view", tag, "--repo", config.repository, "--json", "isDraft,isPrerelease"]));
  if (published.isDraft || published.isPrerelease) throw new Error("Stable publication was not confirmed.");
  let channel;
  try { channel = JSON.parse(capture("gh", ["release", "view", "standard-channel", "--repo", config.repository, "--json", "isDraft,tagName"])); }
  catch (error) {
    if (!process.argv.includes("--first-release")) throw error;
    gh(["release", "create", "standard-channel", "--repo", config.repository, "--target", head, "--prerelease", "--latest=false",
      "--title", "PokéBonk Offline update channel", "--notes", "Signed metadata only. Versioned installers and source remain in their immutable releases."]);
  }
  if (channel?.isDraft) throw new Error("Standard channel must be public before updating discovery.");
  gh(["release", "upload", "standard-channel", path.join(directory, "standard-update.json"), "--repo", config.repository, "--clobber"]);
  console.log("Published the approved Standard release and signed channel manifest. Previous releases retained.");
}
if (isMain(import.meta.url)) await publish();
