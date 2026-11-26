// Android-only, invisible native-owned WebView. No fetch, sockets or tokens.
// The GAME WebView does not receive PokeBonkCloudNative or these capabilities.
import {CloudSync} from "../common/cloud-sync.mjs";
const native=globalThis.PokeBonkCloudNative;
if(!native)throw Error("Native-only cloud broker.");
const pending=new Map();let serial=0;
function request(op,data={}){
  if(pending.size>=4)return Promise.reject(Error("cloud_busy"));
  const id="c"+(++serial),bytes=new TextEncoder().encode(JSON.stringify({op,data}));
  if(bytes.length>512*1024+65536)return Promise.reject(Error("cloud_save_too_large"));
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{pending.delete(id);const error=Error("network");error.code="network";reject(error);},op==="connect"?665000:30000);
    pending.set(id,{resolve,reject,timeout,parts:null});
    const size=24*1024,total=Math.ceil(bytes.length/size);
    for(let index=0;index<total;index++){
      let text="";for(const byte of bytes.subarray(index*size,(index+1)*size))text+=String.fromCharCode(byte);
      native.request(JSON.stringify({id,index,total,data:btoa(text)}));
    }
  });
}
Object.defineProperty(globalThis,"PokeBonkCloudReply",{value:(id,index,total,text)=>{
  const value=pending.get(id);if(!value||!Number.isSafeInteger(total)||total<1||total>32||index<0||index>=total)return;
  value.parts??=new Array(total);
  if(value.parts.length!==total||value.parts[index]!==undefined)return;
  value.parts[index]=text;if(value.parts.filter(part=>part!==undefined).length!==total)return;
  clearTimeout(value.timeout);pending.delete(id);
  try{
    const chunks=value.parts.map(part=>Uint8Array.from(atob(part),char=>char.charCodeAt(0)));
    const length=chunks.reduce((sum,part)=>sum+part.length,0);if(length>512*1024+65536)throw Error("invalid_cloud_response");
    const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    const response=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    if(response.ok)value.resolve(response.value);
    else{const error=Error(response.error);error.code=response.error;value.reject(error);}
  }catch(error){value.reject(error);}
}});
const config=await request("configuration"),host={
  status:()=>request("status"),preferences:()=>request("preferences"),
  savePreferences:value=>request("save-preferences",value),
  connect:()=>request("connect"),cancel:()=>request("cancel"),disconnect:()=>request("disconnect"),
  snapshot:()=>request("snapshot"),restore:value=>request("restore",value),idle:()=>request("idle"),
  api:(operation,value)=>request("api",{operation,value}),
};
const controller=new CloudSync({config,host,emit:value=>{void request("feedback",value).catch(()=>{});}});
Object.defineProperty(globalThis,"PokeBonkCloudInput",{value:(action,selection)=>{
  if(action==="tick")void controller.tick();
  else void controller.command(action,selection);
}});
await controller.init();
await request("ready");
