import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {parse} from "acorn";
import {validateEnvelope} from "../common/state.mjs";

const source=await readFile(new URL("../tools/export-online-save.js",import.meta.url),"utf8");
const config=JSON.parse(await readFile(new URL("../config.json",import.meta.url),"utf8"));
const version={version:"0.10.35",build:"mwwhf156"};
const token="synthetic-session-not-a-real-login";
const profile=()=>({v:1,name:"My Trainer",starter:4,starterJ:0,settings:{music:.25},
  league:[4,25],unlocked:[4,25],seen:[1,4,7,25],stardust:137,totalStardust:500,
  bonk:2,totalBonk:2,lab:{power:2},bag:{"rare-candy":2},counters:{runs:8},
  runs:[],best:{},biomes:{forest:1},captured:{"4":100}});
const expedition=()=>({next:3,coins:41,shards:2,rep:3,slots:40,
  gear:{held:{id:1,b:"choice-band",lv:1,r:1,s:123,d:99}},
  stash:[{id:2,b:"potion",lv:1,r:0,s:456,q:3}],bag:[],over:[],pocket:null,
  ins:[1],codex:[],ps:{xp:100,got:[]},history:[],out:2,best:90});

async function run(options={}){
  const account={id:"synthetic-player",name:"My Trainer",token,guest:false};
  const values=new Map([
    ["pb.session",JSON.stringify(account)],["pb.device",JSON.stringify("synthetic-device-12345")],
    ...Object.entries(options.storage??{}).map(([key,value])=>[key,JSON.stringify(value)]),
  ]);
  const originalValues=new Map(values),requests=[],downloads=[],blobs=new Map(),messages=[],timers=new Map();
  let nextTimer=0,versions=0,writes=0,clicks=0;
  const stash=options.stash??{plans:{data:{v:2,"4":[{name:"My plan"}]},updated:123}};
  class BrowserURL extends URL{
    static createObjectURL(blob){const url="blob:https://pokebonk.com/"+blobs.size;blobs.set(url,blob);return url;}
    static revokeObjectURL(url){blobs.delete(url);}
  }
  const localStorage={getItem:key=>{
    assert.ok(["pb.session","pb.device","pb.pending","pb.live","pb.coop.run"].includes(key));
    return values.get(key)??null;
  },setItem(){writes++;throw Error("Unexpected browser write");},
  removeItem(){writes++;throw Error("Unexpected browser delete");},
  clear(){writes++;throw Error("Unexpected browser clear");}};
  const context=vm.createContext({
    location:new URL(options.origin??"https://pokebonk.com/"),
    localStorage,URL:BrowserURL,Blob,TextEncoder,TextDecoder,AbortController,
    crypto:{randomUUID:()=>"synthetic-new-local-player"},
    setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;},
    clearTimeout:id=>timers.delete(id),
    console:Object.fromEntries(["info","warn","error","log"].map(level=>[level,(...args)=>messages.push({level,text:args.join(" ")})])),
    document:{
      querySelector:selector=>{assert.equal(selector,'meta[name="pokebonk-build"]');return {content:options.build??version.build};},
      body:{append(link){assert.equal(link.hidden,true);}},
      createElement:tag=>{
        assert.equal(tag,"a");
        return {click(){clicks++;downloads.push({name:this.download,blob:blobs.get(this.href)});},remove(){}};
      },
    },
    fetch:async(url,init)=>{
      const parsed=new URL(url),route=parsed.pathname;
      requests.push({url,init});
      assert.equal(init.method,"GET");
      assert.equal(init.credentials,"omit");
      assert.equal(init.redirect,"error");
      assert.equal(init.cache,"no-store");
      assert.equal(parsed.search,"");
      assert.ok(!url.includes(token));
      if(route==="/version.json"){
        assert.equal(parsed.origin,"https://pokebonk.com");
        assert.equal(init.headers.Authorization,undefined);
        return Response.json(options.versions?.[versions++]??version);
      }
      assert.equal(parsed.origin,"https://api.pokebonk.com");
      assert.equal(init.headers.Authorization,"Bearer "+token);
      assert.equal(init.headers["X-Device"],"synthetic-device-12345");
      assert.equal(init.headers["X-Client"],"8");
      if(options.rejectRoute===route)return Response.json({error:token},{status:401});
      if(route==="/auth/me")return Response.json(options.me??{
        id:account.id,email:"private-synthetic@example.invalid",token:"never-export-this-auth-response"});
      if(route==="/profile")return Response.json({profile:options.profile??profile(),now:123});
      if(route==="/profile/stash"){
        options.afterRead?.(values);
        return Response.json(stash);
      }
      throw Error("Unexpected endpoint");
    },
  });
  vm.runInContext("globalThis.structuredClone=value=>JSON.parse(JSON.stringify(value));",context);
  await vm.runInContext(source,context,{timeout:1000});
  const files=await Promise.all(downloads.map(async item=>({name:item.name,text:await item.blob.text()})));
  for(const file of files)file.value=JSON.parse(file.text);
  assert.equal(writes,0);
  assert.ok(messages.every(message=>!message.text.includes(token)&&!message.text.includes("never-export-this-auth-response")));
  assert.ok(files.every(file=>!file.text.includes(token)&&!file.text.includes("private-synthetic@example.invalid")&&
    !file.text.includes("never-export-this-auth-response")));
  return {files,requests,messages,values,originalValues,stash,clicks,timers};
}

