import {readFile,realpath,lstat} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
export async function addReviewedImages(files,build){
  const bytes=await readFile("standard/asset-additions.json"),contract=JSON.parse(bytes);
  if(contract.schemaVersion!==1||contract.origin!=="https://pokebonk.com"||contract.reviewedBuild!==build||
    !Array.isArray(contract.files)||contract.files.length>256)throw Error("Review the additional-image contract for this upstream build.");
  const root=await realpath("standard/resources/game-assets"),seen=new Set(),added=[];
  for(const entry of contract.files){
    if(!/^assets\/(?:ui\/(?:icons|frames|banners)|items)\/[a-z0-9-]+\.(?:png|jpg)$/.test(entry.name)||seen.has(entry.name)||
      entry.source!=="https://pokebonk.com/"+entry.name||!Number.isSafeInteger(entry.bytes)||entry.bytes<32||
      !/^[a-f0-9]{64}$/.test(entry.sha256))throw Error("Invalid reviewed image addition.");
    seen.add(entry.name);
    const file=await realpath(path.join(root,entry.name));
    if(!file.startsWith(root+path.sep)||!(await lstat(file)).isFile())throw Error("Additional image escaped its directory.");
    const image=await readFile(file);
    const format=entry.name.endsWith(".png")?
      image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
      image[0]===255&&image[1]===216&&image.lastIndexOf(Buffer.from([255,217]))>=image.length-1024;
    if(image.length!==entry.bytes||sha(image)!==entry.sha256||!format)throw Error("Additional image integrity mismatch: "+entry.name);
    if(files.has(entry.name)&&sha(files.get(entry.name))!==entry.sha256)throw Error("An image addition would overwrite a different captured asset.");
    files.set(entry.name,image);added.push({name:entry.name,bytes:entry.bytes,sha256:entry.sha256});
  }
  const aliases=contract.aliases??[];
  if(!Array.isArray(aliases)||aliases.length>64)throw Error("Invalid reviewed artwork aliases.");
  if(aliases.length){
    const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
    if(accepted.build!==build)throw Error("Review artwork aliases for the accepted snapshot.");
    const pristine=await realpath(path.join(accepted.snapshot,"game"));
    const snapshot=JSON.parse(await readFile(path.join(accepted.snapshot,"snapshot.json"),"utf8"));
    if(snapshot.digest!==accepted.digest)throw Error("Artwork alias snapshot identity mismatch.");
    for(const entry of aliases){
      const original=snapshot.files.find(file=>file.name===entry.sourceAsset);
      if(!/^assets\/ui\/frames\/look-[a-z0-9-]+\.png$/.test(entry.name)||
        !/^assets\/ui\/frames\/tr-[a-z0-9-]+-2\.png$/.test(entry.sourceAsset)||seen.has(entry.name)||
        entry.originalStatus!==404||entry.originalSource!=="https://pokebonk.com/"+entry.name||
        entry.source!=="https://pokebonk.com/"+entry.sourceAsset||!original||
        entry.bytes!==original.bytes||entry.sha256!==original.sha256)
        throw Error("Invalid reviewed original-artwork alias.");
      seen.add(entry.name);
      const file=await realpath(path.join(pristine,entry.sourceAsset));
      if(!file.startsWith(pristine+path.sep)||!(await lstat(file)).isFile())throw Error("Artwork alias escaped its snapshot.");
      const image=files.get(entry.sourceAsset)??await readFile(file);
      if(image.length!==entry.bytes||sha(image)!==entry.sha256||
        !image.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
        throw Error("Artwork alias source integrity mismatch.");
      if(files.has(entry.name)&&sha(files.get(entry.name))!==entry.sha256)
        throw Error("An artwork alias would overwrite a different captured asset.");
      files.set(entry.name,image);
    }
  }
  return {contractSha256:sha(bytes),files:added,...(aliases.length?{aliases}: {})};
}
