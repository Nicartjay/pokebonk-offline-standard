// Portable, completed progression. Shared by native desktop, the isolated
// Android cloud broker and the private Worker. No network or filesystem APIs.
import {validateEnvelope} from "./state.mjs";
export const CLOUD_PROTOCOL=1;
export const CLOUD_MAX_BYTES=512*1024;
export const CLOUD_HISTORY=10;
export const revisionOK=value=>typeof value==="string"&&/^[a-f0-9]{32}$/.test(value);
export const hashOK=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
export function cloudError(code){const error=Error(code);error.code=code;return error;}
export function canonicalJSON(value){
  if(value===null||typeof value!=="object")return JSON.stringify(value);
  if(Array.isArray(value))return "["+value.map(canonicalJSON).join(",")+"]";
  return "{"+Object.keys(value).sort().map(key=>JSON.stringify(key)+":"+canonicalJSON(value[key])).join(",")+"}";
}
export async function cloudHash(text){
  const bytes=typeof text==="string"?new TextEncoder().encode(text):text;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
}
export function completedProgress(saved,config){
  if(!saved)throw cloudError("no_local_save");
  validateEnvelope(saved,config);
  const state=saved.state;
  if(state.activeRun||state.suspended||state.profile.exp?.raid)throw cloudError("unfinished_run");
  for(const party of Object.values(state.expeditionTeams?.parties??{}))
    if(!party.settled||party.pending?.length)throw cloudError("pending_expedition_returns");
  return saved;
}
export function portableCloudSave(saved,config){
  completedProgress(saved,config);
  const value=JSON.parse(JSON.stringify(saved));
  // Native file generations and device identities are never cloud identity.
  delete value.nativeEpoch;
  value.state.playerId="offline-cloud-progress";
  value.state.updatedAt=0;
  value.state.profile.settings={};
  // Settled peer receipts belong to the old device/session, not a new team.
  delete value.state.expeditionTeams;
  const allowed={format:value.format,edition:value.edition,schemaVersion:value.schemaVersion,
    upstream:value.upstream,state:value.state};
  const text=canonicalJSON(allowed);
  if(new TextEncoder().encode(text).length>CLOUD_MAX_BYTES)throw cloudError("cloud_save_too_large");
  return JSON.parse(text);
}
export async function cloudSnapshot(saved,config){
  const save=portableCloudSave(saved,config),text=canonicalJSON(save);
  return {save,text,hash:await cloudHash(text),summary:cloudSaveSummary(save)};
}
export function cloudSaveSummary(saved){
  const p=saved.state.profile;
  return {name:p.name.slice(0,80),usable:p.league.length,stardust:Math.floor(p.stardust??0)};
}
export function mergeCloudSave(remote,local,config){
  const value=portableCloudSave(remote,config);
  value.state.playerId=local?.state.playerId??"offline-"+crypto.randomUUID();
  value.state.updatedAt=Date.now();
  value.state.profile.settings=structuredClone(local?.state.profile.settings??{});
  validateEnvelope(value,config);
  return value;
}
export function cloudOrigin(config){
  if(config?.cloudSaves?.enabled!==true)return null;
  try{
    const url=new URL(config.cloudSaves.url);
    if(url.protocol!=="https:"||url.port||url.username||url.password||url.pathname!=="/"||url.search||url.hash||
      !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname))return null;
    return url.origin;
  }catch{return null;}
}
export function cloudHead(value){
  if(value===null)return null;
  if(!value||!revisionOK(value.revision)||!hashOK(value.hash)||
    value.parent!==null&&!revisionOK(value.parent)||!Number.isSafeInteger(value.createdAt)||value.createdAt<0)
    throw cloudError("invalid_cloud_response");
  return {revision:value.revision,parent:value.parent,hash:value.hash,createdAt:value.createdAt,
    summary:value.summary&&{name:String(value.summary.name??"Trainer").slice(0,80),
      usable:Number.isSafeInteger(value.summary.usable)&&value.summary.usable>=0?value.summary.usable:0,
      stardust:Number.isSafeInteger(value.summary.stardust)&&value.summary.stardust>=0?value.summary.stardust:0}};
}
