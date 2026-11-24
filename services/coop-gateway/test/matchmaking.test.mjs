import test from "node:test";
import assert from "node:assert/strict";
import worker,{CoopControl,CoopRoom} from "../src/worker.mjs";
import {POLICY} from "../src/policy.mjs";

// Deterministic DO contract harness, not a substitute for deployed WebRTC tests.
class Storage {
  data=new Map();alarm=null;
  async get(key){return structuredClone(this.data.get(key));}
  async put(key,value){this.data.set(key,structuredClone(value));}
  async delete(key){return this.data.delete(key);}
  async deleteAll(){this.data.clear();}
  async list({prefix="",limit=Infinity}={}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)).slice(0,limit).map(([key,value])=>[key,structuredClone(value)]));}
  async getAlarm(){return this.alarm;}
  async setAlarm(at){this.alarm=at;}
  async deleteAlarm(){this.alarm=null;}
}
class Context {
  storage=new Storage();sockets=[];tail=Promise.resolve();gateRejections=0;
  blockConcurrencyWhile(fn){
    const result=this.tail.then(fn).catch(error=>{this.gateRejections++;throw error;});
    this.tail=result.catch(()=>{});return result;
  }
  getWebSockets(){return this.sockets;}
}
function harness(){
  const env={SERVICE_ENABLED:"true",PUBLIC_MATCHMAKING_ENABLED:"true",TURN_MODE:"disabled",IP_HASH_SECRET:"x".repeat(43),
    ACCEPTED_BUILD_IDS:JSON.stringify(["compatible-game-build-0001","compatible-game-build-0002"])};
  const contexts=new Map(),instances=new Map();
  const namespace=Type=>({idFromName:name=>name,get(name){
    const key=Type.name+name;
    if(!instances.has(key)){const ctx=new Context();contexts.set(key,ctx);instances.set(key,new Type(ctx,env));}
    return instances.get(key);
  }});
  env.CONTROL=namespace(CoopControl);env.ROOMS=namespace(CoopRoom);
  const call=async(path,value,token,options={})=>{
    const headers={"Content-Type":"application/json","CF-Connecting-IP":options.ip??"203.0.113.10",Origin:"pokebonk-standard://game"};
    if(token)headers.Authorization="Bearer "+token;
    const response=await worker.fetch(new Request("https://test.example"+path,{method:"POST",headers,body:JSON.stringify(value)}),env);
    return {status:response.status,value:await response.json()};
  };
  const player=(name="Trainer",extra={})=>({name,species:4,buildId:"compatible-game-build-0001",connectionMode:"stun-only",...extra});
  const create=async(extra={})=>{
    const result=await call("/v1/rooms",player("Host",extra));assert.equal(result.status,200,JSON.stringify(result.value));return result.value;
  };
  const socket=async lease=>{
    const room=env.ROOMS.get(lease.code),state=await room.ctx.storage.get("room");
    const sock={readyState:1,messages:[],attachment:{member:lease.member,generation:state.generation,window:Date.now(),count:0,signals:{}},
      send(text){this.messages.push(JSON.parse(text));},close(){this.readyState=3;},
      serializeAttachment(value){this.attachment=structuredClone(value);},deserializeAttachment(){return structuredClone(this.attachment);}};
    room.ctx.sockets.push(sock);
    const member=state.members.find(m=>m.id===lease.member);
    if(member.id===state.host){delete member.deadline;await room.persist(state);}
    return sock;
  };
  return {env,call,player,create,socket};
}

