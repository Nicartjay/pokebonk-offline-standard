// Written before the design preview; run only after owner approval.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {createCloudLoopback} from "../desktop/cloud-loopback.mjs";
import {cloudLoopbackURL} from "../common/cloud-return.mjs";
const origin="https://cloud.owner.workers.dev";
async function get(url,headers={},method="GET"){
  return new Promise((resolve,reject)=>{
    const request=http.request(url,{method,headers},response=>{
      let text="";response.setEncoding("utf8");response.on("data",chunk=>{text+=chunk;});
      response.on("end",()=>resolve({status:response.statusCode,headers:response.headers,text}));
    });
    request.setTimeout(2000,()=>request.destroy(Error("Timed out.")));request.on("error",reject);request.end();
  });
}
test("native callback binds only loopback, rejects probes, activates once and closes after the response",async t=>{
  let returned=0;
  const callback=await createCloudLoopback({origin,onReturn:()=>{returned++;}});
  t.after(()=>callback.close());assert.equal(cloudLoopbackURL(callback.url),callback.url);
  const url=new URL(callback.url);
  assert.equal((await get(url.origin+"/wrong-path")).status,404);
  assert.equal((await get(callback.url,{Host:"untrusted.invalid:"+url.port})).status,404);
  assert.equal((await get(callback.url,{Origin:"https://untrusted.invalid"})).status,404);
  assert.equal((await get(callback.url,{Origin:"null"})).status,404);
  assert.equal((await get(callback.url,{},"POST")).status,404);assert.equal(returned,0);
  const response=await get(callback.url);
  assert.equal(response.status,200);assert.equal(returned,1);
  assert.match(response.text,/Back to the game/);assert.doesNotMatch(response.text,/<script|token=|access_token|id_token/);
  assert.equal(response.headers["cache-control"],"no-store");assert.equal(response.headers["access-control-allow-origin"],undefined);
  await assert.rejects(get(callback.url));assert.equal(returned,1);
});
test("cancelled callbacks and timeout release the ephemeral port without focusing the app",async()=>{
  const first=await createCloudLoopback({origin,onReturn:()=>assert.fail("Cancelled flow must not activate.")});
  first.close();first.close();await assert.rejects(get(first.url));
  const expired=await createCloudLoopback({origin,timeoutMs:1000,onReturn:()=>assert.fail("Expired flow must not activate.")});
  try{
    await new Promise(resolve=>setTimeout(resolve,1100));
    await assert.rejects(get(expired.url));
  }finally{expired.close();}
});
