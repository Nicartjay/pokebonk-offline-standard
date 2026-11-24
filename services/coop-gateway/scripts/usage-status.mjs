// Read-only operator probe; only sanitized usage/subscription metadata leaves
// this process. Do not print whole API responses or errors.
import {readFile,stat} from "node:fs/promises";
import {realtimeSubscriptions,readAccountUsage} from "../src/usage.mjs";
const file=new URL("../../../../pokebonk-standard-signing/cloudflare-usage.json",import.meta.url);
if(((await stat(file)).mode&0o077)!==0)throw Error("Monitor credential file must have permissions 0600.");
const privateData=JSON.parse(await readFile(file,"utf8"));
const config=JSON.parse(await readFile(new URL("../wrangler.jsonc",import.meta.url),"utf8"));
const env={...config.vars,CF_ACCOUNT_ID:privateData.accountId,CF_USAGE_API_TOKEN:privateData.apiToken};
try {
  if(process.argv.includes("--subscriptions")) {
    const subscriptions=await realtimeSubscriptions(env);
    console.log(JSON.stringify(subscriptions.map(value=>({id:value.id,name:value.rate_plan?.public_name,
      frequency:value.frequency,state:value.state,periodStart:value.current_period_start,periodEnd:value.current_period_end})),null,2));
  } else {
    console.log(JSON.stringify(await readAccountUsage(env),null,2));
  }
} catch(error) { console.error(error.code??"Trusted provider usage could not be verified."); process.exitCode=1; }
