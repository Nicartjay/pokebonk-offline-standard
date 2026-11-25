import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {ast,nodesOf,literal} from "../../scripts/source.ts";
import {readSnapshotManifest} from "../../scripts/upstream-snapshot.ts";
import {validateRentalSnapshot} from "../common/rentals.mjs";
import {isMain} from "../../scripts/is-main.mjs";
const sha=value=>createHash("sha256").update(value).digest("hex");
const clean=(value,max=80)=>String(value??"").replace(/[\u0000-\u001f\u007f]/g,"").slice(0,max);
const id=value=>"rental-"+sha(String(value)).slice(0,24);
const list=value=>Array.isArray(value)?value:[];
export async function importRentalCapture(directory) {
  const capture=JSON.parse(await readFile(path.join(directory,"capture.json"),"utf8"));
  if(capture.schemaVersion!==1||capture.scope!=="all-public-rental-listings"||!capture.complete||
    capture.sourceOrigin!=="https://api.pokebonk.com"||capture.files.length!==capture.species.length)
    throw Error("A complete public rental capture is required.");
  const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
  // Capture records its intended target. Future candidates may be imported
  // before acceptance, but must still resolve a real hash-checked snapshot.
  const targetRoot=capture.target.snapshot??accepted.snapshot;
  const target=await readSnapshotManifest(targetRoot);
  if(target.digest!==capture.target.digest)throw Error("Rental target snapshot changed.");
  const moves=JSON.parse(await readFile(path.join(targetRoot,"game/data/moves.json"),"utf8"));
  const pokemon=JSON.parse(await readFile(path.join(targetRoot,"game/data/pokemon.json"),"utf8"));
  const items=JSON.parse(await readFile(path.join(targetRoot,"game/data/items.json"),"utf8"));
  const pokemonIds=new Set(pokemon.map(mon=>mon.id)),types=new Set(pokemon.flatMap(mon=>mon.types));
  const moveIds=new Set(moves.map(move=>move.id)),moveKeys=new Set(moves.map(move=>move.key)),known=new Set(Object.keys(items));
  const knownFusion=value=>known.has(value)||/^fu-\d+$/.test(value)&&pokemonIds.has(Number(value.slice(3)))||
    /^fu-t-[a-z]+$/.test(value)&&types.has(value.slice(5))||
    /^fu-r-[a-z0-9_-]+$/.test(value)&&known.has(value.slice(5));
  for(const file of target.files.filter(file=>/^assets\/(?:assets|moves|cosmetics|machine)-[\w-]+\.js$/.test(file.name))){
    const bytes=await readFile(path.join(targetRoot,"game",file.name));
    if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error("Rental reference catalog integrity mismatch.");
    for(const node of [...nodesOf(ast(bytes.toString()),"Literal"),...nodesOf(ast(bytes.toString()),"TemplateLiteral")]){
      const value=literal(node);if(typeof value==="string")known.add(value);
    }
  }
  const entries={},unknownPlanKeys=new Set(),unknownBuildKeys=new Set();
  for(const file of capture.files){
    if(file.file!==file.species+".json"||!capture.species.includes(file.species))throw Error("Invalid rental capture path.");
    const bytes=await readFile(path.join(directory,file.file));
    if(bytes.length!==file.bytes||sha(bytes)!==file.sha256)throw Error("Rental capture hash mismatch.");
    const rows=JSON.parse(bytes);if(!Array.isArray(rows)||rows.length!==file.entries)throw Error("Rental capture count mismatch.");
    entries[file.species]=rows.map(raw=>{
      if(raw.build?.member!==file.species)throw Error("Rental build is for the wrong Pokémon.");
      const original=raw.build,plan=original.plan;
      if(!plan||typeof plan!=="object")throw Error("Missing rental plan.");
      for(const key of Object.keys(original))if(!["member","plan","off","types"].includes(key))unknownBuildKeys.add(key);
      for(const key of Object.keys(plan))if(!["moves","favs","vits","fus","items","arch","from","relics","note","links"].includes(key))unknownPlanKeys.add(key);
      const unavailable=[
        ...list(plan.moves).filter(value=>!moveIds.has(value)).map(value=>"Move "+value),
        ...list(original.off).filter(value=>!moveKeys.has(value)).map(value=>"Move "+value),
        ...list(plan.fus).filter(value=>!knownFusion(value)).map(value=>"fus: "+value),
        ...["vits","items","arch"].flatMap(key=>list(plan[key]).filter(value=>!known.has(value)).map(value=>key+": "+value)),
        ...list(raw.items).filter(value=>!known.has(value)).map(value=>"Archive: "+value),
        ...list(plan.relics).filter(value=>!known.has(value)).map(value=>"Relic: "+value),
        ...list(plan.links).flat().filter(value=>!moveIds.has(value)).map(value=>"Linked move "+value),
      ];
      const build={member:original.member,plan:{moves:list(plan.moves),favs:list(plan.favs),vits:list(plan.vits),fus:list(plan.fus),
        items:list(plan.items),...(plan.arch?{arch:list(plan.arch)}:{}),...(plan.from?{from:id(plan.from)}:{}),
        ...(plan.relics?{relics:list(plan.relics)}:{}),...(plan.note?{note:clean(plan.note,1000)}:{}),
        ...(plan.links?{links:list(plan.links)}:{})},
        off:list(original.off),types:list(original.types)};
      return {id:id(raw.id),name:clean(raw.name)||"Trainer",avatar:clean(raw.avatar),frame:clean(raw.frame),
        skins:list(raw.skins),species:raw.species,rank:raw.rank??0,kills:raw.kills??0,time:raw.time??0,
        users:raw.users??0,rents:raw.rents??0,items:list(raw.items),build,
        ...(raw.creator?{creator:{id:id(raw.creator.id),name:clean(raw.creator.name)||"Trainer"}}:{}),
        compatible:unavailable.length===0,unavailable:[...new Set(unavailable)]};
    });
  }
  if(unknownPlanKeys.size||unknownBuildKeys.size)throw Error("Review new rental build fields before importing: "+JSON.stringify({
    plan:[...unknownPlanKeys],build:[...unknownBuildKeys]}));
  const data=validateRentalSnapshot({schemaVersion:1,scope:"public-rental-snapshot",capturedAt:capture.completedAt,
    source:{version:capture.source.version,build:capture.source.build},
    target:{version:capture.target.version,build:capture.target.build,digest:capture.target.digest,species:capture.target.species},
    species:capture.species,totalEntries:capture.totalEntries,entries});
  const bytes=Buffer.from(JSON.stringify(data)+"\n"),digest=sha(bytes),directoryOut="standard/resources/rentals";
  await mkdir(directoryOut,{recursive:true});
  await writeFile(path.join(directoryOut,digest+".json"),bytes);
  const info={schemaVersion:1,file:digest+".json",sha256:digest,bytes:bytes.length,
    capturedAt:data.capturedAt,source:data.source,target:data.target,
    species:data.species.length,totalEntries:data.totalEntries,
    compatibleEntries:Object.values(data.entries).flat().filter(row=>row.compatible).length,
    captureSha256:sha(await readFile(path.join(directory,"capture.json"))),
    refreshPolicy:"Refresh and review the public rental snapshot with every upstream game version/build update; never fetch rental data during gameplay."};
  await writeFile("standard/rental-snapshot.json.next",JSON.stringify(info,null,2)+"\n");
  await rename("standard/rental-snapshot.json.next","standard/rental-snapshot.json");
  console.log(JSON.stringify({imported:info.totalEntries,species:info.species,compatible:info.compatibleEntries,bytes:info.bytes,source:info.source,target:info.target.build},null,2));
  return info;
}
if(isMain(import.meta.url)){
  if(process.argv.length!==3)throw Error("Usage: import-rentals.mjs RAW_CAPTURE_DIRECTORY");
  await importRentalCapture(process.argv[2]);
}
