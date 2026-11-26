import test from "node:test";
import assert from "node:assert/strict";
import {gatewayOrigin,gatewayRequest,internetInvitation,internetDescription,internetState} from "../common/internet-coop.mjs";
import {NativeCoop,NativeInternet} from "../desktop/coop.mjs";
import {InternetBroker} from "../runtime/internet-broker.js";
import {InternetMesh} from "../runtime/internet-rtc.js";
import {coopConfig} from "../common/coop-rules.mjs";

const gateway="https://pokebonk-offline-coop.example.workers.dev";
const sdp=type=>({type,sdp:"v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n"+
  "a=candidate:1 1 udp 2113937151 192.168.1.2 12000 typ host\r\n"+
  "a=candidate:2 1 udp 2113937150 203.0.113.20 13000 typ srflx raddr 192.168.1.2 rport 12000\r\n"});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(predicate){for(let i=0;i<100;i++){if(predicate())return;await tick();}assert.fail("Asynchronous fixture did not advance.");}
const profile=()=>Promise.resolve({name:"Tester",league:[4],unfinished:false});
const discovery=()=>({cancel(){},advertise(){},find:async()=>({rooms:[]})});
test("the browser fetch default retains its required Window receiver",async()=>{
  const original=globalThis.fetch;let called=0;
  globalThis.fetch=function(){assert.equal(this,globalThis);called++;return Promise.resolve(Response.json({ok:true}));};
  try{
    const broker=new InternetBroker(()=>{}),run={gateway,abort:new AbortController()};
    assert.deepEqual(await broker.api(run,"/v1/matchmaking/find",{}),{ok:true});assert.equal(called,1);
  }finally{globalThis.fetch=original;}
});

test("Android-era WebViews can create/find rooms in both Internet modes without AbortSignal static helpers",async()=>{
  const any=Object.getOwnPropertyDescriptor(AbortSignal,"any"),timeout=Object.getOwnPropertyDescriptor(AbortSignal,"timeout");
  Object.defineProperty(AbortSignal,"any",{configurable:true,value:undefined});
  Object.defineProperty(AbortSignal,"timeout",{configurable:true,value:undefined});
  try{
    for(const mode of ["stun-only","turn-fallback"])for(const action of ["host","find"]){
      const h=brokerFixture();
      h.command.type=action;h.command.data.connectionMode=mode;
      const request=h.broker.request;
      h.broker.request=async(url,options)=>{
        const response=await request(url,options),value=await response.json();
        return Response.json({...value,connectionMode:mode});
      };
      const running=h.broker.begin(h.command);
      try{
        await until(()=>h.sockets.length===1);
        assert.equal(h.requests[0].url,gateway+(action==="host"?"/v1/rooms":"/v1/matchmaking/find"));
        const room=h.room(1,false);room.connectionMode=mode;
        if(action==="host"){
          room.host="lan-guest1";room.members=room.members.slice(1);room.members[0].slot=0;
        }
        h.sockets[0].receive(room);await running;
        assert.equal(h.events.at(-1).value.phase,action==="host"?"hosting":"lobby");
        assert.equal(h.requests.some(value=>value.url.endsWith("/turn")),false,"Hosting/finding must not issue relay credentials.");
      }finally{await h.broker.close();await running;}
      assert.equal(h.requests.filter(value=>value.url.endsWith("/leave")).length,1,"Cancellation still releases the seat.");
    }
  }finally{
    if(any)Object.defineProperty(AbortSignal,"any",any);else delete AbortSignal.any;
    if(timeout)Object.defineProperty(AbortSignal,"timeout",timeout);else delete AbortSignal.timeout;
  }
});
test("portable service requests retain cancellation and bound response-body reads",async()=>{
  const run={gateway,abort:new AbortController()};
  const broker=new InternetBroker(()=>{},{request:async(_url,{signal})=>({
    ok:true,text:()=>new Promise((_resolve,reject)=>signal.addEventListener("abort",()=>reject(Error("aborted")),{once:true})),
  })});
  await assert.rejects(broker.api(run,"/v1/rooms",{},null,run.abort.signal,5),{code:"request_timeout"});
  const pending=broker.api(run,"/v1/rooms",{});
  await tick();run.abort.abort();await assert.rejects(pending,/aborted/);
  let requested=false;
  broker.request=async()=>{requested=true;return Response.json({});};
  await assert.rejects(broker.api(run,"/v1/rooms",{}),/cancelled/);
  assert.equal(requested,false,"A cancelled run must not create another room.");
});

