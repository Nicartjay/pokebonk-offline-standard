import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readdir,readFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {CloudSync} from "../common/cloud-sync.mjs";
import {cloudSnapshot,portableCloudSave,mergeCloudSave,cloudHash,canonicalJSON} from "../common/cloud-save.mjs";
import {StateStore} from "../common/store.mjs";
import {DesktopCloudHost} from "../desktop/cloud-host.mjs";
import {save,config as originalConfig} from "./fixtures.mjs";
import worker from "../../services/cloud-saves/src/worker.mjs";
import {environment,session} from "../../services/cloud-saves/test/fixtures.mjs";
async function fixture(t){
  const directory=await mkdtemp(path.join(os.tmpdir(),"pokebonk-cloud-"));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const env=environment(),identity=await session(env),config={...originalConfig,cloudSaves:{enabled:true,url:env.PUBLIC_ORIGIN}};
  let requests=0,offline=false;
  async function device(name,dust,music){
    const store=new StateStore(path.join(directory,name),config),local=save();
    local.state.playerId="offline-"+name;local.state.profile.stardust=dust;local.state.profile.settings={music,quality:name};
    await store.saveState(local);
    let meta={automatic:false},idle=true;
    const events=[],host={
      status:async()=>({accountId:identity.accountId,accountLabel:identity.accountLabel}),
      preferences:async()=>structuredClone(meta),savePreferences:async value=>{meta=structuredClone(value);},
      snapshot:()=>store.cloudSnapshot(),restore:value=>store.restoreCloud(value),idle:async()=>idle,
      async api(op,value){
        requests++;if(offline){const error=Error("network");error.code="network";throw error;}
        const response=await worker.fetch(new Request(env.PUBLIC_ORIGIN+"/v1/"+op,{method:"POST",
          headers:{"Content-Type":"application/json",Authorization:"Bearer "+identity.token},body:JSON.stringify(value)}),env);
        const body=await response.json();if(!response.ok){const error=Error(body.error);error.code=body.error;throw error;}return body;
      }
    };
    const controller=new CloudSync({config,host,emit:value=>events.push(value)});
    return {store,controller,events,host,get meta(){return meta;},set idle(value){idle=value;},
      async progress(amount){const value=await store.loadState();value.state.profile.stardust=amount;await store.saveState(value);},
      async dust(){return (await store.loadState()).state.profile.stardust;}};
  }
  return {env,identity,config,directory,device,get requests(){return requests;},set offline(value){offline=value;}};
}
test("one portable progression format is independent of desktop/Android preferences, file timestamps and local player identity",async()=>{
  const first=save(),second=save();
  first.state.profile.settings={quality:"low",music:0,touchScale:2};
  second.state.profile.settings={quality:"high",music:1};second.state.playerId="offline-android";second.state.updatedAt=123456;
  const a=await cloudSnapshot(first,originalConfig),b=await cloudSnapshot(second,originalConfig);
  assert.equal(a.hash,b.hash);assert.deepEqual(a.save.state.profile.settings,{});
  const restored=mergeCloudSave(a.save,second,originalConfig);
  assert.equal(restored.state.playerId,second.state.playerId);assert.deepEqual(restored.state.profile.settings,second.state.profile.settings);
  first.state.activeRun={status:"running",ticket:{id:"offline-run",seed:1}};
  assert.throws(()=>portableCloudSave(first,originalConfig),{code:"unfinished_run"});
});
test("browser consent completing in the background keeps sign-in connected without premature save access",async t=>{
  const f=await fixture(t),a=await f.device("browser-return",50,1);
  a.host.connect=async()=>{
    a.idle=false;
    return {accountId:f.identity.accountId,accountLabel:f.identity.accountLabel};
  };
  let snapshots=0;
  const snapshot=a.host.snapshot;a.host.snapshot=()=>{snapshots++;return snapshot();};
  await a.controller.command("connect");
  assert.equal(a.controller.value.state,"connected");assert.equal(a.controller.value.connected,true);
  assert.equal(a.controller.value.automatic,false);assert.equal(snapshots,0);assert.equal(f.requests,0);
  a.idle=true;await a.controller.command("open");
  assert.equal(a.controller.value.state,"review");assert.equal(snapshots,1);assert.equal(f.requests,1);
  assert.equal(f.env.SAVES.data.size,0,"Signing in/reviewing alone must not upload a save.");
});
test("two native-controller fixtures upload, choose conflicts, restore history and retain device settings without additive rewards",async t=>{
  const f=await fixture(t),mac=await f.device("macos",1000,0),android=await f.device("android",10,1);
  await mac.controller.init();await android.controller.init();assert.equal(f.requests,0);
  assert.equal(mac.meta.automatic,false);
  await mac.controller.command("sync");assert.equal(mac.controller.value.state,"synced");
  const first=mac.meta.base;
  await android.controller.command("open");assert.equal(android.controller.value.state,"conflict");
  await android.controller.command("review-cloud");assert.equal(android.controller.value.state,"confirm-restore");
  await android.controller.command("confirm-cloud");assert.equal(await android.dust(),1000);
  assert.deepEqual((await android.store.loadState()).state.profile.settings,{music:1,quality:"android"});
  assert.ok((await readdir(android.store.directory)).some(name=>name.startsWith("before-cloud-")));
  await mac.progress(1100);await mac.controller.command("sync");
  await android.progress(1050);await android.controller.command("sync");
  assert.equal(android.controller.value.state,"conflict");assert.equal(await android.dust(),1050);
  await android.controller.command("review-local");await android.controller.command("confirm-local");
  await mac.controller.command("sync");assert.equal(await mac.dust(),1050);
  assert.deepEqual((await mac.store.loadState()).state.profile.settings,{music:0,quality:"macos"});
  await android.controller.command("backups");assert.ok(android.controller.value.backups.length>=3);
  await android.controller.command("review-backup",first);await android.controller.command("confirm-cloud");
  assert.equal(await android.dust(),1000);assert.equal(android.meta.base, null);
  assert.equal(android.controller.value.state,"review");
  assert.equal(android.controller.value.local.stardust,1000);
  assert.equal(android.controller.value.cloud.stardust,1050);
  assert.equal(android.controller.value.local.savedLabel,"On this device");
  await android.controller.command("sync");assert.equal(android.controller.value.state,"conflict");
});
test("confirmed cloud operations stay serialized and report an asynchronous native restore failure without losing local progress",async t=>{
  const f=await fixture(t),a=await f.device("source",50,0),b=await f.device("target",70,1);
  await a.controller.command("sync");await b.controller.command("open");await b.controller.command("review-cloud");
  let release;
  const entered=new Promise(resolve=>{
    b.host.restore=async()=>{resolve();await new Promise(done=>{release=done;});const error=Error("local_changed");error.code="local_changed";throw error;};
  });
  const pending=b.controller.command("confirm-cloud");await entered;
  assert.equal(b.controller.busy,true);
  const before=f.requests;await b.controller.command("sync");assert.equal(f.requests,before);
  release();await pending;
  assert.equal(b.controller.busy,false);assert.equal(b.controller.value.state,"error");
  assert.equal(b.controller.value.reason,"local_changed");assert.equal(await b.dust(),70);
});
test("a changed remote head invalidates confirmation; failed/offline sync never replaces local progress",async t=>{
  const f=await fixture(t),a=await f.device("windows",50,0),b=await f.device("linux",70,1);
  await a.controller.command("sync");await b.controller.command("open");await b.controller.command("review-cloud");
  await a.progress(60);await a.controller.command("sync");
  await b.controller.command("confirm-cloud");assert.equal(await b.dust(),70);assert.equal(b.controller.value.state,"conflict");
  f.offline=true;await b.controller.command("sync");assert.equal(b.controller.value.state,"offline");assert.equal(await b.dust(),70);
  b.idle=false;f.offline=false;const before=f.requests;await b.controller.command("sync");
  assert.equal(b.controller.value.state,"blocked");assert.equal(f.requests,before);
});
test("atomic restore fences already-loaded renderer writes and refuses a save changed since its native snapshot",async t=>{
  const f=await fixture(t),a=await f.device("fence",50,1);
  const loaded=await a.store.clientLoadState(),snapshot=await a.store.cloudSnapshot(),remote=save();remote.state.profile.stardust=99;
  await a.store.restoreCloud({stamp:snapshot.stamp,save:remote});
  assert.equal(await a.dust(),99);
  assert.throws(()=>a.store.clientSaveState({...loaded.save,nativeEpoch:loaded.epoch}),{code:"stale_native_save"});
  const fresh=await a.store.clientLoadState();assert.notEqual(fresh.epoch,loaded.epoch);
  await a.store.clientSaveState({...fresh.save,nativeEpoch:fresh.epoch});
  const stale=await a.store.cloudSnapshot();await a.progress(100);
  await assert.rejects(a.store.restoreCloud({stamp:stale.stamp,save:remote}),{code:"local_changed"});
  assert.equal(await a.dust(),100);
});
test("unconfigured or opted-out cloud makes no provider requests and Linux plaintext keyring fallback is refused",async t=>{
  let network=0;
  const off=new CloudSync({config:originalConfig,host:{status(){throw Error("Unexpected credential access");}},emit(){}});
  await off.init();await off.tick();assert.equal(off.value.state,"unavailable");
  const f=await fixture(t),a=await f.device("optout",1,1);await a.controller.init();await a.controller.tick();assert.equal(f.requests,0);
  const host=new DesktopCloudHost({config:f.config,directory:f.directory,platform:"linux",
    safeStorage:{isAsyncEncryptionAvailable:async()=>true,getSelectedStorageBackend:()=>"basic_text"}});
  await assert.rejects(host.secure(),{code:"secure_storage_unavailable"});
});
