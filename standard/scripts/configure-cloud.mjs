// Public client endpoint only. Never accepts, reads or stores cloud credentials.
import {readFile} from "node:fs/promises";
import {atomicWrite} from "../common/store.mjs";
import {cloudOrigin} from "../common/cloud-save.mjs";
const args=process.argv.slice(2),config=JSON.parse(await readFile("standard/config.json","utf8"));
if(args.length===1&&args[0]==="--disable")config.cloudSaves={enabled:false,url:""};
else if(args.length===2&&args[1]==="--enable"){
  const proposed={cloudSaves:{enabled:true,url:args[0]}},origin=cloudOrigin(proposed);
  if(!origin)throw Error("Pass the verified separate HTTPS Workers origin, without credentials, query, path or fragment.");
  config.cloudSaves={enabled:true,url:origin};
}else throw Error("Use configure-cloud.mjs <verified Workers origin> --enable, or --disable. Configure and approve the separate service first.");
await atomicWrite("standard/config.json",JSON.stringify(config,null,2)+"\n");
console.log(config.cloudSaves.enabled?"Configured public cloud origin; no credentials were stored. Rebuild matching native clients.":"Cloud disabled; local saves remain available.");
