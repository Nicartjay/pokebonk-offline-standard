import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.mjs";
import {publicPage} from "../src/public-pages.mjs";
import {environment} from "./fixtures.mjs";
const origin="https://pokebonk-offline-cloud.nicartjay.workers.dev";
test("home/privacy/terms are public static pages without touching secrets, budgets, accounts or R2",async()=>{
  const noServices=new Proxy({}, {get(){throw Error("A public page accessed private service configuration.");}});
  for(const [path,title]of [["/","PokéBonk Offline"],["/privacy","Privacy Policy"],["/terms","Terms of Service"]]){
    const response=await worker.fetch(new Request(origin+path),noServices),html=await response.text();
    assert.equal(response.status,200);assert.match(response.headers.get("Content-Type"),/^text\/html/);
    assert.match(html,new RegExp("<h1>"+title+"</h1>"));
    assert.ok(html.includes('rel="canonical" href="'+origin+path+'"'));
    assert.ok(html.includes('href="/privacy"'));assert.ok(html.includes('href="/terms"'));
    assert.equal(response.headers.has("Set-Cookie"),false);
    assert.doesNotMatch(html,/<script\b|<iframe\b|<form\b|<img\b/i);
    assert.doesNotMatch(html,/pokebonk\.com\/legal|REPLACE-ME|synthetic-google-secret/);
  }
});
test("HEAD and trailing-slash policy URLs work without authentication",async()=>{
  for(const path of ["/","/privacy/","/terms/"]){
    const response=await worker.fetch(new Request(origin+path,{method:"HEAD"}),{});
    assert.equal(response.status,200);assert.equal(await response.text(),"");
    assert.match(response.headers.get("Cache-Control"),/public/);
    assert.equal(response.headers.get("Referrer-Policy"),"no-referrer");
    assert.match(response.headers.get("Content-Security-Policy"),/default-src 'none'/);
    assert.match(response.headers.get("Content-Security-Policy"),/form-action 'none'/);
    assert.equal(response.headers.get("X-Content-Type-Options"),"nosniff");
  }
});
test("public policy routes are read-only and do not replace private API routing",async()=>{
  for(const path of ["/","/privacy","/terms"]){
    const response=await worker.fetch(new Request(origin+path,{method:"POST",body:"not a save"}),{});
    assert.equal(response.status,405);assert.equal(response.headers.get("Allow"),"GET, HEAD");
  }
  assert.equal(publicPage(new Request(origin+"/v1/head")),null);
  const env=environment();env.SERVICE_ENABLED="false";
  const privateResponse=await worker.fetch(new Request(origin.replace("pokebonk-offline-cloud.nicartjay","cloud-save.test")+"/v1/head",
    {method:"POST",headers:{"Content-Type":"application/json"},body:"{}"}),env);
  assert.equal(privateResponse.status,503);
});
test("privacy explains identity-only Google access, operator visibility, retention and assisted deletion",async()=>{
  const html=await (await worker.fetch(new Request(origin+"/privacy"),{})).text();
  for(const text of ["openid","email","not end-to-end encrypted","up to 10 minutes","Up to 10 save versions",
    "at most 30 days","does not delete cloud backups","no one-click cloud-account deletion","maintainer assistance",
    "https://github.com/Nicartjay/pokebonk-offline-standard/issues","no advertising or analytics scripts"])
    assert.ok(html.includes(text),"Missing privacy disclosure: "+text);
});
test("terms identify the operator and describe optional use, finite capacity, backups and retained legal rights",async()=>{
  const html=await (await worker.fetch(new Request(origin+"/terms"),{})).text();
  for(const text of ["Nicartjay","without a service fee","quotas","own exported backups","Nothing in these terms removes rights",
    "applicable open-source licenses","request maintainer-assisted account/data deletion"])
    assert.ok(html.includes(text),"Missing terms disclosure: "+text);
});
test("static pages do not reflect query parameters or credential-like configuration",async()=>{
  const response=await worker.fetch(new Request(origin+"/privacy?injected=%3Cscript%3Esecret-query%3C%2Fscript%3E"),
    {GOOGLE_CLIENT_SECRET:"never-render-this",PUBLIC_ORIGIN:"https://untrusted.invalid"});
  const html=await response.text();
  assert.doesNotMatch(html,/secret-query|never-render-this|untrusted\.invalid/);
  assert.ok(html.includes(origin+"/privacy"));
});
