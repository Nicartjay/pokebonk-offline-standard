// Only original, source-derived Treasures artwork. No accounts or credentials.
import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {ast} from "../../scripts/source.ts";
import {treasureImagePlan} from "./cosmetic-images.mjs";
import {isMain} from "../../scripts/is-main.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
export async function captureTreasureImages(){
  const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
  const snapshot=JSON.parse(await readFile(accepted.snapshot+"/snapshot.json","utf8"));
  const file="standard/asset-additions.json",contract=JSON.parse(await readFile(file,"utf8"));
  if(snapshot.digest!==accepted.digest||contract.reviewedBuild!==accepted.build||
    contract.origin!=="https://pokebonk.com"||contract.schemaVersion!==1)throw Error("Review the accepted Treasures source first.");
  const names=new Set([...snapshot.files.map(entry=>entry.name),...contract.files.map(entry=>entry.name),
    ...(contract.aliases??[]).map(entry=>entry.name)]);
  const modules=new Map(await Promise.all(snapshot.files.filter(entry=>entry.name.endsWith(".js")).map(async entry=>{
    const bytes=await readFile(path.join(accepted.snapshot,"game",entry.name));
    if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error("Pristine source integrity mismatch.");
    return [entry.name,ast(bytes.toString())];
  })));
  const plan=treasureImagePlan(modules),required=plan.references.map(entry=>entry.name);
  const replacements=new Map(plan.portraitAliases.map(entry=>[entry.name,entry.sourceAsset]));
  if(!required.length)throw Error("No supported Treasures artwork catalog.");
  const downloads=[],aliases=[];
  for(const name of required.filter(name=>!names.has(name))){
    if(!/^assets\/ui\/(?:frames|banners)\/(?:look-|tr-)[a-z0-9-]+\.(?:png|jpg)$/.test(name))
      throw Error("Review unsupported Treasures image: "+name);
    const source="https://pokebonk.com/"+name;
    const response=await fetch(source,{redirect:"error",signal:AbortSignal.timeout(30000)});
    if(response.status===404&&replacements.has(name)){
      await response.body?.cancel();
      const sourceAsset=replacements.get(name),entry=snapshot.files.find(entry=>entry.name===sourceAsset);
      if(!entry)throw Error("Matching original Treasures frame is not captured: "+sourceAsset);
      const bytes=await readFile(path.join(accepted.snapshot,"game",sourceAsset));
      if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error("Original frame integrity mismatch.");
      aliases.push({name,originalSource:source,originalStatus:404,sourceAsset,
        source:"https://pokebonk.com/"+sourceAsset,bytes:entry.bytes,sha256:entry.sha256,
        reason:"The original style-frame URL returns 404. Reuse the matching original Treasures grand-prize frame; no cosmetic unlock is granted."});
      console.log(`Original URL is 404; reviewed frame alias: ${name} <- ${sourceAsset}`);
      continue;
    }
    if(!response.ok||!response.body)throw Error(`Treasures image returned HTTP ${response.status}: ${name}`);
    const png=name.endsWith(".png"),type=response.headers.get("content-type")??"";
    if(!(png?/^image\/png\b/i:/^image\/jpeg\b/i).test(type)){
      await response.body.cancel();throw Error("Unexpected Treasures image response: "+name);
    }
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{
      for(;;){
        const {value,done}=await reader.read();if(done)break;
        size+=value.length;if(size>4*1024*1024)throw Error("Treasures image too large: "+name);
        chunks.push(value);
      }
    }finally{await reader.cancel();}
    const bytes=Buffer.concat(chunks);
    const valid=png?bytes.length>=33&&
      bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&
      bytes.toString("ascii",12,16)==="IHDR"&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0&&
      bytes.readUInt32BE(16)<=4096&&bytes.readUInt32BE(20)<=4096:
      bytes[0]===255&&bytes[1]===216&&bytes.lastIndexOf(Buffer.from([255,217]))>=bytes.length-1024;
    if(!valid)throw Error("Invalid Treasures image: "+name);
    downloads.push({entry:{name,source,bytes:bytes.length,sha256:sha(bytes)},bytes});
    console.log(`Captured ${name} (${bytes.length} bytes)`);
  }
  for(const {entry,bytes}of downloads){
    const output=path.join("standard/resources/game-assets",entry.name);
    await mkdir(path.dirname(output),{recursive:true});
    try{await writeFile(output,bytes,{flag:"wx"});}
    catch(error){if(error.code!=="EEXIST"||sha(await readFile(output))!==entry.sha256)throw error;}
    contract.files.push(entry);
  }
  contract.reason="Original status icons, Treasures banner glows and collection artwork omitted from captures, plus explicitly recorded matching-art aliases for upstream-missing look frames.";
  contract.purpose="Keep the reviewed gameplay/cosmetic artwork offline with documented original-art substitutions for confirmed 404s, without modifying pristine vendor snapshots.";
  contract.aliases=[...(contract.aliases??[]),...aliases];
  contract.treasureImageCatalog={required,capturedAt:new Date().toISOString()};
  const temporary=file+"."+randomUUID()+".tmp";
  await writeFile(temporary,JSON.stringify(contract,null,2)+"\n");
  await rename(temporary,file);
  console.log(`Treasures artwork: ${required.length} required; ${downloads.length} newly captured; ${aliases.length} reviewed aliases for upstream 404s.`);
  return {required,added:downloads.map(value=>value.entry),aliases};
}
if(isMain(import.meta.url))await captureTreasureImages();
