// Authored for the next approved single verification pass. No real saves,
// native rooms, Cloudflare credentials or installed applications are used.
import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {OfflineBackend} from "../runtime/backend.js";
import {validateState} from "../common/state.mjs";
import {expeditionOwnRefs,lootKey} from "../runtime/expedition-ledger.js";
import {ExpeditionTeamIO} from "../runtime/expedition-team.js";
Object.assign(globalThis,{window:globalThis,location:new URL("http://127.0.0.1:8765/"),
  addEventListener(){},removeEventListener(){},localStorage:{getItem(){return null;},setItem(){},removeItem(){}},
  matchMedia:()=>({matches:false,addEventListener(){},addListener(){}})});
const metadata=JSON.parse(await readFile("build/standard-game/offline-build.json","utf8"));
const load=role=>import(new URL("../../build/standard-game/"+metadata.modules[role],import.meta.url));
const [rules,config,cosmetics,modes,expedition]=await Promise.all(
  ["backendRules","backendConfig","backendCosmetics","backendModes","backendExpedition"].map(load));
const NOW=Date.UTC(2026,10,25,1),PARTY="lan-expedition-unit-party";
const members=[{id:"lan-exp-host",slot:0,name:"Host",species:4,ready:true},
  {id:"lan-exp-peer",slot:1,name:"Friend",species:7,ready:true}];
async function fixture(index,{insured=false}={}){
  let disk=null,fail=false;
  const runtime={rules,config,cosmetics,modes,expedition,now:()=>NOW,storage:{setItem(){}},
    data:()=>({has:id=>id>0&&id<=251,family:id=>id,familyTypes:()=>["fire"],
      researchGoal:()=>100,legendary:()=>false}),
    transport:{load:async()=>structuredClone(disk),save:async state=>{
      if(fail)throw Error("interrupted write");validateState(state);disk=structuredClone(state);
    }}};
  const backend=new OfflineBackend(runtime),account=await backend.restore();
  await backend.chooseStarter(account,members[index].species);await backend.expState();
  await backend.change(p=>{
    const e=p.exp;
    e.gear.held=expedition.normalizeItem({id:e.next++,b:"choice-band",lv:1,r:1,s:123,d:100});
    if(insured)e.ins=[e.gear.held.id];
  });
  const before=structuredClone(disk),session={phase:"preparing",role:index?"client":"host",me:members[index].id,
    linked:true,members:structuredClone(members),settings:{biome:"wilds",tier:4},seats:{discoverable:false,capacity:4},
    match:{party:PARTY,seed:123456,mode:"expedition",biome:"wilds",tier:0,rulesAt:NOW,players:members.map(m=>m.id)}};
  const select=()=>{globalThis.PokeBonkLocalCoop={state:()=>structuredClone(session),send(){}};};
  select();await backend.prepareLan(structuredClone(session));
  return {backend,account,runtime,session,select,before,get disk(){return structuredClone(disk);},set fail(value){fail=value;},
    async launch(){session.phase="playing";select();this.ticket=await backend.startRun(account,{...backend.state.activeRun.ticket.config,party:PARTY});return this.ticket;}};
}
const result=(f,{out=true,loot=[],...extra}={})=>({species:f.ticket.config.species,finalSpecies:f.ticket.config.species,
  mode:"expedition",biome:"wilds",tier:0,stage:1,time:240,kills:12,damage:50,level:4,victory:false,
  bosses:0,legendaries:0,alphas:0,reactions:0,moves:[],items:[],splits:[],coop:{party:PARTY,size:2},
  progress:{counters:{},research:{},seen:[],league:[],shinies:[],classics:[],forms:[]},
  exp:{out,loot,gear:{held:"e1"},bag:[],pocket:null,...extra}});
