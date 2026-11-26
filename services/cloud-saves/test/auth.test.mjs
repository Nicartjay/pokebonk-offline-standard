import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {environment} from "./fixtures.mjs";
import {cloudHash} from "../../../standard/common/cloud-save.mjs";
import {verifyGoogle,exchangeGoogle} from "../src/google.mjs";
import {internal} from "../src/policy.mjs";
const b64=value=>Buffer.from(typeof value==="string"?value:JSON.stringify(value)).toString("base64url");
const keys=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:"SHA-256"},true,["sign","verify"]);
const jwk={...await crypto.subtle.exportKey("jwk",keys.publicKey),kid:"cloud-test",alg:"RS256"};
async function token(claims){
  const body=b64({alg:"RS256",kid:jwk.kid})+"."+b64(claims);
  return body+"."+Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",keys.privateKey,new TextEncoder().encode(body))).toString("base64url");
}
test("Google identity signature, audience, issuer, nonce and email verification are independently required",async()=>{
  const env=environment(),now=Math.floor(Date.now()/1000);
  const claims={iss:"https://accounts.google.com",aud:env.GOOGLE_CLIENT_ID,sub:"user-a",email:"a@example.test",
    email_verified:true,nonce:"expected",iat:now,exp:now+300};
  const request=async(_target,options)=>{assert.equal(options.redirect,"manual");return Response.json({keys:[jwk]});};
  const valid=await verifyGoogle(await token(claims),"expected",env,request);
  assert.match(valid.account,/^[a-f0-9]{64}$/);assert.equal(valid.label,"a@example.test");
  for(const changed of [{aud:"another-client"},{iss:"https://evil.invalid"},{nonce:"another"},
    {email_verified:false},{exp:now-1},{iat:now+100},{sub:""}]){
    await assert.rejects(verifyGoogle(await token({...claims,...changed}),"expected",env,request));
  }
  const signed=await token(claims),parts=signed.split(".");parts[1]=b64({...claims,sub:"victim"});
  await assert.rejects(verifyGoogle(parts.join("."),"expected",env,request),{code:"invalid_identity_signature"});
});
test("native proof + browser-bound consent issue one idempotent cross-platform account session without Drive access",async()=>{
  const env=environment(),verifier="v".repeat(43),challenge=await cloudHash(verifier);
  const post=(route,value,headers={})=>worker.fetch(new Request(env.PUBLIC_ORIGIN+route,{method:"POST",
    headers:{"Content-Type":"application/json",...headers},body:JSON.stringify(value)}),env);
  const start=await post("/v1/login/start",{challenge},{"CF-Connecting-IP":"192.0.2.1"});
  assert.equal(start.status,200);const {id}=await start.json();
  const browser=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/start/"+id),env);
  assert.equal(browser.status,302);
  const url=new URL(browser.headers.get("Location")),cookie=browser.headers.get("Set-Cookie").split(";")[0];
  assert.equal(url.origin,"https://accounts.google.com");assert.equal(url.searchParams.get("scope"),"openid email");
  const login=(await env.DIRECTORY.contexts.get("directory").storage.get("directory")).logins[id];
  const now=Math.floor(Date.now()/1000),jwt=await token({iss:"https://accounts.google.com",aud:env.GOOGLE_CLIENT_ID,
    sub:"same-google-user-on-all-platforms",email:"trainer@example.test",email_verified:true,nonce:login.nonce,iat:now,exp:now+300});
  const original=globalThis.fetch;
  globalThis.fetch=async(target,options)=>{
    assert.equal(options.redirect,"manual");
    if(String(target)==="https://oauth2.googleapis.com/token")return Response.json({id_token:jwt});
    if(String(target)==="https://www.googleapis.com/oauth2/v3/certs")return Response.json({keys:[jwk]});
    throw Error("Unexpected external request.");
  };
  try{
    const callback=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/callback?"+
      new URLSearchParams({code:"synthetic-code",state:url.searchParams.get("state")}),{headers:{Cookie:cookie}}),env);
    assert.equal(callback.status,303);
    assert.equal(callback.headers.get("Location"),"/auth/confirm/"+id);
    const review=await worker.fetch(new Request(env.PUBLIC_ORIGIN+callback.headers.get("Location"),{headers:{Cookie:cookie}}),env);
    assert.equal(review.headers.get("Referrer-Policy"),"strict-origin");
    const html=await review.text();assert.match(html,/Connect this device/);assert.doesNotMatch(html,/SESSION_SIGNING_KEY|synthetic-google-secret|synthetic-code/);
    const stranger=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/confirm/"+id),env);
    assert.doesNotMatch(await stranger.text(),/trainer@example.test|name="csrf"/);
    const csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
    assert.equal((await post("/v1/login/poll",{id,verifier:"x".repeat(43)})).status,403);
    assert.equal((await (await post("/v1/login/poll",{id,verifier})).json()).pending,true);
    const denied=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/confirm/"+id,{method:"POST",
      headers:{Cookie:cookie,Origin:"https://evil.invalid"},body:new URLSearchParams({csrf})}),env);
    const denial=await denied.text();
    assert.match(denial,/Sign-in did not finish/);assert.match(denial,/invalid_confirmation/);
    assert.doesNotMatch(denial,/synthetic-google-secret|synthetic-code/);
    const opaque=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/confirm/"+id,{method:"POST",
      headers:{Cookie:cookie,Origin:"null"},body:new URLSearchParams({csrf})}),env);
    assert.match(await opaque.text(),/invalid_confirmation/);
    assert.equal((await (await post("/v1/login/poll",{id,verifier})).json()).pending,true);
    const approved=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/confirm/"+id,{method:"POST",
      headers:{Cookie:cookie,Origin:env.PUBLIC_ORIGIN},body:new URLSearchParams({csrf})}),env);
    const approvedHtml=await approved.text();
    assert.match(approvedHtml,/Device connected/);assert.match(approvedHtml,/Return to game/);
    assert.ok(approvedHtml.includes("pokebonk-offline-standard://cloud/return/"+id));
    const session=await (await post("/v1/login/poll",{id,verifier})).json();
    assert.match(session.accountId,/^[a-f0-9]{64}$/);assert.equal(session.accountLabel,"trainer@example.test");
    const retry=await (await post("/v1/login/poll",{id,verifier})).json();assert.equal(retry.token,session.token);
    const head=await post("/v1/head",{},{Authorization:"Bearer "+session.token});assert.equal(head.status,200);
    assert.equal((await head.json()).head,null);assert.equal(env.SAVES.data.size,0);
  }finally{globalThis.fetch=original;}
});
test("Google token redirects are rejected in Workers-compatible manual mode without forwarding the client secret",async()=>{
  const env=environment();let requests=0;
  await assert.rejects(exchangeGoogle("synthetic-code","v".repeat(43),env,async(target,options)=>{
    requests++;assert.equal(target,"https://oauth2.googleapis.com/token");
    assert.equal(options.redirect,"manual");
    return new Response(null,{status:302,headers:{Location:"https://untrusted.invalid/token"}});
  }),{code:"identity_service_unavailable"});
  assert.equal(requests,1);
});
test("the Mac loopback target is validated at start and browser-cookie/CSRF bound, never taken from a query",async()=>{
  const env=environment(),target="http://127.0.0.1:49152/cloud/return/"+"N".repeat(43),verifier="v".repeat(43);
  const start=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/v1/login/start",{method:"POST",
    headers:{"Content-Type":"application/json","CF-Connecting-IP":"192.0.2.3"},
    body:JSON.stringify({challenge:await cloudHash(verifier),returnTo:target})}),env);
  const login=await start.json();assert.equal(start.status,200);assert.equal(login.returnMode,"loopback");
  const browser=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/start/"+login.id),env);
  const cookie=browser.headers.get("Set-Cookie").split(";")[0],directory=env.DIRECTORY.get("directory");
  const state=await env.DIRECTORY.contexts.get("directory").storage.get("directory");
  // Synthetic identity replaces Google only in this isolated service fixture.
  const identity=await directory.fetch(internal("/identity",{id:login.id,cookie:state.logins[login.id].browser,
    account:"a".repeat(64),label:"test@example.test"}));
  assert.equal(identity.status,200);
  const review=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/confirm/"+login.id,{headers:{Cookie:cookie}}),env);
  const html=await review.text();assert.match(html,/This Mac signs in for this app session only/);
  const csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
  const approved=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/confirm/"+login.id+"?returnTo=https://evil.invalid",{method:"POST",
    headers:{Cookie:cookie,Origin:env.PUBLIC_ORIGIN},body:new URLSearchParams({csrf})}),env);
  const connected=await approved.text();
  assert.ok(connected.includes(`href="${target}"`));assert.doesNotMatch(connected,/evil\.invalid/);
  assert.match(connected,/Connect again after fully quitting/);
  assert.equal(env.SAVES.data.size,0);
});
test("arbitrary or malformed return destinations are rejected without creating a login or following a URL",async()=>{
  for(const returnTo of ["https://evil.invalid","http://localhost:49152/cloud/return/"+"N".repeat(43),
    "http://127.0.0.1:80/cloud/return/"+"N".repeat(43),{},null]){
    const env=environment(),response=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/v1/login/start",{method:"POST",
      headers:{"Content-Type":"application/json","CF-Connecting-IP":"192.0.2.4"},
      body:JSON.stringify({challenge:"a".repeat(64),returnTo})}),env);
    assert.equal(response.status,400);assert.equal((await response.json()).error,"invalid_return_destination");
    const state=await env.DIRECTORY.contexts.get("directory").storage.get("directory");
    assert.equal(state,undefined);assert.equal(env.SAVES.data.size,0);
  }
});
test("Android return selection is bound to native login start, not the confirmation page query",async()=>{
  const env=environment();
  const start=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/v1/login/start",{method:"POST",
    headers:{"Content-Type":"application/json","CF-Connecting-IP":"192.0.2.5"},
    body:JSON.stringify({challenge:"a".repeat(64),clientPlatform:"android"})}),env);
  assert.equal(start.status,200);const {id}=await start.json();
  const browser=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/start/"+id),env);
  const cookie=browser.headers.get("Set-Cookie").split(";")[0];
  const login=(await env.DIRECTORY.contexts.get("directory").storage.get("directory")).logins[id];
  await env.DIRECTORY.get("directory").fetch(internal("/identity",{id,cookie:login.browser,account:"a".repeat(64),label:"sample@example.test"}));
  const review=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/confirm/"+id,{headers:{Cookie:cookie}}),env);
  const html=await review.text(),csrf=html.match(/name="csrf" value="([^"]+)"/)[1];
  const approved=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/auth/confirm/"+id+"?clientPlatform=desktop",{method:"POST",
    headers:{Cookie:cookie,Origin:env.PUBLIC_ORIGIN},body:new URLSearchParams({csrf})}),env);
  const connected=await approved.text();
  assert.ok(connected.includes('href="intent://cloud/return/'+id+"#Intent;"));
  assert.match(connected,/scheme=pokebonk-offline;/);assert.match(connected,/Chrome needs your tap/);
  assert.doesNotMatch(connected,/setInterval\(|Signed in for this Mac/);
});
