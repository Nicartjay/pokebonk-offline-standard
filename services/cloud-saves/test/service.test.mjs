import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {environment,session} from "./fixtures.mjs";
import {cloudSnapshot} from "../../../standard/common/cloud-save.mjs";
import {save,config} from "../../../standard/test/fixtures.mjs";
const call=(env,token,op,value={})=>worker.fetch(new Request(env.PUBLIC_ORIGIN+"/v1/"+op,{method:"POST",
  headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(value)}),env);
test("private account storage isolates two people and rejects forged sessions before allocating account objects",async()=>{
  const env=environment(),a=await session(env,"a"),b=await session(env,"b");
  const data=await cloudSnapshot(save(),config);
  const committed=await call(env,a.token,"commit",{parent:null,requestId:"a".repeat(32),save:data.save,hash:data.hash});
  assert.equal(committed.status,200);const {head}=await committed.json();
  assert.equal((await call(env,b.token,"read",{revision:head.revision})).status,404);
  assert.equal((await call(env,null,"head")).status,401);
  const objects=env.ACCOUNTS.instances.size;
  const forged=a.token.replace(/^[a-f0-9]{64}/,"b".repeat(64));
  assert.equal((await call(env,forged,"head")).status,401);assert.equal(env.ACCOUNTS.instances.size,objects);
  assert.equal((await call(env,a.token,"logout")).status,200);
  assert.equal((await call(env,a.token,"head")).status,401);
});
test("compare-and-swap and request replay preserve both branches; R2 never gets device settings or live runs",async()=>{
  const env=environment(),a=await session(env),snapshot=save();snapshot.state.profile.settings={music:1,touchScale:3};
  const data=await cloudSnapshot(snapshot,config),body={parent:null,requestId:"c".repeat(32),save:data.save,hash:data.hash};
  const first=await (await call(env,a.token,"commit",body)).json();
  const replay=await (await call(env,a.token,"commit",body)).json();assert.equal(replay.head.revision,first.head.revision);
  assert.equal((await call(env,a.token,"commit",{...body,requestId:"d".repeat(32)})).status,409);
  assert.equal(env.SAVES.data.size,1);
  const text=[...env.SAVES.data.values()][0];assert.deepEqual(JSON.parse(text).state.profile.settings,{});
  assert.equal(JSON.parse(text).state.playerId,"offline-cloud-progress");
  env.SAVES.data.set([...env.SAVES.data.keys()][0],text.replace('"stardust":0','"stardust":500'));
  assert.equal((await call(env,a.token,"read",{revision:first.head.revision})).status,503);
});
test("disabled/missing configuration fails closed rather than serving public R2 objects",async()=>{
  const env=environment();env.SERVICE_ENABLED="false";
  assert.equal((await call(env,null,"head")).status,503);
  env.SERVICE_ENABLED="true";env.SESSION_SIGNING_KEY="";
  assert.equal((await call(env,null,"head")).status,503);
  assert.equal(env.SAVES.data.size,0);
});
