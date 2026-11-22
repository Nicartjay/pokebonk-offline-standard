// Run on the key-holding Mac after CI finishes. GitHub never receives these keys.
import {readFile, mkdir, mkdtemp, rename, rm} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {isDeepStrictEqual} from "node:util";
import {DESKTOP_PLATFORMS, verifyCandidates, requireCandidateRun} from "./verify-candidates.mjs";
import {collectArtifacts, assemble} from "./assemble-release.mjs";
import {signAndroidCandidate} from "./sign-android-candidate.mjs";
import {verifyPayload} from "./verify.mjs";
import {releasePlatform} from "../common/manifest.mjs";
import {receiptName} from "./release-files.mjs";

const args = process.argv.slice(2).filter(a => a !== "--");
const runId = args.find(a => /^\d+$/.test(a));
if (!runId || args.some(a => a !== runId && a !== "--prepare-draft")) throw new Error("Usage: pnpm release:finalize RUN_ID [--prepare-draft]");
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
const git = args => execFileSync("git", args, {encoding: "utf8"}).trim();
if (git(["status", "--porcelain"])) throw new Error("Finalize only the exact clean, reviewed source checkout.");
const head = git(["rev-parse", "HEAD"]), repo = config.repository;
if (repo !== "Nicartjay/pokebonk-offline-standard") throw new Error("Unexpected release repository.");
const gh = args => execFileSync("gh", args, {stdio: "inherit"});
const run = JSON.parse(execFileSync("gh", ["api", `repos/${repo}/actions/runs/${runId}`], {encoding: "utf8"}));
requireCandidateRun(run, head, repo);
await mkdir("build", {recursive: true});
const temp = await mkdtemp(path.resolve("build/finalize-"));
try {
  gh(["run", "download", runId, "--repo", repo, "--name", "shared-game-payload", "--dir", path.join(temp, "payload")]);
  execFileSync(process.execPath, ["standard/scripts/restore-payload.mjs"],
    {env: {...process.env, GAME_ARCHIVE: path.join(temp, "payload/standard-game.tar")}, stdio: "inherit"});
  await rm(path.join(temp, "payload"), {recursive: true, force: true});
  const verified = await verifyPayload();
  gh(["run", "download", runId, "--repo", repo, "--pattern", "installers-*", "--dir", path.join(temp, "desktop")]);
  await mkdir("standard/release", {recursive: true});
  for (const platform of DESKTOP_PLATFORMS) {
    const directory = path.join(temp, "desktop", `installers-${releasePlatform(platform)}`);
    const artifacts = await collectArtifacts(directory, config, verified.inventory.gameDigest, {platforms: [platform]});
    for (const name of [...Object.values(artifacts).map(a => a.name), receiptName(platform)]) {
      // Move, rather than duplicate multi-GB installer sets on the key-holding Mac.
      await rename(path.join(directory, name), path.resolve("standard/release", name));
    }
  }
  gh(["run", "download", runId, "--repo", repo, "--name", "candidate-android-universal", "--dir", path.join(temp, "android")]);
  gh(["run", "download", runId, "--repo", repo, "--name", `candidate-audit-${config.version}`, "--dir", path.join(temp, "audit")]);
  const summary = await verifyCandidates({android: path.join(temp, "android")});
  const ciSummary = JSON.parse(await readFile(path.join(temp, "audit/candidate-summary.json"), "utf8"));
  if (!isDeepStrictEqual(summary, ciSummary)) throw new Error("Local candidate audit differs from the completed CI run.");
  await signAndroidCandidate(path.join(temp, "android"));
  await assemble();
  if (args.includes("--prepare-draft")) {
    execFileSync(process.execPath, ["standard/scripts/publish.mjs", "--prepare-draft"], {stdio: "inherit"});
  }
  console.log("Finalized all ten downloads locally. Public publication still requires device/licensing acceptance and explicit approval.");
} finally { await rm(temp, {recursive: true, force: true}); }