test("v2 room listings are read-only, sanitized and isolated from legacy rooms; public code joins reserve atomically",async()=>{
  const h=harness(),legacy=await h.create(),host=await h.create({protocolVersion:2}),
    hidden=await h.create({protocolVersion:2,discoverable:false}),wrongMode=await h.create({protocolVersion:2,connectionMode:"turn-fallback"});
  assert.equal(legacy.code.length,8);assert.equal(host.code.length,6);
  for(const lease of [legacy,host,hidden,wrongMode])await h.socket(lease);
  const query=h.player("Viewer",{protocolVersion:2});
  const listing=await h.call("/v1/matchmaking/rooms",query);
  assert.equal(listing.status,200);
  assert.deepEqual(listing.value,{rooms:[{code:host.code,name:"Host",players:1}]});
  assert.doesNotMatch(JSON.stringify(listing.value),/Token|Secret|Hash|generation|invitation|credential|address/);
  assert.equal((await h.env.ROOMS.get(host.code).ctx.storage.get("room")).members.length,1,"Listing reserved a seat.");
  const results=await Promise.all(Array.from({length:5},()=>h.call(`/v1/rooms/${host.code}/join`,query)));
  assert.equal(results.filter(value=>value.status===200).length,3);
  assert.equal((await h.call("/v1/matchmaking/rooms",query)).value.rooms.length,0);
  assert.notEqual((await h.call(`/v1/rooms/${hidden.code}/join`,query)).status,200);
  assert.equal((await h.call(`/v1/rooms/${legacy.code}/join`,query)).status,403);
  const secretJoin=await h.call(`/v1/rooms/${hidden.code}/join`,{...query,joinSecret:hidden.joinSecret});
  assert.equal(secretJoin.status,200,"A private room still requires its secret.");
});
test("six-character code lookups and room lists retain the shared IP rate limit and protocol validation",async()=>{
  const h=harness(),host=await h.create({protocolVersion:2});await h.socket(host);
  const query=h.player("Viewer",{protocolVersion:2});
  assert.equal((await h.call("/v1/matchmaking/rooms",{...query,protocolVersion:3})).status,400);
  for(let i=0;i<20;i++)assert.equal((await h.call("/v1/matchmaking/rooms",query)).status,200);
  assert.equal((await h.call("/v1/matchmaking/rooms",query)).status,429);
  assert.equal((await h.call(`/v1/rooms/${host.code}/join`,query)).status,429);
});

test("Internet find only reserves compatible, discoverable, listening, unexpired lobbies",async()=>{
  const h=harness(),hidden=await h.create({discoverable:false}),otherBuild=await h.create({buildId:"compatible-game-build-0002"}),
    otherMode=await h.create({connectionMode:"turn-fallback"}),open=await h.create();
  for(const lease of [hidden,otherBuild,otherMode,open])await h.socket(lease);
  const directory=h.env.CONTROL.get("account");
  const request=value=>directory.fetch(new Request("https://internal/matchmaking",{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify({client:"a".repeat(64),exclude:[],...h.player(),...value})}));
  assert.deepEqual((await (await request({})).json()).rooms,[open.code]);
  assert.deepEqual((await (await request({exclude:[open.code]})).json()).rooms,[]);
  const found=await h.call("/v1/matchmaking/find",h.player("Guest"));
  assert.equal(found.status,200);assert.equal(found.value.code,open.code);assert.equal(found.value.pending,true);
  const room=h.env.ROOMS.get(open.code),state=await room.ctx.storage.get("room");
  state.phase="playing";await room.ctx.storage.put("room",state);
  assert.equal((await h.call("/v1/matchmaking/find",h.player())).value.error,"no_matching_room");
  state.phase="lobby";state.expiresAt=Date.now()-1;await room.ctx.storage.put("room",state);
  assert.equal((await h.call("/v1/matchmaking/find",h.player())).status,404);
  assert.equal(await directory.ctx.storage.get("room:"+open.code),undefined);
});

test("concurrent searches count leased seats, release cancellation, and reuse slots in roster order",async()=>{
  const h=harness(),host=await h.create();await h.socket(host);
  const results=await Promise.all(Array.from({length:7},(_,i)=>h.call("/v1/matchmaking/find",h.player("Guest "+i))));
  const joined=results.filter(result=>result.status===200).map(result=>result.value);
  assert.equal(joined.length,3);assert.equal(results.filter(result=>result.status===404).length,4);
  const room=h.env.ROOMS.get(host.code);
  const before=await room.ctx.storage.get("room");assert.equal(before.members.length,4);
  const vacated=before.members.find(member=>member.id===joined[0].member).slot;
  await h.call(`/v1/rooms/${host.code}/leave`,{},joined[0].sessionToken);
  const replacement=await h.call("/v1/matchmaking/find",h.player("Replacement"));assert.equal(replacement.status,200);
  const state=await room.ctx.storage.get("room");
  // Concurrent edge requests may arrive in any order after IP-key hashing.
  // Assert reuse of the actual vacated slot, not the first Promise's slot.
  assert.deepEqual(state.members.map(m=>m.slot),[0,1,2,3]);assert.equal(state.members.find(member=>member.slot===vacated).id,replacement.value.member);
  assert.equal(state.members.some(m=>m.id===joined[0].member),false);
  const pending=state.members.find(m=>m.id===replacement.value.member);pending.deadline=Date.now()-1;
  await room.ctx.storage.put("room",state);room.ctx.storage.alarm=null;await room.alarm();
  assert.equal((await room.ctx.storage.get("room")).members.some(m=>m.id===replacement.value.member),false);
  assert.equal(room.ctx.gateRejections,0,"A full/expired/cancelled seat must not reset the room Durable Object.");
  assert.equal(h.env.CONTROL.get("account").ctx.gateRejections,0);
});

