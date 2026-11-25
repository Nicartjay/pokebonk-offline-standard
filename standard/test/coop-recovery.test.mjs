import test from "node:test";
import assert from "node:assert/strict";
import {RunRecovery} from "../runtime/run-recovery.js";
import {COOP_RECONNECT_MS,peerLinks,recoveryState,retryDelay} from "../common/coop-recovery.mjs";

function cluster(count){
  let now=1000;
  const rooms=[],recoveries=[],runs=[],members=Array.from({length:count},(_,slot)=>({id:"lan-p"+slot,slot}));
  for(let i=0;i<count;i++){
    const room={me:members[i].id,open:true,departed:new Set(),room:{party:"lan-unchanged-party",host:members[0].id,members},
      session:{linked:true},linkState:()=>room.session.linked?"open":"connecting",
      mesh:{sendCtl:(id,data)=>{queueMicrotask(()=>recoveries[+id.slice(5)].control(room.me,structuredClone(data)));return true;}}};
    const peers=new Map(members.filter(m=>m.id!==room.me).map(member=>[member.id,{...member,buf:[],last:{hp:42}}]));
    class Pause {get frozen(){return this.original===true;}tick(dt){this.lastDt=dt;}}
    const net={pause:new Pause(),peers,known:new Map([...peers.keys()].map(id=>[id,new Map([[1,true]])])),
      recovered(peer){peer.gone=false;},peerGone(peer){peer.gone=true;},sendState(){},sendTotals(){},sendSnapshots(){}};
    const run={coop:net,state:"play",input:{pressed:new Set(["KeyW"]),releaseLock(){this.released=true;},
      requestLock(){this.locks=(this.locks??0)+1;},armLock(){this.requestLock();}},
      player:{hp:42,iframes:0},ticket:{id:"offline-retained-ticket"},time:141,stage:2,kills:73,level:18,
      async finish(victory){this.finishes=(this.finishes??0)+1;this.victory=victory;this.state="over";this.coop.ended=true;}};
    const recovery=new RunRecovery(room,{now:()=>now,nonce:()=>"a".repeat(32)});
    recovery.attach(run);rooms.push(room);recoveries.push(recovery);runs.push(run);
  }
  return {rooms,recoveries,runs,advance:ms=>{now+=ms;},dispose(){recoveries.forEach(recovery=>recovery.dispose());}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
for(const count of [2,3,4])test(`${count}-player recovery freezes and resumes the same run only after the team barrier`,async t=>{
  const c=cluster(count);t.after(()=>c.dispose());
  for(const room of c.rooms)room.session.linked=false;
  c.recoveries.forEach(recovery=>recovery.update());
  for(const run of c.runs){assert.equal(run.coop.pause.frozen,true);run.coop.pause.tick(1);assert.equal(run.coop.pause.lastDt,0);}
  const tickets=c.runs.map(run=>run.ticket);
  c.advance(1000);for(const room of c.rooms)room.session.linked=true;
  c.recoveries.forEach(recovery=>recovery.update());
  await flush();await flush();
  for(let i=0;i<count;i++){
    assert.equal(c.recoveries[i].frozen,false);assert.equal(c.runs[i].coop.pause.frozen,false);
    assert.equal(c.runs[i].ticket,tickets[i]);
    assert.deepEqual([c.runs[i].time,c.runs[i].stage,c.runs[i].kills,c.runs[i].level,c.runs[i].player.hp],[141,2,73,18,42]);
  }
});
test("another player, another party or an old commit cannot thaw a disconnected run",t=>{
  const c=cluster(3);t.after(()=>c.dispose());
  c.rooms[1].session.linked=false;c.recoveries[1].update();
  for(const [peer,party]of [["lan-p2","lan-unchanged-party"],["lan-p0","lan-other-party"]])
    c.recoveries[1].control(peer,{t:"offline-resume",k:"commit",party,round:1,nonce:"a".repeat(32)});
  assert.equal(c.recoveries[1].frozen,true);
  c.advance(COOP_RECONNECT_MS+1);c.recoveries[1].step();
  assert.equal(c.recoveries[1].expired,true);assert.equal(c.runs[1].ticket.id,"offline-retained-ticket");
});
test("normal team pause remains in effect after transport recovery",async t=>{
  const c=cluster(2);t.after(()=>c.dispose());
  c.runs[1].coop.pause.original=true;
  for(const room of c.rooms)room.session.linked=false;c.recoveries.forEach(r=>r.update());
  for(const room of c.rooms)room.session.linked=true;c.recoveries.forEach(r=>r.update());
  await flush();await flush();
  assert.equal(c.recoveries[1].frozen,false);assert.equal(c.runs[1].coop.pause.frozen,true);
});
test("Give up leaves once and finishes only this player through the ordinary defeat path",async t=>{
  const c=cluster(2);t.after(()=>c.dispose());
  const recovery=c.recoveries[1],run=c.runs[1];let leaves=0;
  c.rooms[1].transmit=action=>{assert.equal(action,"leave");leaves++;recovery.fail();};
  c.rooms[1].session.linked=false;recovery.update();
  const first=recovery.giveUp(),second=recovery.giveUp();
  assert.equal(first,second);assert.equal(recovery.expired,true);
  assert.equal(await first,true);
  recovery.fail();recovery.finish();
  assert.equal(leaves,1);assert.equal(run.finishes,1);assert.equal(run.victory,false);
  assert.equal(run.endHow,"quit");assert.equal(c.runs[0].state,"play");
});
test("timeout and a permanent connection failure automatically give up without a click",async t=>{
  for(const reason of ["timeout","failed"]){
    const c=cluster(2);t.after(()=>c.dispose());
    const recovery=c.recoveries[1],room=c.rooms[1],run=c.runs[1];room.session.linked=false;recovery.update();
    if(reason==="timeout"){c.advance(COOP_RECONNECT_MS+1);recovery.step();}else recovery.fail();
    await recovery.ending;
    assert.equal(recovery.reason,reason);assert.equal(run.finishes,1);
    assert.equal(room.open,false);assert.equal(run.state,"over");assert.equal(run.victory,false);
    room.session.linked=true;recovery.update();
    recovery.control(room.room.host,{t:"offline-resume",k:"commit",party:room.room.party,round:1,nonce:"a".repeat(32)});
    recovery.finish();
    assert.equal(recovery.frozen,true);assert.equal(run.finishes,1);
  }
});
test("desktop mouse stays released while recovering and input hooks are restored on disposal",t=>{
  const c=cluster(2);t.after(()=>c.dispose());
  const recovery=c.recoveries[0],run=c.runs[0];
  run.input.armLock();assert.equal(run.input.locks,1);
  c.rooms[0].session.linked=false;recovery.update();
  assert.equal(run.input.released,true);run.input.armLock();run.input.requestLock();
  assert.equal(run.input.locks,1);
  recovery.dispose();run.input.armLock();assert.equal(run.input.locks,2);
});
test("failure received before engine attachment ends the attached run, not a replacement run",async t=>{
  const c=cluster(2);t.after(()=>c.dispose());
  c.recoveries[1].dispose();
  const recovery=new RunRecovery(c.rooms[1]);t.after(()=>recovery.dispose());
  await recovery.fail();assert.equal(recovery.pendingGiveUp,"failed");
  recovery.attach(c.runs[1]);await recovery.ending;
  assert.equal(c.runs[1].finishes,1);assert.equal(c.runs[1].state,"over");
});
test("recovery metadata is bounded and does not carry private reconnect credentials",()=>{
  const members=[{id:"lan-me"},{id:"lan-peer"}];
  assert.deepEqual(peerLinks(["lan-peer"],members,"lan-me"),["lan-peer"]);
  for(const list of [["lan-me"],["lan-stranger"],["lan-peer","lan-peer"]])assert.throws(()=>peerLinks(list,members,"lan-me"));
  const state=recoveryState({status:"reconnecting",until:100000,attempt:3,sessionToken:"private",resume:"secret"});
  assert.deepEqual(state,{status:"reconnecting",until:100000,attempt:3});
  assert.equal(retryDelay(100),8000);
});
