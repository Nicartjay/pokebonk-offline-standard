import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {ast,nodesOf,literal} from "../../scripts/source.ts";
import {validateRentalSnapshot} from "../common/rentals.mjs";
import {RentalLibrary} from "../runtime/rentals.js";
import {OfflineBackend} from "../runtime/backend.js";
import {readRentalSnapshot} from "../scripts/rental-snapshot.mjs";
import {playableRentalSpecies} from "../scripts/rental-catalog.mjs";
import {patchRentalBuilds,patchRentalGallery} from "../adapters/rentals.mjs";
const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
const bundle=await readRentalSnapshot(accepted),full=JSON.parse(bundle.bytes);
const sample=()=>{
  const data=structuredClone(full),species=data.target.species.find(id=>data.entries[id].length);
  data.target.species=data.species=[species];data.entries={[species]:[data.entries[species][0]]};data.totalEntries=1;
  return data;
};
test("bundled rental capture is complete, hash checked and covers the accepted playable catalog",()=>{
  validateRentalSnapshot(full);
  assert.equal(full.totalEntries,bundle.info.totalEntries);
  assert.deepEqual(full.target.species,full.species);
  assert.equal(full.species.length,bundle.info.species);
  assert.equal(full.target.build,accepted.build);
  for(const rows of Object.values(full.entries))for(const row of rows){
    assert.match(row.id,/^rental-[a-f0-9]{24}$/);
    if(row.build.plan.from)assert.match(row.build.plan.from,/^rental-/);
  }
});
test("an upstream build change requires an explicitly refreshed rental snapshot",async()=>{
  await assert.rejects(readRentalSnapshot({...accepted,build:"future-upstream"}),/Refresh and review rental/);
});
test("rental library loads only its injected/local data, caches concurrent reads and returns independent copies",async()=>{
  const data=sample(),species=data.species[0];let loads=0;
  const library=new RentalLibrary({load:async()=>{loads++;return structuredClone(data);}});
  const [rows,index]=await Promise.all([library.list(species),library.index()]);
  assert.equal(loads,1);assert.equal(rows.length,1);assert.equal(index[0].players,1);
  rows[0].build.plan.moves=[];rows[0].name="Changed";
  assert.notEqual((await library.list(species))[0].name,"Changed");
  await assert.rejects(library.list(99999),/not in the bundled game/);
});
test("rental browsing grants no Pokémon, currency, equipment or payouts and does not save a profile",async()=>{
  let saves=0;const data=sample(),library=new RentalLibrary({load:async()=>data});
  const backend=new OfflineBackend({rentals:library,transport:{save(){saves++;}}});
  backend.state={profile:{league:[],stardust:137,lab:{},bag:{},cosmetics:[]}};
  const before=structuredClone(backend.state);
  await backend.rentalBuilds(null,data.species[0]);await backend.rentalIndex();
  assert.deepEqual(backend.state,before);assert.equal(saves,0);
  assert.equal(backend.rentClaim,undefined);assert.equal(backend.rentStatus,undefined);
});
test("malformed rental data is rejected while original signed shiny-skin markers remain valid",()=>{
  const data=sample();data.entries[data.species[0]][0].skins=[-25,1010];
  validateRentalSnapshot(data);
  data.entries[data.species[0]][0].build.plan.moves=[{url:"not executable"}];
  assert.throws(()=>validateRentalSnapshot(data),/Invalid offline rental build/);
  const missing=sample();delete missing.entries[missing.species[0]];
  assert.throws(()=>validateRentalSnapshot(missing),/Incomplete offline rental/);
});
test("capture discovers playable species structurally instead of guessing every Pokémon ID",()=>{
  const source='const root=[{id:1,kit:[],passive:"a",rank:"common"}],extra=[{id:4,kit:[],passive:"b",rank:"common"}];root.push(...extra);';
  assert.deepEqual(playableRentalSpecies(source),[1,4]);
  assert.throws(()=>playableRentalSpecies(source.replaceAll("kit","unrelated")),/rental playable-catalog/);
});
test("original rental screens retain their card and copy UI without live board, account or payout calls",async()=>{
  const snapshot=JSON.parse(await readFile(accepted.snapshot+"/snapshot.json","utf8"));
  const file=snapshot.files.find(file=>/^assets\/menus-[\w-]+\.js$/.test(file.name));
  const source=await readFile(accepted.snapshot+"/game/"+file.name,"utf8"),tree=ast(source);
  const functions=tree.body.filter(node=>node.type==="FunctionDeclaration");
  const builds=functions.find(node=>[...nodesOf(node,"Literal"),...nodesOf(node,"TemplateLiteral")].some(value=>literal(value)==="bd-rents"));
  const gallery=functions.find(node=>nodesOf(node,"CallExpression",call=>call.callee.type==="MemberExpression"&&call.callee.property.name==="rentalBuilds").length===1);
  const changed=patchRentalBuilds(source,builds),cards=patchRentalGallery(source,gallery);
  ast(changed);ast(cards);
  assert.match(changed,/rentalIndex\(\)/);assert.match(changed,/rentalSnapshotInfo/);
  assert.doesNotMatch(changed,/\.rentStatus\(|\.rentClaim\(|\.monBoards\(/);
  assert.match(cards,/bs-rentcard/);assert.match(cards,/allowRental/);assert.match(cards,/Captured #/);
  assert.match(cards,/rentalBuilds/);assert.doesNotMatch(cards,/onclick:[^}]*dD\(/);
});
