// One sync state machine on all desktop OSes and Android's native-owned
// isolated broker. Capabilities are injected by the native host, never the game.
import {cloudSnapshot,cloudHead,cloudOrigin,cloudError,revisionOK} from "./cloud-save.mjs";
const clone=value=>structuredClone(value);
export class CloudSync {
  constructor({config,host,emit,now=Date.now}){
    Object.assign(this,{config,host,emit,now});this.value={state:"unavailable",connected:false,automatic:false,reason:"not-configured"};
    this.generation=0;this.nextCheck=0;this.pending=null;this.busy=false;
  }
  publish(state,extra={}){
    const value={state,connected:Boolean(this.session),automatic:Boolean(this.session&&this.meta?.automatic),
      ...(this.host.sessionOnly===true?{sessionOnly:true}:{}),
      ...(this.session?{accountLabel:this.session.accountLabel}:{}),
      ...(this.meta?.syncedAt?{lastSyncedLabel:new Date(this.meta.syncedAt).toLocaleString()}:{}),...extra,
      ...(this.quiet?{open:false}:{})};
    this.value=value;this.emit(clone(value));return value;
  }
  async init(){
    if(this.initialized)return;
    if(this.initializing)return this.initializing;
    this.initializing=this.initialize();
    try{return await this.initializing;}finally{this.initializing=null;}
  }
  async initialize(){
    if(this.initialized)return;
    if(!cloudOrigin(this.config)){this.initialized=true;this.publish("unavailable",{reason:"not-configured"});return;}
    try{
      this.session=await this.host.status();
      this.meta=await this.host.preferences();
    }catch(error){
      this.session=null;this.meta={automatic:false};this.initialized=true;
      this.publish("error",{reason:error.code??"secure_storage_unavailable"});return;
    }
    if(!this.meta||this.meta.accountId!==this.session?.accountId)this.meta={accountId:this.session?.accountId??null,automatic:false};
    this.initialized=true;
    this.publish(this.session?"connected":"off");
  }
  async command(action,selection){
    if(action==="cancel"){this.generation++;await this.host.cancel();this.busy=false;return this.publish(this.session?"connected":"off",{open:true});}
    if(this.busy)return;
    this.busy=true;const generation=this.generation;
    try{
      await this.init();
      if(!cloudOrigin(this.config))return this.publish("unavailable",{reason:"not-configured",open:true});
      if(action==="open")return await this.refresh(false);
      if(action==="connect"){
        if(!await this.host.idle())throw cloudError("room_active");
        this.publish("connecting",{open:true});
        this.session=await this.host.connect();
        if(generation!==this.generation)return;
        this.meta={accountId:this.session.accountId,automatic:false};
        await this.host.savePreferences(this.meta);
        // Connection alone does not upload/restore, even on a fresh device.
        // Browser consent may finish before the five-second app return. Keep
        // the successful connection, rather than treating background focus as
        // an active-room error or reading progress outside the safe idle gate.
        if(!await this.host.idle())return this.publish("connected",{open:true});
        return await this.refresh(false);
      }
      if(action==="disconnect"){
        await this.host.disconnect();this.session=null;this.meta={automatic:false};this.pending=null;
        await this.host.savePreferences(this.meta);return this.publish("off",{open:true});
      }
      if(!this.session)throw cloudError("sign_in_required");
      if(action==="auto-on"||action==="auto-off"){
        this.meta.automatic=action==="auto-on";await this.host.savePreferences(this.meta);
        return await this.refresh(false);
      }
      if(action==="sync")return await this.refresh(true);
      if(action==="backups"){
        const result=await this.host.api("history",{});
        if(!Array.isArray(result.revisions)||result.revisions.length>10)throw cloudError("invalid_cloud_response");
        this.history=result.revisions.map(cloudHead);
        return this.publish("backups",{backups:this.history,open:true});
      }
      if(action==="review-backup"){
        if(!revisionOK(selection)||!this.history?.some(row=>row.revision===selection))throw cloudError("invalid_backup");
        const local=await this.local(),remote=await this.remote(selection),head=cloudHead((await this.host.api("head",{})).head);
        this.pending={kind:"restore",local,remote,head};
        return this.publish("confirm-restore",{local:local.summary,cloud:this.summary(remote.head),open:true});
      }
      if(action==="review-local"||action==="review-cloud"){
        if(!this.observed)throw cloudError("review_save_first");
        const local=await this.local(),head=cloudHead((await this.host.api("head",{})).head);
        if(local.hash!==this.observed.local.hash||head?.revision!==this.observed.head?.revision)return this.refresh(false);
        const remote=head?await this.remote(head.revision):null;
        this.pending={kind:action==="review-local"?"upload":"restore",local,remote,head};
        return this.publish(action==="review-local"?"confirm-upload":"confirm-restore",
          {local:local.summary,cloud:remote?this.summary(remote.head):undefined,open:true});
      }
      if(action==="confirm-local"||action==="confirm-cloud"){
        const choice=this.pending;this.pending=null;
        if(!choice||choice.kind!==(action==="confirm-local"?"upload":"restore"))throw cloudError("review_save_first");
        const local=await this.local(),head=cloudHead((await this.host.api("head",{})).head);
        if(local.hash!==choice.local.hash||head?.revision!==choice.head?.revision)return this.refresh(false);
        if(choice.kind==="upload")return await this.upload(local,head);
        return await this.restore(local,choice.remote,head);
      }
      throw cloudError("unknown_cloud_action");
    }catch(error){
      if(generation!==this.generation)return;
      if(error.code==="unauthorized"){this.session=null;this.pending=null;}
      return this.publish(["unfinished_run","pending_expedition_returns","cloud_save_too_large","room_active","no_local_save"].includes(error.code)?"blocked":
        error.code==="network"?"offline":"error",{reason:error.code??"cloud_unavailable",open:true});
    }finally{if(generation===this.generation)this.busy=false;}
  }
  summary(head){return {...head.summary,savedLabel:new Date(head.createdAt).toLocaleString()};}
  async local(){
    if(!await this.host.idle())throw cloudError("room_active");
    const snapshot=await this.host.snapshot();
    const data=await cloudSnapshot(snapshot.save,this.config);
    return {...data,stamp:snapshot.stamp,summary:{...data.summary,savedLabel:"On this device"}};
  }
  async remote(revision){
    const value=await this.host.api("read",{revision}),head=cloudHead(value.head);
    const data=await cloudSnapshot(value.save,this.config);
    if(head.revision!==revision||data.hash!==head.hash)throw cloudError("cloud_hash_mismatch");
    return {head,...data};
  }
  async refresh(sync){
    if(!this.session)return this.publish("off",{open:true});
    this.publish("checking");
    const local=await this.local(),value=await this.host.api("head",{}),head=cloudHead(value.head);
    this.observed={local,head};
    if(head?.hash===local.hash){
      this.meta={...this.meta,base:head.revision,baseHash:head.hash,syncedAt:this.now()};
      await this.host.savePreferences(this.meta);
      return this.publish("synced",{local:local.summary,cloud:this.summary(head),open:true});
    }
    // Do not choose a remote branch merely because a timestamp looks newer.
    const localChanged=local.hash!==this.meta.baseHash,remoteChanged=(head?.revision??null)!==(this.meta.base??null);
    if(sync&&!remoteChanged)return this.upload(local,head);
    if(sync&&!localChanged&&head)return this.restore(local,await this.remote(head.revision),head);
    this.observed={local,head};
    return this.publish(localChanged&&remoteChanged?"conflict":"review",
      {local:local.summary,cloud:head?this.summary(head):undefined,open:true});
  }
  async upload(local,head){
    this.publish("syncing",{local:local.summary,cloud:head?this.summary(head):undefined});
    try{
      if(!await this.host.idle())throw cloudError("room_active");
      const value=await this.host.api("commit",{parent:head?.revision??null,hash:local.hash,save:local.save,
        requestId:crypto.randomUUID().replaceAll("-","")});
      const next=cloudHead(value.head);
      if(next.hash!==local.hash)throw cloudError("cloud_hash_mismatch");
      this.meta={...this.meta,base:next.revision,baseHash:local.hash,syncedAt:this.now()};
      await this.host.savePreferences(this.meta);
      this.observed={local,head:next};
      return this.publish("synced",{local:local.summary,cloud:this.summary(next),open:true});
    }catch(error){if(error.code==="conflict")return this.refresh(false);throw error;}
  }
  async restore(local,remote,expectedHead){
    if(!remote)throw cloudError("cloud_save_missing");
    if(!await this.host.idle())throw cloudError("room_active");
    const head=cloudHead((await this.host.api("head",{})).head);
    if(head?.revision!==expectedHead?.revision)return this.refresh(false);
    this.publish("syncing");
    // Native atomic compare-and-restore independently rechecks the file stamp,
    // creates an immutable backup, preserves device settings and fences old
    // renderer writes before reloading the game. No save is merged additively.
    await this.host.restore({stamp:local.stamp,save:remote.save});
    const restored={...remote,summary:{...remote.summary,savedLabel:"On this device"}};
    this.observed={local:restored,head};
    // An older backup creates a local branch. Show the actual current cloud
    // head immediately, not a misleading "backed up" state with the old copy.
    if(remote.head.revision!==head?.revision){
      this.meta={...this.meta,base:null};delete this.meta.baseHash;
      await this.host.savePreferences(this.meta);
      return this.publish("review",{local:restored.summary,cloud:head?this.summary(head):undefined,open:true});
    }
    this.meta={...this.meta,base:head?.revision??null,baseHash:remote.hash,syncedAt:this.now()};
    await this.host.savePreferences(this.meta);
    return this.publish("synced",{local:restored.summary,cloud:this.summary(remote.head),open:true});
  }
  async tick(){
    if(this.ticking||this.busy||this.now()<this.nextCheck||!cloudOrigin(this.config))return;
    this.ticking=true;
    try{
      await this.init();
      if(!this.session||!this.meta.automatic||!await this.host.idle())return;
      this.nextCheck=this.now()+60000;this.quiet=true;
      await this.command("sync");
    }catch{/* Automatic failures never block local play. */}
    finally{this.quiet=false;this.ticking=false;}
  }
}
