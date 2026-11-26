import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {bagItemImageReferences,collectCatalogImageReferences} from "../scripts/catalog-image-references.mjs";

async function catalogs(){
  const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
  const snapshot=JSON.parse(await readFile(accepted.snapshot+"/snapshot.json","utf8"));
  const selected=snapshot.files.filter(entry=>
    /^assets\/(?:assets-|cosmetics-|expedition-|dom-).*\.js$/.test(entry.name)||entry.name==="data/items.json");
  return new Map(await Promise.all(selected.map(async entry=>
    [entry.name,await readFile(accepted.snapshot+"/game/"+entry.name)])));
}
test("computed appearance and Expedition artwork distinguishes generated looks from optional border PNGs",async()=>{
  const files=await catalogs();
  const refs=collectCatalogImageReferences(files);
  for(const style of ["ukiyo","glitch","calavera","synth","relief"]){
    const name=`assets/ui/frames/look-${style}.png`;
    assert.ok(refs.optional.has(name),style);
    assert.equal(refs.required.has(name),false,style);
  }
  assert.equal(refs.optional.size,5);
  assert.ok(refs.required.has("assets/ui/frames/look-stone.png"));
  assert.equal(refs.families["trainer portrait catalog"],32);
  assert.equal(refs.families["relic artwork"],47);
  assert.equal(refs.families["Refuge levels (bundled, currently excluded UI)"],12);
  assert.equal(refs.families["Bag and rotating-task reward items"],9);
  assert.ok(refs.required.has("assets/items/lure.png"));
  for(const path of ["assets/ui/exp/refuge/radio-3.png","assets/ui/exp/faction-bill.png",
    "assets/ui/exp/pass-cosmetic.png","assets/gear/leg-mewtwo.png","assets/ui/frames/lg-144-1.png"])
    assert.ok(refs.required.has(path),path);
});
test("custom rotating-task rewards use the exact item factory fallback, not lookalike PokeAPI metadata",()=>{
  const game={renamed:[{id:"rare-candy",name:"Candy",desc:"Levels"},{id:"master-ball",name:"Ball",desc:"Catch"},
    {id:"lure",name:"Lure",desc:"Choose an encounter"}]};
  const metadata={"rare-candy":{icon:"items/rare-candy.png"},"lure-ball":{icon:"items/lure-ball.png"}};
  assert.deepEqual(bagItemImageReferences(game,metadata),[
    {id:"rare-candy",name:"assets/items/rare-candy.png"},{id:"master-ball",name:"assets/items/master-ball.png"},
    {id:"lure",name:"assets/items/lure.png"},
  ]);
  assert.throws(()=>bagItemImageReferences({...game,duplicate:game.renamed},metadata),/artwork catalog/);
  assert.throws(()=>bagItemImageReferences(game,{lure:{icon:"../outside.png"}}),/artwork path/);
});
test("optional appearance borders require the original remove-on-error renderer",async()=>{
  const files=await catalogs();
  const name=[...files.keys()].find(name=>/^assets\/dom-/.test(name));
  const source=files.get(name).toString();
  assert.ok(source.includes("r.onerror=()=>{r.onerror=null,r.remove()}"));
  files.set(name,Buffer.from(source.replace("r.onerror=()=>{r.onerror=null,r.remove()}","r.onerror=()=>{r.onerror=null,r.hidden=true}")));
  assert.throws(()=>collectCatalogImageReferences(files),/optional appearance-border renderer/);
});
