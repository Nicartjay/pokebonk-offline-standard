import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {page,connectedPage,returnHelpPage} from "../src/auth-pages.mjs";
test("approved auth page has a fixed credential-free return URL, nonce CSP and no external requests",async()=>{
  const id="a".repeat(32),response=connectedPage(id,"pb_cloud_login=; Max-Age=0");
  const html=await response.text(),nonce=html.match(/<script nonce="([^"]+)"/)[1];
  assert.match(html,/Return to game/);assert.match(html,/<b id="countdown">5<\/b>/);
  assert.match(html,new RegExp(`href="pokebonk-offline-standard://cloud/return/${id}"`));
  assert.match(html,/Automatic sync is still off/);
  assert.ok(response.headers.get("Content-Security-Policy").includes(`script-src 'nonce-${nonce}'`));
  assert.doesNotMatch(response.headers.get("Content-Security-Policy"),/script-src 'unsafe-inline'/);
  assert.equal(response.headers.get("Referrer-Policy"),"strict-origin");
  assert.equal(response.headers.get("Cache-Control"),"no-store");
  assert.equal(response.headers.get("Set-Cookie"),"pb_cloud_login=; Max-Age=0");
  assert.doesNotMatch(html,/<script[^>]*src=|fetch\(|XMLHttpRequest|id_token|access_token|verifier\s*[:=]|client_secret/);
  assert.throws(()=>connectedPage("https://evil.invalid"),/Invalid return flow/);
  assert.doesNotMatch(await page("Review","<p>Confirmation</p>").text(),/<script/);
});
test("countdown makes one return attempt after five seconds; button and leaving the tab cancel the timer",async()=>{
  const html=await connectedPage("b".repeat(32)).text(),source=html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1];
  function fixture(){
    let tick,cleared=0;const attempts=[],events={},button={href:"pokebonk-offline-standard://cloud/return/"+"b".repeat(32),
      addEventListener:(type,fn)=>{events[type]=fn;}},status={textContent:"Countdown"},count={textContent:"5"};
    const document={hidden:false,getElementById:id=>({"return-button":button,"return-status":status,countdown:count})[id],
      addEventListener:(type,fn)=>{events[type]=fn;}};
    vm.runInNewContext(source,{document,window:{location:{assign:url=>attempts.push(url)}},String,
      setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{cleared++;tick=null;}});
    return {events,document,status,count,attempts,advance:()=>tick?.(),get cleared(){return cleared;}};
  }
  const auto=fixture();
  for(let i=0;i<4;i++)auto.advance();
  assert.equal(auto.count.textContent,"1");assert.equal(auto.attempts.length,0);
  auto.advance();auto.advance();assert.equal(auto.attempts.length,1);assert.equal(auto.cleared,1);
  assert.match(auto.status.textContent,/If the game didn’t open/);
  const manual=fixture();manual.events.click();manual.advance();assert.equal(manual.attempts.length,0);assert.equal(manual.cleared,1);
  const hidden=fixture();hidden.document.hidden=true;hidden.events.visibilitychange();hidden.advance();assert.equal(hidden.attempts.length,0);
});
test("Mac success page uses only the proof-bound validated loopback target and explains session-only login",async()=>{
  const target="http://127.0.0.1:49152/cloud/return/"+"N".repeat(43);
  const response=connectedPage("a".repeat(32),undefined,target),html=await response.text();
  assert.ok(html.includes(`href="${target}"`));assert.doesNotMatch(html,/href="pokebonk-offline-standard:/);
  assert.match(html,/Signed in for this Mac session only/);assert.match(html,/No cloud login token is saved to disk or Keychain/);
  assert.match(html,/Connect again after fully quitting/);assert.match(html,/<b id="countdown">5<\/b>/);
  for(const invalid of ["https://evil.invalid/","http://localhost:49152/cloud/return/"+"N".repeat(43),target+"?token=secret"])
    assert.throws(()=>connectedPage("a".repeat(32),undefined,invalid),/Invalid return flow/);
});
test("Android success offers a package-targeted tap, legacy alternate and honest manual handoff help",async()=>{
  const id="c".repeat(32),html=await connectedPage(id,undefined,undefined,"android").text();
  assert.ok(html.includes('href="intent://cloud/return/'+id+"#Intent;"));
  assert.ok(html.includes("package=dev.nicartjay.pokebonk.offline.standard;"));
  assert.ok(html.includes('href="pokebonk-offline://cloud/return/'+id+'"'));
  assert.match(html,/Try the alternate return link/);assert.match(html,/use your launcher/);
  assert.doesNotMatch(html,/setInterval\(|Returning to the game in/);
  const help=await returnHelpPage().text();assert.match(help,/Your browser could not open/);
  assert.doesNotMatch(help,/<script|href="intent:|access_token|id_token/);
});
