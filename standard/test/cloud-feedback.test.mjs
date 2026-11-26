// Authored for the next approved focused pass. No service or real save access.
import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {cloudFeedbackView,unavailableCloudFeedback} from "../common/cloud-feedback.mjs";
test("unconfigured cloud saves are visibly unavailable, disconnected and never automatic",()=>{
  const value=cloudFeedbackView(unavailableCloudFeedback());
  assert.equal(value.state,"unavailable");assert.equal(value.reason,"not-configured");
  assert.equal(value.connected,false);assert.equal(value.automatic,false);
  for(const invalid of [null,{}, {state:"sync-arbitrary-url",connected:false,automatic:false},
    {state:"unavailable",connected:true,automatic:false},{state:"off",connected:false,automatic:true},
    {state:"synced",connected:false,automatic:false}]){
    assert.equal(cloudFeedbackView(invalid),null);
  }
});
test("cloud presentation excludes credentials, paths, endpoints and remote save contents",()=>{
  const value=cloudFeedbackView({state:"synced",connected:true,automatic:false,accountLabel:"Example account",
    local:{name:"Trainer",usable:18,stardust:12450,token:"never",save:{secret:"never"}},
    cloud:{name:"Trainer",usable:-1,stardust:Infinity},credential:"never",endpoint:"https://example.invalid",path:"/private/state"});
  assert.equal(value.local.usable,18);assert.equal(value.local.stardust,12450);
  assert.equal(value.cloud.usable,undefined);assert.equal(value.cloud.stardust,undefined);
  assert.doesNotMatch(JSON.stringify(value),/never|example\.invalid|private\/state/);
});
test("Mac session-only disclosure is bounded presentation data, not a credential or callback bridge",async()=>{
  const value=cloudFeedbackView({state:"off",connected:false,automatic:false,sessionOnly:true,
    returnTo:"http://127.0.0.1:49152/private",token:"never"});
  assert.equal(value.sessionOnly,true);assert.doesNotMatch(JSON.stringify(value),/49152|never|private/);
  assert.equal(cloudFeedbackView({state:"off",connected:false,automatic:false,sessionOnly:"true"}).sessionOnly,undefined);
  const ui=await readFile("standard/runtime/cloud-ui.js","utf8");
  assert.match(ui,/Connect again after fully quitting/);assert.match(ui,/No cloud login token is saved to disk or Keychain/);
});
test("cloud UI is part of the production payload, not the source-only sample fixture",async()=>{
  const prepare=await readFile("standard/scripts/prepare.mjs","utf8");
  const ui=await readFile("standard/runtime/ui.js","utf8");
  const cloud=await readFile("standard/runtime/cloud-ui.js","utf8");
  assert.match(prepare,/"cloud-ui\.js"/);assert.match(prepare,/"cloud\.css"/);
  assert.match(prepare,/common\/cloud-feedback\.mjs/);
  assert.doesNotMatch(prepare,/"cloud-preview\.js"/);
  assert.match(ui,/body\.append\(cloudUI\.entry/);
  assert.match(ui,/nativeAction\("Cloud save setup","cloud-saves",close\)/);
  assert.match(cloud,/Cloud service setup required/);
  assert.doesNotMatch(cloud,/\bfetch\s*\(|\bXMLHttpRequest\b|\blocalStorage\b|\bsaveState\s*\(/);
});
