import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {CloudBudget,CLOUD_USAGE_LIMITS as limits} from "../src/budget.mjs";
import {internal} from "../src/policy.mjs";
import {environment,session,MemoryStorage} from "./fixtures.mjs";
import worker from "../src/worker.mjs";
import {cloudSnapshot} from "../../../standard/common/cloud-save.mjs";
import {save,config} from "../../../standard/test/fixtures.mjs";
const DAY=86400000,row=(value={})=>({requests:0,commits:0,classA:0,classB:0,...value});
const reserve=(budget,kind)=>budget.fetch(internal("/reserve",{kind}));
const api=(env,token,op,value={})=>worker.fetch(new Request(env.PUBLIC_ORIGIN+"/v1/"+op,{method:"POST",
  headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},body:JSON.stringify(value)}),env);
function meter(env){
  const id=env.BUDGET.idFromName("cloud-save-budget-v1");
  env.BUDGET.get(id);return env.BUDGET.contexts.get(id).storage;
}
test("R2 reservations serialize concurrent requests and survive a budget-object restart",async()=>{
  const storage=new MemoryStorage(),day=Math.floor(Date.now()/DAY),ctx={storage};
  await storage.put("meter",{version:1,days:{[day]:row({classA:limits.classA-4})}});
  const budget=new CloudBudget(ctx,{});
  const results=await Promise.all(Array.from({length:10},()=>reserve(budget,"commit")));
  assert.equal(results.filter(value=>value.ok).length,2);
  assert.equal(results.filter(value=>value.status===429).length,8);
  assert.equal((await storage.get("meter")).days[day].classA,limits.classA);
  assert.equal((await reserve(new CloudBudget(ctx,{}),"commit")).status,429);
});
test("daily limits reset at UTC boundaries but rolling R2 limits do not reset at month boundaries",async()=>{
  const storage=new MemoryStorage(),base=Date.UTC(2026,10,30),day=base/DAY;let now=base;
  const budget=new CloudBudget({storage},{},()=>now);
  await storage.put("meter",{version:1,days:{[day]:row({requests:limits.requestsPerDay,classB:limits.classB})}});
  assert.equal((await reserve(budget,"request")).status,429);
  now+=DAY;assert.equal((await reserve(budget,"request")).status,200);
  assert.equal((await reserve(budget,"read")).status,429);
  now=base+32*DAY;assert.equal((await reserve(budget,"read")).status,429);
  now+=DAY;assert.equal((await reserve(budget,"read")).status,200);
});
test("failed or corrupt budget persistence fails closed, and reservations are not refunded after an R2 failure",async()=>{
  const env=environment(),user=await session(env),storage=meter(env),data=await cloudSnapshot(save(),config);
  let r2=0;env.SAVES.list=async()=>{r2++;throw Error("Synthetic R2 failure");};
  const commit={parent:null,requestId:"a".repeat(32),save:data.save,hash:data.hash};
  assert.equal((await api(env,user.token,"commit",commit)).status,503);
  const day=Math.floor(Date.now()/DAY);
  assert.equal((await storage.get("meter")).days[day].classA,2);
  assert.equal(r2,1);
  storage.put=async()=>{throw Error("Synthetic durable-write failure");};
  assert.equal((await api(env,user.token,"commit",commit)).status,503);assert.equal(r2,1);
  const corrupted=new MemoryStorage();await corrupted.put("meter",{version:99,days:{}});
  assert.equal((await reserve(new CloudBudget({storage:corrupted},{}),"read")).status,503);
});
test("quota exhaustion prevents R2 list, put and get; authenticated metadata remains local to its Durable Object",async()=>{
  const env=environment(),user=await session(env),storage=meter(env),data=await cloudSnapshot(save(),config),day=Math.floor(Date.now()/DAY);
  const commit={parent:null,requestId:"b".repeat(32),save:data.save,hash:data.hash};
  const first=await (await api(env,user.token,"commit",commit)).json();assert.ok(first.head);
  await storage.put("meter",{version:1,days:{[day]:row({classA:limits.classA,classB:limits.classB})}});
  let r2=0;for(const method of ["list","put","get"])env.SAVES[method]=async()=>{r2++;throw Error("Unexpected R2 access");};
  assert.equal((await api(env,user.token,"commit",{...commit,parent:first.head.revision,requestId:"c".repeat(32)})).status,429);
  assert.equal((await api(env,user.token,"read",{revision:first.head.revision})).status,429);
  assert.equal((await api(env,user.token,"head")).status,200);
  assert.equal(r2,0);
});
test("the deployed service cannot increase its account cap past the bounded storage model or run without a budget binding",async()=>{
  const env=environment();env.MAX_ACCOUNTS=String(limits.accounts+1);
  assert.equal((await api(env,"invalid","head")).status,503);
  env.MAX_ACCOUNTS="100";delete env.BUDGET;
  assert.equal((await api(env,"invalid","head")).status,503);
  const deployment=JSON.parse(await readFile(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
  assert.ok(["false","true"].includes(deployment.vars.SERVICE_ENABLED));
  assert.ok(Number(deployment.vars.MAX_ACCOUNTS)<=limits.accounts);
  assert.ok(Object.keys(deployment.vars).every(name=>!/SECRET|SIGNING_KEY/.test(name)));
  assert.equal(deployment.vars.GOOGLE_CLIENT_ID,undefined,"Provider-specific identity config stays server-side, not in the public repository.");
  assert.equal(deployment.keep_vars,true,"Preserve the existing server-side OAuth identity on ordinary deployments.");
  const missingIdentity=environment();delete missingIdentity.GOOGLE_CLIENT_ID;
  assert.equal((await api(missingIdentity,"invalid","head")).status,503,"A missing server-side client ID must fail closed.");
  assert.ok(deployment.durable_objects.bindings.some(value=>value.name==="BUDGET"));
  assert.ok(deployment.migrations.some(value=>value.new_sqlite_classes.includes("CloudBudget")));
  assert.equal(deployment.r2_buckets[0].bucket_name,"pokebonk-offline-private-saves");
});
test("a daily commit cap rejects the next reservation without charging any additional R2 operation",async()=>{
  const storage=new MemoryStorage(),day=Math.floor(Date.now()/DAY);
  await storage.put("meter",{version:1,days:{[day]:row({commits:limits.commitsPerDay,classA:2*limits.commitsPerDay})}});
  assert.equal((await reserve(new CloudBudget({storage},{}),"commit")).status,429);
  assert.equal((await storage.get("meter")).days[day].classA,2*limits.commitsPerDay);
});
