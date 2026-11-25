// Maintainer-only public GET capture. Never shipped to the renderer, run by
// the installed updater, or given GitHub/game-account/device credentials.
import {mkdir,readFile,writeFile,rename,access} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {setTimeout as sleep} from "node:timers/promises";
import {discoverUpstream} from "../../scripts/upstream-version.ts";
import {requestUpstream} from "../../scripts/upstream-request.ts";
import {readSnapshotManifest} from "../../scripts/upstream-snapshot.ts";
import {ast,nodesOf,literal} from "../../scripts/source.ts";
import {playableRentalSpecies} from "./rental-catalog.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const args=process.argv.slice(2),captureOnly=args.includes("--capture-only");
const targetAt=args.indexOf("--target-snapshot");
const targetRoot=targetAt<0?JSON.parse(await readFile("standard/accepted.json","utf8")).snapshot:args[targetAt+1];
if(!targetRoot||args.some((arg,index)=>arg!=="--capture-only"&&arg!=="--target-snapshot"&&!(targetAt>=0&&index===targetAt+1)))
  throw Error("Usage: capture-rentals.mjs [--target-snapshot DIRECTORY] [--capture-only]");
const target=await readSnapshotManifest(targetRoot);
const targetEntry=target.files.find(file=>/^assets\/assets-[\w-]+\.js$/.test(file.name));
if(!targetEntry)throw Error("No reviewed target rental catalog.");
const targetBytes=await readFile(path.join(targetRoot,"game",targetEntry.name));
if(targetBytes.length!==targetEntry.bytes||sha(targetBytes)!==targetEntry.sha256)throw Error("Target catalog integrity mismatch.");
const targetSpecies=playableRentalSpecies(targetBytes.toString()),seen=new Map();
const read=async url=>{
  const response=await requestUpstream(url,{maxBytes:4*1024*1024,timeoutMs:20000});
  if(response.ok)seen.set(String(url),await response.clone().text());
  return response;
};
const source=await discoverUpstream(read);
let sourceCatalog;
for(const [url,code]of seen){
  if(!url.endsWith(".js"))continue;
  for(const declaration of nodesOf(ast(code),"ImportDeclaration")){
    const name=literal(declaration.source);
    if(typeof name==="string"&&/^\.\/assets-[\w-]+\.js$/.test(name))
      sourceCatalog=new URL(name,url).href;
  }
}
if(!sourceCatalog)throw Error("Unsupported live rental-catalog import.");
const sourceResponse=await read(sourceCatalog);
if(!sourceResponse.ok)throw Error("Could not read live rental catalog.");
const sourceCode=await sourceResponse.text(),sourceSpecies=playableRentalSpecies(sourceCode);
const species=[...new Set([...targetSpecies,...sourceSpecies])].sort((a,b)=>a-b);
const startedAt=new Date().toISOString(),stamp=startedAt.replace(/[:.]/g,"-");
const parent=path.resolve("upstream/rental-snapshots",source.build),staging=path.join(parent,stamp+".partial"),destination=path.join(parent,stamp);
await mkdir(staging,{recursive:true});
const results=[];let total=0;
async function getListing(id){
  const url="https://api.pokebonk.com/builds/rental/"+id;
  for(let attempt=0;attempt<4;attempt++){
    let response;
    try{
      response=await fetch(url,{headers:{Accept:"application/json"},redirect:"error",credentials:"omit",signal:AbortSignal.timeout(20000)});
      if(response.status===429||response.status>=500){
        const retry=Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        if(attempt===3)throw Error("Rental GET failed: HTTP "+response.status);
        await sleep(Math.min(60000,Math.max(1500*2**attempt,Number.isFinite(retry)?retry*1000:0)));
        continue;
      }
      if(!response.ok||!response.headers.get("content-type")?.includes("application/json"))
        throw Error("Rental GET "+id+" failed: HTTP "+response.status);
      const chunks=[];let length=0;
      for await(const chunk of response.body){
        length+=chunk.length;if(length>1024*1024)throw Error("Rental response exceeds 1 MiB.");
        chunks.push(chunk);
      }
      const bytes=Buffer.concat(chunks),rows=JSON.parse(bytes);
      if(!Array.isArray(rows)||rows.length>128||rows.some(row=>!row||typeof row!=="object"||row.build?.member!==id))
        throw Error("Unsupported rental-listing schema for "+id);
      return {bytes,rows:rows.length,wireBytes:Number(response.headers.get("content-length"))||null};
    }catch(error){
      await response?.body?.cancel().catch(()=>{});
      if(attempt===3||response&&response.status<500&&response.status!==429)throw error;
      await sleep(1500*2**attempt);
    }
  }
}
console.log(`Capturing public rentals for ${species.length} species; online ${source.upstreamVersion}/${source.build}; target ${target.upstreamVersion}/${target.upstreamBuild}.`);
for(const id of species){
  const result=await getListing(id);total+=result.bytes.length;
  if(total>64*1024*1024)throw Error("Rental capture exceeds 64 MiB.");
  await writeFile(path.join(staging,id+".json"),result.bytes,{flag:"wx"});
  results.push({species:id,file:id+".json",entries:result.rows,bytes:result.bytes.length,wireBytes:result.wireBytes,sha256:sha(result.bytes)});
  console.log(`${results.length}/${species.length}: Pokémon ${id}, ${result.rows} builds, ${result.bytes.length} bytes.`);
  await sleep(250); // One request at a time; honor Retry-After above.
}
const end=await requestUpstream("https://pokebonk.com/index.html?offline-rental-check="+Date.now(),{timeoutMs:20000});
if(!end.ok||(await end.text()).match(/name="pokebonk-build" content="([\w-]+)"/)?.[1]!==source.build)
  throw Error("Website build changed during capture; partial capture preserved, not imported.");
const report={schemaVersion:1,scope:"all-public-rental-listings",sourceOrigin:"https://api.pokebonk.com",
  source:{version:source.upstreamVersion,build:source.build,catalogSha256:sha(sourceCode),species:sourceSpecies},
  target:{snapshot:targetRoot,version:target.upstreamVersion,build:target.upstreamBuild,digest:target.digest,catalogSha256:targetEntry.sha256,species:targetSpecies},
  startedAt,completedAt:new Date().toISOString(),complete:true,species,files:results,
  totalEntries:results.reduce((n,row)=>n+row.entries,0),totalBytes:total,
  limitation:"Public per-Pokémon rental endpoint results only; not private/unshared builds or a transactionally frozen server database."};
await writeFile(path.join(staging,"capture.json"),JSON.stringify(report,null,2)+"\n",{flag:"wx"});
try{await access(destination);throw Error("Capture destination already exists.");}catch(error){if(error.code!=="ENOENT")throw error;}
await rename(staging,destination);
console.log(JSON.stringify({capture:destination,species:species.length,builds:report.totalEntries,bytes:total},null,2));
if(!captureOnly){
  const {importRentalCapture}=await import("./import-rentals.mjs");
  await importRentalCapture(destination);
}
