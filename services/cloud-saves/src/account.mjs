import {canonicalJSON,cloudSnapshot,CLOUD_MAX_BYTES,CLOUD_HISTORY,revisionOK,hashOK} from "../../../standard/common/cloud-save.mjs";
import {Fault,requireValue,random,json,readBody,equal} from "./policy.mjs";
import {reserveCloudUsage} from "./budget.mjs";
const saveConfig={saveSchema:1,compatibleRunBuilds:[]};
export class CloudAccount{
  constructor(ctx,env){Object.assign(this,{ctx,env});this.queue=Promise.resolve();}
  fetch(request){
    const task=this.queue.catch(()=>{}).then(()=>this.route(request)).catch(error=>json({error:error instanceof Fault?error.code:"storage_unavailable"},error.status??503));
    this.queue=task;return task;
  }
  async route(request){
    const path=new URL(request.url).pathname,value=await readBody(request);
    const state=await this.ctx.storage.get("account")??{head:null,revisions:[],sessions:{},writes:[],reads:[]};
    const now=Date.now();
    for(const [key,session]of Object.entries(state.sessions))if(session.expires<=now)delete state.sessions[key];
    if(path==="/session"){
      requireValue(/^[a-f0-9]{64}$/.test(value.sessionHash)&&Number.isSafeInteger(value.expires)&&value.expires>now,"invalid_session");
      requireValue(Object.keys(state.sessions).length<8,"device_limit",429);
      state.sessions[value.sessionHash]={expires:value.expires,label:String(value.label).slice(0,120)};
      await this.ctx.storage.put("account",state);return json({ok:true});
    }
    requireValue(value.auth&&state.sessions[value.auth.sessionHash]?.expires===value.auth.expires,"unauthorized",401);
    if(path==="/logout"){
      delete state.sessions[value.auth.sessionHash];await this.ctx.storage.put("account",state);return json({ok:true});
    }
    state.reads=state.reads.filter(at=>now-at<60000);requireValue(state.reads.length<60,"rate_limited",429);state.reads.push(now);
    await this.ctx.storage.put("account",state);
    if(path==="/head")return json({head:state.head});
    if(path==="/history")return json({revisions:state.revisions});
    if(path==="/read"){
      requireValue(revisionOK(value.revision),"invalid_revision");
      const head=state.revisions.find(row=>row.revision===value.revision);
      requireValue(head,"backup_not_found",404);
      await reserveCloudUsage(this.env,"read");
      const object=await this.env.SAVES.get(`${value.auth.account}/${head.revision}.json`);
      requireValue(object&&object.size<=CLOUD_MAX_BYTES,"backup_unavailable",503);
      const text=await object.text();requireValue(new TextEncoder().encode(text).length<=CLOUD_MAX_BYTES,"backup_unavailable",503);
      const data=await cloudSnapshot(JSON.parse(text),saveConfig);
      requireValue(equal(data.hash,head.hash),"cloud_hash_mismatch",503);
      return json({head,save:data.save});
    }
    requireValue(path==="/commit","not_found",404);
    requireValue(value.parent===null||revisionOK(value.parent),"invalid_parent");
    requireValue(revisionOK(value.requestId)&&hashOK(value.hash),"invalid_commit");
    // Replays after a lost response are idempotent, never a second reward/commit.
    const replay=state.revisions.find(row=>row.requestId===value.requestId);
    if(replay){requireValue(replay.hash===value.hash,"request_reused",409);return json({head:replay});}
    requireValue((state.head?.revision??null)===value.parent,"conflict",409);
    state.writes=state.writes.filter(at=>now-at<60000);requireValue(state.writes.length<6,"rate_limited",429);
    const data=await cloudSnapshot(value.save,saveConfig);
    requireValue(equal(data.hash,value.hash),"cloud_hash_mismatch");
    const revision=random(),head={revision,parent:value.parent,hash:data.hash,createdAt:now,summary:data.summary,requestId:value.requestId};
    const key=`${value.auth.account}/${revision}.json`;
    // Reserve two Class A operations before either list or put. A failed
    // attempt still consumes its reservation; cleanup deletes are unmetered.
    await reserveCloudUsage(this.env,"commit");
    const prefix=value.auth.account+"/",objects=await this.env.SAVES.list({prefix,limit:CLOUD_HISTORY+2});
    const retained=new Set(state.revisions.map(row=>prefix+row.revision+".json"));
    for(const object of objects.objects)if(!retained.has(object.key))await this.env.SAVES.delete(object.key);
    requireValue(!objects.truncated,"storage_cleanup_required",503);
    // R2 object is immutable; the serialized DO is the sole head authority.
    const stored=await this.env.SAVES.put(key,data.text,{onlyIf:{etagDoesNotMatch:"*"},
      httpMetadata:{contentType:"application/json"},customMetadata:{sha256:data.hash}});
    requireValue(stored,"revision_collision",503);
    state.writes.push(now);const previous=state.revisions;
    state.revisions=[head,...previous].slice(0,CLOUD_HISTORY);state.head=head;
    try{await this.ctx.storage.put("account",state);}
    catch(error){await this.env.SAVES.delete(key).catch(()=>{});throw error;}
    const expired=previous.filter(row=>!state.revisions.some(current=>current.revision===row.revision));
    // Failing retention cleanup must not roll back a committed head. Retained
    // metadata stays bounded; an operator can sweep orphan objects separately.
    for(const row of expired)await this.env.SAVES.delete(`${value.auth.account}/${row.revision}.json`).catch(()=>{});
    return json({head});
  }
}
