import {COOP_RECONNECT_MS} from "../common/coop-recovery.mjs";
// Preserve the existing simulation and ticket during recovery. Abandonment
// uses the engine's ordinary finish(false), never a new run or discarded save.
export class RunRecovery {
  constructor(room,{now=Date.now,nonce=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,"0")).join("")}={}){
    Object.assign(this,{room,now,nonce});this.frozen=false;this.round=0;this.committed=0;
  }
  attach(run){
    const net=run.coop,pause=net?.pause,getter=pause&&Object.getOwnPropertyDescriptor(Object.getPrototypeOf(pause),"frozen")?.get;
    if(!getter||typeof run.finish!=="function"||!["recovered","sendState","sendTotals","sendSnapshots"].every(key=>typeof net[key]==="function"))
      throw Error("Unsupported co-op recovery contract. Your run ticket is preserved.");
    this.run=run;
    const recovery=this,tick=pause.tick.bind(pause);
    Object.defineProperty(pause,"frozen",{configurable:true,get(){return recovery.frozen||getter.call(this);}});
    pause.tick=dt=>tick(recovery.frozen?0:dt);
    // Releasing the mouse makes Give up usable on desktop. Do not let the
    // engine's per-frame armLock immediately capture it again while frozen.
    this.inputHooks=[];
    for(const key of ["requestLock","armLock"]){
      const original=run.input?.[key];
      if(typeof original!=="function")continue;
      const wrapped=function(...args){if(!recovery.frozen)return original.apply(this,args);};
      run.input[key]=wrapped;this.inputHooks.push({key,original,wrapped});
    }
    const dispose=net.dispose?.bind(net);
    if(dispose)net.dispose=()=>{try{return dispose();}finally{this.dispose();}};
    if(this.pendingGiveUp){void this.giveUp(this.pendingGiveUp);return;}
    if(this.frozen)this.releaseInput();
    if(this.frozen)this.show();
  }
  expected(){return this.room.room.members.filter(member=>member.id!==this.room.me&&!this.room.departed.has(member.id)).map(member=>member.id);}
  ready(){return this.room.open&&this.room.session.linked===true&&this.expected().every(id=>this.room.linkState(id)==="open");}
  send(id,data){return this.room.mesh.sendCtl(id,{t:"offline-resume",party:this.room.room.party,...data});}
  all(data){for(const id of this.expected())this.send(id,data);}
  show(){if(globalThis.PokeBonkNativeApp&&globalThis.PokeBonkNativeApp.run!==this.run)return;
    if(this.run&&this.frozen&&(!this.run.coop?.ended||this.expired))
    globalThis.PokeBonkOfflineUI?.coopRecovery?.({
      state:this.saveFailed?"save-error":this.expired?"giving-up":this.syncing?"syncing":"reconnecting",
      reason:this.reason,until:this.until,giveUp:()=>this.giveUp("manual"),
      showResults:()=>globalThis.PokeBonkOfflineUI?.coopRecovery?.({state:"connected"}),
    });}
  releaseInput(){
    this.run?.input?.pressed?.clear();
    for(const key of ["releaseAll","releaseLock"])
      try{this.run?.input?.[key]?.();}catch{/* Input release must not block saving/ending the run. */}
  }
  interrupted(until){
    if(this.disposed||this.expired||this.run?.coop?.ended)return;
    if(!this.frozen){
      this.frozen=true;this.until=Math.min(Number.isSafeInteger(until)?until:Infinity,this.now()+COOP_RECONNECT_MS);
      this.key=null;this.syncedKey=null;this.syncing=false;this.acks=new Set();this.lastSyncAt=-Infinity;
      this.releaseInput();
      globalThis.dispatchEvent?.(new Event("standard:checkpoint"));
      this.timer=setInterval(()=>this.step(),500);
      this.timer?.unref?.();
    }
    this.show();
  }
  update(){
    if(this.disposed||this.expired||this.run?.coop?.ended)return;
    if(!this.ready()){this.interrupted(this.room.session.recovery?.until);return;}
    if(this.frozen)this.step();
  }
  synchronize(){
    if(!this.run)return false;
    if(this.syncedKey===this.key)return true;
    try{
    const net=this.run.coop;
    for(const peer of net.peers.values()){
      if(this.room.departed.has(peer.id)){peer.left=true;net.peerGone(peer);continue;}
      if(this.room.linkState(peer.id)!=="open")continue;
      net.recovered(peer);peer.buf.length=0;peer.last=null;peer.lastAt=-99;
      peer.hbAt=-99;peer.hbTm=peer.hbZt=-1;net.known.get(peer.id)?.clear();
    }
    net.hbDirty=true;net.hbT=0;net.mapFullAt=0;net.mapT=0;
    net.sendState();net.sendTotals(true);net.sendSnapshots();this.syncedKey=this.key;return true;
    }catch{this.fail();return false;}
  }
  step(){
    if(this.disposed||!this.frozen||this.expired)return;
    if(this.now()>=this.until){this.fail("timeout");return;}
    if(!this.ready()||!this.run){this.show();return;}
    const host=this.room.room.host;
    if(host===this.room.me){
      if(!this.key){this.key=this.nonce();this.round++;this.acks=new Set([this.room.me]);if(!this.synchronize())return;}
      this.syncing=true;
      if(this.now()-this.lastSyncAt>=900){this.lastSyncAt=this.now();this.all({k:"sync",nonce:this.key,round:this.round});}
      if(this.frozen&&this.expected().every(id=>this.acks.has(id))){
        this.all({k:"commit",nonce:this.key,round:this.round});this.finish();
      }
    }else if(this.key){
      this.syncing=true;if(!this.synchronize())return;
      this.send(host,{k:"ack",nonce:this.key,round:this.round});
    }else this.send(host,{k:"need",round:this.committed});
    this.show();
  }
  control(peer,data){
    if(data?.t!=="offline-resume")return false;
    if(!this.expected().includes(peer)||data.party!==this.room.room.party||this.disposed||this.expired||this.run?.coop?.ended)return true;
    const host=this.room.room.host;
    if(data.k==="need"){
      if(this.room.me===host&&data.round===this.committed){this.interrupted();this.step();}
      return true;
    }
    if(typeof data.nonce!=="string"||!/^[a-f0-9-]{32,40}$/.test(data.nonce)||
        !Number.isSafeInteger(data.round)||data.round<1||data.round>1000)return true;
    if(data.k==="sync"&&peer===host&&data.round>this.committed){
      this.interrupted();
      if(this.key&&data.round<this.round)return true;
      if(this.key&&data.round===this.round&&this.key!==data.nonce)return true;
      this.key=data.nonce;this.round=data.round;this.syncing=true;this.step();
    }else if(data.k==="ack"&&this.room.me===host&&data.nonce===this.key&&data.round===this.round){
      this.acks.add(peer);this.step();
    }else if(data.k==="commit"&&peer===host&&this.ready()&&this.syncedKey===data.nonce&&
        data.nonce===this.key&&data.round===this.round)this.finish();
    return true;
  }
  finish(){
    if(this.disposed||this.expired||!this.frozen)return;
    clearInterval(this.timer);this.timer=null;this.committed=this.round;this.frozen=false;this.syncing=false;
    this.run?.input?.pressed?.clear();
    if(this.run?.player)this.run.player.iframes=Math.max(this.run.player.iframes??0,2);
    globalThis.PokeBonkOfflineUI?.coopRecovery?.({state:"connected"});
  }
  fail(reason="failed"){return this.giveUp(reason);}
  giveUp(reason="manual"){
    if(this.ending)return this.ending;
    if(this.disposed||this.run?.state==="over"||this.run?.coop?.ended)return Promise.resolve(false);
    clearInterval(this.timer);this.timer=null;
    this.frozen=true;
    // Native failure can arrive while startRun is still attaching its engine.
    if(!this.run){this.pendingGiveUp=reason;return Promise.resolve(false);}
    this.expired=true;this.syncing=false;this.reason=reason;this.key=null;this.acks?.clear();
    const run=this.run,ticketId=run.meta?.ticket?.id;
    // Latch before leaving: native closed events / repeated taps can reenter.
    this.ending=Promise.resolve().then(async()=>{
      if(this.disposed)return false;
      this.releaseInput();this.show();
      if(this.room.open){
        this.room.open=false;
        try{this.room.transmit?.("leave");}catch{/* Finish locally even if the link is already gone. */}
      }
      // No team-end broadcast: only this player's run is abandoned. The
      // ordinary engine result/settlement retains its idempotent local ticket.
      run.endHow="quit";
      await run.finish(false);
      // The engine reports save errors in its results screen instead of
      // rejecting. Keep that screen and the durable checkpoint on failure.
      if(ticketId&&run.meta?.backend?.state?.activeRun?.ticket?.id===ticketId){
        this.saveFailed=true;this.show();return false;
      }
      globalThis.PokeBonkOfflineUI?.coopRecovery?.({state:"connected"});
      return true;
    }).catch(()=>{
      this.saveFailed=true;this.show();return false;
    });
    return this.ending;
  }
  dispose(){
    this.disposed=true;clearInterval(this.timer);this.timer=null;
    for(const {key,original,wrapped} of this.inputHooks??[])
      if(this.run?.input?.[key]===wrapped)this.run.input[key]=original;
    this.inputHooks=[];
    globalThis.PokeBonkOfflineUI?.coopRecovery?.({state:"connected"});
  }
}