test("gateway access is native-pinned and Internet invitations never become arbitrary URLs",()=>{
  assert.equal(gatewayOrigin({internetCoop:{enabled:true,url:gateway}}),gateway);
  assert.equal(gatewayOrigin({internetCoop:{enabled:false,url:gateway}}),null);
  for(const url of ["http://co-op.example.workers.dev","https://user@co-op.example.workers.dev","https://co-op.example.workers.dev/other",
    "https://co-op.example.workers.dev:444","https://example.invalid","https://127.0.0.1",gateway+"?x=1"])
    assert.equal(gatewayOrigin({internetCoop:{enabled:true,url}}),null,url);
  assert.equal(gatewayRequest(gateway+"/v1/matchmaking/find",gateway),true);
  assert.equal(gatewayRequest(gateway.replace("https:","wss:")+"/v1/rooms/ABCDEFGH/socket",gateway),true);
  for(const url of [gateway+"/admin/status",gateway+"/v1/rooms?token=secret",gateway+".evil.test/v1/rooms",
    gateway+"/v1/../admin",gateway+"/v1/%2e%2e/admin","file:///etc/hosts"])
    assert.equal(gatewayRequest(url,gateway),false,url);
  assert.deepEqual(internetInvitation("ABCDEFGH#"+"a".repeat(43)),{code:"ABCDEFGH",joinSecret:"a".repeat(43)});
  assert.deepEqual(internetInvitation(" bonk23 "),{code:"BONK23"});
  assert.throws(()=>internetInvitation("https://example.invalid/join"));
});

test("STUN-only rejects any relay candidate; unusable candidates do not break good IPv4/IPv6/mDNS peers",()=>{
  const base=sdp("offer");
  assert.match(internetDescription({...base,sdp:base.sdp+"a=candidate:3 1 udp 123 fe80::1 15000 typ host\r\n"},"stun-only").sdp,/203\.0\.113/);
  assert.doesNotMatch(internetDescription({...base,sdp:base.sdp+"a=candidate:3 1 udp 123 fe80::1 15000 typ host\r\n"},"stun-only").sdp,/fe80/);
  const relay={...base,sdp:base.sdp+"a=candidate:4 1 udp 123 198.51.100.10 16000 typ relay\r\n"};
  assert.throws(()=>internetDescription(relay,"stun-only"),/does not allow/);
  assert.match(internetDescription(relay,"turn-fallback").sdp,/typ relay/);
  assert.throws(()=>internetDescription({...base,sdp:base.sdp+"m=audio 9 RTP/AVP 0\r\n"},"stun-only"),/Invalid/);
  assert.throws(()=>internetDescription({...base,sdp:base.sdp+"a=remote-candidates:1 203.0.113.1 80\r\n"},"stun-only"),/Invalid/);
  const state=internetState({phase:"hosting",members:[],linked:false,invitation:"ABCDEFGH#"+"a".repeat(43),
    sessionToken:"secret",iceServers:[{credential:"secret"}],gateway},"stun-only");
  assert.equal(state.connectionMode,"stun-only");assert.doesNotMatch(JSON.stringify(state),/credential|sessionToken|workers.dev/);
});

test("native routing fails closed when unconfigured and cancellation invalidates queued profile checks",async()=>{
  const sent=[],events=[];
  const coop=new NativeCoop({config:{},identity:"fixture",profile,emit:value=>events.push(value),broker:value=>sent.push(value),
    interfaces:()=>[],discovery:discovery()});
  await assert.rejects(coop.command("find",{connectionMode:"stun-only",species:4}),/not been configured/);
  assert.equal(coop.state().connectionMode,"lan");assert.equal(coop.state().capabilities.internetReady,false);assert.equal(sent.length,0);
  let read;
  const native=new NativeInternet({gateway,identity:"fixture",profile:()=>new Promise(resolve=>{read=resolve;}),emit:value=>events.push(value),broker:value=>sent.push(value)});
  const pending=native.command("find",{connectionMode:"stun-only",species:4});
  await assert.rejects(native.command("host",{connectionMode:"stun-only",species:4}),/Leave/);
  native.stop();read(await profile());await pending;
  assert.deepEqual(sent.map(value=>value.type),["reset"]);assert.equal(native.value.phase,"closed");
  const epoch=native.epoch;native.fromBroker({scope:"internet",epoch:epoch-1,type:"state",value:{phase:"hosting",members:[],linked:false}});
  assert.equal(native.value.phase,"closed");
  native.fromBroker({scope:"internet",epoch,type:"state",value:{phase:"hosting",members:[],linked:false}});
  native.cancelFind();assert.equal(native.value.phase,"hosting","Android foreground/background search cancellation must not leave an established room");
});

