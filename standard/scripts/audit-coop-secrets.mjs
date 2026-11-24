// Public-source guard plus optional LOCAL known-secret/history/artifact scan.
// This script never prints a credential or uploads one to CI.
import {readFile,readdir,stat} from "node:fs/promises";
import {execFileSync,spawn} from "node:child_process";
import path from "node:path";
import {createRequire} from "node:module";
import {createReadStream} from "node:fs";
import {createHash} from "node:crypto";
const root=process.cwd(),needles=[];
for(const name of ["cloudflare-coop.json","cloudflare-gateway-secrets.json","cloudflare-usage.json"]) {
  try {
    const data=JSON.parse(await readFile(path.resolve(root,"../pokebonk-standard-signing",name),"utf8"));
    for(const [key,value] of Object.entries(data))if(/^(turnTokenId|turnApiToken|apiToken|ADMIN_TOKEN|PRIVATE_BETA_TOKEN|IP_HASH_SECRET)$/.test(key)&&typeof value==="string"&&value.length>=24)
      needles.push(Buffer.from(value));
  } catch(error) { if(error.code!=="ENOENT")throw Error("Cannot read the private known-secret inventory safely."); }
}
const overlap=Math.max(1,...needles.map(value=>value.length));
function check(bytes,label) {
  if(needles.some(value=>bytes.includes(value)))throw Error("Private credential detected in "+label+" (value withheld).");
}
async function streamCheck(stream,label,limit=2*1024**3) {
  let tail=Buffer.alloc(0),size=0;
  for await(const part of stream) {
    size+=part.length;if(size>limit)throw Error("Safety scan size limit reached: "+label);
    const bytes=Buffer.concat([tail,part]);check(bytes,label);tail=bytes.subarray(-overlap);
  }
}
const names=execFileSync("git",["ls-files","-z","--cached","--others","--exclude-standard"],
  {encoding:"utf8",maxBuffer:128*1024*1024}).split("\0").filter(Boolean);
for(const name of new Set(names)) {
  if(path.basename(name)!==".env.example"&&/(^|\/)(?:cloudflare-(?:coop|gateway-secrets|usage)\.json|\.dev\.vars[^/]*|\.env(?:\..*)?|[^/]+\.(?:key|keystore|jks)|[^/]*private[^/]*\.pem)$/.test(name))
    throw Error("Private credential file is eligible for Git: "+name);
  try {
    const bytes=await readFile(name);check(bytes,name);
    if(/\.(?:json|jsonc|ya?ml)$/.test(name)&&/"(?:turnApiToken|TURN_API_TOKEN|CF_USAGE_API_TOKEN)"\s*:\s*"[^"]{24,}"/.test(bytes.toString("utf8")))
      throw Error("A literal service credential is present in "+name);
  } catch(error) { if(error.code!=="ENOENT"&&error.code!=="EISDIR")throw error; }
}
async function tree(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isSymbolicLink())throw Error("Do not follow symlinks while auditing a payload.");
    if(entry.isDirectory())await tree(file);
    else {
      if((await stat(file)).size>512*1024*1024)throw Error("Unexpectedly large payload file.");
      check(await readFile(file),path.relative(root,file));
    }
  }
}
if(process.argv.includes("--payload"))await tree(path.join(root,"build/standard-game"));
if(process.argv.includes("--history")&&needles.length) {
  const objects=execFileSync("git",["rev-list","--objects","--all"],{encoding:"utf8",maxBuffer:128*1024*1024})
    .trim().split("\n").filter(Boolean).map(line=>line.split(" ")[0]).join("\n");
  const child=spawn("git",["cat-file","--batch"],{stdio:["pipe","pipe","pipe"]});
  // Always drain stderr, but do not accidentally echo object contents.
  child.stderr.resume();
  const ended=new Promise((resolve,reject)=>{child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(Error("Git history scan failed.")));});
  const input=Buffer.from(objects+"\n");child.stdin.end(input);
  try { await streamCheck(child.stdout,"Git history",16*1024**3);await ended; }
  catch(error) { child.kill();await ended.catch(()=>{});throw error; }
}
const artifacts=[];
for(let i=2;i<process.argv.length;i++){
  const arg=process.argv[i];
  if(["--history","--payload"].includes(arg))continue;
  if(arg!=="--artifact"||!/\.(?:zip|apk)$/.test(process.argv[i+1]??""))throw Error("Expected --history, --payload, or --artifact with a local ZIP/APK.");
  artifacts.push(process.argv[++i]);
}
const artifactRecords=[];
for(const file of artifacts) {
  const require=createRequire(import.meta.url),yauzl=require("yauzl");
  await new Promise((resolve,reject)=>yauzl.open(file,{lazyEntries:true},(error,zip)=>{
    if(error)return reject(Error("Cannot inspect artifact archive."));
    let total=0;zip.on("error",reject);zip.on("end",resolve);
    zip.on("entry",entry=>{
      if(/(^|\/)(?:cloudflare-(?:coop|gateway-secrets|usage)\.json|credentials\.json|\.dev\.vars[^/]*|[^/]+\.(?:jks|keystore))$/.test(entry.fileName)){
        zip.close();reject(Error("A private credential file was packaged (contents withheld)."));return;
      }
      total+=entry.uncompressedSize;
      if(total>2*1024**3){zip.close();reject(Error("Artifact scan size limit reached."));return;}
      if(entry.fileName.endsWith("/")){zip.readEntry();return;}
      zip.openReadStream(entry,(error,stream)=>{
        if(error){zip.close();reject(error);return;}
        void streamCheck(stream,"artifact entry "+entry.fileName)
          .then(()=>zip.readEntry(),error=>{zip.close();reject(error);});
      });
    });zip.readEntry();
  }));
  const digest=createHash("sha256");
  for await(const bytes of createReadStream(file))digest.update(bytes);
  artifactRecords.push({path:path.resolve(file),bytes:(await stat(file)).size,sha256:digest.digest("hex")});
}
console.log(`Service credential audit passed: ${new Set(names).size} source paths; ${artifacts.length} archives; ${needles.length} locally known secret values checked. Values are never printed.`);
console.log(JSON.stringify({audit:"service-credentials",passed:true,checkedAt:new Date().toISOString(),
  sourcePaths:new Set(names).size,knownSecretsChecked:needles.length,history:process.argv.includes("--history"),
  payloadDigest:process.argv.includes("--payload")?JSON.parse(await readFile("build/standard-game/asset-manifest.json","utf8")).gameDigest:null,
  artifacts:artifactRecords}));
