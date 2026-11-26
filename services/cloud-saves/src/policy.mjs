import {CLOUD_MAX_BYTES,cloudHash} from "../../../standard/common/cloud-save.mjs";
export class Fault extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
export function requireValue(ok,code,status=400){if(!ok)throw new Fault(code,status);}
export const random=()=>crypto.randomUUID().replaceAll("-","");
export const secret=()=>btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
export const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{
  "Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
  "Referrer-Policy":"no-referrer"}});
export async function readBody(request,maximum=CLOUD_MAX_BYTES+65536){
  requireValue(/application\/json/i.test(request.headers.get("Content-Type")??""),"json_required");
  const reader=request.body?.getReader();requireValue(reader,"body_required");
  const chunks=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    requireValue(size<=maximum,"body_too_large",413);chunks.push(part.value);}}
  finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new Fault("invalid_json");}
}
export const internal=(path,value)=>new Request("https://internal"+path,{method:"POST",
  headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});
export const equal=(a,b)=>{
  if(typeof a!=="string"||typeof b!=="string"||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;
};
export async function hmac(key,value){
  requireValue(typeof key==="string"&&key.length>=32,"service_not_configured",503);
  const imported=await crypto.subtle.importKey("raw",new TextEncoder().encode(key),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC",imported,new TextEncoder().encode(value)))]
    .map(n=>n.toString(16).padStart(2,"0")).join("");
}
export async function accountToken(env,account,session,expires){
  const payload=`${account}.${session}.${expires}`;
  return payload+"."+await hmac(env.SESSION_SIGNING_KEY,payload);
}
export async function parseToken(request,env){
  const value=request.headers.get("Authorization")??"";
  const match=/^Bearer ([a-f0-9]{64})\.([A-Za-z0-9_-]{43})\.(\d{13})\.([a-f0-9]{64})$/.exec(value);
  requireValue(match,"unauthorized",401);
  const [,account,session,expires,signature]=match,payload=`${account}.${session}.${expires}`;
  requireValue(+expires>Date.now()&&equal(signature,await hmac(env.SESSION_SIGNING_KEY,payload)),"unauthorized",401);
  return {account,sessionHash:await cloudHash(session),expires:+expires};
}
export function configured(env){
  requireValue(env.SERVICE_ENABLED==="true"&&env.SAVES&&env.DIRECTORY&&env.ACCOUNTS&&env.BUDGET&&
    /^[1-9]\d{0,3}$/.test(env.MAX_ACCOUNTS??"")&&Number(env.MAX_ACCOUNTS)<=100&&
    typeof env.GOOGLE_CLIENT_ID==="string"&&env.GOOGLE_CLIENT_ID.endsWith(".apps.googleusercontent.com")&&
    typeof env.GOOGLE_CLIENT_SECRET==="string"&&env.GOOGLE_CLIENT_SECRET.length>=16&&
    env.SESSION_SIGNING_KEY?.length>=32&&env.IP_HASH_SECRET?.length>=32&&
    /^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(env.PUBLIC_ORIGIN??""),
  "service_not_configured",503);
}
