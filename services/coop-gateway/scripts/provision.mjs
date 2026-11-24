// Operator-only setup. No secrets in arguments, stdout, source or app assets.
import {open,readFile,chmod} from "node:fs/promises";
import {randomBytes} from "node:crypto";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../",import.meta.url));
const file=new URL("../../../../pokebonk-standard-signing/cloudflare-gateway-secrets.json",import.meta.url);
const names=["ADMIN_TOKEN","PRIVATE_BETA_TOKEN","IP_HASH_SECRET"];
if(!process.argv.includes("--upload-gateway-only"))throw Error("Explicit --upload-gateway-only is required.");
try{
  const handle=await open(file,"wx",0o600);
  try{await handle.writeFile(JSON.stringify(Object.fromEntries(names.map(name=>[name,randomBytes(32).toString("base64url")])),null,2)+"\n");}
  finally{await handle.close();}
}catch(error){if(error.code!=="EEXIST")throw error;}
await chmod(file,0o600);
const values=JSON.parse(await readFile(file,"utf8"));
if(Object.keys(values).sort().join()!==[...names].sort().join()||names.some(name=>!/^[A-Za-z0-9_-]{43}$/.test(values[name])))
  throw Error("Unexpected gateway secret file; refusing to upload other credentials.");
const cli=spawn(process.execPath,["node_modules/wrangler/bin/wrangler.js","secret","bulk"],{
  cwd:root,stdio:["pipe","inherit","inherit"],env:{...process.env,WRANGLER_SEND_METRICS:"false"},
});
cli.stdin.end(JSON.stringify(values));
const result=await new Promise((resolve,reject)=>{cli.on("error",reject);cli.on("exit",code=>resolve(code));});
if(result!==0)throw Error("Gateway secret provisioning failed.");
console.log("Provisioned gateway admission/admin/IP-hash secrets only. TURN issuer credentials were not uploaded.");
