// Delete only superseded Actions build artifacts, never releases or source.
import {execFileSync} from "node:child_process";
import {isMain} from "../../scripts/is-main.mjs";
const REPOSITORY = "Nicartjay/pokebonk-offline-standard";
const WORKFLOW = ".github/workflows/build-release.yml";
const ownedBuild = run => run?.repository?.full_name === REPOSITORY &&
  run.head_repository?.full_name === REPOSITORY && run.path === WORKFLOW &&
  ["push", "workflow_dispatch"].includes(run.event);

export function planArtifactCleanup({keepRun, artifacts, runs, auditPassed = false}) {
  if (!ownedBuild(keepRun) || !(keepRun.status === "completed" && keepRun.conclusion === "success" ||
      keepRun.status === "in_progress" && auditPassed)) throw new Error("Keep a successful owned full installer build.");
  const current = artifacts.filter(a => a.workflow_run?.id === keepRun.id && !a.expired);
  const names = current.map(a => a.name);
  const required = [["shared-game-payload"], ["installers-macos-arm64", "installers-darwin-arm64"],
    ["installers-macos-x64", "installers-darwin-x64"], ["installers-win32-x64"], ["installers-linux-x64"],
    ["candidate-android-universal"]];
  if (names.length !== 7 || required.some(options => options.filter(name => names.includes(name)).length !== 1) ||
      names.filter(name => /^candidate-audit-\d+\.\d+\.\d+$/.test(name)).length !== 1) {
    throw new Error("Latest complete seven-artifact installer set is missing; nothing may be deleted.");
  }
  const cutoff = Date.parse(keepRun.created_at);
  if (!Number.isFinite(cutoff)) throw new Error("Invalid keep-run timestamp.");
  const byId = new Map(runs.map(run => [run.id, run]));
  return artifacts.filter(artifact => {
    const run = byId.get(artifact.workflow_run?.id);
    const date = Date.parse(run?.created_at);
    return Number.isSafeInteger(artifact.id) && artifact.id > 0 && run?.id !== keepRun.id &&
      ownedBuild(run) && run.status === "completed" && Number.isFinite(date) && date < cutoff;
  });
}
async function main() {
  const args = process.argv.slice(2), apply = args.includes("--apply");
  const index = args.indexOf("--keep-run");
  const id = index >= 0 ? args[index + 1] : process.env.GITHUB_RUN_ID;
  if (!/^\d+$/.test(id ?? "") || args.some((arg, i) =>
      !["--apply", "--keep-run"].includes(arg) && !(index >= 0 && i === index + 1))) {
    throw new Error("Usage: node standard/scripts/prune-artifacts.mjs [--apply] --keep-run RUN_ID");
  }
  if (process.env.GITHUB_REPOSITORY && process.env.GITHUB_REPOSITORY !== REPOSITORY) throw new Error("Unexpected repository.");
  const capture = endpoint => JSON.parse(execFileSync("gh", ["api", endpoint], {encoding: "utf8"}));
  function pages(endpoint, key) {
    const all = [], seen = new Set();
    for (let page = 1; page <= 100; page++) {
      const data = capture(`${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Array.isArray(data[key])) throw new Error("Invalid paginated GitHub response.");
      for (const value of data[key]) {
        if (seen.has(value.id)) throw new Error("Duplicate artifact/page; refusing partial cleanup.");
        seen.add(value.id); all.push(value);
      }
      if (data[key].length < 100) {
        if (Number.isInteger(data.total_count) && data.total_count !== all.length) throw new Error("Artifact list changed; retry cleanup.");
        return all;
      }
    }
    throw new Error("Artifact pagination limit exceeded.");
  }
  const keepRun = capture(`repos/${REPOSITORY}/actions/runs/${id}`);
  const artifacts = pages(`repos/${REPOSITORY}/actions/artifacts`, "artifacts");
  const runIds = [...new Set(artifacts.map(a => a.workflow_run?.id).filter(Boolean))];
  const runs = runIds.map(run => run === keepRun.id ? keepRun : capture(`repos/${REPOSITORY}/actions/runs/${run}`));
  const auditPassed = keepRun.status === "in_progress" && process.env.GITHUB_RUN_ID === id &&
    pages(`repos/${REPOSITORY}/actions/runs/${id}/jobs?filter=latest`, "jobs")
      .some(job => job.name === "verify-candidates" && job.status === "completed" && job.conclusion === "success");
  const obsolete = planArtifactCleanup({keepRun, artifacts, runs, auditPassed});
  console.log(`Keeping all seven artifacts from installer run ${id}. ${apply ? "Deleting" : "Would delete"} ${obsolete.length} older artifacts.`);
  let bytes = 0;
  for (const artifact of obsolete) {
    console.log(`${apply ? "Deleting" : "Would delete"} ${artifact.id}: ${artifact.name} (run ${artifact.workflow_run.id})`);
    if (apply) execFileSync("gh", ["api", "--method", "DELETE", `repos/${REPOSITORY}/actions/artifacts/${artifact.id}`], {stdio: "inherit"});
    bytes += artifact.size_in_bytes ?? 0;
  }
  console.log(JSON.stringify({applied: apply, keptRun: keepRun.id, oldArtifacts: obsolete.length, bytes, releasesModified: false}));
}
if (isMain(import.meta.url)) await main();
