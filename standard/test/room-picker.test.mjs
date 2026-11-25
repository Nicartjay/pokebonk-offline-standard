import test from "node:test";
import assert from "node:assert/strict";
import {coopRoomCodeLength,isCoopRoomCode,lanRoomCode,roomListing} from "../common/coop-mode.mjs";
import {NativeLan} from "../desktop/lan.mjs";
import {InternetBroker} from "../runtime/internet-broker.js";
import {installLanUI} from "../runtime/lan-ui.js";

const network={label:"Wi-Fi",address:"192.168.1.20",netmask:"255.255.255.0"};
const room=(id="lan-host")=>({id,name:"Host",count:1,invitation:"192.168.1.10:42000#"+"a".repeat(32)});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test("public code lengths and Java-compatible LAN vectors do not reveal pairing-key fragments",()=>{
  assert.equal(coopRoomCodeLength("lan"),4);
  for(const mode of ["stun-only","turn-fallback"]){assert.equal(coopRoomCodeLength(mode),6);assert.ok(isCoopRoomCode("BONK23",mode));assert.equal(isCoopRoomCode("BONK",mode),false);}
  assert.ok(isCoopRoomCode("BONK","lan"));assert.equal(isCoopRoomCode("BONK23","lan"),false);
  for(const [id,code] of [["lan-host","O85T"],["lan-a1b2c3d4-1111-4444-8888-111111111111","8GXN"],
    ["lan-00000000-0000-4000-8000-000000000000","OCIN"]])assert.equal(lanRoomCode(id),code);
  assert.throws(()=>lanRoomCode("not-a-host"));
});
test("room listings are bounded allowlists, not invitations, addresses or credentials",()=>{
  const clean=roomListing({status:"ready",rooms:[{code:"BONK23",name:"Host",players:2,
    invitation:"private",sessionToken:"private",iceServers:[{credential:"private"}],address:"192.168.1.10"}]},"stun-only");
  assert.deepEqual(clean,{status:"ready",rooms:[{code:"BONK23",name:"Host",players:2}]});
  for(const value of [
    {status:"ready",rooms:[{code:"BONK",name:"Host",players:1}]},
    {status:"ready",rooms:[{code:"BONK23",name:"bad\nname",players:1}]},
    {status:"ready",rooms:[{code:"BONK23",name:"Host",players:4}]},
    {status:"ready",rooms:Array(9).fill({code:"BONK23",name:"Host",players:1})},
    {status:"ready",rooms:Array(2).fill({code:"BONK23",name:"Host",players:1})},
  ])assert.throws(()=>roomListing(value,"stun-only"));
});
function localFixture(rooms=[room()]){
  const sent=[],events=[],joins=[];
  const discovery={cancel(){},advertise(){},find:async()=>({rooms,cancelled:false})};
  const native=new NativeLan({identity:"fixture",interfaces:()=>[network],profile:async()=>({league:[4],name:"Trainer",unfinished:false}),
    broker:value=>sent.push(value),emit:value=>events.push(value),discovery});
  const command=native.command.bind(native);
  native.command=async(action,data)=>{
    if(action==="join"&&data.invitation.includes("#")){joins.push(data);return;}
    return command(action,data);
  };
  return {native,discovery,sent,events,joins};
}
test("LAN browsing reserves no seat, and four-character joining resolves only a discovered private host",async()=>{
  const f=localFixture();
  await f.native.command("browse",{species:4,connectionMode:"lan"});
  assert.deepEqual(f.native.state().roomListing,{status:"ready",rooms:[{code:"O85T",name:"Host",players:1,capacity:4}]});
  assert.equal(f.joins.length,0);assert.equal(f.sent.length,0);
  assert.equal(JSON.stringify(f.events).includes("a".repeat(32)),false);
  await f.native.command("join",{species:4,connectionMode:"lan",invitation:"O85T"});
  assert.equal(f.joins.length,1);assert.equal(f.joins[0].invitation,room().invitation);
  f.native.value={phase:"hosting",members:[],linked:false,invitation:room().invitation,code:"O85T"};
  assert.equal(f.native.state().invitation,undefined);
});
test("ambiguous LAN short codes are omitted from lists and cannot select the wrong host",async()=>{
  const ids=["lan-collision-7335","lan-collision-8240"];
  assert.equal(lanRoomCode(ids[0]),"9XPQ");assert.equal(lanRoomCode(ids[1]),"9XPQ");
  const f=localFixture(ids.map(room));
  await f.native.command("browse",{species:4});
  assert.equal(f.native.state().roomListing.status,"empty");
  await f.native.command("join",{species:4,invitation:"9XPQ"});
  assert.equal(f.joins.length,0);assert.match(f.native.state().error,/More than one/);
});
test("closing LAN browsing invalidates late results and never starts a connection",async()=>{
  const f=localFixture();let resolve;
  f.discovery.find=()=>new Promise(done=>{resolve=done;});
  const pending=f.native.command("browse",{species:4});await tick();
  f.native.cancelFind();resolve({rooms:[room()],cancelled:false});await pending;
  assert.equal(f.native.state().roomListing.status,"idle");assert.equal(f.joins.length,0);
});
test("Internet browsing uses one metadata request and no sockets, ICE or TURN credentials",async()=>{
  for(const mode of ["stun-only","turn-fallback"]){
    const requests=[],events=[];
    const broker=new InternetBroker(value=>events.push(value),{
      request:async(url,options)=>{requests.push({url,options});return Response.json({rooms:[{code:"BONK23",name:"Host",players:1}]});},
      Socket:class{constructor(){assert.fail("Browsing opened a socket.");}},
      Mesh:class{constructor(){assert.fail("Browsing created a peer mesh.");}},
    });
    await broker.begin({type:"browse",gateway:"https://fixture.example.workers.dev",identity:"fixture",epoch:1,player:{name:"Guest"},data:{species:4,connectionMode:mode}});
    assert.equal(events.at(-1).value.roomListing.status,"ready");assert.equal(requests.length,1);
    assert.ok(requests[0].url.endsWith("/v1/matchmaking/rooms"));assert.equal(JSON.parse(requests[0].options.body).protocolVersion,3);
    assert.equal(requests[0].options.headers.Authorization,undefined);await broker.close();assert.equal(requests.length,1);
  }
});
test("late Internet browsing results cannot reopen a dismissed picker",async()=>{
  let resolve;const events=[];
  const broker=new InternetBroker(value=>events.push(value),{request:()=>new Promise(done=>{resolve=done;})});
  const pending=broker.begin({type:"browse",gateway:"https://fixture.example.workers.dev",identity:"fixture",epoch:1,player:{name:"Guest"},data:{connectionMode:"stun-only"}});
  await tick();await broker.close();const count=events.length;
  resolve(Response.json({rooms:[{code:"BONK23",name:"Host",players:1}]}));await pending;
  assert.equal(events.length,count);
});
test("Cancel, Close and a second native Back retain the room; Confirm leaves exactly once",()=>{
  const original=globalThis.document;const document=new EventTarget();document.querySelector=()=>({});
  globalThis.document=document;
  const prompts=[];
  const el=(tag,text,cls)=>({tag,text,cls,children:[],classList:{add(){}},append(...items){this.children.push(...items);},focus(){this.focused=true;}});
  const button=(text,fn,cls)=>Object.assign(el("button",text,cls),{click:fn});
  const modal=(_title,onClose)=>{
    const prompt={panel:el("section"),overlay:{isConnected:true},close(){this.overlay.isConnected=false;onClose?.();}};
    prompts.push(prompt);return prompt;
  };
  try{
    const api={};installLanUI(api,{}, {el,button,modal});
    let left=0;const room={open:true,isHost:true};
    const leave=()=>{left++;room.open=false;};
    api.bindLanBack(room,leave);
    assert.equal(api.lanBack(),true);let actions=prompts.at(-1).panel.children[0].children.find(n=>n?.cls?.includes("offline-lan-leave-actions"));
    assert.equal(actions.children[0].focused,true);actions.children[0].click();assert.equal(left,0);
    api.lanBack();api.lanBack();assert.equal(left,0);assert.equal(prompts.at(-1).overlay.isConnected,false);
    api.lanBack();prompts.at(-1).close();assert.equal(left,0);
    api.lanBack();actions=prompts.at(-1).panel.children[0].children.find(n=>n?.cls?.includes("offline-lan-leave-actions"));
    actions.children[1].click();actions.children[1].click();assert.equal(left,1);assert.equal(api.lanBack(),false);
  }finally{globalThis.document=original;}
});
