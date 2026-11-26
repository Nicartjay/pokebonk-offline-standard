import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {DesktopCloudHost} from "../desktop/cloud-host.mjs";
import {CloudSync} from "../common/cloud-sync.mjs";
import {cloudHash} from "../common/cloud-save.mjs";
for(const platform of ["win32"])test(`${platform} async OS credentials unpack the Electron result and survive a fresh host`,async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"pokebonk-async-keyring-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  const config={cloudSaves:{enabled:true,url:"https://cloud.owner.workers.dev"}};
  let rotate=false,writes=0,fail=false;
  const safeStorage={
    isAsyncEncryptionAvailable:async()=>true,
    encryptStringAsync:async text=>{writes++;if(fail)throw Error("OS storage denied");return Buffer.from("os:"+Buffer.from(text).toString("base64"));},
    decryptStringAsync:async bytes=>({result:Buffer.from(bytes.toString().slice(3),"base64").toString(),shouldReEncrypt:rotate}),
    decryptString(){assert.fail("Async ciphertext must use the same async provider.");},
  };
  const session={accountId:"a".repeat(64),accountLabel:"Test account",token:"native-only-session",origin:config.cloudSaves.url,expiresAt:Date.now()+60000};
  const host=new DesktopCloudHost({config,directory,platform,safeStorage});
  await host.saveSession(session);
  const bytes=await readFile(host.authFile);assert.doesNotMatch(bytes.toString(),/native-only-session/);
  const restarted=new DesktopCloudHost({config,directory,platform,safeStorage});
  assert.deepEqual(await restarted.loadSession(),session);assert.equal(writes,1);
  rotate=true;await restarted.loadSession();assert.equal(writes,2);
  fail=true;await assert.rejects(restarted.loadSession(),{code:"secure_storage_unavailable"});
  assert.deepEqual(await readFile(host.authFile),bytes,"Failed rotation preserves the encrypted login.");
  fail=false;rotate=false;
  safeStorage.decryptStringAsync=async()=>({result:undefined,shouldReEncrypt:false});
  await assert.rejects(restarted.loadSession(),{code:"secure_storage_unavailable"});
  assert.deepEqual(await readFile(host.authFile),bytes);
});
test("Windows old synchronous ciphertext is read through Electron's compatible async result without deleting it",async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"pokebonk-old-keyring-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  const config={cloudSaves:{enabled:true,url:"https://cloud.owner.workers.dev"}};
  const session={accountId:"b".repeat(64),accountLabel:"Existing account",token:"existing-protected-session",origin:config.cloudSaves.url,expiresAt:Date.now()+60000};
  const host=new DesktopCloudHost({config,directory,platform:"win32",safeStorage:{
    isAsyncEncryptionAvailable:async()=>true,
    encryptStringAsync:async()=>assert.fail("An unchanged older credential must not be rewritten."),
    decryptStringAsync:async bytes=>{assert.equal(bytes.toString(),"old-OS-ciphertext");return {result:JSON.stringify(session),shouldReEncrypt:false};},
  }});
  await writeFile(host.authFile,"old-OS-ciphertext",{mode:0o600});
  assert.deepEqual(await host.status(),{accountId:session.accountId,accountLabel:session.accountLabel});
  assert.equal((await readFile(host.authFile)).toString(),"old-OS-ciphertext");
});
test("Mac cloud sessions never initialize Keychain, read legacy ciphertext or persist a token",async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"pokebonk-memory-cloud-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  const config={cloudSaves:{enabled:true,url:"https://cloud.owner.workers.dev"}},requests=[];
  const safeStorage=new Proxy({},{get(){assert.fail("No Mac safeStorage API or availability check is allowed.");}});
  const options={config,directory,platform:"darwin",safeStorage,request:async(url,init)=>{
    requests.push({url,authorization:init.headers.Authorization});return Response.json({ok:true});
  }};
  const host=new DesktopCloudHost(options),sentinel="existing-ciphertext-must-stay-untouched";
  await writeFile(host.authFile,sentinel,{mode:0o600});
  await host.secure();assert.equal(await host.status(),null);assert.equal(requests.length,0);
  const session={accountId:"a".repeat(64),accountLabel:"Mac test account",token:"memory-only-session",
    origin:config.cloudSaves.url,expiresAt:Date.now()+60000};
  await host.saveSession(session);session.token="caller-mutation";
  assert.deepEqual(await host.status(),{accountId:session.accountId,accountLabel:session.accountLabel});
  const loaded=await host.loadSession();assert.equal(loaded.token,"memory-only-session");
  loaded.token="returned-copy-mutation";assert.equal((await host.loadSession()).token,"memory-only-session");
  assert.equal(await readFile(host.authFile,"utf8"),sentinel);
  const restarted=new DesktopCloudHost(options);assert.equal(await restarted.status(),null);
  await restarted.clearSession();assert.equal(await readFile(host.authFile,"utf8"),sentinel);
  await host.close();assert.equal(await host.status(),null);
  assert.equal(requests.length,1);assert.ok(requests[0].url.endsWith("/v1/logout"));
  assert.equal(requests[0].authorization,"Bearer memory-only-session");
  assert.equal(await readFile(host.authFile,"utf8"),sentinel);
});
test("Mac session expiry and disconnect discard only the in-memory sign-in",async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"pokebonk-memory-expiry-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  const config={cloudSaves:{enabled:true,url:"https://cloud.owner.workers.dev"}};
  const host=new DesktopCloudHost({config,directory,platform:"darwin",request:async()=>Response.json({ok:true})});
  const value={accountId:"b".repeat(64),accountLabel:"Test",token:"memory-only",origin:config.cloudSaves.url,expiresAt:Date.now()+60000};
  await host.saveSession(value);host.memorySession.expiresAt=Date.now()-1;assert.equal(await host.status(),null);
  await host.saveSession(value);await host.disconnect();assert.equal(await host.status(),null);
  await assert.rejects(readFile(host.authFile),{code:"ENOENT"});
});
test("Mac sign-in uses a temporary callback only for activation and keeps proof/session exchange native",async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"pokebonk-memory-login-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  const config={cloudSaves:{enabled:true,url:"https://cloud.owner.workers.dev"}},id="c".repeat(32),account="a".repeat(64);
  const expiresAt=Date.now()+60000,token=account+"."+"s".repeat(43)+"."+expiresAt+"."+"b".repeat(64);
  let notify,challenge,finished=0,closed=0,focused=0;
  const callback={url:"http://127.0.0.1:49152/cloud/return/"+"N".repeat(43),
    finishLogin:()=>{finished++;},close:()=>{closed++;}};
  const host=new DesktopCloudHost({config,directory,platform:"darwin",safeStorage:new Proxy({},{get(){assert.fail("No Keychain.");}}),
    openLoopback:async options=>{assert.equal(options.origin,config.cloudSaves.url);notify=options.onReturn;return callback;},
    openBrowser:async url=>assert.equal(url,config.cloudSaves.url+"/auth/start/"+id),onReturn:()=>{focused++;}});
  host.call=async(operation,data,bearer)=>{
    if(operation==="login/start"){
      assert.equal(data.returnTo,callback.url);challenge=data.challenge;
      return {id,expiresAt,returnMode:"loopback"};
    }
    if(operation==="login/poll"){
      assert.equal(data.id,id);assert.equal(await cloudHash(data.verifier),challenge);
      return {accountId:account,accountLabel:"Test account",token,expiresAt};
    }
    assert.equal(operation,"logout");assert.equal(bearer,token);return {ok:true};
  };
  t.after(()=>host.close());
  assert.deepEqual(await host.connect(),{accountId:account,accountLabel:"Test account"});
  assert.equal(finished,1);assert.equal(closed,0);assert.equal((await host.loadSession()).token,token);
  notify();assert.equal(focused,1);await host.cancel();notify();assert.equal(focused,1);assert.equal(closed,1);
  await assert.rejects(readFile(host.authFile),{code:"ENOENT"});
});
test("cancelling while the Mac listener starts closes it before any browser or cloud request",async()=>{
  let enter,release,closed=0;
  const started=new Promise(resolve=>{enter=resolve;});
  const host=new DesktopCloudHost({config:{},directory:"/unused",platform:"darwin",
    openLoopback:()=>{enter();return new Promise(resolve=>{release=resolve;});},
    request:()=>assert.fail("Cancelled flow must not send a request."),openBrowser:()=>assert.fail("Cancelled flow must not open a browser.")});
  const pending=host.connect();await started;await host.cancel();
  release({url:"http://127.0.0.1:49152/cloud/return/"+"N".repeat(43),close:()=>{closed++;}});
  await assert.rejects(pending,{code:"cancelled"});assert.equal(closed,1);
});
test("Linux cloud credentials use the approved keyring provider and never async/basic_text fallback",async t=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"pokebonk-keyring-"));t.after(()=>rm(directory,{recursive:true,force:true}));
  const config={cloudSaves:{enabled:true,url:"https://cloud.owner.workers.dev"}};
  const host=new DesktopCloudHost({config,directory,platform:"linux",safeStorage:{
    isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>"gnome_libsecret",
    encryptString:text=>Buffer.from("protected:"+Buffer.from(text).toString("base64")),
    decryptString:bytes=>Buffer.from(bytes.toString().slice("protected:".length),"base64").toString(),
    encryptStringAsync(){assert.fail("Provider must not change between selection and encryption.");},
  }});
  const session={accountId:"a".repeat(64),accountLabel:"Test account",token:"native-only-session",origin:config.cloudSaves.url,expiresAt:Date.now()+60000};
  await host.saveSession(session);assert.doesNotMatch((await readFile(host.authFile)).toString(),/native-only-session/);
  assert.deepEqual(await host.status(),{accountId:session.accountId,accountLabel:session.accountLabel});
  host.safeStorage.getSelectedStorageBackend=()=>"basic_text";
  await assert.rejects(host.secure(),{code:"secure_storage_unavailable"});
});
test("pending OS credential initialization is shared rather than repeatedly prompting on foreground ticks",async()=>{
  let resolve,calls=0;const config={cloudSaves:{enabled:true,url:"https://cloud.owner.workers.dev"}};
  const sync=new CloudSync({config,host:{status:()=>{calls++;return new Promise(done=>{resolve=done;});},preferences:async()=>({automatic:false})},emit(){}});
  const first=sync.init(),second=sync.init();assert.equal(calls,1);
  resolve(null);await Promise.all([first,second]);assert.equal(sync.value.state,"off");
});
test("Android isolated-broker RPC chunks requests and replies, without exposing a new game bridge",async()=>{
  const vm=await import("node:vm"),source=(await readFile("standard/runtime/cloud-broker.js","utf8")).replace(/^import .*;\s*$/gm,"");
  const assemblies=new Map(),operations=[],large="x".repeat(250000);let host;
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,Map,Array,JSON,Promise,Error,Number,String,atob,btoa,setTimeout,clearTimeout,
    CloudSync:class{constructor(options){host=options.host;}async init(){}},
    PokeBonkCloudNative:{request(packet){
      assert.ok(packet.length<50000);const part=JSON.parse(packet);
      let row=assemblies.get(part.id);if(!row){row=new Array(part.total);assemblies.set(part.id,row);}
      row[part.index]=Buffer.from(part.data,"base64");
      if(row.filter(Boolean).length!==part.total)return;
      const value=JSON.parse(Buffer.concat(row).toString());assemblies.delete(part.id);operations.push(value);
      const reply=Buffer.from(JSON.stringify({ok:true,value:value.op==="snapshot"?{save:large}:value.op==="configuration"?{}:true}));
      queueMicrotask(()=>{
        const size=32000,total=Math.ceil(reply.length/size);
        for(let i=0;i<total;i++)context.PokeBonkCloudReply(part.id,i,total,reply.subarray(i*size,(i+1)*size).toString("base64"));
      });
    }}});
  await vm.runInContext("(async()=>{"+source+"})()",context);
  assert.equal((await host.snapshot()).save,large);
  await host.api("commit",{save:large});
  assert.equal(operations.at(-1).data.value.save,large);assert.equal(assemblies.size,0);
});
