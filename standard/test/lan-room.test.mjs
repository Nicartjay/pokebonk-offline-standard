import test from "node:test";
import assert from "node:assert/strict";
import {readFile, readdir} from "node:fs/promises";
import {parse} from "acorn";
import {patchLanRoom,patchLanLanding} from "../adapters/lan-room.mjs";
import {LanLobby} from "../runtime/lan-lobby.js";
import {ownedLanSpecies,installLanUI} from "../runtime/lan-ui.js";
import {LocalRoom} from "../runtime/lan.js";
import {nodesOf, maybeName, literal, one} from "../../scripts/source.ts";
const directory = new URL("../../vendor/pokebonk-standard-0.10.26/game/assets/", import.meta.url);
const name = one((await readdir(directory)).filter(name => /^menus-.*\.js$/.test(name)), "captured menus module");
const source = await readFile(new URL(name, directory), "utf8");
const patched = patchLanRoom(source);
const tree = text => parse(text, {ecmaVersion: "latest", sourceType: "module"});
const methodCalls = text => nodesOf(tree(text), "CallExpression").map(node => maybeName(node.callee.property));

test("adapts the original room without replacing its screen, trainer stages or sprite renderer", () => {
  const original = source.slice(patched.change.start, patched.change.end), result = patched.change.text;
  assert.ok(original.startsWith("function " + patched.entry + "("));
  assert.ok(result.startsWith("function " + patched.entry + "("));
  const classes = new Set(nodesOf(tree(result), "TemplateLiteral").map(literal));
  for (const cls of ["cp-room", "cp-dest-art", "cp-slots", "ls-show cp-slot-stage",
    "cp-slot-info", "cp-slot-tr", "cp-chat-list scroll", "cp-bar", "cp-ticket"]) assert.ok(classes.has(cls), cls);
  assert.ok(result.includes('"cp lobby offline-lan-room"'));
  const sprite = one(nodesOf(tree(original), "CallExpression", node => node.arguments.some(arg =>
    arg.type === "ObjectExpression" && arg.properties.some(p =>
      maybeName(p.key) === "height" && literal(p.value) === 132))), "original animated card renderer");
  assert.ok(result.includes(original.slice(sprite.start, sprite.end)), "actual upstream sprite helper call is preserved verbatim");
  assert.ok(result.includes("globalThis.PokeBonkOfflineUI.lanInvitation("));
  assert.ok(result.includes("globalThis.PokeBonkOfflineUI.lanInviteHelp("));
});
test("removes server-only room services and destructive solo-save clearing", () => {
  const calls = methodCalls(patched.change.text);
  for (const method of ["friends", "clanMates", "coopStanding", "coopSeeking", "quick", "kick",
    "voteOut", "retryLink", "clearSavedForCoop", "startRun", "share"]) {
    assert.ok(!calls.includes(method), "must not call " + method);
  }
  assert.ok(patched.change.text.includes("disabled:true"));
  assert.ok(patched.change.text.includes('.filter(mode=>mode==="classic")'));
  assert.ok(patched.change.text.includes("/4"));
  assert.ok(!patched.change.text.includes("/2"));
  assert.ok(patched.change.text.includes("Local co-op · LAN"));
  assert.ok(patched.change.text.includes("PREVIEW · NOT CONNECTED"));
  assert.ok(patched.change.text.includes("disabled:t.preview"));
});
test("fails closed if the upstream room contract is absent", () => {
  assert.throws(() => patchLanRoom("function unrelated(){}"), /original co-op room screen/);
});
test("Lab browsing keeps the upstream return callback and restores title without rewriting the room URL",()=>{
  const original=source.slice(patched.cleanupChange.start,patched.cleanupChange.end);
  const cleanup=patched.cleanupChange.text;
  assert.match(original,/document\.title/);
  assert.match(cleanup,/document\.title/);
  assert.equal(nodesOf(tree(cleanup),"CallExpression").length,0,"Offline screen cleanup must not call the online URL reset.");
  const lab=one(nodesOf(tree(patched.change.text),"CallExpression",node=>node.arguments[1]?.properties?.some(p=>
    maybeName(p.key)==="class"&&literal(p.value)==="btn small ghost cp-lab")),"original in-room Lab control");
  const handler=one(lab.arguments[1].properties.filter(p=>maybeName(p.key)==="onclick"),"room Lab navigation").value;
  assert.equal(nodesOf(handler,"CallExpression",call=>maybeName(call.callee.property)==="leave").length,0);
  assert.ok(nodesOf(handler,"ArrowFunctionExpression",fn=>fn.params.length===1&&fn.body.type==="CallExpression"&&
    fn.body.arguments.length===3&&literal(fn.body.arguments[1])==="lab"&&
    maybeName(fn.body.arguments[2])===maybeName(fn.params[0])).length,"Lab must retain the callback back to this room.");
});
test("LAN selection falls back to an owned starter when lastSpecies is not in the local League",()=>{
  const profile=Object.freeze({league:Object.freeze([7,155]),lastSpecies:4});
  assert.equal(ownedLanSpecies(profile),7);
  assert.equal(ownedLanSpecies(profile,155),155);
  assert.equal(ownedLanSpecies(profile,1),7);
  assert.equal(ownedLanSpecies({league:[],lastSpecies:4}),0);
});
test("full four-player room facade routes packets by peer and reports accepted snapshot writes",async()=>{
  const members=[0,1,2,3].map(slot=>({id:"lan-peer"+slot,slot,species:4,name:"Trainer "+slot}));
  const sent=[],room=new LocalRoom({me:members[0].id,members,match:{party:"lan-run"}},(channel,data)=>{sent.push({channel,data});return true;});
  assert.equal(room.mesh.sendSnap(members[1].id,new Uint8Array([1,2,3]).buffer),true);
  assert.equal(sent[0].data.to,members[1].id);assert.equal(sent[0].data.payload,"AQID");
  room.mesh.broadcast({t:"hello"});assert.equal(sent.filter(s=>s.channel==="ctl").length,3);
  const received=[];
  room.frame({peer:members[2].id,channel:"ctl",data:{t:"early"}});
  room.ev={ctl:(id,data)=>received.push({id,data})};
  assert.equal(received.length,0);await Promise.resolve();assert.equal(received[0].id,members[2].id);
  room.peerClosed(members[1].id);
  assert.equal(room.mesh.sendSnap(members[1].id,new ArrayBuffer(1)),false);
  assert.equal(room.linkState(members[1].id),"closed");
});
test("adapted original landing retains the fixed native Host/Join attributes at callback edit boundaries",()=>{
  const landing=patchLanLanding(source).change.text;
  const anchors=nodesOf(tree(landing),"CallExpression",node=>literal(node.arguments[0])==="a");
  for(const action of ["host","join","find"]){
    const anchor=one(anchors.filter(node=>node.arguments[1]?.properties?.some(p=>
      literal(p.key)==="data-standard-lan-action"&&literal(p.value)===action)),action+" native anchor");
    assert.ok(anchor.arguments[1].properties.some(p=>maybeName(p.key)==="href"&&literal(p.value)==="/__native__/lan/"+action));
  }
  assert.ok(landing.includes("globalThis.PokeBonkOfflineUI.lanHomeTools"));
  assert.ok(!methodCalls(landing).includes("coopSeeking"));
  assert.ok(!methodCalls(landing).includes("coopBoard"));
  const left=one(nodesOf(tree(landing),"CallExpression",node=>node.arguments[1]?.properties?.some(p=>
    maybeName(p.key)==="class"&&literal(p.value)==="cp-left")),"standalone network column");
  assert.equal(left.arguments.length,3,"How to play is a sibling, not stacked below Create/Join.");
  const middle=one(nodesOf(tree(landing),"CallExpression",node=>node.arguments[1]?.properties?.some(p=>
    maybeName(p.key)==="class"&&literal(p.value)==="offline-lan-middle")),"standalone finder/guide column");
  assert.equal(middle.arguments.length,4,"Find a match and How to play are separate cards in the middle column.");
  const help=one(nodesOf(tree(landing),"CallExpression",node=>maybeName(node.callee.property)==="lanConnectionHelp"),"blue help column");
  assert.equal(help.arguments.length,1,"Find a match must not be inside the help section.");
  assert.ok(landing.includes('globalThis.PokeBonkOfflineUI.cancelLanSearch()'));
  assert.ok(landing.includes('"Find a match"'));
  assert.ok(landing.includes('globalThis.PokeBonkOfflineUI.lanFindStatus()'));
});

