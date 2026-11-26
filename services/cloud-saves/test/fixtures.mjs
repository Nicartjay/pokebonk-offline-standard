import {CloudAccount} from "../src/account.mjs";
import {CloudDirectory} from "../src/directory.mjs";
import {CloudBudget} from "../src/budget.mjs";
import {accountToken,secret,internal} from "../src/policy.mjs";
import {cloudHash} from "../../../standard/common/cloud-save.mjs";
export class MemoryStorage{
  data=new Map();
  async get(key){return structuredClone(this.data.get(key));}
  async put(key,value){this.data.set(key,structuredClone(value));}
}
export class MemoryBucket{
  data=new Map();
  async get(key){const text=this.data.get(key);return text===undefined?null:{size:new TextEncoder().encode(text).length,text:async()=>text};}
  async put(key,text){if(this.data.has(key))return null;this.data.set(key,text);return {etag:"test"};}
  async delete(key){this.data.delete(key);}
  async list({prefix,limit}){const keys=[...this.data.keys()].filter(key=>key.startsWith(prefix));return {objects:keys.slice(0,limit).map(key=>({key})),truncated:keys.length>limit};}
}
function namespace(Type,env){
  const instances=new Map(),contexts=new Map();
  return {instances,contexts,idFromName:name=>name,get(id){
    if(!instances.has(id)){const context={storage:new MemoryStorage()};contexts.set(id,context);instances.set(id,new Type(context,env));}
    return instances.get(id);
  }};
}
export function environment(){
  const env={SERVICE_ENABLED:"true",PUBLIC_ORIGIN:"https://cloud-save.test.workers.dev",MAX_ACCOUNTS:"100",SESSION_DAYS:"30",
    GOOGLE_CLIENT_ID:"cloud-test.apps.googleusercontent.com",GOOGLE_CLIENT_SECRET:"synthetic-google-secret",
    SESSION_SIGNING_KEY:"synthetic-session-signing-key-".repeat(3),IP_HASH_SECRET:"synthetic-ip-hash-key-".repeat(3),SAVES:new MemoryBucket()};
  env.ACCOUNTS=namespace(CloudAccount,env);env.DIRECTORY=namespace(CloudDirectory,env);
  env.BUDGET=namespace(CloudBudget,env);return env;
}
export async function session(env,who="first"){
  const account=await cloudHash("test-account-"+who),bearer=secret(),expires=Date.now()+86400000;
  const response=await env.ACCOUNTS.get(account).fetch(internal("/session",{sessionHash:await cloudHash(bearer),expires,label:who+"@example.test"}));
  if(!response.ok)throw Error("Test session rejected.");
  return {accountId:account,accountLabel:who+"@example.test",token:await accountToken(env,account,bearer,expires)};
}