test("standalone exporter is self-contained, and never writes browser storage or loads scripts",()=>{
  const tree=parse(source,{ecmaVersion:"latest",sourceType:"script"});
  function visit(node){
    if(!node||typeof node!=="object")return;
    assert.ok(!["ImportDeclaration","ImportExpression"].includes(node.type));
    if(node.type==="CallExpression"&&node.callee.type==="Identifier"){
      assert.ok(!["eval","Function","WebSocket","XMLHttpRequest"].includes(node.callee.name));
    }
    if(node.type==="MemberExpression"&&node.object.name==="localStorage"){
      assert.equal(node.property.name,"getItem");
    }
    for(const child of Object.values(node)){
      if(Array.isArray(child))child.forEach(visit);
      else if(child&&typeof child==="object")visit(child);
    }
  }
  visit(tree);
});

test("own completed profile becomes a native-importable backup without topping up or granting Pokémon",async()=>{
  const original=profile(),result=await run({profile:original});
  assert.equal(result.files.length,1);
  const file=result.files[0],save=validateEnvelope(file.value,config);
  assert.match(file.name,/OFFLINE-IMPORT/);
  assert.equal(save.state.playerId,"offline-synthetic-new-local-player");
  assert.notEqual(save.state.playerId,"synthetic-player");
  assert.equal(save.state.profile.stardust,137);
  assert.equal(save.state.profile.totalStardust,500);
  assert.deepEqual(save.state.profile.league,[4,25]);
  assert.deepEqual(save.state.profile.unlocked,[4,25]);
  assert.deepEqual(save.state.stash,result.stash);
  assert.deepEqual(save.onlineArchive.profile,original);
  assert.equal(save.state.activeRun,null);
  assert.equal(save.state.suspended,null);
  assert.deepEqual(save.upstream,version,"actual online build must not be mislabelled as the older offline engine");
  assert.deepEqual(result.values,result.originalValues);
  assert.equal(result.requests.length,5);
  assert.equal(result.timers.size,1,"only delayed blob cleanup remains");
  assert.equal([...result.timers.values()][0].delay,60000);
});

test("zero balances and newer non-runtime profile fields are preserved, not reset",async()=>{
  const p={...profile(),stardust:0,totalStardust:0,bonk:0,totalBonk:0,
    card:{newStyle:"retained"},looks:["retained-for-newer-engine"]};
  const {files}=await run({profile:p}),save=validateEnvelope(files[0].value,config);
  assert.equal(save.state.profile.stardust,0);
  assert.deepEqual(save.state.profile.card,p.card);
  assert.deepEqual(save.onlineArchive.profile,p);
});

test("compatible Expedition inventory retains quantities, IDs, equipment, currency and original archive",async()=>{
  const p={...profile(),exp:expedition()},{files}=await run({profile:p});
  const save=validateEnvelope(files[0].value,config);
  assert.deepEqual(save.state.profile.exp,{...p.exp,offlineVersion:1});
  assert.deepEqual(save.onlineArchive.profile.exp,p.exp);
  assert.equal(save.onlineArchive.profile.exp.offlineVersion,undefined);
});

test("online v1 Expedition statistics are copied and borrowed Pokémon are not mistaken for pass XP",async()=>{
  const e=expedition();
  delete e.out;delete e.best;delete e.ps;delete e.history;
  Object.assign(e,{v:1,stats:{out:3,best:700,dead:1,raids:4},sp:[1,4,7],
    last:{at:123,got:[],out:false,run:"synthetic-run",time:45,value:0}});
  const p={...profile(),exp:e},{files}=await run({profile:p});
  assert.match(files[0].name,/OFFLINE-IMPORT/);
  const save=validateEnvelope(files[0].value,config),after=save.state.profile.exp;
  assert.equal(after.out,e.stats.out);
  assert.equal(after.best,e.stats.best);
  assert.deepEqual(after.ps,{xp:0,got:[]});
  assert.deepEqual(after.history,[]);
  assert.deepEqual(after.sp,[1,4,7]);
  assert.deepEqual(after.last,e.last,"incomplete old last-run summary must not become a fabricated history row");
  for(const key of ["coins","shards","rep","gear","stash","bag","over","pocket","next","ins"]){
    assert.deepEqual(after[key],e[key],key+" must not reset or change");
  }
  assert.deepEqual(save.onlineArchive.profile,p,"the original online format stays intact");
});