function brokerFixture(){
  const sockets=[],meshes=[],requests=[],events=[];
  class Socket {
    readyState=1;
    constructor(url,protocols){this.url=url;this.protocols=protocols;sockets.push(this);}
    receive(value){this.onmessage?.({data:JSON.stringify(value)});}
    close(){this.readyState=3;}
    send(value){this.sent??=[];this.sent.push(JSON.parse(value));}
  }
  class Mesh {
    peers=new Map();
    constructor(options){Object.assign(this,options);meshes.push(this);}
    async configure(id){this.peers.set(id,{});}
    drop(id){this.peers.delete(id);}
    close(){this.closed=true;}
    send(){}
  }
  let found=0;
  const request=async(url,options)=>{
    const data=JSON.parse(options.body);requests.push({url,data,options});
    if(url.endsWith("/leave"))return Response.json({left:true});
    found++;
    return Response.json({code:"AAAAA"+"BCDE"[found-1],member:"lan-guest"+found,sessionToken:"a".repeat(43),pending:true,connectionMode:"stun-only"});
  };
  const broker=new InternetBroker(value=>events.push(value),{request,Socket,Mesh});
  const command={type:"find",epoch:7,gateway,identity:"fixture-build",player:{name:"Guest"},data:{connectionMode:"stun-only",species:4}};
  const room=(n,pending=true)=>({type:"room",code:"AAAAA"+"BCDE"[n-1],buildId:"fixture-build",connectionMode:"stun-only",phase:"lobby",
    peerRounds:{},recoveryUntil:0,
    host:"lan-host",linked:!pending,chat:[],members:[
      {id:"lan-host",slot:0,name:"Host",species:1,ready:true,pending:false,connected:true},
      {id:"lan-guest"+n,slot:1,name:"Guest",species:4,ready:false,pending,connected:true}]});
  return {broker,command,sockets,meshes,requests,events,room};
}
for(const mode of ["stun-only","turn-fallback"])test(`${mode} start survives Worker match-key ordering and still rejects a changed run or unacknowledged return`,async()=>{
  const h=brokerFixture();
  h.command.data.connectionMode=mode;
  const originalRequest=h.broker.request;
  h.broker.request=async(url,options)=>{
    const response=await originalRequest(url,options);
    return Response.json({...await response.json(),connectionMode:mode});
  };
  const running=h.broker.begin(h.command);
  try{
    await until(()=>h.sockets.length===1);
    const room=h.room(1,false);room.connectionMode=mode;
    room.members.forEach(member=>{member.ready=true;});
    room.settings={biome:"forest",tier:0};room.rulesAt=123456;
    h.sockets[0].receive(room);await running;
    const run=h.broker.run,attempt=run.attempt;
    const receive=value=>h.broker.received(run,attempt,JSON.stringify(value));
    // Exact production Worker construction order, not the sanitized native
    // state's insertion order. JSON key order is not a match-identity change.
    room.phase="preparing";
    room.match={party:"lan-internet-start-test",seed:123,...coopConfig(room.settings),
      rulesAt:room.rulesAt,players:room.members.map(member=>member.id)};
    await receive(room);
    assert.notDeepEqual(Object.keys(attempt.state.match),Object.keys(room.match));
    await assert.doesNotReject(receive(room),"The second preparation broadcast is the same run.");
    room.phase="playing";await assert.doesNotReject(receive(room));
    await assert.doesNotReject(receive(room),"An ordinary playing-state refresh must not eject the room.");
    for(const change of [
      {party:"lan-another-party"},{seed:124},{mode:"endless"},{biome:"desert"},{tier:1},
      {rulesAt:room.rulesAt+1},{players:[...room.match.players].reverse()},
    ])await assert.rejects(receive({...room,match:{...room.match,...change}}),/cannot change|Invalid shared LAN match/);
    const returned={...room,phase:"lobby",lastParty:room.match.party};
    delete returned.match;
    await assert.rejects(receive(returned),/cannot change/);
    h.broker.action("room-return",room.match.party);
    await assert.doesNotReject(receive(returned));
    assert.equal(attempt.state.phase,"lobby");
    const next={...room,phase:"preparing",match:{...room.match,party:"lan-next-internet-run",seed:125}};
    await assert.doesNotReject(receive(next));
    assert.equal(attempt.state.match.party,next.match.party);
    assert.equal(h.requests.some(request=>request.url.endsWith("/turn")),false);
  }finally{await h.broker.close();await running;}
});
test("find waits for bidirectional peer acceptance, retries another room, and isolates stale callbacks",async()=>{
  const h=brokerFixture(),running=h.broker.begin(h.command);
  await until(()=>h.sockets.length===1);
  const first=h.sockets[0],lateMessage=first.onmessage;
  first.receive(h.room(1,true));await until(()=>h.meshes[0].peers.size===1);
  assert.equal(h.events.at(-1).value.phase,"connecting");
  h.meshes[0].emit({type:"failed",peer:"lan-host"});
  await until(()=>h.sockets.length===2);
  assert.equal(first.readyState,3);assert.equal(h.meshes[0].closed,true);
  assert.equal(h.requests.filter(r=>r.url.endsWith("/leave")).length,1);
  assert.deepEqual(h.requests.filter(r=>r.url.endsWith("/find"))[1].data.exclude,["AAAAAB"]);
  lateMessage({data:JSON.stringify(h.room(1,false))});
  h.meshes[0].emit({type:"frame",peer:"lan-host",channel:"ctl",data:{t:"stale"}});
  await tick();assert.equal(h.events.some(event=>event.data?.t==="stale"),false);
  h.sockets[1].receive(h.room(2,false));await running;
  assert.equal(h.events.at(-1).value.phase,"lobby");assert.equal(h.events.at(-1).value.me,"lan-guest2");
  assert.equal(h.requests.some(request=>request.url.endsWith("/turn")),false);
  assert.equal(h.sockets[1].url.includes("token"),false);assert.equal(h.sockets[1].protocols[1],"a".repeat(43));
  await h.broker.close();assert.equal(h.requests.filter(r=>r.url.endsWith("/leave")).length,2);
});

