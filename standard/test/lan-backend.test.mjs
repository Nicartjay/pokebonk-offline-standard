import test from "node:test";
import assert from "node:assert/strict";
import {OfflineBackend} from "../runtime/backend.js";
import {validateState} from "../common/state.mjs";
import {RunRecovery} from "../runtime/run-recovery.js";
function fixture({modes}={}) {
  let disk = null, fail = false;
  const session = {phase: "idle", members: []};
  globalThis.PokeBonkLocalCoop = {state: () => structuredClone(session)};
  const backend = new OfflineBackend({
    rules: {
      wn: profile => ({settings: {}, league: [], unlocked: [], seen: [], captured: {}, bag: {}, runs: [], ...profile}),
      Ut(profile, result, _data, context) {
        assert.equal(context.coop, true);
        profile.stardust += 25; const record = {...result, id: context.id, date: 1};
        profile.runs.push(record); return {record, stardust: 25};
      },
    },
    data: () => ({}), modes,storage: {setItem() {}},
    transport: {load: async () => structuredClone(disk),
      save: async state => { if (fail) throw new Error("interrupted write"); disk = structuredClone(state); }},
  });
  return {backend, session, disk: () => structuredClone(disk), fail: value => { fail = value; }};
}
async function prepare(f, count = 2) {
  const account = await f.backend.restore();
  await f.backend.chooseStarter(account, 4);
  Object.assign(f.session, {phase: "preparing", linked: true, role: "host", me: "lan-me",
    match: {party: "lan-test", seed: 123, mode: "standard", biome: "forest", tier: 0},
    members: [{id: "lan-me", species: 4, ready: true}, {id: "lan-peer", species: 155, ready: true}]});
  for(let i=2;i<count;i++)f.session.members.push({id:"lan-peer"+i,species:1,ready:true});
  await f.backend.prepareLan(structuredClone(f.session));
  return account;
}
const cfg = party => ({species: 4, mode: "standard", biome: "forest", tier: 0, boosts: [], party});
const result = party => ({species: 4, mode: "standard", biome: "forest", tier: 0, kills: 5, time: 60,
  coop: {party, size: 2}});
test("both local run preparation and launch require the exact native session", async () => {
  const f = fixture(), account = await prepare(f);
  const pending = f.disk().activeRun.ticket;
  assert.equal(pending.lan.launched, false);
  assert.equal(pending.seed, 123);
  await assert.rejects(f.backend.startRun(account, cfg("lan-test")), /durably prepared/);
  f.session.phase = "playing";
  const ticket = await f.backend.startRun(account, cfg("lan-test"));
  assert.equal(ticket.id, pending.id);
  assert.equal(f.disk().activeRun.ticket.lan.launched, true);
  await assert.rejects(f.backend.startRun(account, cfg("lan-test")), /durably prepared/);
  assert.equal(f.disk().profile.stardust, 10000);
});
test("settles once with original co-op rules and keeps shared metrics out of solo records", async () => {
  const f = fixture(), account = await prepare(f);
  f.session.phase = "playing";
  const ticket = await f.backend.startRun(account, cfg("lan-test"));
  await assert.rejects(f.backend.finishRun(account, ticket, result("lan-wrong")), /does not match/);
  await f.backend.finishRun(account, ticket, result("lan-test"));
  await f.backend.finishRun(account, ticket, result("lan-test"));
  assert.equal(f.disk().profile.stardust, 10025);
  assert.equal(f.disk().profile.runs.length, 1);
  assert.equal(Object.keys(f.disk().records.kos).length, 0);
  assert.equal(Object.keys(f.disk().lanRecords.kos).length, 1);
  assert.equal(f.disk().activeRun, null);
  validateState(f.disk());
});
test("a canceled start clears only its exact unlaunched LAN ticket", async () => {
  const f = fixture(); await prepare(f);
  const original = f.disk();
  await f.backend.cancelPreparedLan("lan-other");
  assert.deepEqual(f.disk().activeRun, original.activeRun);
  await f.backend.cancelPreparedLan("lan-test");
  assert.equal(f.disk().activeRun, null);
  assert.equal(f.disk().profile.stardust, 10000);
});
test("an interrupted preparation commit or launched ticket is never silently discarded", async () => {
  const f = fixture(), account = await prepare(f);
  await f.backend.cancelPreparedLan("lan-test");
  f.fail(true);
  await assert.rejects(f.backend.prepareLan(structuredClone(f.session)), /interrupted write/);
  assert.equal(f.backend.state.activeRun, null);
  f.fail(false); await f.backend.prepareLan(structuredClone(f.session));
  f.session.phase = "playing";
  const ticket = await f.backend.startRun(account, cfg("lan-test"));
  await f.backend.cancelPreparedLan("lan-test");
  assert.equal(f.disk().activeRun.ticket.id, ticket.id);
  assert.equal(f.disk().activeRun.ticket.lan.launched, true);
  const bad = f.disk(); bad.activeRun.ticket.lan.version = 99;
  assert.throws(() => validateState(bad), /Unsupported local co-op ticket/);
});