const session = () => ({phase: "lobby", role: "host", me: "lan-me", linked: true,
  invitation: "192.168.1.10:48123#abcdef0123456789abcdef0123456789",
  members: [{id: "lan-me", slot: 0, species: 155, ready: true, name: "Host"},
    {id: "lan-peer", slot: 1, species: 4, ready: false, name: "Friend"}]});
test("native state is mapped to the original four-seat room with no account service", async () => {
  const sent = [], input = session();
  const lobby = new LanLobby(input, (...message) => sent.push(message));
  assert.equal(lobby.isPublic, false);
  assert.equal(lobby.isHost, true);
  assert.equal(lobby.code, "ABCD");
  assert.equal(lobby.room.members.length, 2);
  assert.equal(lobby.room.want, 4);
  assert.equal(lobby.room.members[0].host, true);
  assert.equal(lobby.room.biome, "forest");
  assert.equal(lobby.room.tier, 0);
  assert.equal(lobby.linkState("lan-peer"), "open");
  lobby.room.members[1].name = "UI change";
  assert.equal(input.members[1].name, "Friend");
  await lobby.setPick(4); await lobby.start(); await lobby.say("Hi!");
  assert.deepEqual(sent, [["room-pick", 4], ["room-start"], ["room-chat", "Hi!"]]);
  await assert.rejects(lobby.setSettings("forest", 1), /Classic/);
});
test("updates the existing original screen and emits only newly received chat", () => {
  const input = session(), lobby = new LanLobby(input, () => {}), received = [];
  let changes = 0, closed;
  lobby.ev = {change: () => changes++, chat: messages => received.push(messages), closed: reason => { closed = reason; }};
  input.chat = [{id: "1", from: "lan-peer", name: "Friend", text: "Hi!", at: 1}];
  lobby.update(input); lobby.update(input);
  assert.equal(changes, 2);
  assert.deepEqual(received, [input.chat]);
  lobby.update({...input, phase: "closed", error: "Host left"});
  assert.equal(closed, "Host left");
  assert.equal(lobby.open, false);
});
test("an explicitly left lobby ignores repeated resets and cannot adopt a new room's identity",async()=>{
  const input=session(),sent=[],lobby=new LanLobby(input,(...m)=>sent.push(m));let closed=0;
  lobby.ev={closed:()=>closed++};
  await lobby.leave();await lobby.leave();
  lobby.update({phase:"closed",members:[]});
  lobby.update({...input,me:"lan-next",members:[{...input.members[0],id:"lan-next"}]});
  assert.equal(lobby.me,"lan-me");assert.equal(lobby.open,false);assert.equal(lobby.retired,true);
  assert.equal(closed,0);assert.deepEqual(sent,[["leave"]]);assert.deepEqual(lobby.ev,{});
});
test("terminal native updates close the current lobby only once",()=>{
  const lobby=new LanLobby(session(),()=>{});let closed=0;
  lobby.ev={closed:()=>closed++};
  lobby.update({phase:"closed",members:[]});lobby.update({phase:"closed",members:[]});
  lobby.update(session());
  assert.equal(closed,1);assert.equal(lobby.open,false);
});
test("Host → Escape → Host creates a fresh UI facade despite queued native reset events",async()=>{
  const previous={document:globalThis.document,app:globalThis.PokeBonkNativeApp,open:globalThis.PokeBonkOpenLocalRoom};
  const document=new EventTarget(),opened=[],sent=[];
  let input=session(),home=false,staleClosed=0;
  document.querySelector=()=>home?{}:null;
  globalThis.document=document;globalThis.PokeBonkNativeApp={};
  globalThis.PokeBonkOpenLocalRoom=(_app,room)=>{opened.push(room);home=false;};
  const api={lan:{state:()=>structuredClone(input),send:(...m)=>sent.push(m)}};
  try{
    installLanUI(api,{},{});api.localCoop();
    const first=opened.at(-1);first.ev={closed:()=>staleClosed++};
    await first.leave();
    for(let i=0;i<2;i++){input={phase:"closed",members:[]};document.dispatchEvent(new Event("standard:lan-state"));}
    home=true;input={...session(),me:"lan-next",members:[{...session().members[0],id:"lan-next"}]};
    document.dispatchEvent(new Event("standard:lan-state"));
    const second=opened.at(-1);assert.notEqual(second,first);assert.equal(second.me,"lan-next");
    let changes=0;second.ev={change:()=>changes++};
    document.dispatchEvent(new Event("standard:lan-state"));
    assert.equal(changes,1);assert.equal(staleClosed,0);assert.equal(first.me,"lan-me");
    assert.deepEqual(sent,[["leave",undefined]]);
  }finally{globalThis.document=previous.document;globalThis.PokeBonkNativeApp=previous.app;globalThis.PokeBonkOpenLocalRoom=previous.open;}
});
test("the unconnected room preview cannot start, ready or send chat", async () => {
  const sent = [], input = {...session(), preview: true, linked: false, invitation: undefined,
    code: "PREVIEW"};
  input.members.splice(1);
  const lobby = new LanLobby(input, (...message) => sent.push(message));
  assert.equal(lobby.preview, true);
  assert.equal(lobby.meshReady, false);
  assert.equal(lobby.invitation, null);
  assert.equal(lobby.room.want, 4);
  await assert.rejects(lobby.start(), /preview only/);
  await assert.rejects(lobby.setReady(true), /preview only/);
  await assert.rejects(lobby.say("Hi!"), /Chat is disabled/);
  assert.deepEqual(sent, []);
});
