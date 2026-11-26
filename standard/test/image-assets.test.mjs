import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {collectImageReferences} from "../scripts/image-references.mjs";
import {addReviewedImages} from "../scripts/asset-additions.mjs";
import {COOP_MAPS,coopSettings} from "../common/coop-rules.mjs";
import {ast} from "../../scripts/source.ts";
import {treasureImageReferences,treasureImagePlan} from "../scripts/cosmetic-images.mjs";
const treasureFixture=`
  const renamedWheels=[{id:"geode",starter:246,items:[],title1:"Gems",frame1:"Quarry",grandFrame:"Crown",grandLook:"Eternal",banner:"Cavern"}];
  const renamedLooks=[{member:246,n:3,style:"stone",pal:[],rule:{}},{member:246,n:4,style:"geode",pal:[],rule:{}}];
`;
const treasureBuilders=`
  function renamedGlow(banner){const url=\`ui/banners/\${banner}-glow.png\`;return \`<img class="bf-glow" src="\${url}">\`;}
  function renamedFrame(look){return \`ui/frames/\${look.frame??"look-"+look.style}.png\`;}
`;
test("static and dynamically catalogued UI icons are required through renamed imports",()=>{
  const files=new Map([
    ["assets/dom.js",Buffer.from('function makeIcon(key){return `ui/icons/${key}.png`};export{makeIcon as i};')],
    ["assets/game.js",Buffer.from('import{i as renamed}from"./dom.js";renamed("st-burn");const seal={icon:"st-wet"};')],
  ]);
  const names=new Set([...files.keys(),...COOP_MAPS.map(id=>"assets/ui/maps/"+id+".webp"),"assets/ui/maps/newisland.webp"]);
  const missing=collectImageReferences(files,names).missing;
  assert.deepEqual(missing,["assets/ui/icons/st-burn.png","assets/ui/icons/st-wet.png"]);
  for(const name of missing)names.add(name);
  assert.deepEqual(collectImageReferences(files,names).missing,[]);
});
test("boss status icons constructed from a finite catalog are required through renamed icon imports",()=>{
  const files=new Map([
    ["assets/dom.js",Buffer.from('function icon(key){return `ui/icons/${key}.png`};export{icon as i};')],
    ["assets/status.js",Buffer.from('import{i as renamed}from"./dom.js";const catalog=[{id:"poison",on:()=>true},{id:"para",on:()=>true},{id:"confuse",on:()=>true}];class Status{update(){for(const entry of catalog){renamed("st-"+entry.id,22);}}}')],
  ]);
  const names=new Set([...files.keys(),...COOP_MAPS.map(id=>"assets/ui/maps/"+id+".webp"),"assets/ui/maps/newisland.webp"]);
  names.add("assets/ui/frames/st-poison.png"); // Cosmetic artwork is not a status icon.
  const references=collectImageReferences(files,names);
  assert.deepEqual(references.missing,["assets/ui/icons/st-confuse.png","assets/ui/icons/st-para.png","assets/ui/icons/st-poison.png"]);
  for(const name of references.missing)names.add(name);
  assert.deepEqual(collectImageReferences(files,names).missing,[]);
  files.set("assets/status.js",Buffer.from('import{i as renamed}from"./dom.js";const catalog=unknown();for(const entry of catalog){renamed("st-"+entry.id,22);}'));
  assert.throws(()=>collectImageReferences(files,names),/Unsupported catalog-driven status icon/);
});
test("Treasures requires catalog-derived look frames and banner glows, not just JPG backgrounds",()=>{
  const files=new Map([
    ["assets/cosmetics.js",Buffer.from(treasureFixture)],
    ["assets/renamed-ui.js",Buffer.from(treasureBuilders)],
  ]);
  const names=new Set([...files.keys(),...COOP_MAPS.map(id=>"assets/ui/maps/"+id+".webp"),"assets/ui/maps/newisland.webp",
    "assets/ui/frames/look-stone.png","assets/ui/frames/tr-geode-1.png","assets/ui/frames/tr-geode-2.png",
    "assets/ui/banners/tr-geode.jpg","assets/ui/icons/look-geode.png"]);
  assert.deepEqual(collectImageReferences(files,names).missing,[
    "assets/ui/banners/tr-geode-glow.png","assets/ui/frames/look-geode.png",
  ]);
  names.add("assets/ui/banners/tr-geode-glow.png");names.add("assets/ui/frames/look-geode.png");
  assert.deepEqual(collectImageReferences(files,names).missing,[]);
});
test("unsupported Treasures look mappings, image builders and duplicate catalogs fail closed",()=>{
  const modules=(catalog=treasureFixture,builders=treasureBuilders)=>new Map([
    ["assets/cosmetics.js",ast(catalog)],["assets/ui.js",ast(builders)],
  ]);
  assert.equal(treasureImageReferences(modules()).length,6);
  assert.deepEqual(treasureImagePlan(modules()).portraitAliases,[
    {name:"assets/ui/frames/look-geode.png",sourceAsset:"assets/ui/frames/tr-geode-2.png"},
  ]);
  assert.throws(()=>treasureImageReferences(modules(treasureFixture.replace("n:4","n:9"))),/look-to-wheel/);
  assert.throws(()=>treasureImageReferences(modules(treasureFixture,treasureBuilders.replace("look-","unknown-"))),/image builders/);
  const duplicate=modules();duplicate.set("assets/duplicate.js",ast(treasureFixture));
  assert.throws(()=>treasureImageReferences(duplicate),/catalogs/);
});
test("form portraits use named keys while sheet sprites use numeric IDs; suffixes are not standalone paths",()=>{
  const files=new Map([
    ["data/formsprites.json",Buffer.from(JSON.stringify({ids:{"mega-3":30001},sheets:{30001:{w:32,h:32}},portraits:["mega-3"]}))],
    ["assets/loader.js",Buffer.from('const suffix=".png";')],
  ]);
  const names=new Set([...files.keys(),"assets/pmd-forms/30001.png","assets/portraits-forms/mega-3.png",
    ...COOP_MAPS.map(id=>"assets/ui/maps/"+id+".webp"),"assets/ui/maps/newisland.webp"]);
  assert.deepEqual(collectImageReferences(files,names).missing,[]);
});
test("unused upstream medicine metadata is not guessed artwork; executable use makes it required",()=>{
  const files=new Map([["data/items.json",Buffer.from(JSON.stringify({antidote:{icon:"items/antidote.png"}}))]]);
  const names=new Set([...COOP_MAPS.map(id=>"assets/ui/maps/"+id+".webp"),"assets/ui/maps/newisland.webp"]);
  assert.equal(collectImageReferences(files,names).metadataOnly.length,1);
  files.set("offline/item.js",Buffer.from('const item={key:"antidote"};'));
  assert.ok(collectImageReferences(files,names).missing.includes("assets/items/antidote.png"));
});
test("capture reports are provenance, not runtime image references",()=>{
  const files=new Map([
    ["offline-build.json",Buffer.from(JSON.stringify({missingCandidates:["assets/ui/maps/crater.webp"]}))],
    ["asset-manifest.json",Buffer.from(JSON.stringify({files:[{name:"assets/items/tm-bug.png"}]}))],
  ]);
  const names=new Set([...COOP_MAPS.map(id=>"assets/ui/maps/"+id+".webp"),"assets/ui/maps/newisland.webp"]);
  assert.deepEqual(collectImageReferences(files,names).missing,[]);
  files.set("assets/actual.js",Buffer.from('const path="assets/items/tm-bug.png";'));
  assert.deepEqual(collectImageReferences(files,names).missing,["assets/items/tm-bug.png"]);
});
test("original artwork and explicit upstream-404 aliases are hash checked and cannot overwrite pristine images",async()=>{
  const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
  const contract=JSON.parse(await readFile("standard/asset-additions.json","utf8"));
  const snapshot=accepted.snapshot+"/snapshot.json";
  const before=await readFile(snapshot,"utf8"),files=new Map();
  const extra=await addReviewedImages(files,accepted.build);
  assert.equal(extra.files.length,contract.files.length);
  assert.ok(files.get("assets/items/lure.png")?.length>=33,"Tasks must not fall back to a Poké Ball for Lure.");
  for(const name of ["burn","poison","para","sleep","frozen","chill","stun","confuse","charm","root","pull","wet","curse","healblock","shield"])
    assert.ok(files.get("assets/ui/icons/st-"+name+".png")?.length>100,name);
  for(const style of ["ember","verdant","tidal","psionic","spectre","storm","geode","candy","frost","gothic","circuit","toxic"])
    assert.ok(files.get("assets/ui/frames/look-"+style+".png")?.length>100,style);
  for(const wheel of ["geode","candy","frost","gothic","circuit","toxic"])
    assert.ok(files.get("assets/ui/banners/tr-"+wheel+"-glow.png")?.length>100,wheel);
  assert.equal(extra.aliases.length,12);
  for(const alias of extra.aliases){
    assert.equal(alias.originalStatus,404);
    assert.equal(alias.originalSource,"https://pokebonk.com/"+alias.name);
    assert.equal(alias.source,"https://pokebonk.com/"+alias.sourceAsset);
    assert.match(alias.sourceAsset,/^assets\/ui\/frames\/tr-[a-z0-9-]+-2\.png$/);
  }
  await assert.rejects(addReviewedImages(new Map([["assets/ui/icons/st-burn.png",Buffer.from("different")]]),accepted.build),/overwrite/);
  await assert.rejects(addReviewedImages(new Map([["assets/ui/frames/look-geode.png",Buffer.from("different")]]),accepted.build),/alias would overwrite/);
  await assert.rejects(addReviewedImages(new Map(),"unsupported-build"),/Review/);
  assert.equal(await readFile(snapshot,"utf8"),before);
});
test("every selectable co-op map has captured artwork, including Cinnabar's real canela identifier",async()=>{
  const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
  const snapshot=JSON.parse(await readFile(accepted.snapshot+"/snapshot.json","utf8"));
  const names=new Set(snapshot.files.map(file=>file.name));
  for(const biome of [...COOP_MAPS,"newisland"])assert.ok(names.has("assets/ui/maps/"+biome+".webp"),biome);
  assert.equal(coopSettings({biome:"canela",tier:0}).biome,"canela");
  assert.throws(()=>coopSettings({biome:"crater",tier:0}),/supported/);
});