test("compact-format adaptation preserves an existing pass and never replaces it with defaults",async()=>{
  const e={...expedition(),v:1,stats:{out:3,best:700},sp:[1,4,7],ps:{xp:1200,got:[1,2]}};
  delete e.out;delete e.best;delete e.history;
  const {files}=await run({profile:{...profile(),exp:e}});
  const save=validateEnvelope(files[0].value,config);
  assert.deepEqual(save.state.profile.exp.ps,e.ps);
  assert.equal(save.state.profile.exp.out,3);
});

test("missing source statistics and unknown online Expedition schemas remain archives",async()=>{
  for(const extra of [{v:1,stats:{}},{v:2,stats:{out:1,best:50}}]){
    const e={...expedition(),...extra};
    delete e.out;delete e.best;
    const p={...profile(),exp:e},{files}=await run({profile:p});
    assert.match(files[0].name,/ARCHIVE-NOT-IMPORTABLE/);
    assert.deepEqual(files[0].value.profile,p);
  }
});

test("unknown Expedition items and active raids preserve an archive instead of deleting progression",async()=>{
  for(const e of [
    {...expedition(),stash:[{id:2,b:"future-unreviewed-item",lv:1,r:0,s:4}]},
    {...expedition(),raid:"online-active-run"},
    {...expedition(),ins:[99]},
  ]){
    const p={...profile(),exp:e},{files,messages}=await run({profile:p});
    assert.equal(files.length,1);
    assert.match(files[0].name,/ARCHIVE-NOT-IMPORTABLE/);
    assert.deepEqual(files[0].value.profile,p);
    assert.equal(files[0].value.compatibility.importable,false);
    assert.throws(()=>validateEnvelope(files[0].value,config),/edition/);
    assert.ok(messages.some(value=>value.level==="warn"));
  }
});

test("missing starter migration fields never trigger automatic starter unlocks",async()=>{
  const p=profile();delete p.starter;
  const {files}=await run({profile:p});
  assert.match(files[0].name,/ARCHIVE-NOT-IMPORTABLE/);
  assert.deepEqual(files[0].value.profile,p);
});

test("wrong origin, missing login, unsupported builds, pending results and live rooms stop before networking",async()=>{
  for(const options of [
    {origin:"https://not-pokebonk.example/"},
    {storage:{"pb.session":null}},
    {build:"unreviewed-future-build"},
    {storage:{"pb.pending":[{acc:"synthetic-player",result:{}}]}},
    {storage:{"pb.live":{acc:"synthetic-player"}}},
    {storage:{"pb.coop.run":{acc:"synthetic-player"}}},
  ]){
    const result=await run(options);
    assert.equal(result.files.length,0);
    assert.equal(result.requests.length,0);
    assert.ok(result.messages.some(value=>value.level==="error"));
  }
});

test("expired or mismatched sessions never fall back to a different account or export auth data",async()=>{
  for(const options of [
    {rejectRoute:"/auth/me"},
    {me:{id:"different-player"}},
    {afterRead:values=>values.set("pb.session",JSON.stringify({id:"different-player",token:"different"}))},
  ]){
    const result=await run(options);
    assert.equal(result.files.length,0);
    assert.ok(result.messages.some(value=>value.level==="error"));
  }
});

test("build changes before or during capture fail closed without downloading a mixed snapshot",async()=>{
  for(const versions of [
    [{version:"0.10.36",build:"newer-build"}],
    [version,{version:"0.10.36",build:"newer-build"}],
  ]){
    const result=await run({versions});
    assert.equal(result.files.length,0);
    assert.ok(result.messages.some(value=>value.level==="error"));
  }
});

test("unsafe properties or mixed-in secrets are neither downloaded nor logged",async()=>{
  for(const p of [
    {...profile(),token},
    {...profile(),nested:{Authorization:token}},
    JSON.parse(JSON.stringify(profile()).replace('"name":','"__proto__":{},"name":')),
  ]){
    const result=await run({profile:p});
    assert.equal(result.files.length,0);
    assert.ok(result.messages.some(value=>value.level==="error"));
  }
});
