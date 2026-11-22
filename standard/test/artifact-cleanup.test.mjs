import test from "node:test";
import assert from "node:assert/strict";
import {planArtifactCleanup} from "../scripts/prune-artifacts.mjs";
const repository = {full_name: "Nicartjay/pokebonk-offline-standard"};
const build = (id, created_at = "2026-11-21T00:00:00Z", extra = {}) => ({id, created_at,
  repository, head_repository: repository, path: ".github/workflows/build-release.yml",
  event: "workflow_dispatch", status: "completed", conclusion: "success", ...extra});
const names = ["shared-game-payload", "installers-macos-arm64", "installers-macos-x64",
  "installers-win32-x64", "installers-linux-x64", "candidate-android-universal", "candidate-audit-0.1.0"];
const current = names.map((name, i) => ({id: i + 100, name, expired: false, workflow_run: {id: 2}}));
const artifact = id => ({id, name: "old-build", workflow_run: {id}});
test("cleanup keeps the entire latest set and protects newer, active and unrelated builds", () => {
  const keepRun = build(2, "2026-11-22T00:00:00Z");
  const runs = [build(1), keepRun, build(3, "2026-11-23T00:00:00Z"),
    build(4, undefined, {status: "in_progress"}), build(5, undefined, {path: ".github/workflows/checks.yml"}),
    build(6, undefined, {head_repository: {full_name: "other/fork"}})];
  assert.deepEqual(planArtifactCleanup({keepRun, artifacts: [...current, ...[1, 3, 4, 5, 6].map(artifact)], runs}), [artifact(1)]);
});
test("incomplete, expired, smoke-only and failed keep-runs cannot delete anything", () => {
  const keepRun = build(2);
  for (const artifacts of [[], current.slice(1), current.map((a, i) => i === 0 ? {...a, expired: true} : a)]) {
    assert.throws(() => planArtifactCleanup({keepRun, artifacts, runs: []}), /missing/);
  }
  assert.throws(() => planArtifactCleanup({keepRun: {...keepRun, conclusion: "failure"}, artifacts: current, runs: []}), /successful/);
});
test("an in-progress cleanup job requires the completed candidate audit", () => {
  const keepRun = build(2, undefined, {status: "in_progress", conclusion: null});
  assert.throws(() => planArtifactCleanup({keepRun, artifacts: current, runs: []}), /successful/);
  assert.deepEqual(planArtifactCleanup({keepRun, artifacts: current, runs: [], auditPassed: true}), []);
});
