// Same daily checker, separate Standard baseline; no duplicate issue tracker.
// NEVER capture, promote, tag, sign or publish here.
import {readFile, appendFile} from "node:fs/promises";
import {readSnapshotManifest} from "../../scripts/upstream-snapshot.ts";
import {discoverUpstream} from "../../scripts/upstream-version.ts";
import {githubVersionIssues, reconcileVersionIssue} from "../../scripts/upstream-issue.ts";
const accepted = JSON.parse(await readFile("standard/accepted.json", "utf8"));
const current = await readSnapshotManifest(accepted.snapshot), detected = await discoverUpstream();
const changed = current.upstreamBuild !== detected.build || current.upstreamVersion !== detected.upstreamVersion;
console.log(JSON.stringify({edition: "standard", accepted, detected, changed, action: "report-only"}));
if (process.argv.includes("--report")) {
  const config = JSON.parse(await readFile("standard/config.json", "utf8"));
  if (process.env.GITHUB_REPOSITORY !== config.repository) throw new Error("Unexpected issue-reporting repository.");
  const result = reconcileVersionIssue(config.repository, current,
    {upstreamBuild: detected.build, upstreamVersion: detected.upstreamVersion}, githubVersionIssues(config.repository));
  console.log(JSON.stringify(result));
}
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
  `\n## Standard edition: ${changed ? "review required" : "current"}\n\nAccepted ${current.upstreamVersion} (${current.upstreamBuild}); detected ${detected.upstreamVersion} (${detected.build}).\n\nNo code was captured, adapted or published. Follow standard/docs/maintenance.md.\n`);