test("a found seat stays connecting until both peers confirm links; start waits for durable prepared barrier",async()=>{
  const h=harness(),host=await h.create(),hs=await h.socket(host);
  const guest=(await h.call("/v1/matchmaking/find",h.player("Guest"))).value,gs=await h.socket(guest),room=h.env.ROOMS.get(host.code);
  const send=(socket,value)=>room.webSocketMessage(socket,JSON.stringify(value));
  await send(hs,{type:"link",peer:guest.member,open:true});
  assert.equal((await room.ctx.storage.get("room")).members[1].pending,true);
  await send(gs,{type:"link",peer:host.member,open:true});
  let state=await room.ctx.storage.get("room");assert.equal(state.members[1].pending,false);assert.equal(room.snapshot(state).linked,true);
  assert.doesNotMatch(JSON.stringify(room.snapshot(state)),/sessionToken|tokenHash|joinSecret|joinHash|generation|sdp/);
  await send(gs,{type:"ready",ready:true});await send(hs,{type:"start"});
  state=await room.ctx.storage.get("room");assert.equal(state.phase,"preparing");assert.ok(state.match.party.startsWith("lan-"));
  await send(hs,{type:"prepared",party:state.match.party});assert.equal((await room.ctx.storage.get("room")).phase,"preparing");
  await send(gs,{type:"prepared",party:state.match.party});assert.equal((await room.ctx.storage.get("room")).phase,"playing");
});

test("host departure unregisters the room; bad or stalled guests release their seat",async()=>{
  const h=harness(),host=await h.create();await h.socket(host);
  const guest=(await h.call("/v1/matchmaking/find",h.player("Guest"))).value,gs=await h.socket(guest),room=h.env.ROOMS.get(host.code);
  await room.webSocketMessage(gs,JSON.stringify({type:"signal",to:host.member,attempt:1,description:{type:"offer",sdp:"v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n"}}));
  assert.equal(gs.readyState,3);assert.equal((await room.ctx.storage.get("room")).members.length,1);
  assert.equal((await h.call(`/v1/rooms/${host.code}/turn`,{directAttemptFailed:true,peer:guest.member},host.sessionToken)).status,403);
  await h.call(`/v1/rooms/${host.code}/leave`,{},host.sessionToken);
  assert.equal(await room.ctx.storage.get("room"),undefined);
  assert.equal(await h.env.CONTROL.get("account").ctx.storage.get("room:"+host.code),undefined);
  const again=await h.create();await h.socket(again);
  assert.equal((await h.call("/v1/matchmaking/find",h.player())).value.code,again.code);
});

test("unlistening hosts, wrong invitations, disabled public access and wrong builds cannot match",async()=>{
  const h=harness(),host=await h.create();
  assert.equal((await h.call("/v1/matchmaking/find",h.player())).status,404);
  await h.socket(host);
  assert.equal((await h.call(`/v1/rooms/${host.code}/join`,h.player("Guest",{joinSecret:"x".repeat(43)}))).status,403);
  assert.equal(h.env.ROOMS.get(host.code).ctx.gateRejections,0,"A bad invitation must not reset the host's room.");
  assert.equal((await h.call("/v1/matchmaking/find",h.player("Guest",{buildId:"unknown-game-build"}))).status,409);
  h.env.PUBLIC_MATCHMAKING_ENABLED="false";
  assert.equal((await h.call("/v1/matchmaking/find",h.player())).status,401);
  h.env.SERVICE_ENABLED="false";
  assert.equal((await h.call("/v1/matchmaking/find",h.player())).status,503);
});

