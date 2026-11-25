// Fetch ONLY finite boss-status icon references from the accepted source.
// Never changes a pristine vendor snapshot or enables runtime networking.
import {readFile,writeFile,mkdir,rename} from "node:fs/promises";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {collectImageReferences} from "./image-references.mjs";
import {isMain} from "../../scripts/is-main.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
export async function captureStatusIcons(){
  const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
  const snapshot=JSON.parse(await readFile(accepted.snapshot+"/snapshot.json","utf8"));
  const file="standard/asset-additions.json",contract=JSON.parse(await readFile(file,"utf8"));
  if(snapshot.digest!==accepted.digest||contract.reviewedBuild!==accepted.build||
    contract.origin!=="https://pokebonk.com"||contract.schemaVersion!==1)throw Error("Review the accepted status-icon source first.");
  const names=new Set([...snapshot.files.map(entry=>entry.name),...contract.files.map(entry=>entry.name)]);
  const modules=new Map(await Promise.all(snapshot.files.filter(entry=>entry.name.endsWith(".js")).map(async entry=>{
    const bytes=await readFile(path.join(accepted.snapshot,"game",entry.name));
    if(bytes.length!==entry.bytes||sha(bytes)!==entry.sha256)throw Error("Pristine source integrity mismatch.");
    return [entry.name,bytes];
  })));
  const references=collectImageReferences(modules,names);
  const required=[...references.required.keys()].filter(name=>/^assets\/ui\/icons\/st-[a-z0-9-]+\.png$/.test(name)).sort();
  if(required.length<15||required.length>64)throw Error("Review the boss status catalog before capturing.");
  const pending=required.filter(name=>!names.has(name)),downloads=[];
  for(const name of pending){
    const source="https://pokebonk.com/"+name;
    const response=await fetch(source,{redirect:"error",signal:AbortSignal.timeout(20000)});
    if(!response.ok||!response.body)throw Error(`Status image returned HTTP ${response.status}: ${name}`);
    if(!/^image\/png\b/i.test(response.headers.get("content-type")??""))throw Error("Non-PNG response: "+name);
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{
      for(;;){
        const {value,done}=await reader.read();if(done)break;
        size+=value.length;if(size>256*1024)throw Error("Status image too large: "+name);
        chunks.push(value);
      }
    }finally{await reader.cancel();}
    const bytes=Buffer.concat(chunks);
    if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||
      bytes.toString("ascii",12,16)!=="IHDR"||bytes.readUInt32BE(16)>512||bytes.readUInt32BE(20)>512)
      throw Error("Invalid status image: "+name);
    downloads.push({entry:{name,source,bytes:bytes.length,sha256:sha(bytes)},bytes});
    console.log(`Captured ${name} (${bytes.length} bytes)`);
  }
  // Do not replace an existing reviewed asset with unreviewed remote changes.
  for(const {entry,bytes}of downloads){
    const output=path.join("standard/resources/game-assets",entry.name);
    await mkdir(path.dirname(output),{recursive:true});
    try{await writeFile(output,bytes,{flag:"wx"});}
    catch(error){
      if(error.code!=="EEXIST"||sha(await readFile(output))!==entry.sha256)throw error;
    }
    contract.files.push(entry);
  }
  contract.reason="Original dynamic gameplay/cosmetic artwork omitted from earlier captures, with separately recorded aliases for confirmed upstream 404s.";
  contract.purpose="Keep the reviewed status, Treasures and collection-goal artwork offline without modifying pristine vendor snapshots.";
  contract.statusIconCatalog={required,capturedAt:new Date().toISOString()};
  const temporary=file+"."+randomUUID()+".tmp";
  await writeFile(temporary,JSON.stringify(contract,null,2)+"\n");
  await rename(temporary,file);
  console.log(`Status icon catalog: ${required.length} required; ${downloads.length} newly captured.`);
  return {required,added:downloads.map(value=>value.entry)};
}
if(isMain(import.meta.url))await captureStatusIcons();
