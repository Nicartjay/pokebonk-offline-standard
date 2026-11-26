// Capture only missing original Bag/task reward PNGs from reviewed catalogs.
// No account, saves, build output or pristine vendor file is changed.
import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {collectCatalogImageReferences} from "./catalog-image-references.mjs";
import {isMain} from "../../scripts/is-main.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");

export async function captureTaskImages(){
  const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
  const snapshot=JSON.parse(await readFile(accepted.snapshot+"/snapshot.json","utf8"));
  const file="standard/asset-additions.json",contract=JSON.parse(await readFile(file,"utf8"));
  if(snapshot.digest!==accepted.digest||snapshot.upstreamBuild!==accepted.build||
    contract.reviewedBuild!==accepted.build||contract.origin!=="https://pokebonk.com"||contract.schemaVersion!==1)
    throw Error("Review the accepted task artwork source first.");
  const files=new Map(await Promise.all(snapshot.files.filter(entry=>
    entry.name.endsWith(".js")||entry.name==="data/items.json").map(async entry=>{
      const bytes=await readFile(path.join(accepted.snapshot,"game",entry.name));
      if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error("Pristine source integrity mismatch.");
      return [entry.name,bytes];
    })));
  const {bagItems}=collectCatalogImageReferences(files);
  const names=new Set([...snapshot.files.map(entry=>entry.name),...contract.files.map(entry=>entry.name)]);
  const pending=bagItems.filter(item=>!names.has(item.name)),downloads=[];
  for(const {name}of pending){
    const source="https://pokebonk.com/"+name;
    const response=await fetch(source,{redirect:"error",signal:AbortSignal.timeout(20000)});
    if(!response.ok||!response.body)throw Error(`Task image returned HTTP ${response.status}: ${name}`);
    if(!/^image\/png\b/i.test(response.headers.get("content-type")??"")){
      await response.body.cancel();throw Error("Non-PNG task image response: "+name);
    }
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{
      for(;;){
        const {value,done}=await reader.read();if(done)break;
        size+=value.length;if(size>1024*1024)throw Error("Task artwork is too large: "+name);
        chunks.push(value);
      }
    }finally{await reader.cancel();}
    const bytes=Buffer.concat(chunks);
    if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
      bytes.toString("ascii",12,16)!=="IHDR"||bytes.readUInt32BE(16)<1||bytes.readUInt32BE(20)<1||
      bytes.readUInt32BE(16)>4096||bytes.readUInt32BE(20)>4096)
      throw Error("Invalid original task artwork: "+name);
    downloads.push({entry:{name,source,bytes:bytes.length,sha256:sha(bytes)},bytes});
  }
  for(const {entry,bytes}of downloads){
    const output=path.join("standard/resources/game-assets",entry.name);
    await mkdir(path.dirname(output),{recursive:true});
    try{await writeFile(output,bytes,{flag:"wx"});}
    catch(error){if(error.code!=="EEXIST"||sha(await readFile(output))!==entry.sha256)throw error;}
    contract.files.push(entry);
    console.log(`Captured original ${entry.name} (${entry.bytes} bytes).`);
  }
  contract.taskItemImageCatalog={required:bagItems.map(item=>item.name).sort(),capturedAt:new Date().toISOString()};
  contract.reason="Original status, Bag/task reward, collection and Treasures artwork omitted from captures, plus explicitly recorded aliases for upstream-missing look frames.";
  contract.purpose="Keep reviewed status, cosmetic, collection and Bag/task reward artwork offline, without modifying pristine vendor snapshots. Confirmed cosmetic 404 aliases remain explicitly documented.";
  const temporary=file+"."+randomUUID()+".tmp";
  await writeFile(temporary,JSON.stringify(contract,null,2)+"\n");
  await rename(temporary,file);
  console.log(`Bag/task reward artwork: ${bagItems.length} required; ${downloads.length} original images captured.`);
  return {required:bagItems.map(item=>item.name),added:downloads.map(item=>item.entry)};
}
if(isMain(import.meta.url))await captureTaskImages();
