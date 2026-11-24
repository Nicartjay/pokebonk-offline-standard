import test from "node:test";
import assert from "node:assert/strict";
import {brokerLiteral,assertBrokerImport,BROKER_MODULES} from "../scripts/broker-boundary.mjs";
import {selectedInternetRoute,internetState} from "../common/internet-coop.mjs";
import {coopRouteMessage,coopModeMessage} from "../common/coop-mode.mjs";
import {configureBrokerSession} from "../desktop/coop-session.mjs";

test("only broker modules may contain the exact fixed transport literals",()=>{
  assert.equal(brokerLiteral("offline/stun-first.js","stun:stun.cloudflare.com:3478"),true);
  for(const file of ["offline/entry.js","offline/ui.js","assets/boot.js"])
    assert.equal(brokerLiteral(file,"stun:stun.cloudflare.com:3478"),false);
  assert.equal(brokerLiteral("offline/stun-first.js","stun:evil.invalid:3478"),false);
  assert.equal(brokerLiteral("common/internet-coop.mjs","http://["),true);
  assert.equal(brokerLiteral("common/internet-coop.mjs","http://evil.invalid"),false);
  for(const target of BROKER_MODULES)assert.throws(()=>assertBrokerImport("offline/entry.js",target),/native-only/);
  assert.doesNotThrow(()=>assertBrokerImport("offline/internet-broker.js","offline/internet-rtc.js"));
  assert.doesNotThrow(()=>assertBrokerImport("offline/lan-ui.js","common/coop-mode.mjs"));
});
test("route labels use the selected ICE pair, not the requested fallback mode",()=>{
  const stats=(local,remote)=>new Map([
    ["transport",{type:"transport",selectedCandidatePairId:"selected"}],
    ["selected",{type:"candidate-pair",state:"succeeded",localCandidateId:"local",remoteCandidateId:"remote"}],
    ["local",local],["remote",remote],
  ]);
  const host=address=>({candidateType:"host",address});
  assert.equal(selectedInternetRoute(stats(host("192.168.1.2"),host("192.168.1.3"))),"lan");
  assert.equal(selectedInternetRoute(stats(host("192.168.1.2"),{candidateType:"srflx"})),"stun");
  assert.equal(selectedInternetRoute(stats({candidateType:"relay"},{candidateType:"srflx"})),"turn");
  assert.equal(selectedInternetRoute(stats(host("2001:db8::1"),host("2001:db8::2"))),"direct");
  assert.equal(selectedInternetRoute(new Map()),"connecting");
  const state=internetState({phase:"hosting",members:[],linked:false,transport:"turn"},"turn-fallback");
  assert.equal(state.transport,"turn");assert.match(coopRouteMessage(state.transport),/Using TURN/);
  assert.match(coopModeMessage("turn-fallback",{internetReady:true,relayReady:false}),/currently disabled/);
});
test("the isolated broker admits pinned CORS preflights without exposing other hosts or native permissions",()=>{
  let before,permission,download;
  const session={webRequest:{onBeforeRequest(_filter,callback){before=callback;}},
    setPermissionCheckHandler(callback){permission=callback;},setPermissionRequestHandler(){},on(event,callback){if(event==="will-download")download=callback;}};
  const gateway="https://pokebonk-offline-coop.example.workers.dev",contents={};
  configureBrokerSession(session,{gateway,trusted:value=>value===contents,phase:()=>"connecting"});
  let result;
  before({url:gateway+"/v1/rooms",method:"OPTIONS"},value=>{result=value;});
  assert.equal(result.cancel,false);
  before({url:"https://evil.invalid/v1/rooms",method:"POST"},value=>{result=value;});
  assert.equal(result.cancel,true);
  assert.equal(permission(contents,"local-network","pokebonk-standard://game",{isMainFrame:true}),true);
  assert.equal(permission({},"local-network","pokebonk-standard://game",{isMainFrame:true}),false);
  assert.equal(permission(contents,"media","pokebonk-standard://game",{isMainFrame:true}),false);
  let cancelled=false;download({}, {cancel(){cancelled=true;}});assert.equal(cancelled,true);
});
