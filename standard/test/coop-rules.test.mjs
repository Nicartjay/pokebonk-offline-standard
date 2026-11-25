import test from "node:test";
import assert from "node:assert/strict";
import {coopMaps,coopSettings,coopSeats,coopConfig,resolveCoopConfig,requireCoopUnlocks,coopModeUnavailable,
  coopLoadout,coopDestination,coopRoomMatches,coopGameConfig} from "../common/coop-rules.mjs";
import {LanLobby} from "../runtime/lan-lobby.js";
test("original room modes resolve while Expedition accepts only its own two destinations",()=>{
  for(const [tier,mode]of[[0,"standard"],[1,"standard"],[2,"standard"],[3,"endless"],[5,"relay"],[6,"mutation"],[7,"bossrush"]]){
    const value=coopConfig({biome:"forest",tier});
    assert.equal(value.mode,mode);assert.equal(coopModeUnavailable(tier),null);
    assert.equal(value.biome,tier===7?"newisland":"forest");
  }
  for(const tier of [4,8,-1,1.5,"0"])assert.throws(()=>coopSettings({biome:"forest",tier}));
  assert.deepEqual(coopSettings({biome:"newisland",tier:6}),{biome:"forest",tier:6});
  assert.throws(()=>coopSettings({biome:"https://example.invalid",tier:7}));
  for(const biome of ["wilds","safari"]){
    assert.deepEqual(coopConfig({biome,tier:4}),{mode:"expedition",biome,tier:0});
    assert.ok(coopGameConfig({mode:"expedition",biome,tier:0}));
    assert.deepEqual(coopDestination(biome),{biome,tier:4});
    assert.equal(coopRoomMatches({biome,tier:4},biome),true);
  }
  assert.equal(coopRoomMatches({biome:"forest",tier:0},"wilds"),false);
  assert.equal(coopRoomMatches({biome:"safari",tier:4},"wilds"),false);
  assert.equal(coopGameConfig({mode:"expedition",biome:"wilds",tier:1}),false);
  assert.equal(coopModeUnavailable(4),null);
});
test("Expedition summaries are small data-only views, not transferable inventory or transport credentials",()=>{
  const value={worn:[{b:"choice-band",r:1,lv:2,id:123,credential:"never"}],bag:2,risk:100,ins:20,card:"card-treasure",token:"never"};
  const safe=coopLoadout(value);
  assert.equal(JSON.stringify(safe).includes("never"),false);
  assert.equal(safe.worn[0].id,undefined);
  assert.throws(()=>coopLoadout({...value,bag:13}),/loadout/);
  assert.throws(()=>coopLoadout({...value,risk:Infinity}),/loadout/);
});
test("ordinary maps/difficulties require every teammate's earned unlock; event maps retain the original exemption",()=>{
  const team=[{name:"Host",maps:{forest:2,desert:1}},{name:"Friend",maps:{forest:1}}];
  assert.deepEqual(requireCoopUnlocks({biome:"forest",tier:1},team),{biome:"forest",tier:1});
  assert.throws(()=>requireCoopUnlocks({biome:"forest",tier:2},team),/Friend/);
  assert.throws(()=>requireCoopUnlocks({biome:"desert",tier:0},team),/Friend/);
  for(const tier of [6,7])assert.doesNotThrow(()=>requireCoopUnlocks({biome:"forest",tier},team));
  assert.deepEqual(coopMaps({forest:99,desert:"2",cave:1,credential:"private"}),{forest:0,cave:1});
});
test("shared Daily Mutation is determined by the room clock, not each device's current date",()=>{
  const rulesAt=Date.UTC(2026,10,24,23,59),calls=[];
  const daily=at=>{calls.push(at);return{biome:"cave",day:123,mutation:{id:"sample-mutation",tier:2}};};
  const match={mode:"mutation",biome:"forest",tier:0,rulesAt};
  assert.deepEqual(resolveCoopConfig(match,daily),resolveCoopConfig(match,daily));
  assert.deepEqual(calls,[rulesAt,rulesAt]);
  assert.deepEqual(resolveCoopConfig(match,daily),{mode:"mutation",biome:"cave",tier:2,mutation:"sample-mutation",mutationDay:123});
  assert.throws(()=>resolveCoopConfig({...match,rulesAt:undefined},daily),/clock/);
  assert.throws(()=>resolveCoopConfig(match,()=>({biome:"unsafe",mutation:{id:"x",tier:0}})),/resolve/);
});
test("capacity cannot evict teammates and room visibility maps to the real upstream Find teammates controls",async()=>{
  assert.deepEqual(coopSeats(),{discoverable:false,capacity:4});
  assert.throws(()=>coopSeats({discoverable:true,capacity:2},3),/removing/);
  const sent=[],lobby=new LanLobby({phase:"hosting",role:"host",me:"lan-host",members:[{id:"lan-host",slot:0,name:"Host",species:4}],
    seats:{discoverable:false,capacity:3},settings:{biome:"forest",tier:0}},(...message)=>sent.push(message));
  assert.equal(lobby.room.pub,0);assert.equal(lobby.room.want,3);
  await lobby.openSeats(true,2);
  assert.deepEqual(sent,[["room-seats",{discoverable:true,capacity:2}]]);
  lobby.isHost=false;await assert.rejects(lobby.openSeats(false,2),/host/);
});
