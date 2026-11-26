import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import {readSnapshot} from "../../scripts/upstream-snapshot.ts";
import {ast, nodesOf, maybeName, literal, one, edits} from "../../scripts/source.ts";
import {patchSnapshot} from "../adapters/mwv6wzyo.mjs";
import {patchSnapshot as refresh01036} from "../adapters/mwxeoqzj.mjs";
import {readRentalSnapshot} from "../scripts/rental-snapshot.mjs";
import {structuralHash} from "../adapters/expedition.mjs";
import {validateEnvelope, envelope} from "../common/state.mjs";

const accepted = JSON.parse(await readFile("standard/accepted.json", "utf8"));
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
const snapshot = await readSnapshot("vendor/pokebonk-standard-0.10.31",
  "4e20fcc6612cd5c2e3e010f45136bd5e1710be74aa9975d0741d0783ffb0f7d5");
let adapted;
const candidate = () => adapted ??= patchSnapshot(snapshot.files);

test("0.10.31 is explicitly pinned and its new original collection/reward roles remain in the offline source", () => {
  assert.equal(snapshot.manifest.upstreamBuild, "mwv6wzyo");
  assert.equal(snapshot.manifest.upstreamVersion, "0.10.31");
  const {files, modules} = candidate(), source = files.get("assets/" + modules.menus).toString();
  const pokedex = one(ast(source).body.filter(node => node.type === "FunctionDeclaration" &&
    nodesOf(node, "TemplateLiteral", value => literal(value) === "dh-shell").length === 1), "original Pokédex+ hub");
  assert.ok(nodesOf(pokedex, "Property", node => maybeName(node.key) === "openRun").length);
  assert.match(source, /"Pokédex\+"/);
  assert.match(files.get("assets/" + modules.rules).toString(), /\.codex=/);
  assert.match(files.get("assets/" + modules.rules).toString(), /\.mons=/);
  assert.match(files.get("assets/" + modules.rules).toString(), /\.mlog=/);
  assert.match(files.get("offline/upstream-expedition.js").toString(), /as wantedAllowed/);
  assert.match(files.get("offline/upstream-expedition.js").toString(), /as stackLimits/);
  assert.match(files.get("assets/" + modules.main).toString(), /PokeBonkOfflineBackend/);
  assert.doesNotMatch(files.get("assets/" + modules.main).toString(), /https:\/\/api\.pokebonk\.com/);
});
test("0.10.36 retains the local backend after the upstream services split and keeps trainer cards local", async () => {
  assert.deepEqual(config.upstream, {version:"0.10.36", build:"mwxeoqzj"});
  assert.equal(accepted.build, config.upstream.build);
  const {files: pristine} = await readSnapshot(accepted.snapshot, accepted.digest);
  const {files, modules} = refresh01036(pristine);
  const [services] = [...files].filter(([name]) => /^assets\/services-.*\.js$/.test(name)).map(([, bytes]) => bytes.toString());
  assert.match(services, /new globalThis\.PokeBonkOfflineBackend/);
  assert.match(services, /\.backend\.uploadSave/);
  assert.doesNotMatch(services, /https:\/\/api\.pokebonk\.com/);
  const [card] = [...files].filter(([name]) => /^assets\/cardcustom-.*\.js$/.test(name)).map(([, bytes]) => bytes.toString());
  assert.match(card, /Your local trainer card/);
  assert.doesNotMatch(card, /\.backend\.(?:player|clanCardFrame)\(/);
  assert.match(files.get("assets/" + modules.menus).toString(), /Button transparency|Transparencia de los botones/);
  assert.match(files.get("offline/upstream-rules.js").toString(), /as buyCard/);
  assert.equal((await readRentalSnapshot(accepted)).info.source.build, accepted.build);
});
test("0.10.31 adapter refuses a different upstream build and changed Expedition wanted-loot rules", async () => {
  const files = new Map(snapshot.files);
  files.set("index.html", Buffer.from(files.get("index.html").toString().replaceAll("mwv6wzyo", "future-build")));
  assert.throws(() => patchSnapshot(files), /explicitly reviewed build/);
  const changed = new Map(snapshot.files);
  const [name, bytes] = one([...changed].filter(([name, bytes]) => name.endsWith(".js") &&
    bytes.toString().includes("demand:") && bytes.toString().includes("trophy-valley") &&
    bytes.toString().includes("mat-crystal")), "Expedition catalog");
  const contract = JSON.parse(await readFile("standard/adapters/expedition-contract-mwv6wzyo.json", "utf8"));
  const source = bytes.toString();
  const rule = one(nodesOf(ast(source), "VariableDeclarator", node =>
    node.init && structuralHash(node.init) === contract.roles.wantedAllowed), "wanted-loot rule");
  changed.set(name, Buffer.from(source.slice(0, rule.init.start) + "(()=>true)" + source.slice(rule.init.end)));
  assert.notEqual(changed.get(name).toString(), bytes.toString());
  assert.throws(() => patchSnapshot(changed), /wantedAllowed structure/);
});
test("co-op keeps the current original Pokémon picker, including the new roster/wardrobe layout and room callbacks",()=>{
  const {files,modules}=candidate();
  const before=snapshot.files.get("assets/"+modules.menus).toString();
  const after=files.get("assets/"+modules.menus).toString();
  const pick=source=>one(ast(source).body.filter(node=>node.type==="FunctionDeclaration"&&
    nodesOf(node,"TemplateLiteral",value=>literal(value)==="ls-grid scroll").length===1),
    "current original Pokémon selector");
  const original=pick(before),adapted=pick(after),source=before.slice(original.start,original.end);
  const copy=new Map([["Clasificación","Personal records"],["Clasificación de {name}","Personal records: {name}"]]);
  const changes=[...nodesOf(ast(source),"Literal"),...nodesOf(ast(source),"TemplateLiteral")]
    .filter(node=>copy.has(literal(node))).map(node=>({...node,text:JSON.stringify(copy.get(literal(node)))}));
  assert.equal(after.slice(adapted.start,adapted.end),edits(source,changes));
  const classes=new Set(nodesOf(ast(source),"Property",node=>maybeName(node.key)==="class")
    .flatMap(node=>typeof literal(node.value)==="string"?literal(node.value).split(/\s+/):[]));
  for(const cls of ["ls4-filters","ls4-tabs","ls4-pane","ls-roster","lg-poster"])
    assert.ok(classes.has(cls),cls);
  const owner=one(ast(after).body.filter(node=>node.type==="FunctionDeclaration"&&
    nodesOf(node,"TemplateLiteral",value=>literal(value)==="cp-slots").length===1),"adapted original room");
  const choose=one(nodesOf(owner,"CallExpression",node=>maybeName(node.callee)===adapted.id.name),
    "original room-to-selector call");
  assert.equal(literal(choose.arguments[1]),"standard");
  assert.deepEqual(choose.arguments[3].properties.map(node=>maybeName(node.key)),["back","pick"]);
  const shortcut=one(ast(after).body.filter(node=>node.type==="FunctionDeclaration"&&
    nodesOf(node,"TemplateLiteral",value=>literal(value)==="btn green cp-return").length===1),
    "original green room-return shortcut");
  assert.ok(nodesOf(owner,"CallExpression",node=>maybeName(node.callee)===shortcut.id.name).length);
  assert.match(after,/globalThis\.PokeBonkTrackRoomReturn=/);
  const expeditionTeam=one([...files].filter(([name,bytes])=>name.endsWith(".js")&&
    bytes.toString().includes("xt-slots")&&bytes.toString().includes("exb-team-room")),
    "adapted original Expedition team module")[1].toString();
  assert.match(expeditionTeam,/PokeBonkTrackRoomReturn/);
});
test("results keep the original green Co-op button, including shared Boss Rush, and preserve the room before disposing the run",()=>{
  const {files,modules}=candidate(),source=files.get("assets/"+modules.main).toString(),tree=ast(source);
  const launch=one(nodesOf(tree,"MethodDefinition",node=>maybeName(node.key)==="launch"&&
    nodesOf(node,"AssignmentExpression",assignment=>maybeName(assignment.left.property)==="onCoop").length===1),
    "application launch");
  const callback=one(nodesOf(launch,"AssignmentExpression",node=>maybeName(node.left.property)==="onCoop"),
    "native results return action").right;
  const calls=[],room={open:true},app={coopRoom:room,
    run:{coop:{keepRoom(){calls.push("keepRoom");this.stay=true;}}},
    toMenu(){
      calls.push("toMenu");
      if(!this.run.coop.stay)room.open=false;
      this.run=null;
    }};
  const action=vm.runInNewContext("(function(){return "+source.slice(callback.start,callback.end)+"}).call(app)",{
    app,PokeBonkOfflineUI:{localCoop(){calls.push("sameRoom");assert.equal(app.coopRoom,room);assert.equal(room.open,true);}}
  });
  action();assert.deepEqual(calls,["keepRoom","toMenu","sameRoom"]);
  const result=one(nodesOf(tree,"MethodDefinition",node=>nodesOf(node,"CallExpression",call=>
    call.arguments[1]?.properties?.some(property=>literal(property.key)==="data-standard-coop-return")).length===1),
    "original co-op result footer");
  const button=one(nodesOf(result,"CallExpression",node=>node.arguments[1]?.properties?.some(property=>
    literal(property.key)==="data-standard-coop-return")),"guard-exempt native return button");
  assert.equal(literal(button.arguments[1].properties.find(property=>maybeName(property.key)==="class").value),"btn green big");
  assert.ok(nodesOf(button,"MemberExpression",node=>maybeName(node.property)==="onCoop").length);
  const guard=one(result.value.body.body.filter(node=>node.type==="IfStatement"&&
    nodesOf(node,"MemberExpression",member=>maybeName(member.property)==="challengeResult").length),
    "solo-only event-result diversion");
  const run=result.value.params[0].name,condition=source.slice(guard.test.start,guard.test.end);
  for(const coop of [null,{}])for(const rush of [null,{}]){
    assert.equal(Boolean(vm.runInNewContext(condition,{[run]:{coop,rush,tower:null}})),!coop&&!!rush);
  }
});
test("completed old progress imports, but unfinished old-engine runs are preserved instead of migrated", () => {
  const state = {version: 1, playerId: "offline-refresh-test", updatedAt: 1,
    profile: {name: "Trainer", settings: {}, league: [4], unlocked: [4], seen: [4], stardust: 123},
    stash: {}, finished: {}, spins: {}, activeRun: null, suspended: null};
  const old = {...envelope(state, config), upstream: {version: "0.10.31", build: "mwv6wzyo"}};
  assert.equal(validateEnvelope(old, config).state.profile.stardust, 123);
  old.state.activeRun = {status: "running", ticket: {id: "offline-previous-run", seed: 123}};
  const preserved = structuredClone(old);
  assert.throws(() => validateEnvelope(old, config), /Complete it in the previous app version/);
  assert.deepEqual(old, preserved);
  assert.deepEqual(config.compatibleRunBuilds, ["mwxeoqzj"]);
});
