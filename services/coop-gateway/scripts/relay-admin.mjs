// Local operator commands only. Fixed routes; no bearer values in argv/logs.
import {readFile,stat} from "node:fs/promises";
import {gatewayOrigin} from "../../../standard/common/internet-coop.mjs";
const routes={status:["GET","/admin/status"],refresh:["POST","/admin/refresh-usage"],
  resume:["POST","/admin/resume-relay"],disable:["POST","/admin/disable-relay"]};
const args=process.argv.slice(2),choice=routes[args[0]];
if(args.length!==1||!choice)throw Error("Choose exactly one operator command: status, refresh, resume, disable.");
const file=new URL("../../../../pokebonk-standard-signing/cloudflare-gateway-secrets.json",import.meta.url);
if(((await stat(file)).mode&0o077)!==0)throw Error("Admin credential file must have permissions 0600.");
const config=JSON.parse(await readFile(new URL("../../../standard/config.json",import.meta.url),"utf8"));
const origin=gatewayOrigin(config);if(!origin)throw Error("Native gateway is not configured.");
const secrets=JSON.parse(await readFile(file,"utf8"));
if(!/^[A-Za-z0-9_-]{43}$/.test(secrets.ADMIN_TOKEN??""))throw Error("Invalid private admin token.");
try {
  const [method,route]=choice,response=await fetch(origin+route,{method,
    headers:{Authorization:"Bearer "+secrets.ADMIN_TOKEN},redirect:"error",signal:AbortSignal.timeout(30000)});
  const text=await response.text();if(text.length>48000)throw Error("Oversized admin response.");
  const data=JSON.parse(text);
  // Only the service's explicitly safe status schema is ever displayed.
  const safe=Object.fromEntries(["error","turnMode","disabled","disabledReason","meterError","monitorConfigured","pendingLeases","reservedBytes","liveLeases",
    "cutoffBytes","hardBillingCap","recorded","resumed"].filter(key=>key in data).map(key=>[key,data[key]]));
  if(data.usage)safe.usage=Object.fromEntries(["scope","complete","source","bytes","turnBytes","sfuBytes","asOf","periodStart","periodEnd"]
    .filter(key=>key in data.usage).map(key=>[key,data.usage[key]]));
  console.log(JSON.stringify({status:response.status,...safe},null,2));
  if(!response.ok)process.exitCode=1;
}catch{console.error("Operator request failed; no credential details were logged.");process.exitCode=1;}
