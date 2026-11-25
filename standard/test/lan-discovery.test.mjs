import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {DISCOVERY_GROUP,DISCOVERY_PORT,DISCOVERY_MAGIC,discoveryQuery,discoveryRoom,advertisedRoom} from "../common/lan-discovery.mjs";
import {LanDiscovery} from "../desktop/lan-discovery.mjs";
import {NativeLan} from "../desktop/lan.mjs";
import {lanRoomCode} from "../common/coop-mode.mjs";
const identity="PB-LAN2|standard|1.1.0|build|"+"a".repeat(64),nonce="ab".repeat(16);
const network=address=>({label:"Wi-Fi",address,netmask:"255.255.255.0"});
const host=()=>({role:"host",phase:"hosting",me:"lan-host",invitation:"192.168.1.10:42000#"+"cd".repeat(16),
  members:[{id:"lan-host",name:"Host",slot:0,species:4,ready:true}]});
const answer=()=>({magic:DISCOVERY_MAGIC,op:"room",identity,nonce,...advertisedRoom(host())});
const check=value=>discoveryRoom(value,{identity,nonce,remote:"192.168.1.10",interfaces:[network("192.168.1.20")]});
test("discovery accepts only the exact game identity, current nonce and responding host's private subnet address",()=>{
  assert.ok(check(answer()));
  assert.ok(discoveryQuery({magic:DISCOVERY_MAGIC,op:"find",identity,nonce},identity));
  for(const values of [{identity:"wrong-build"},{nonce:"00".repeat(16)},{op:"find"},{magic:"wrong"},
    {count:0},{count:4},{count:1.5},{name:"a".repeat(25)},{name:"bad\nname"},{id:"not-a-room"},
    {invitation:"8.8.8.8:42000#"+"cd".repeat(16)},{invitation:"192.168.1.11:42000#"+"cd".repeat(16)}]){
    assert.equal(check({...answer(),...values}),null);
  }
  assert.equal(discoveryRoom(answer(),{identity,nonce,remote:"192.168.1.10",interfaces:[network("192.168.2.20")]}),null);
});
test("full, running, closed and non-host rooms are not advertised",()=>{
  assert.ok(advertisedRoom(host()));
  for(const phase of ["preparing","playing","closed","error"])assert.equal(advertisedRoom({...host(),phase}),null);
  assert.equal(advertisedRoom({...host(),role:"client"}),null);
  assert.equal(advertisedRoom({...host(),members:Array(4).fill(host().members[0])}),null);
});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function bus(){
  const sockets=new Set(),sent=[];let port=50000;
  class Socket extends EventEmitter{
    constructor(ip){super();this.ip=ip;sockets.add(this);}
    bind(value,_address,ready){this.port=value||port++;queueMicrotask(ready);}
    setMulticastTTL(value){assert.equal(value,1);}
    setMulticastInterface(ip){assert.equal(ip,this.ip);}
    addMembership(group,ip){assert.equal(group,DISCOVERY_GROUP);assert.equal(ip,this.ip);this.member=true;}
    send(bytes,to,address,done){
      sent.push({from:this.ip,to,address,bytes:Buffer.from(bytes)});
      for(const socket of sockets)if(socket.port===to&&(address===DISCOVERY_GROUP?socket.member:socket.ip===address)){
        queueMicrotask(()=>{if(!socket.closed)socket.emit("message",Buffer.from(bytes),{address:this.ip,port:this.port});});
      }
      queueMicrotask(()=>done?.());
    }
    close(){this.closed=true;sockets.delete(this);}
  }
  return {sent,sockets,create:ip=>()=>new Socket(ip)};
}
test("native discovery multicasts one bounded query, receives a nonce-matched room and closes on cancel",async()=>{
  const b=bus(),progress=[];
  const advertiser=new LanDiscovery({identity,interfaces:()=>[network("192.168.1.10")],socket:b.create("192.168.1.10")});
  const finder=new LanDiscovery({identity,interfaces:()=>[network("192.168.1.20")],socket:b.create("192.168.1.20"),progress:n=>progress.push(n)});
  try{
    advertiser.advertise(host());await tick();
    const pending=finder.find();await tick();await tick();
    finder.cancel();const result=await pending;
    assert.equal(result.cancelled,true);assert.equal(result.rooms.length,1);
    assert.equal(result.rooms[0].invitation,host().invitation);assert.deepEqual(progress,[1]);
    const query=b.sent.find(p=>p.address===DISCOVERY_GROUP);
    assert.equal(query.to,DISCOVERY_PORT);assert.ok(query.bytes.length<=1400);
    assert.equal(b.sent.filter(p=>p.address===DISCOVERY_GROUP).length,1,"No subnet address sweep.");
    advertiser.advertise({...host(),phase:"playing"});assert.equal(b.sockets.size,0);
  }finally{advertiser.close();finder.close();}
});
test("code-only LAN hosts answer an exact code lookup but never random discovery or room browsing",async()=>{
  const b=bus(),advertiser=new LanDiscovery({identity,interfaces:()=>[network("192.168.1.10")],socket:b.create("192.168.1.10")}),
    finder=new LanDiscovery({identity,interfaces:()=>[network("192.168.1.20")],socket:b.create("192.168.1.20")});
  try{
    advertiser.advertise({...host(),seats:{discoverable:false,capacity:2}});await tick();
    let pending=finder.find();await tick();await tick();finder.cancel();
    assert.equal((await pending).rooms.length,0);
    pending=finder.find({code:lanRoomCode(host().me)});await tick();await tick();finder.cancel();
    const result=await pending;assert.equal(result.rooms.length,1);assert.equal(result.rooms[0].capacity,2);
    assert.equal(result.rooms[0].invitation,host().invitation);
    assert.equal(b.sent.filter(packet=>packet.address===DISCOVERY_GROUP).length,2);
  }finally{advertiser.close();finder.close();}
});
function controller({profile={league:[4],name:"Player",unfinished:false},result={rooms:[],cancelled:false}}={}){
  const calls=[],events=[];
  const discovery={find:async()=>{calls.push("find");return result;},cancel:()=>calls.push("cancel"),advertise:()=>{}};
  const native=new NativeLan({identity,interfaces:()=>[network("192.168.1.20")],profile:async()=>profile,
    emit:event=>events.push(event),broker:async()=>{},discovery});
  const command=native.command.bind(native);
  native.command=async(action,data)=>action==="join"?calls.push({action,data}):command(action,data);
  return {native,calls,events,discovery};
}
test("Find automatically joins an eligible discovered room using the owned default, without hosting another",async()=>{
  const c=controller({result:{rooms:[advertisedRoom(host())],cancelled:false}});
  await c.native.command("find",{species:4});
  assert.deepEqual(c.calls,["find",{action:"join",data:{species:4,invitation:host().invitation}}]);
  assert.equal(c.events[0].value.discovery.status,"searching");
  assert.equal(c.events.at(-1).value.discovery.status,"joining");
});
test("no room or discovery error leaves manual hosting and gameplay available",async()=>{
  const c=controller();await c.native.command("find",{species:4});
  assert.equal(c.native.state().discovery.status,"empty");assert.equal(c.native.state().phase,"idle");
  c.discovery.find=async()=>{throw Error("Network denied");};
  await c.native.command("find",{species:4});assert.equal(c.native.state().discovery.status,"error");
  assert.equal(c.calls.some(c=>typeof c==="object"&&c.action==="join"),false);
});
test("preserved runs and unowned picks cannot start discovery",async()=>{
  for(const profile of [{league:[4],unfinished:true},{league:[7],unfinished:false}]){
    const c=controller({profile});await c.native.command("find",{species:4});
    assert.equal(c.calls.includes("find"),false);assert.equal(c.native.state().discovery.status,"error");
  }
});
test("cancel/back invalidates an in-flight result so it cannot autojoin later",async()=>{
  const c=controller();let resolve;
  c.discovery.find=()=>new Promise(r=>{resolve=r;});
  const pending=c.native.command("find",{species:4});await tick();
  c.native.cancelFind();resolve({rooms:[advertisedRoom(host())],cancelled:false});await pending;
  assert.equal(c.native.state().discovery.status,"idle");
  assert.equal(c.calls.some(c=>typeof c==="object"),false);
});