test("directory cleanup keeps the earliest alarm and removes expired search rate keys",async()=>{
  const h=harness(),control=h.env.CONTROL.get("account"),now=Date.now();
  await control.ctx.storage.setAlarm(now+1000);
  await h.call("/v1/matchmaking/find",h.player());
  assert.equal(await control.ctx.storage.getAlarm(),now+1000);
  await control.ctx.storage.put("find-rate:expired",{count:1,until:now-1});
  // Empty directory + expired rates must not become an endless alarm loop.
  for(const key of control.ctx.storage.data.keys())if(key.startsWith("find-rate:"))await control.ctx.storage.put(key,{until:now-1});
  control.ctx.storage.alarm=null;await control.alarm();
  assert.equal((await control.ctx.storage.list({prefix:"find-rate:"})).size,0);
  assert.equal(await control.ctx.storage.getAlarm(),null);
});
test("room creation has a bounded household-friendly rate without resetting the directory on denial",async()=>{
  const h=harness(),control=h.env.CONTROL.get("account");
  const internal=(route,value)=>control.fetch(new Request("https://internal"+route,{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(value)}));
  const value={client:"c".repeat(64),generation:"a".repeat(22),buildId:"compatible-game-build-0001",connectionMode:"stun-only",discoverable:true};
  for(let i=0;i<POLICY.maxRoomCreatesPerHour;i++){
    const code="AAAAAAA"+String.fromCharCode(65+i);
    assert.equal((await internal("/register-room",{...value,code})).status,200);
    await internal("/unregister-room",{code,generation:value.generation});
  }
  assert.equal((await internal("/register-room",{...value,code:"ZZZZZZZZ"})).status,429);
  assert.equal(control.ctx.gateRejections,0);
});
test("relay access requires the exact active room session and peer, rejects extra parameters, and is rate limited",async()=>{
  const h=harness(),host=await h.create({connectionMode:"turn-fallback"});
  const guest=(await h.call(`/v1/rooms/${host.code}/join`,h.player("Guest",{
    connectionMode:"turn-fallback",joinSecret:host.joinSecret}))).value;
  const path=`/v1/rooms/${host.code}/turn`,data={peer:guest.member,directAttemptFailed:true};
  assert.equal((await h.call(path,data)).status,401);
  assert.equal((await h.call(path,data,host.sessionToken)).value.error,"active_room_required");
  await h.socket(host);
  assert.equal((await h.call(path,data,host.sessionToken)).value.error,"active_peer_required");
  await h.socket(guest);
  const stranger=await h.create({connectionMode:"turn-fallback"});
  assert.equal((await h.call(path,data,stranger.sessionToken)).status,401);
  assert.equal((await h.call(path,{...data,url:"https://example.invalid"},host.sessionToken)).status,400);
  const control=h.env.CONTROL.get("account"),original=control.fetch.bind(control);let issued=0;
  control.fetch=async request=>{
    if(new URL(request.url).pathname!=="/issue")return original(request);
    const value=await request.json();assert.equal(value.room,host.code);assert.equal(value.member,host.member);
    assert.match(value.generation,/^[A-Za-z0-9_-]{22}$/);issued++;
    return Response.json({expiresAt:Date.now()+300000,iceServers:[{urls:["turn:turn.cloudflare.com:3478?transport=udp"],
      username:"ephemeral-fixture",credential:"temporary-fixture-only"}]});
  };
  for(let i=0;i<POLICY.maxRelayRequestsPerMinute;i++)assert.equal((await h.call(path,data,host.sessionToken)).status,200);
  assert.equal((await h.call(path,data,host.sessionToken)).value.error,"relay_request_rate_limited");
  assert.equal(issued,POLICY.maxRelayRequestsPerMinute);
  await h.call(`/v1/rooms/${host.code}/leave`,{},host.sessionToken);
  assert.equal((await h.call(path,data,guest.sessionToken)).status,410);
  assert.equal(h.env.ROOMS.get(host.code).ctx.gateRejections,0);
});
