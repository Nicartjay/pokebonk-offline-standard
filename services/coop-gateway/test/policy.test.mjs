import test from "node:test";
import assert from "node:assert/strict";
import {POLICY, relayAdmission, authorized, body, signalDescription, turnServers} from "../src/policy.mjs";
import worker from "../src/worker.mjs";
const now = Date.UTC(2026, 10, 24, 12);
const usage = {scope: "account-shared-realtime-egress", complete: true, bytes: 0, asOf: now,
  periodStart: Date.UTC(2026, 10, 1), periodEnd: Date.UTC(2026, 11, 1)};
const env = {TURN_MODE: "guarded-payg", TURN_PAYG_RISK_ACCEPTED: "true", TURN_CUTOFF_BYTES: String(POLICY.cutoffBytes)};
test("disabled relay is the default; soft controls never advertise a hard billing cap", async () => {
  assert.throws(() => relayAdmission({env: {}, usage, now}), /turn_disabled/);
  assert.throws(() => relayAdmission({env: {...env, TURN_PAYG_RISK_ACCEPTED: "false"}, usage, now}), /turn_disabled/);
  const health = await worker.fetch(new Request("https://example.test/health"), {});
  assert.deepEqual(await health.json(), {service: "pokebonk-coop", enabled: false, turn: "disabled", hardBillingCap: false, maxPlayers: 4});
  const disabled = await worker.fetch(new Request("https://example.test/v1/connection-policy"), {});
  assert.equal(disabled.status, 503);
});
test("stale/missing/partial/other-service usage and exhausted reservations fail closed", () => {
  for (const value of [undefined, {...usage, asOf: now - 121000}, {...usage, complete: false},
    {...usage, scope: "this-app-only"}, {...usage, periodEnd: now}, {...usage, asOf: now + 1}])
    assert.throws(() => relayAdmission({env, usage: value, now}), /fresh_account_usage_required/);
  assert.throws(() => relayAdmission({env, usage: {...usage, bytes: POLICY.cutoffBytes}, now}), /budget_exhausted/);
  assert.throws(() => relayAdmission({env, usage, reservedBytes: POLICY.cutoffBytes, now}), /budget_exhausted/);
  assert.throws(() => relayAdmission({env: {...env, TURN_CUTOFF_BYTES: "900000000000"}, usage, now}), /invalid_budget/);
  assert.throws(() => relayAdmission({env, usage, activeLeases: POLICY.maxRelayLeases, now}), /capacity_reached/);
  assert.equal(relayAdmission({env, usage, now}).expiresAt, now + 300000);
});
test("secret validation, body limits, data-only SDP and fixed TURN origins reject unsafe input", async () => {
  assert.equal(await authorized("Bearer " + "a".repeat(43), "a".repeat(43)), true);
  assert.equal(await authorized("Bearer " + "b".repeat(43), "a".repeat(43)), false);
  assert.equal(await authorized("Bearer short", "short"), false);
  await assert.rejects(body(new Request("https://example.test", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({large: "x".repeat(200)})}), 100), /body_too_large/);
  assert.throws(() => signalDescription({type: "offer", sdp: "v=0\r\nm=video 9 UDP\r\n"}), /data_channel/);
  assert.throws(() => turnServers({iceServers: [{urls: ["turn:attacker.invalid:3478"], username: "user", credential: "x".repeat(32)}]}), /invalid_issuer/);
  const servers = turnServers({iceServers: {urls: ["stun:stun.cloudflare.com:3478", "turn:turn.cloudflare.com:3478?transport=udp"], username: "user", credential: "x".repeat(32)}});
  assert.equal(servers[0].urls.length, 1);
});
test("public routes, guessed admin routes and bad admin bearers never reflect permanent service credentials",async()=>{
  const privateEnv={...env,SERVICE_ENABLED:"true",ADMIN_TOKEN:"a".repeat(43),
    TURN_API_TOKEN:"issuer-fixture-not-a-live-secret",CF_USAGE_API_TOKEN:"monitor-fixture-not-a-live-secret"};
  for(const [path,status] of [["/health",200],["/v1/connection-policy",200],["/admin/status",401],
    ["/admin/issue",401],["/internal/issue",404],["/.env",404],["/cloudflare-coop.json",404]]){
    const response=await worker.fetch(new Request("https://example.test"+path,{
      headers:{Authorization:"Bearer "+"b".repeat(43)}}),privateEnv);
    assert.equal(response.status,status,path);
    const text=await response.text();
    for(const key of ["ADMIN_TOKEN","TURN_API_TOKEN","CF_USAGE_API_TOKEN"])
      assert.equal(text.includes(privateEnv[key]),false,"Permanent credential reflected by "+path);
    assert.equal(response.headers.get("Cache-Control"),"no-store");
  }
});