for(const count of [3,4])test(`durable tickets and settlement retain the ${count}-player match size`,async()=>{
  const f=fixture(),account=await prepare(f,count);f.session.phase="playing";
  const ticket=await f.backend.startRun(account,cfg("lan-test"));assert.equal(ticket.lan.size,count);
  await assert.rejects(f.backend.finishRun(account,ticket,result("lan-test")),/does not match/);
  const value={...result("lan-test"),coop:{party:"lan-test",size:count}};
  await f.backend.finishRun(account,ticket,value);await f.backend.finishRun(account,ticket,value);
  assert.equal(f.disk().profile.stardust,10025);assert.equal(f.disk().profile.runs.length,1);validateState(f.disk());
});
test('a queued LAN checkpoint cannot resurrect or crash an already settled run',async()=>{
  const f=fixture(),account=await prepare(f);f.session.phase='playing';
  const ticket=await f.backend.startRun(account,cfg('lan-test'));
  await Promise.all([f.backend.finishRun(account,ticket,result('lan-test')),f.backend.checkpoint(account,ticket,result('lan-test'))]);
  assert.equal(f.disk().activeRun,null);assert.equal(f.disk().profile.runs.length,1);
});
for(const mode of ["mutation","bossrush"])test(`${mode} co-op durably retains the shared rules, clock and single-claim ticket`,async()=>{
  const rulesAt=Date.UTC(2026,10,24,23,59),calls=[];
  const f=fixture({modes:{dailyMutation:at=>{calls.push(at);return{day:123,biome:"cave",mutation:{id:"sample-mutation",tier:2}};}}});
  const account=await prepare(f);await f.backend.cancelPreparedLan("lan-test");
  Object.assign(f.session,{rulesAt,settings:{biome:mode==="bossrush"?"newisland":"forest",tier:mode==="bossrush"?7:6}});
  Object.assign(f.session.match,{mode,biome:mode==="bossrush"?"newisland":"forest",tier:0,rulesAt});
  await f.backend.prepareLan(structuredClone(f.session));f.session.phase="playing";
  const expected=mode==="mutation"?{mode,biome:"cave",tier:2,mutation:"sample-mutation",mutationDay:123}:{mode,biome:"newisland",tier:0};
  const ticket=await f.backend.startRun(account,{species:4,...expected,boosts:[],party:"lan-test"});
  assert.equal(ticket.coopRulesAt,rulesAt);assert.equal(ticket.lan.version,2);
  assert.deepEqual(ticket.config,{species:4,...expected});
  if(mode==="mutation"){assert.equal(ticket.mutation,"sample-mutation");assert.ok(calls.every(at=>at===rulesAt));}
  const value={...result("lan-test"),...expected};
  await f.backend.finishRun(account,ticket,value);await f.backend.finishRun(account,ticket,value);
  assert.equal(f.disk().profile.stardust,10025);assert.equal(f.disk().profile.runs.length,1);
  assert.equal(f.disk().activeRun,null);validateState(f.disk());
});
for(const failSave of [false,true])test(`recovery give-up ${failSave?"preserves a failed durable save":"settles earned progress exactly once"}`,async t=>{
  const f=fixture(),account=await prepare(f);f.session.phase="playing";
  const ticket=await f.backend.startRun(account,cfg("lan-test")),value=result("lan-test");
  await f.backend.checkpoint(account,ticket,value);
  const before=f.disk();let finishes=0,leaves=0;
  const room={open:true,transmit(action){assert.equal(action,"leave");leaves++;}};
  const recovery=new RunRecovery(room);t.after(()=>recovery.dispose());
  recovery.run={state:"play",coop:{},input:{pressed:new Set()},
    meta:{ticket,backend:f.backend},
    async finish(victory){
      finishes++;assert.equal(victory,false);this.state="over";this.coop.ended=true;
      // The actual engine also catches save failure and opens its error result.
      try{await f.backend.finishRun(account,ticket,value);}catch{}
    }};
  f.fail(failSave);
  assert.equal(await recovery.fail(),!failSave);await recovery.giveUp();
  assert.equal(finishes,1);assert.equal(leaves,1);
  if(failSave){
    assert.equal(recovery.saveFailed,true);
    assert.deepEqual(f.disk(),before);assert.deepEqual(f.backend.state.activeRun,before.activeRun);
    assert.equal(f.disk().profile.stardust,10000);
  }else{
    assert.equal(f.disk().activeRun,null);assert.equal(f.disk().profile.stardust,10025);
    assert.equal(f.disk().profile.runs.length,1);
  }
});
