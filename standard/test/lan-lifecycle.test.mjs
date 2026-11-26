import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
const source=(await readFile(new URL("../runtime/lan.js",import.meta.url),"utf8"))
  .replace(/^import .*;\s*$/gm,"").replace("export class LocalRoom","class LocalRoom");
function fixture(){
  let state={phase:"idle",members:[]};
  const listeners=new Map(),sent=[],started=[],notices=[];
  const backend={state:{},prepareLan:async session=>{
    backend.state.activeRun={ticket:{config:{mode:"standard",species:4,biome:"forest",tier:0}}};
  },cancelPreparedLan:async()=>{}};
  const app={backend,notice:message=>notices.push(message),startRun:async config=>{
    started.push(config);app.run={coop:{},state:"play"};return true;
  }};
  const sandbox={
    PokeBonkLAN:{state:()=>structuredClone(state),send:(...args)=>sent.push(args)},
    PokeBonkNativeApp:app,structuredClone,queueMicrotask,Event,Set,Map,
    document:{addEventListener:(name,listener)=>listeners.set(name,listener),dispatchEvent(){}},
    RunRecovery:class {attach(){}update(){}dispose(){}},
  };
  vm.runInNewContext(source,sandbox);
  return {app,sent,started,notices,
    update(value){state=value;listeners.get("standard:lan-state")();}};
}
test("fresh hosting/lobby events without a completed-party marker do not access a nonexistent run-room",()=>{
  const f=fixture();
  for(const phase of ["hosting","lobby","hosting","idle","closed"]){
    assert.doesNotThrow(()=>f.update({phase,members:[]}));
  }
  assert.equal(f.started.length,0);assert.equal(f.sent.length,0);assert.equal(f.notices.length,0);
});
test("the fresh-room state guard still allows exactly one committed launch through repeated native state updates",async()=>{
  const f=fixture(),members=[
    {id:"lan-self",slot:0,species:4,ready:true},{id:"lan-friend",slot:1,species:7,ready:true}];
  const session={phase:"preparing",me:"lan-self",linked:true,members,
    match:{party:"lan-lifecycle-test",seed:123,mode:"standard",biome:"forest",tier:0}};
  f.update({phase:"hosting",members});
  f.update(session);await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.sent,[["prepared","lan-lifecycle-test"]]);
  f.update({...session,phase:"playing"});await new Promise(resolve=>setImmediate(resolve));
  f.update({...session,phase:"playing"});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.started.length,1);assert.equal(f.started[0].coop.party,session.match.party);
  assert.equal(f.notices.length,0);
});