const all=e=>[...e.stash,...e.over,...e.bag,...Object.values(e.gear),...e.pocket?[e.pocket]:[]];
test("Expedition preparation escrows once, then cancellation restores gear and insurance without granting progress",async()=>{
  const f=await fixture(0,{insured:true}),committed=f.disk;
  f.select();await f.backend.prepareLan(structuredClone(f.session));assert.deepEqual(f.disk,committed);
  assert.deepEqual(f.disk.profile.exp.gear,{});
  assert.equal(f.disk.activeRun.ticket.config.mode,"expedition");
  await f.backend.cancelPreparedLan(PARTY);
  assert.deepEqual(f.disk.profile.exp,f.before.profile.exp);
  assert.equal(f.disk.activeRun,null);assert.deepEqual(f.disk.profile.league,[4]);
});
test("the durable start barrier checks actual owned equipment, not a peer-supplied summary",async()=>{
  const f=await fixture(0);
  await f.backend.cancelPreparedLan(PARTY);
  await f.backend.change(p=>{p.exp.stash.push(p.exp.gear.held);p.exp.gear={};});
  const before=f.disk;f.select();
  await assert.rejects(f.backend.prepareLan(structuredClone(f.session)),/usable piece of gear/);
  assert.deepEqual(f.disk,before);
});
test("gift ownership is committed before delivery, cannot be kept twice and survives restart",async()=>{
  const a=await fixture(0),b=await fixture(1);await a.launch();await b.launch();
  const claim={k:"crate",i:0,t:1,m:1},source=result(a,{loot:[claim]});
  const item=expeditionOwnRefs(expedition,a.ticket,source).refs.get("l0"),packet={t:"xg",key:lootKey(claim),it:item};
  a.fail=true;const unchanged=a.disk;
  await assert.rejects(a.backend.recordExpeditionPacket({party:PARTY,peer:members[1].id,direction:"out",data:packet,result:source}),/interrupted/);
  assert.deepEqual(a.disk,unchanged);a.fail=false;
  await a.backend.recordExpeditionPacket({party:PARTY,peer:members[1].id,direction:"out",data:packet,result:source});
  assert.equal(await b.backend.recordExpeditionPacket({party:PARTY,peer:members[0].id,direction:"in",data:packet,result:result(b)}),true);
  assert.equal(await b.backend.recordExpeditionPacket({party:PARTY,peer:members[0].id,direction:"in",data:packet,result:result(b)}),false);
  const gift={to:members[1].id,ref:"l0"};
  await assert.rejects(a.backend.finishRun(a.account,a.ticket,result(a,{loot:[claim],give:[gift],bag:["l0"]})),/Gifted loot/);
  await a.backend.finishRun(a.account,a.ticket,result(a,{loot:[claim],give:[gift]}));
  const received=result(b,{take:[{from:members[0].id,key:lootKey(claim)}],bag:["g0"]});
  await b.backend.finishRun(b.account,b.ticket,received);
  const count=all(b.disk.profile.exp).length;
  await b.backend.finishRun(b.account,b.ticket,received);assert.equal(all(b.disk.profile.exp).length,count);
  const next=new OfflineBackend(b.runtime);await next.restore();
  assert.deepEqual(next.state.profile.exp,b.disk.profile.exp);
  assert.deepEqual(b.disk.profile.league,[7]);
});
test("rescued backpacks return to their owner once, never become the rescuer's permanent gear",async()=>{
  const owner=await fixture(0),rescuer=await fixture(1);await owner.launch();await rescuer.launch();
  const item=owner.ticket.exp.gear.held,packet={t:"xpk",id:"pack1234",l:[{k:"e1",it:item}],x:0,z:0};
  await owner.backend.recordExpeditionPacket({party:PARTY,peer:members[1].id,direction:"out",data:packet,
    result:result(owner,{out:false,gear:{},pack:["e1"]})});
  await rescuer.backend.recordExpeditionPacket({party:PARTY,peer:members[0].id,direction:"in",data:packet,result:result(rescuer)});
  await owner.backend.finishRun(owner.account,owner.ticket,result(owner,{out:false,gear:{},pack:["e1"]}));
  assert.equal(all(owner.disk.profile.exp).length,0);
  await rescuer.backend.finishRun(rescuer.account,rescuer.ticket,result(rescuer,{
    rescue:[{from:members[0].id,key:"e1"}],bag:["r0"]}));
  assert.equal(all(rescuer.disk.profile.exp).length,1);
  const [receipt]=rescuer.backend.expeditionReturns(PARTY);
  await owner.backend.receiveExpeditionReturn(PARTY,members[1].id,receipt);
  const restored=owner.disk;
  await owner.backend.receiveExpeditionReturn(PARTY,members[1].id,receipt);assert.deepEqual(owner.disk,restored);
  assert.equal(all(owner.disk.profile.exp)[0].id,1);
  await rescuer.backend.acknowledgeExpeditionReturn(PARTY,members[0].id,receipt.id);
  assert.deepEqual(rescuer.backend.expeditionReturns(PARTY),[]);
});
test("new upstream split references conserve quantity and receive unique local item identities",async()=>{
  const f=await fixture(0);await f.backend.cancelPreparedLan(PARTY);
  await f.backend.change(p=>{const e=p.exp;e.pocket=expedition.normalizeItem({id:e.next++,b:"potion",lv:1,r:0,s:1,q:3});});
  f.select();await f.backend.prepareLan(structuredClone(f.session));await f.launch();
  const good=result(f,{pocket:"e2",bag:["e2~1"],q:{e2:1,"e2~1":2}});
  await assert.rejects(f.backend.finishRun(f.account,f.ticket,{...good,exp:{...good.exp,q:{e2:3,"e2~1":3}}}),/quantity/);
  await f.backend.finishRun(f.account,f.ticket,good);
  const potions=all(f.disk.profile.exp).filter(item=>item.b==="potion");
  assert.equal(potions.reduce((sum,item)=>sum+item.q,0),3);
  assert.equal(new Set(potions.map(item=>item.id)).size,2);
  validateState(f.disk);
});
test("the engine adapter never transmits an ownership-changing message before durable receipt storage",async()=>{
  const sent=[],notice=globalThis.PokeBonkNativeApp;
  globalThis.PokeBonkNativeApp={notice(){}};
  let release;
  const io=new ExpeditionTeamIO({open:true,gone:new Set(),room:{party:PARTY}},{backend:{recordExpeditionPacket:()=>new Promise(resolve=>{release=resolve;})},
    run:()=>({mode:"expedition",coop:{gid:"game"},result:()=>({})})});
  try{
    assert.equal(io.outgoing("lan-friend",{t:"xg",g:"game",key:"crate0.0"},(...args)=>sent.push(args)),true);
    await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(sent,[]);
    release(true);await io.flush();assert.equal(sent.length,1);
  }finally{
    io.dispose();globalThis.PokeBonkNativeApp=notice;
  }
});
