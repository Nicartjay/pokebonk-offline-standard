// Operator-only. Never import this into the app or run it in public CI.
import {readFile,stat} from "node:fs/promises";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url));
const privateRoot=new URL("../../../../pokebonk-standard-signing/",import.meta.url);
if(process.argv.slice(2).join()!=="--upload-turn-secrets")throw Error("Explicit --upload-turn-secrets is required.");
async function readPrivate(name) {
  const file=new URL(name,privateRoot),info=await stat(file);
  if((info.mode&0o077)!==0)throw Error("Private credential files must be readable only by their owner (0600).");
  return JSON.parse(await readFile(file,"utf8"));
}
const issuer=await readPrivate("cloudflare-coop.json"),monitor=await readPrivate("cloudflare-usage.json");
if(!/^[a-f0-9]{32}$/.test(issuer.accountId??"") || issuer.accountId!==monitor.accountId ||
   !/^[a-f0-9]{32}$/.test(issuer.turnTokenId??"") || typeof issuer.turnApiToken!=="string" ||
   issuer.turnApiToken.length<24 || typeof monitor.apiToken!=="string" || monitor.apiToken.length<24 ||
   !Number.isFinite(Date.parse(monitor.expiresAt)) || Date.parse(monitor.expiresAt)<Date.now()+86400000)
  throw Error("Issuer and read-only monitor credentials are missing, expired or do not belong to the same account.");
// Exact allowlist: no signing keys, global API keys, unrelated tokens or file
// contents are uploaded. stdin prevents secret values appearing in argv.
const secrets={TURN_TOKEN_ID:issuer.turnTokenId,TURN_API_TOKEN:issuer.turnApiToken,
  CF_ACCOUNT_ID:issuer.accountId,CF_USAGE_API_TOKEN:monitor.apiToken};
const cli=spawn(process.execPath,["node_modules/wrangler/bin/wrangler.js","secret","bulk"],{
  cwd:root,stdio:["pipe","inherit","inherit"],env:{...process.env,WRANGLER_SEND_METRICS:"false"},
});
cli.stdin.end(JSON.stringify(secrets));
const code=await new Promise((resolve,reject)=>{cli.on("error",reject);cli.on("exit",resolve);});
if(code!==0)throw Error("Worker secret provisioning failed.");
console.log("Uploaded four server-side TURN/meter secrets. No app/repository credentials were written. Relay enablement is separate.");
