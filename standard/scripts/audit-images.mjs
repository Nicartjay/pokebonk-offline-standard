import {readFile,writeFile,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import {inflateSync} from "node:zlib";
import path from "node:path";
import {collectImageReferences} from "./image-references.mjs";
import {prepare} from "./prepare.mjs";
import http from "node:http";
const sourceMode=process.argv.includes("--source");
const serve=process.argv.includes("--serve"),probe=process.argv.includes("--probe-missing");
if(serve&&!sourceMode)throw Error("The audit gallery requires the read-only source mode.");
const root=path.resolve(process.argv.slice(2).find(arg=>!arg.startsWith("--"))??"build/standard-game");
const candidate=sourceMode?await prepare({write:false}):null;
const inventory=candidate?.inventory??JSON.parse(await readFile(path.join(root,"asset-manifest.json"),"utf8"));
const readAsset=async name=>{
  if(candidate){
    const bytes=candidate.files.get(name);if(!bytes)throw Error("Missing source image: "+name);return bytes;
  }
  return readFile(path.join(root,name));
};
const names=new Set(inventory.files.map(file=>file.name));
const files=new Map(await Promise.all(inventory.files.filter(file=>/\.(?:m?js|css|json)$/.test(file.name)&&
  !file.name.startsWith("data/i18n/")).map(async file=>[file.name,await readAsset(file.name)])));
const contract=collectImageReferences(files,names);
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
const crc32=bytes=>{let n=0xffffffff;for(const byte of bytes)n=crcTable[(n^byte)&255]^(n>>>8);return(n^0xffffffff)>>>0;};
const requireValue=(value,message)=>{if(!value)throw Error(message);};
function png(bytes){
  requireValue(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),"PNG signature");
  let at=8,w,h,end=false;const data=[];
  while(at+12<=bytes.length){
    const length=bytes.readUInt32BE(at),type=bytes.toString("ascii",at+4,at+8),next=at+12+length;
    requireValue(next<=bytes.length,"Truncated PNG chunk");
    requireValue(crc32(bytes.subarray(at+4,next-4))===bytes.readUInt32BE(next-4),"PNG checksum");
    if(type==="IHDR"){requireValue(length===13,"PNG header");w=bytes.readUInt32BE(at+8);h=bytes.readUInt32BE(at+12);}
    if(type==="IDAT")data.push(bytes.subarray(at+8,next-4));
    if(type==="IEND"){end=true;break;}at=next;
  }
  requireValue(w>0&&h>0&&data.length&&end,"Incomplete PNG");
  inflateSync(Buffer.concat(data),{maxOutputLength:256*1024*1024});
  return {w,h};
}
const failures=[],counts={png:0,webp:0,jpg:0,svg:0,ico:0};let totalBytes=0;
for(const file of inventory.files.filter(file=>/\.(?:png|webp|jpe?g|svg|ico)$/i.test(file.name))){
  try{
    const bytes=await readAsset(file.name);totalBytes+=bytes.length;
    requireValue(bytes.length===file.bytes&&createHash("sha256").update(bytes).digest("hex")===file.sha256,"Image file hash");
    const ext=path.extname(file.name).slice(1).replace("jpeg","jpg");counts[ext]++;
    if(ext==="png"){
      const size=png(bytes),expected=contract.dimensions.get(file.name);
      if(expected)requireValue(size.w===expected.w&&size.h===expected.h,"Sprite catalog dimensions");
    }else if(ext==="webp")requireValue(bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP"&&bytes.readUInt32LE(4)+8===bytes.length,"WebP container");
    else if(ext==="jpg")requireValue(bytes[0]===255&&bytes[1]===216&&bytes.lastIndexOf(Buffer.from([255,217]))>=bytes.length-1024,"JPEG container");
    else if(ext==="svg")requireValue(/<svg[\s>]/i.test(bytes.toString())&&!/<html[\s>]/i.test(bytes.toString()),"SVG document");
    else requireValue(bytes.length>6&&bytes.readUInt16LE(0)===0&&[1,2].includes(bytes.readUInt16LE(2))&&bytes.readUInt16LE(4)>0,"Icon container");
  }catch(error){failures.push({name:file.name,error:error.message});}
}
const report={appVersion:JSON.parse(await readFile("standard/config.json","utf8")).version,
  observedAt:new Date().toISOString(),gameDigest:inventory.gameDigest,
  input:sourceMode?"current accepted source, adapted in memory; no prepared or native build changed":root,
  scope:"Every bundled image: SHA-256 and format/container checks; PNG chunk CRC/inflate; sprite dimensions; explicit paths, computed status/Treasures/cosmetic/default-look/reward/trainer/rank/relic/Expedition item/faction/pass/Refuge catalogs, regular/fallback/shiny/form/portrait/icon catalogs and co-op thumbnails.",
  counts,totalImages:Object.values(counts).reduce((sum,n)=>sum+n,0),totalBytes,
  requiredReferences:contract.required.size,iconFactoryBindings:contract.iconFactories,
  missing:contract.missing.map(name=>({name,sources:[...contract.required.get(name)]})),failures,
  optionalMissing:[...contract.optional].filter(([name])=>!names.has(name))
    .map(([name,reasons])=>({name,sources:[...reasons]})),
  metadataOnly:contract.metadataOnly,
  computedCatalogFamilies:contract.computedCatalogFamilies,
  reviewedDynamicFamilies:contract.dynamicFamilies,
  limitation:"Not a claim about unreferenced or future website assets, nor physical-device GPU decoding or every possible gameplay branch."};
if(probe){
  if(report.missing.length>32)throw Error("Review missing-image requests before contacting the original site.");
  for(const entry of report.missing){
    if(!/^assets\/[a-zA-Z0-9/_-]+\.(?:png|jpg|webp|svg|ico)$/.test(entry.name))throw Error("Invalid missing-image URL.");
    try{
      const response=await fetch("https://pokebonk.com/"+entry.name,{redirect:"error",signal:AbortSignal.timeout(15000)});
      entry.originalStatus=response.status;entry.originalContentType=response.headers.get("content-type");
      await response.body?.cancel();
    }catch{entry.originalStatus=null;entry.originalProbe="Unavailable; not proof of an upstream 404.";}
  }
}
await mkdir("evidence/image-audit-1.3.0",{recursive:true});
await writeFile("evidence/image-audit-1.3.0/report.json",JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({images:report.totalImages,requiredReferences:report.requiredReferences,missing:report.missing,
  optionalMissing:report.optionalMissing,failures:report.failures},null,2));
if(report.missing.length||failures.length)process.exitCode=1;
if(serve){
  const images=inventory.files.filter(file=>/\.(?:png|webp|jpe?g|svg|ico)$/i.test(file.name)).map(file=>file.name);
  const permitted=new Set(images);
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><title>PokéBonk offline image audit</title>
<style>
body{margin:0;padding:28px;background:#181c2d;color:#f0f2ff;font:15px/1.5 system-ui}main{max-width:1120px;margin:auto}
h1{margin:0 0 8px;font-size:29px}p{color:#b9c4df}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0}
.cards section{padding:18px;background:#272d44;border:1px solid #535e7d;border-radius:15px}.cards strong{font-size:30px;display:block}
.warn{color:#ffd88a}.ok{color:#86e1b1}button{border:0;border-radius:10px;background:#70abf8;color:#13213a;padding:12px 18px;font:800 15px system-ui;cursor:pointer}
output{display:block;margin:16px 0;font-weight:800}code{font-size:12px;overflow-wrap:anywhere}li{margin:5px 0}small{color:#9aa9c9}
</style><main><h1>PokéBonk Offline · Full image audit</h1>
<p>App ${report.appVersion} · game ${candidate.metadata.upstream.version} · current source, checked in memory. No installed app or save is used.</p>
<div class="cards"><section><strong>${report.totalImages.toLocaleString()}</strong>Bundled image files</section>
<section class="${report.missing.length?"warn":"ok"}"><strong>${report.missing.length}</strong>Missing catalog references</section>
<section class="${report.failures.length?"warn":"ok"}"><strong>${report.failures.length}</strong>Hash / image-container failures</section></div>
${report.missing.length?`<h2>Missing artwork</h2><ul>${report.missing.map(entry=>`<li><code>${entry.name}</code> · original site: ${entry.originalStatus??"not verified"}</li>`).join("")}</ul>`:"<p class=\"ok\">All image paths in the reviewed reference contracts are present.</p>"}
<button id="decode">Decode all bundled images</button><output id="decode-status">Browser decoding has not started.</output><ul id="decode-errors"></ul>
<small>Checks cover static paths plus computed cosmetic, reward, default-look, status, Treasures, trainer, rank, relic and Expedition catalogs.<br>
No native packaging, real gameplay session or publication. Physical-device rendering remains separate.<br>
Source payload digest: <code>${report.gameDigest}</code></small></main><script src="/audit.js"></script></html>`;
  const script=`const images=${JSON.stringify(images)},button=document.querySelector("#decode"),status=document.querySelector("#decode-status");
button.onclick=async()=>{
  button.disabled=true;let next=0,done=0;const errors=[];
  await Promise.all(Array.from({length:4},async()=>{
    while(next<images.length){
      const name=images[next++],image=new Image();let timer;
      try{image.src="/"+name;await Promise.race([image.decode(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("decode timeout")),15000);})]);
        if(!image.naturalWidth||!image.naturalHeight)throw Error("Empty image");
      }catch(error){errors.push({name,error:error.message});}
      finally{clearTimeout(timer);image.src="";done++;}
      status.textContent="Decoded "+done.toLocaleString()+" / "+images.length.toLocaleString()+" images; "+errors.length+" failures.";
    }
  }));
  status.textContent="Complete: "+done.toLocaleString()+" images decoded; "+errors.length+" failures.";
  status.className=errors.length?"warn":"ok";status.dataset.done=String(done);status.dataset.failures=String(errors.length);
  document.querySelector("#decode-errors").replaceChildren(...errors.map(entry=>{const item=document.createElement("li");item.textContent=entry.name+": "+entry.error;return item;}));
};`;
  const types={".png":"image/png",".jpg":"image/jpeg",".webp":"image/webp",".svg":"image/svg+xml",".ico":"image/x-icon"};
  const server=http.createServer(async(req,res)=>{
    try{
      const name=decodeURIComponent(new URL(req.url,"http://localhost").pathname).slice(1);
      const bytes=name===""?Buffer.from(html):name==="audit.js"?Buffer.from(script):
        permitted.has(name)?await readAsset(name):null;
      if(!bytes)throw Error("Not an audit resource.");
      res.writeHead(200,{"Content-Type":name===""?"text/html":name==="audit.js"?"text/javascript":types[path.extname(name)],
        "Cache-Control":"no-store","Content-Security-Policy":"default-src 'none'; img-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'none'; frame-src 'none'; object-src 'none'"});
      res.end(bytes);
    }catch{res.writeHead(404);res.end("Not an audit resource.");}
  });
  server.listen(0,"127.0.0.1",()=>console.log("Read-only image audit gallery: http://127.0.0.1:"+server.address().port+"/"));
}
