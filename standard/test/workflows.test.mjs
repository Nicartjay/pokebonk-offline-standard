import test from "node:test";
import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import {parseDocument} from "yaml";
import {releasePlatform} from "../common/manifest.mjs";

async function document(file) {
  const parsed = parseDocument(await readFile(file, "utf8"), {uniqueKeys: true});
  assert.deepEqual(parsed.errors, [], `${file} must be valid YAML.`);
  return parsed.toJS();
}
test("all workflow and action references parse and use immutable official action pins", async () => {
  const files = (await readdir(".github/workflows")).filter(n => n.endsWith(".yml"));
  assert.equal(files.length, 4);
  for (const name of files) {
    const workflow = await document(`.github/workflows/${name}`);
    assert.equal(workflow.permissions.contents, "read");
    assert.equal(workflow.on.pull_request_target, undefined);
    for (const job of Object.values(workflow.jobs)) for (const step of job.steps ?? []) {
      if (step.uses && !step.uses.startsWith("./")) assert.match(step.uses, /^(?:actions|pnpm)\/[\w-]+@[a-f0-9]{40}$/);
      if (step.uses?.startsWith("actions/checkout@")) assert.equal(step.with["persist-credentials"], false);
    }
  }
  const setup = await document(".github/actions/setup/action.yml");
  for (const step of setup.runs.steps) if (step.uses) assert.match(step.uses, /@[a-f0-9]{40}$/);
  assert.match(setup.runs.steps.at(-1).run, /--frozen-lockfile --ignore-scripts/);
});
test("upstream schedule can report an issue but never adapt/sign/publish game code", async () => {
  const w = await document(".github/workflows/check-upstream.yml");
  assert.equal(w.on.schedule[0].cron, "41 1 * * *");
  assert.equal(w.jobs.report.permissions.contents, "read");
  assert.equal(w.jobs.report.permissions.issues, "write");
  const commands = w.jobs.report.steps.map(s => s.run ?? "").join("\n");
  assert.match(commands, /check-upstream\.mjs --report/);
  assert.doesNotMatch(commands, /publish|assemble-release|capture-candidate|prepare\.mjs|git push/);
  assert.doesNotMatch(JSON.stringify(w), /secrets\./);
});
test("all installer jobs reuse one prepared payload and cannot publish publicly", async () => {
  const w = await document(".github/workflows/build-release.yml");
  assert.equal(w.on.schedule, undefined);
  assert.deepEqual(w.on.push.tags, ["standard-v*"]);
  assert.equal(w.jobs.desktop.strategy.matrix.include.length, 4);
  assert.deepEqual(w.jobs.desktop.strategy.matrix.include.map(x => `${x.platform}-${x.arch}`),
    ["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"]);
  for (const target of w.jobs.desktop.strategy.matrix.include) {
    assert.equal(target.artifact, releasePlatform(`${target.platform}-${target.arch}`));
  }
  const upload = w.jobs.desktop.steps.find(s => s.uses?.startsWith("actions/upload-artifact@"));
  assert.equal(upload.with.name, "installers-${{ matrix.artifact }}");
  assert.equal(w.jobs.shared.steps.filter(s => s.run === "pnpm prepare:game").length, 1);
  for (const id of ["desktop", "android", "verify-candidates"]) {
    assert.equal(w.jobs[id].steps.some(s => s.run === "pnpm prepare:game"), false);
    assert.ok(w.jobs[id].steps.some(s => s.run?.includes("restore-payload.mjs")));
  }
  assert.equal(w.jobs.android.environment, undefined);
  assert.equal(w.jobs["verify-candidates"].environment, undefined);
  assert.equal(w.jobs.draft, undefined);
  assert.ok(w.jobs.android.steps.some(s => s.run?.endsWith("--unsigned-candidate")));
  assert.ok(w.jobs["verify-candidates"].steps.some(s => s.run?.endsWith("verify-candidates.mjs")));
  assert.doesNotMatch(JSON.stringify(w), /secrets\.|--approve-publication|assemble-release\.mjs|--prepare-draft|release-signing/);
});
test("public publication requires manual dispatch, acceptance and a separate protected environment", async () => {
  const w = await document(".github/workflows/publish-release.yml");
  assert.deepEqual(Object.keys(w.on), ["workflow_dispatch"]);
  assert.equal(w.on.workflow_dispatch.inputs.acceptance_json.required, true);
  assert.equal(w.jobs.publish.environment, "release-publication");
  assert.ok(w.jobs.publish.steps.some(s => s.run?.includes("--approve-publication")));
  const checks = await document(".github/workflows/checks.yml");
  assert.doesNotMatch(JSON.stringify(checks), /secrets\.|release-signing|contents":"write"/);
});
