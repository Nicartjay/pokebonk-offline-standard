// Native desktop capabilities. Never copied into the game renderer.
import {readFile,lstat} from "node:fs/promises";
import path from "node:path";
import {atomicWrite} from "../common/store.mjs";
import {cloudOrigin,cloudHash,cloudError,CLOUD_MAX_BYTES,revisionOK,hashOK} from "../common/cloud-save.mjs";
import {cloudReturnId} from "../common/cloud-return.mjs";
import {createCloudLoopback} from "./cloud-loopback.mjs";
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export class DesktopCloudHost{
  constructor({config,directory,safeStorage,idle,openBrowser,reload,onLogin=()=>{},onReturn=()=>{},request=fetch,
    platform=process.platform,openLoopback=createCloudLoopback}){
    Object.assign(this,{config,directory,safeStorage,idle,openBrowser,reload,onLogin,onReturn,request,platform,openLoopback});
    this.authFile=path.join(directory,"cloud-account-v1.bin");this.prefsFile=path.join(directory,"cloud-sync-v1.json");
    this.loginGeneration=0;
  }
  get sessionOnly(){return this.platform==="darwin";}
  async secure(){
    if(this.sessionOnly)return; // Never initialize/read the Mac Keychain.
    const storage=this.safeStorage;
    if(this.platform==="linux"){
      // Use the same provider for availability, backend selection and crypto.
      // Async portal availability must not accidentally bless basic_text.
      if(!storage?.isEncryptionAvailable?.()||!["gnome_libsecret","kwallet","kwallet5","kwallet6","secret_service","portal"]
        .includes(storage.getSelectedStorageBackend?.()))throw cloudError("secure_storage_unavailable");
      this.cryptoMode="sync";return;
    }
    const available=typeof storage?.isAsyncEncryptionAvailable==="function"?await storage.isAsyncEncryptionAvailable():storage?.isEncryptionAvailable();
    if(!available)throw cloudError("secure_storage_unavailable");
    this.cryptoMode=typeof storage.encryptStringAsync==="function"&&typeof storage.decryptStringAsync==="function"?"async":"sync";
  }
  async loadSession(){
    if(this.sessionOnly){
      if(this.memorySession?.expiresAt<=Date.now())this.memorySession=null;
      return this.memorySession?structuredClone(this.memorySession):null;
    }
    try{
      const info=await lstat(this.authFile);if(!info.isFile()||info.size>8192)throw cloudError("secure_storage_unavailable");
      await this.secure();
      const bytes=await readFile(this.authFile),storage=this.safeStorage;
      // Electron's asynchronous API returns {result, shouldReEncrypt}, not a
      // string. Parsing that object hid a successful Keychain login as a failure.
      const decrypted=this.cryptoMode==="async"?await storage.decryptStringAsync(bytes):null;
      const text=this.cryptoMode==="async"?decrypted?.result:storage.decryptString(bytes);
      if(typeof text!=="string")throw cloudError("secure_storage_unavailable");
      const data=JSON.parse(text);
      if(data.origin!==cloudOrigin(this.config)||!hashOK(data.accountId)||typeof data.token!=="string"||
        data.token.length>256||!Number.isSafeInteger(data.expiresAt)||data.expiresAt<=Date.now())return null;
      if(decrypted?.shouldReEncrypt===true)await this.saveSession(data);
      return data;
    }catch(error){if(error.code==="ENOENT")return null;throw cloudError("secure_storage_unavailable");}
  }
  async saveSession(value){
    if(this.sessionOnly){
      if(value?.origin!==cloudOrigin(this.config)||!hashOK(value.accountId)||typeof value.token!=="string"||
        value.token.length>256||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now())throw cloudError("invalid_cloud_response");
      this.memorySession=structuredClone(value);return;
    }
    await this.secure();const storage=this.safeStorage,text=JSON.stringify(value);
    const encrypted=this.cryptoMode==="async"?await storage.encryptStringAsync(text):storage.encryptString(text);
    await atomicWrite(this.authFile,encrypted);
  }
  async clearSession(){
    // Dormant legacy Mac ciphertext is deliberately not read/decrypted/deleted.
    if(this.sessionOnly){this.memorySession=null;return;}
    // Other platforms remove the protected credential; no plaintext copy is
    // written. Mac's dormant legacy record is never opened or migrated.
    const {rm}=await import("node:fs/promises");await rm(this.authFile,{force:true});
  }
  async status(){
    const data=await this.loadSession();
    return data?{accountId:data.accountId,accountLabel:data.accountLabel}:null;
  }
  async call(route,data,token,timeoutMs=20000){
    const origin=cloudOrigin(this.config);if(!origin)throw cloudError("not-configured");
    if(!["login/start","login/poll","head","history","read","commit","logout"].includes(route))throw cloudError("invalid_cloud_action");
    let response;
    try{response=await this.request(origin+"/v1/"+route,{method:"POST",redirect:"error",credentials:"omit",
      headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},
      body:JSON.stringify(data??{}),signal:AbortSignal.timeout(timeoutMs)});}
    catch{throw cloudError("network");}
    const reader=response.body?.getReader();if(!reader)throw cloudError("network");
    const chunks=[];let size=0;
    try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;
      if(size>CLOUD_MAX_BYTES+65536)throw cloudError("invalid_cloud_response");chunks.push(item.value);}}
    finally{await reader.cancel().catch(()=>{});}
    const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
    let value;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw cloudError("invalid_cloud_response");}
    if(!response.ok)throw cloudError(typeof value.error==="string"&&/^[a-z_]{1,64}$/.test(value.error)?value.error:"cloud_unavailable");
    return value;
  }
  async connect(){
    if(this.closed)throw cloudError("cancelled");
    this.returnLogin=null;this.loopback?.close();this.loopback=null;
    const generation=++this.loginGeneration;
    await this.secure();
    if(generation!==this.loginGeneration)throw cloudError("cancelled");
    let loopback,connected=false;
    try{
    if(this.sessionOnly){
      loopback=await this.openLoopback({origin:cloudOrigin(this.config),onReturn:()=>{
        if(generation===this.loginGeneration&&this.returnLogin?.expiresAt>Date.now())this.onReturn();
      }});
      this.loopback=loopback;
      if(generation!==this.loginGeneration)throw cloudError("cancelled");
    }
    const verifier=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    const login=await this.call("login/start",{challenge:await cloudHash(verifier),...(loopback?{returnTo:loopback.url}:{})});
    if(!revisionOK(login.id)||!Number.isSafeInteger(login.expiresAt)||login.expiresAt<=Date.now()||login.expiresAt>Date.now()+11*60000||
      loopback&&login.returnMode!=="loopback")throw cloudError("invalid_cloud_response");
    if(generation!==this.loginGeneration)throw cloudError("cancelled");
    this.returnLogin={id:login.id,expiresAt:login.expiresAt};
    this.onLogin(login.id.slice(0,8).toUpperCase());
    await this.openBrowser(cloudOrigin(this.config)+"/auth/start/"+login.id);
    while(Date.now()<login.expiresAt){
      if(generation!==this.loginGeneration)throw cloudError("cancelled");
      await pause(2500);
      const value=await this.call("login/poll",{id:login.id,verifier});
      if(value.pending)continue;
      if(!hashOK(value.accountId)||typeof value.accountLabel!=="string"||value.accountLabel.length>120||
        typeof value.token!=="string"||!new RegExp("^"+value.accountId+"\\.[A-Za-z0-9_-]{43}\\.\\d{13}\\.[a-f0-9]{64}$").test(value.token)||
        !Number.isSafeInteger(value.expiresAt)||value.expiresAt<=Date.now())throw cloudError("invalid_cloud_response");
      if(generation!==this.loginGeneration){await this.call("logout",{},value.token).catch(()=>{});throw cloudError("cancelled");}
      await this.saveSession({...value,origin:cloudOrigin(this.config)});
      if(generation!==this.loginGeneration){await this.clearSession();await this.call("logout",{},value.token).catch(()=>{});throw cloudError("cancelled");}
      connected=true;loopback?.finishLogin();
      return {accountId:value.accountId,accountLabel:value.accountLabel};
    }
    throw cloudError("login_expired");
    }finally{
      if(!connected){loopback?.close();if(this.loopback===loopback)this.loopback=null;}
    }
  }
  acceptsReturn(url){
    return !this.sessionOnly&&Boolean(this.returnLogin&&this.returnLogin.expiresAt>Date.now()&&cloudReturnId(url)===this.returnLogin.id);
  }
  async cancel(){this.loginGeneration++;this.returnLogin=null;this.loopback?.close();this.loopback=null;}
  async close(){
    this.closed=true;await this.cancel();
    if(!this.sessionOnly)return;
    const session=this.memorySession;this.memorySession=null;
    // Best effort, bounded revocation avoids accumulating a device session on
    // every normal Mac quit. A crash/offline quit still loses the local token.
    if(session)await this.call("logout",{},session.token,1200).catch(()=>{});
  }
  async disconnect(){
    await this.cancel();
    const session=await this.loadSession().catch(()=>null);
    await this.clearSession();
    if(session)await this.call("logout",{},session.token).catch(()=>{});
  }
  async api(operation,data){
    if(!["head","history","read","commit"].includes(operation))throw cloudError("invalid_cloud_action");
    const session=await this.loadSession();if(!session)throw cloudError("unauthorized");
    return this.call(operation,data,session.token);
  }
  async preferences(){
    try{
      const info=await lstat(this.prefsFile);if(!info.isFile()||info.size>4096)return {automatic:false};
      const value=JSON.parse(await readFile(this.prefsFile,"utf8"));return this.cleanPreferences(value);
    }catch{return {automatic:false};}
  }
  cleanPreferences(value){
    return {automatic:value?.automatic===true,...(hashOK(value?.accountId)?{accountId:value.accountId}:{}),
      ...(revisionOK(value?.base)?{base:value.base}:{}),...(hashOK(value?.baseHash)?{baseHash:value.baseHash}:{}),
      ...(Number.isSafeInteger(value?.syncedAt)&&value.syncedAt>=0?{syncedAt:value.syncedAt}:{})};
  }
  async savePreferences(value){await atomicWrite(this.prefsFile,JSON.stringify(this.cleanPreferences(value)));}
}