test("cancelled matchmaking releases its lease and does not reconnect or forward late room data",async()=>{
  const h=brokerFixture(),running=h.broker.begin(h.command);await until(()=>h.sockets.length===1);
  const late=h.sockets[0].onmessage;await h.broker.close();await running;
  const count=h.events.length;late({data:JSON.stringify(h.room(1,false))});await tick();
  assert.equal(h.events.length,count);assert.equal(h.sockets.length,1);
  assert.equal(h.requests.filter(r=>r.url.endsWith("/leave")).length,1);
});
test("a six-character public join does not pass an invitation secret to the service or game",async()=>{
  const h=brokerFixture();h.command.type="join";h.command.data.invitation="AAAAAB";
  const running=h.broker.begin(h.command);await until(()=>h.sockets.length===1);
  assert.ok(h.requests[0].url.endsWith("/v1/rooms/AAAAAB/join"));
  assert.equal(h.requests[0].data.protocolVersion,3);assert.equal(h.requests[0].data.joinSecret,undefined);
  h.sockets[0].receive(h.room(1,false));await running;
  assert.equal(h.events.at(-1).value.code,"AAAAAB");assert.equal(h.events.at(-1).value.invitation,undefined);
  await h.broker.close();
});

test("simultaneous fallback signaling waits for one credential request and keeps STUN-only relay-free",async()=>{
  class Peer {
    connectionState="new";iceGatheringState="complete";
    createDataChannel(){return {readyState:"connecting",close(){}};}
    setConfiguration(value){this.settings=value;}
    async setRemoteDescription(value){this.remote=value;}
    async createAnswer(){return sdp("answer");}
    async setLocalDescription(value){this.localDescription=value;}
    close(){}
  }
  let resolve,calls=0;const events=[];
  const mesh=new InternetMesh({mode:"turn-fallback",Peer,emit:value=>events.push(value),
    relay:()=>{calls++;return new Promise(done=>{resolve=done;});}});
  await mesh.configure("lan-host",false);
  const fallback=mesh.fallback("lan-host"),signal=mesh.signal("lan-host",sdp("offer"),1);
  await until(()=>calls===1);
  resolve({expiresAt:Date.now()+300000,iceServers:[{urls:["turn:turn.cloudflare.com:3478?transport=udp"],username:"user",credential:"temporary"}]});
  await Promise.all([fallback,signal]);
  assert.equal(calls,1);assert.equal(mesh.peers.get("lan-host").pc.remote.type,"offer");
  assert.equal(events.filter(event=>event.type==="signal"&&event.attempt===1).length,1);mesh.close();
  const only=new InternetMesh({mode:"stun-only",Peer,emit(){},relay:()=>{calls++;throw Error("not allowed");}});
  await only.configure("lan-host",false);await only.fallback("lan-host");assert.equal(calls,1);only.close();
});
test("a failed relay renewal closes only that link, not a healthy direct peer",async()=>{
  class Peer {
    connectionState="new";iceGatheringState="complete";
    createDataChannel(){return {readyState:"connecting",close(){}};}
    setConfiguration(value){this.settings=value;}
    async setRemoteDescription(value){this.remote=value;}
    async createAnswer(){return sdp("answer");}
    async setLocalDescription(value){this.localDescription=value;}
    close(){this.connectionState="closed";}
  }
  let refuse=false;const events=[];
  const mesh=new InternetMesh({mode:"turn-fallback",Peer,emit:value=>events.push(value),relay:async()=>{
    if(refuse)throw Error("meter unavailable");
    return {expiresAt:Date.now()+300000,iceServers:[{urls:["turn:turn.cloudflare.com:3478?transport=udp"],
      username:"ephemeral",credential:"temporary-credential"}]};
  }});
  await mesh.configure("relay-peer",false);await mesh.configure("direct-peer",false);
  await mesh.fallback("relay-peer");refuse=true;await mesh.restart("relay-peer",2);
  assert.equal(mesh.peers.has("relay-peer"),false);assert.equal(mesh.peers.has("direct-peer"),true);
  assert.equal(events.filter(event=>event.type==="failed").length,1);mesh.close();
});
test("an old complete ICE state cannot skip the next asynchronous candidate gather",async()=>{
  class Peer extends EventTarget {
    connectionState="new";iceGatheringState="complete";
    createDataChannel(){return {readyState:"connecting",close(){}};}
    async createOffer(){return {type:"offer",sdp:"v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"};}
    async setLocalDescription(value){
      this.localDescription=value;
      setTimeout(()=>{
        this.localDescription=sdp("offer");this.iceGatheringState="complete";
        this.dispatchEvent(new Event("icegatheringstatechange"));
      },5);
    }
    close(){}
  }
  const events=[],mesh=new InternetMesh({mode:"stun-only",Peer,emit:value=>events.push(value),relay:()=>assert.fail("Unnecessary relay request")});
  await mesh.configure("peer",true);
  assert.equal(events.filter(event=>event.type==="signal").length,1);
  assert.equal(events.some(event=>event.type==="failed"),false);mesh.close();
});
test("repeated room snapshots cannot recreate a terminally failed peer or loop credential requests",async()=>{
  class Peer {
    connectionState="new";iceGatheringState="complete";
    createDataChannel(){return {readyState:"connecting",close(){}};}
    close(){}
  }
  let calls=0;const events=[];
  const mesh=new InternetMesh({mode:"turn-fallback",Peer,emit:value=>events.push(value),relay:async()=>{
    calls++;throw Error("Relay denied");
  }});
  await mesh.configure("peer",false);await mesh.fallback("peer");
  for(let i=0;i<10;i++){await mesh.configure("peer",false);await mesh.fallback("peer");}
  assert.equal(calls,1);assert.equal(events.filter(event=>event.type==="failed").length,1);mesh.close();
});
test("one peer's ICE gathering does not block another peer's signaling in a four-seat room",async()=>{
  const h=brokerFixture(),running=h.broker.begin(h.command);await until(()=>h.sockets.length===1);
  const room=h.room(1,false);room.members.push({id:"lan-other",slot:2,name:"Other",species:1,ready:false,pending:false,connected:true});
  h.sockets[0].receive(room);await running;await until(()=>h.meshes[0].peers.size===2);
  const started=[],release=new Map();
  h.meshes[0].signal=async id=>{started.push(id);await new Promise(resolve=>release.set(id,resolve));};
  h.sockets[0].receive({type:"signal",from:"lan-host",description:sdp("offer"),attempt:0,round:0});
  h.sockets[0].receive({type:"signal",from:"lan-other",description:sdp("answer"),attempt:0,round:0});
  await until(()=>started.length===2);
  assert.deepEqual(new Set(started),new Set(["lan-host","lan-other"]));
  release.get("lan-host")();release.get("lan-other")();await tick();await h.broker.close();
});
