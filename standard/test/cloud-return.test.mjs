import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {cloudReturnId,cloudReturnURL,cloudLoopbackURL,cloudAndroidReturnURL,cloudAndroidActivationURL,CLOUD_RETURN_SCHEME,ANDROID_CLOUD_RETURN_SCHEME} from "../common/cloud-return.mjs";
import {DesktopCloudHost} from "../desktop/cloud-host.mjs";
import {desktopConfiguration} from "../packaging/desktop-config.mjs";
test("app-return URLs accept only an exact Standard activation and a public login ID",()=>{
  const id="a".repeat(32),url=cloudReturnURL(id);
  assert.equal(url,`${CLOUD_RETURN_SCHEME}://cloud/return/${id}`);assert.equal(cloudReturnId(url),id);
  for(const value of [null,{},42,"a".repeat(31),"../../arbitrary"])assert.equal(cloudReturnURL(value),null);
  for(const value of [null,{},url+"?token=secret",url+"#x",url+"/",url+"\n",url+"\r\n",url.toUpperCase(),
    url.replace("cloud/","evil/"),url.replace("return/","return/%2e/"),
    url.replace("://cloud","://user@cloud"),"https://evil.invalid/"+id,"pokebonk-standard://game/index.html"])
    assert.equal(cloudReturnId(value),null);
});
test("external returns can only focus an unexpired in-memory native login, not authenticate or restore",async()=>{
  const host=new DesktopCloudHost({config:{},directory:"/unused",safeStorage:null,platform:"win32"});
  const id="b".repeat(32),url=cloudReturnURL(id);
  assert.equal(host.acceptsReturn(url),false);
  host.returnLogin={id,expiresAt:Date.now()+60000};
  assert.equal(host.acceptsReturn(url),true);assert.equal(host.acceptsReturn(cloudReturnURL("c".repeat(32))),false);
  host.returnLogin.expiresAt=Date.now()-1;assert.equal(host.acceptsReturn(url),false);
  host.returnLogin={id,expiresAt:Date.now()+60000};await host.cancel();assert.equal(host.acceptsReturn(url),false);
});
test("loopback destinations reject arbitrary hosts, DNS aliases, credentials, low ports and extra paths",()=>{
  const nonce="A".repeat(43),url="http://127.0.0.1:49152/cloud/return/"+nonce;
  assert.equal(cloudLoopbackURL(url),url);
  for(const value of [null,{},url.replace("127.0.0.1","localhost"),url.replace("127.0.0.1","127.0.0.2"),
    url.replace("127.0.0.1","[::1]"),url.replace("127.0.0.1","2130706433"),url.replace("127.0.0.1","127.1"),
    url.replace("127.0.0.1","evil.invalid"),url.replace("49152","80"),url.replace("49152","65536"),
    url.replace("49152","049152"),url.replace("http:","https:"),url.replace("://","://user@"),
    url+"?token=bad",url+"#fragment",url+"/",url+"\n",url+"\r\n",url.slice(0,-1),url.replace("/return/","/%72eturn/")])
    assert.equal(cloudLoopbackURL(value),null);
});
test("Android browser intent targets only our installed edition and a fixed credential-free help fallback",()=>{
  const id="a".repeat(32),url=cloudAndroidReturnURL(id);
  assert.ok(url.startsWith("intent://cloud/return/"+id+"#Intent;"));
  assert.ok(url.includes("package=dev.nicartjay.pokebonk.offline.standard;"));
  assert.ok(url.includes("scheme="+ANDROID_CLOUD_RETURN_SCHEME+";"));
  assert.ok(url.endsWith(";end"));assert.doesNotMatch(url,/token=|component=|action=|market:/);
  assert.equal(cloudAndroidReturnURL(id+"?evil"),null);
  assert.equal(cloudAndroidActivationURL(id),"pokebonk-offline://cloud/return/"+id);
});
test("desktop packaging registers the external activation separately from the offline asset scheme",()=>{
  const config={version:"1.3.0",applicationId:"dev.nicartjay.pokebonk.offline.standard",productName:"PokéBonk Offline"};
  const result=desktopConfiguration(config,{app:"/stage",output:"/out",game:"/game",resources:"/icons",electronVersion:"45.0.0"});
  assert.deepEqual(result.protocols,[{name:"PokéBonk Offline cloud sign-in return",schemes:[CLOUD_RETURN_SCHEME],role:"Viewer"}]);
});
test("Android returns reuse the existing activity and never navigate either WebView",async()=>{
  const base="standard/android/app/src/main";
  const manifest=await readFile(base+"/AndroidManifest.xml","utf8");
  assert.match(manifest,/android:launchMode="singleTask"/);assert.match(manifest,/android:scheme="pokebonk-offline-standard"/);
  assert.match(manifest,/android:scheme="pokebonk-offline"/);
  const main=await readFile(base+"/java/dev/nicartjay/pokebonk/offline/standard/MainActivity.java","utf8");
  const method=main.slice(main.indexOf("@Override protected void onNewIntent"),main.indexOf("@Override protected void onResume"));
  assert.match(method,/cloud\.acceptsReturn\(intent\.getDataString\(\)\)/);
  assert.doesNotMatch(method,/loadUrl|reload|startActivity|restoreCloud|saveSession/);
});
