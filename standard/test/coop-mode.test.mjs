import test from "node:test";
import assert from "node:assert/strict";
import {COOP_CONNECTION_MODES, coopConnectionMode, requireLanConnectionMode, coopModeMessage} from "../common/coop-mode.mjs";
import {StunFirstPolicy} from "../runtime/stun-first.js";
import {NativeLan} from "../desktop/lan.mjs";

test("the existing co-op dropdown has exactly the three requested connection policies",()=>{
  assert.deepEqual(COOP_CONNECTION_MODES.map(mode=>mode.title),["LAN","STUN only","STUN + TURN fallback"]);
  assert.equal(coopConnectionMode(),"lan");
  for(const mode of COOP_CONNECTION_MODES)assert.equal(coopConnectionMode(mode.value),mode.value);
  for(const mode of [null,"","turn","stun",123,{},"https://example.invalid"])assert.throws(()=>coopConnectionMode(mode),/Invalid/);
});
test("STUN only and LAN can never request a TURN credential",async()=>{
  let calls=0;
  for(const mode of ["lan","stun-only"]){
    const policy=new StunFirstPolicy({mode,requestRelay:async()=>{calls++;throw Error("must not be called");}});
    const initial=policy.begin();
    assert.equal(initial.iceServers.length,mode==="lan"?0:1);
    assert.ok(initial.iceServers.every(server=>server.urls.every(url=>url.startsWith("stun:"))));
    policy.directFailed();assert.equal(await policy.fallback(),null);policy.close();
  }
  assert.equal(calls,0);
});
test("TURN fallback waits for a failed direct attempt and only issues once per peer",async()=>{
  let now=0,calls=0;
  const reply={expiresAt:300000,iceServers:[{urls:["turn:turn.cloudflare.com:3478?transport=udp"],username:"user",credential:"temporary-credential"}]};
  const policy=new StunFirstPolicy({mode:"turn-fallback",now:()=>now,requestRelay:async()=>{calls++;return reply;}});
  assert.equal(await policy.fallback(),null);assert.equal(calls,0);
  policy.directFailed();
  const [a,b]=await Promise.all([policy.fallback(),policy.fallback()]);
  assert.deepEqual(a,b);assert.equal(calls,1);assert.equal(a.restartIce,true);
  assert.equal(await policy.fallback(),null);
  const direct=new StunFirstPolicy({mode:"turn-fallback",now:()=>now,requestRelay:async()=>{calls++;}});
  direct.selected({kind:"stun"});now=20000;
  assert.equal(await direct.fallback(),null);assert.equal(calls,1);
});
test("a budget refusal is final for the current fallback attempt",async()=>{
  let calls=0;
  const policy=new StunFirstPolicy({mode:"turn-fallback",requestRelay:async()=>{calls++;throw Error("budget exhausted");}});
  policy.directFailed();await assert.rejects(policy.fallback(),/budget exhausted/);
  assert.equal(await policy.fallback(),null);assert.equal(calls,1);
});
test("relay credentials renew without restarting unrelated direct links or exposing permanent keys",async()=>{
  let now=0,calls=0;
  const policy=new StunFirstPolicy({mode:"turn-fallback",now:()=>now,requestRelay:async()=>{
    calls++;return {expiresAt:now+300000,iceServers:[{urls:["turns:turn.cloudflare.com:443?transport=tcp"],
      username:"ephemeral-"+calls,credential:"temporary-credential"}]};
  }});
  policy.directFailed();const first=await policy.fallback();now=210000;
  const renewed=await policy.renew();
  assert.equal(renewed.expiresAt,510000);assert.notEqual(first.iceServers[1].username,renewed.iceServers[1].username);
  assert.equal(calls,2);policy.close();assert.equal(await policy.renew(),null);
  const stun=new StunFirstPolicy({mode:"stun-only",requestRelay:()=>assert.fail("STUN-only cannot renew a relay")});
  assert.equal(await stun.renew(),null);
});
test("unsupported Internet selections cannot silently start LAN or discovery",async()=>{
  let sideEffects=0;
  const native=new NativeLan({identity:"test",profile:async()=>{sideEffects++;return {};},
    interfaces:()=>{sideEffects++;return [];},emit:()=>{sideEffects++;},broker:()=>{sideEffects++;},
    discovery:{cancel:()=>{sideEffects++;},advertise:()=>{sideEffects++;},find:async()=>{sideEffects++;return {rooms:[]};}}});
  for(const connectionMode of ["stun-only","turn-fallback","invalid"]){
    for(const action of ["host","join","find"])await assert.rejects(native.command(action,{species:4,connectionMode}));
  }
  assert.equal(sideEffects,0);
  assert.equal(requireLanConnectionMode(),"lan");
  assert.match(coopModeMessage("stun-only"),/never be used/);
  assert.match(coopModeMessage("turn-fallback"),/remains disabled/);
});
