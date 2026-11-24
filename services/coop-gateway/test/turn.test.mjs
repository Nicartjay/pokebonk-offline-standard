import test from "node:test";
import assert from "node:assert/strict";
import {CoopControl} from "../src/control.mjs";
import {readAccountUsage} from "../src/usage.mjs";
import {POLICY,relayAdmission} from "../src/policy.mjs";
const now=Date.now(),start=now-86400000,end=now+28*86400000;
const usage=()=>({scope:"account-shared-realtime-egress",source:"cloudflare-graphql",complete:true,
  subscriptionId:"s".repeat(32),bytes:40,asOf:Date.now(),periodStart:start,periodEnd:end});
const env={TURN_MODE:"guarded-payg",TURN_PAYG_RISK_ACCEPTED:"true",TURN_CUTOFF_BYTES:String(POLICY.cutoffBytes),
  TURN_TOKEN_ID:"a".repeat(32),TURN_API_TOKEN:"issuer-fixture-not-a-live-token-000000",CF_ACCOUNT_ID:"b".repeat(32),
  CF_USAGE_API_TOKEN:"monitor-fixture-not-a-live-token-00000",REALTIME_SUBSCRIPTION_ID:"s".repeat(32)};
class Storage {
  data=new Map();alarm=null;
  async get(key){return structuredClone(this.data.get(key));}
  async put(key,value){this.data.set(key,structuredClone(value));}
  async delete(key){return this.data.delete(key);}
  async list({prefix="",limit=Infinity}={}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)).slice(0,limit).map(([k,v])=>[k,structuredClone(v)]));}
  async getAlarm(){return this.alarm;}
  async setAlarm(at){this.alarm=at;}
}
async function fixture() {
  const ctx={storage:new Storage(),rejections:0,blockConcurrencyWhile:async fn=>{try{return await fn();}catch(e){ctx.rejections++;throw e;}}};
  const control=new CoopControl(ctx,{...env});
  await ctx.storage.put("budget",{usage:usage(),reservedBytes:0});
  const call=async(route,value={})=>{
    const response=await control.fetch(new Request("https://internal"+route,{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(value)}));
    return {status:response.status,data:await response.json()};
  };
  return {ctx,control,call,member:{room:"ABCDEFGH",generation:"g".repeat(22),member:"lan-"+"m".repeat(22)}};
}
test("usage meter requires both complete account-wide datasets and the selected real billing period",async()=>{
  const requests=[];
  const request=async(url,options)=>{
    assert.equal(options.redirect,"manual","Workers does not implement error redirect mode.");
    requests.push({url,options});
    if(url.includes("/subscriptions"))return Response.json({success:true,result:[{id:env.REALTIME_SUBSCRIPTION_ID,
      current_period_start:new Date(start).toISOString(),current_period_end:new Date(end).toISOString(),frequency:"monthly",state:"Provisioned"}]});
    return Response.json({data:{viewer:{accounts:[{turn:[{sum:{egressBytes:123}}],sfu:[{sum:{egressBytes:456}}]}]}}});
  };
  const result=await readAccountUsage(env,{request,now});
  assert.equal(result.bytes,579);assert.equal(result.periodStart,start);assert.equal(result.periodEnd,end);
  const query=JSON.parse(requests[1].options.body);
  assert.doesNotMatch(query.query,/keyId|customIdentifier|appId/);
  assert.match(query.query,/callsTurnUsageAdaptiveGroups/);assert.match(query.query,/callsUsageAdaptiveGroups/);
  for(const bad of [
    {data:{viewer:{accounts:[{turn:[],sfu:null}]}}},
    {data:{viewer:{accounts:[{turn:[],sfu:[]}]}},errors:[{message:"not allowed"}]},
    {data:{viewer:{accounts:[]}}},
    {data:{viewer:{accounts:[{turn:[{sum:{egressBytes:-1}}],sfu:[]}]}}},
  ])await assert.rejects(readAccountUsage(env,{now,request:(url,options)=>url.includes("/subscriptions")?request(url,options):Promise.resolve(Response.json(bad))}));
  await assert.rejects(readAccountUsage({...env,REALTIME_SUBSCRIPTION_ID:"unselected-subscription"},{request,now}),/subscription_unavailable/);
});
test("reuse does not reserve again; rotation overlaps briefly and leave revokes every generation",async()=>{
  const h=await fixture(),original=globalThis.fetch;let issued=0,revoked=0;
  globalThis.fetch=async(url,options)=>{
    assert.equal(options.redirect,"manual");
    if(url.endsWith("/revoke")){revoked++;return new Response(null,{status:204});}
    issued++;return Response.json({iceServers:{urls:["turn:turn.cloudflare.com:3478?transport=udp"],username:"user-"+issued,credential:"temporary-fixture-credential"}},{status:201});
  };
  try {
    const first=await h.call("/issue",h.member);assert.equal(first.status,200);
    const reused=await h.call("/issue",h.member);assert.deepEqual(reused,first);assert.equal(issued,1);
    const [key,lease]=[...await h.ctx.storage.list({prefix:"lease:"})][0];
    await h.ctx.storage.put(key,{...lease,expiresAt:Date.now()+90000});
    const rotated=await h.call("/issue",h.member);assert.equal(rotated.status,200);assert.equal(issued,2);
    assert.notEqual(rotated.data.iceServers[0].username,first.data.iceServers[0].username);
    assert.equal((await h.ctx.storage.get("budget")).reservedBytes,2*POLICY.reservationBytes);
    assert.equal((await h.call("/release",h.member)).status,200);assert.equal(revoked,2);
    assert.equal((await h.ctx.storage.list({prefix:"lease:"})).size,0);
    assert.equal((await h.ctx.storage.get("budget")).reservedBytes,2*POLICY.reservationBytes,"No within-period refunds.");
    assert.equal(h.ctx.rejections,0);
  } finally { globalThis.fetch=original; }
});
test("a provider redirect is rejected without sending the monitor bearer elsewhere",async()=>{
  let requests=0;
  await assert.rejects(readAccountUsage(env,{now,request:async(_url,options)=>{
    requests++;assert.equal(options.redirect,"manual");
    return new Response(null,{status:302,headers:{Location:"https://example.invalid/redirect"}});
  }}),/usage_provider_http_302/);
  assert.equal(requests,1);
});
test("ambiguous issuer timeout reserves first, poisons the gate and never mints a blind retry",async()=>{
  const h=await fixture(),original=globalThis.fetch;let issued=0;
  globalThis.fetch=async()=>{issued++;assert.equal((await h.ctx.storage.get("budget")).reservedBytes,POLICY.reservationBytes);throw Error("uncertain");};
  try {
    assert.equal((await h.call("/issue",h.member)).data.error,"issuer_requires_operator_review");
    assert.equal((await h.call("/issue",{...h.member,member:"lan-"+"n".repeat(22)})).data.error,"issuer_requires_operator_review");
    assert.equal(issued,1);assert.equal((await h.ctx.storage.get("budget")).disabled,true);
    assert.equal((await h.ctx.storage.list({prefix:"lease:"})).size,1);
    assert.equal(h.ctx.rejections,0);
  } finally { globalThis.fetch=original; }
});
test("stale monitor fails closed; successful refresh alone cannot undo an operator kill switch",async()=>{
  const h=await fixture(),original=globalThis.fetch;
  await h.ctx.storage.put("budget",{usage:{...usage(),asOf:Date.now()-180000},reservedBytes:0});
  globalThis.fetch=async()=>{throw Error("offline");};
  try {
    assert.equal((await h.call("/issue",h.member)).data.error,"fresh_account_usage_required");
    assert.equal((await h.ctx.storage.get("budget")).disabled,true);
    await h.control.recordUsage(usage());
    assert.equal((await h.ctx.storage.get("budget")).disabled,true);
    assert.equal((await h.call("/issue",h.member)).data.error,"turn_disabled");
  } finally { globalThis.fetch=original; }
});
test("high-water usage, boundary carry-over, and reuse at the cutoff remain conservative",async()=>{
  const h=await fixture();
  await h.control.recordUsage({...usage(),bytes:1000});await h.control.recordUsage({...usage(),bytes:20});
  assert.equal((await h.ctx.storage.get("budget")).usage.bytes,1000);
  const report=usage(),reserved=POLICY.cutoffBytes-report.bytes;
  assert.equal(relayAdmission({env,usage:report,reservedBytes:reserved,reuse:true}).reservationBytes,0);
  assert.throws(()=>relayAdmission({env,usage:report,reservedBytes:reserved}),/budget_exhausted/);
  const priorStart=Date.now()-29*86400000,priorEnd=Date.now()-1000;
  await h.ctx.storage.put("budget",{usage:{...usage(),periodStart:priorStart,periodEnd:priorEnd},reservedBytes:999999});
  await h.ctx.storage.put("lease:crossing",{expiresAt:Date.now()+200000,reservationBytes:POLICY.reservationBytes});
  await h.control.recordUsage({...usage(),periodStart:priorEnd,periodEnd:priorEnd+30*86400000});
  assert.equal((await h.ctx.storage.get("budget")).reservedBytes,POLICY.reservationBytes);
});
