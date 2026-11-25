// Bridge the original xg/xpk game messages to durable local ownership receipts.
// A transport reconnect never grants an item a second time.
export class ExpeditionTeamIO {
  constructor(room,{backend=globalThis.PokeBonkNativeApp?.backend,run=()=>globalThis.PokeBonkNativeApp?.run}={}){
    Object.assign(this,{room,backend,getRun:run});this.pending=[];this.serial=Promise.resolve();this.reliable=new Map();
  }
  attach(run){this.run=run;}
  itemKey(data){return data.t+":"+(data.t==="xg"?data.key:data.id);}
  receipt(peer,data){this.raw(peer,{t:"offline-exp-item-ack",party:this.room.room.party,id:this.itemKey(data)});}
  queue(work){
    if(this.pending.length>=96){
      globalThis.PokeBonkNativeApp?.notice("Too many pending Expedition receipts. Your save is preserved.");return false;
    }
    this.pending.push(work);void this.flush().catch(error=>{
      globalThis.PokeBonkNativeApp?.notice("Expedition transfer not saved: "+error.message);
    });
    return true;
  }
  flush(){
    const operation=this.serial.catch(()=>{}).then(async()=>{
      while(this.pending.length){await this.pending[0]();this.pending.shift();}
    });
    this.serial=operation;return operation;
  }
  outgoing(peer,data,transmit){
    if(!["xg","xpk"].includes(data?.t))return false;
    const run=this.run??this.getRun();
    if(run?.mode!=="expedition"||data.g!==run.coop?.gid)return false;
    const result=run.result(false),packet=structuredClone(data);
    this.queue(async()=>{
      await this.backend.recordExpeditionPacket({party:this.room.room.party,peer,direction:"out",data:packet,result});
      this.reliable.set(peer+"|"+this.itemKey(packet),{peer,packet,send:transmit});
      this.pump();this.startTimer();
    });
    return true;
  }
  incoming(peer,data,deliver){
    if(data?.t==="offline-exp-item-ack"){
      if(data.party===this.room.room.party&&typeof data.id==="string"&&data.id.length<=80)
        this.reliable.delete(peer+"|"+data.id);
      return true;
    }
    if(data?.t==="offline-exp-return"){
      if(data.party!==this.room.room.party||!data.receipt||typeof data.receipt.id!=="string"||data.receipt.id.length>220||
        typeof data.receipt.key!=="string"||data.receipt.key.length>40)return true;
      this.queue(async()=>{
        try{await this.backend.receiveExpeditionReturn(data.party,peer,data.receipt);}
        catch(error){if(error.code==="expedition_packet_invalid")return;throw error;}
        this.raw(peer,{t:"offline-exp-ack",party:data.party,id:data.receipt.id});
      });
      return true;
    }
    if(data?.t==="offline-exp-ack"){
      if(data.party===this.room.room.party&&typeof data.id==="string"&&data.id.length<220)
        this.queue(()=>this.backend.acknowledgeExpeditionReturn(data.party,peer,data.id));
      return true;
    }
    const run=this.run??this.getRun();
    if(!["xg","xpk"].includes(data?.t)||run?.mode!=="expedition"||data.g!==run.coop?.gid)return false;
    if(run.state==="over"||run.coop?.ended||data.t==="xg"&&(run.expedition?.took.length??0)>=24||
      data.t==="xpk"&&(run.expedition?.rescuing.length??0)>=24){this.receipt(peer,data);return true;}
    const packet=structuredClone(data),result=run.result(false);
    this.queue(async()=>{
      let first;
      try{first=await this.backend.recordExpeditionPacket({party:this.room.room.party,peer,direction:"in",data:packet,result});}
      catch(error){if(error.code==="expedition_packet_invalid")return;throw error;}
      if(first)deliver(peer,packet);
      this.receipt(peer,packet);
    });
    return true;
  }
  raw(peer,payload){return this.room.open&&!this.room.gone.has(peer)&&this.room.transmit("ctl",{to:peer,payload});}
  peerLeft(peer){
    for(const [key,value]of this.reliable)if(value.peer===peer)this.reliable.delete(key);
    this.pump();
  }
  pump(){
    if(!this.room.open)return;
    for(const value of this.reliable.values())if(!this.room.gone.has(value.peer))value.send(value.peer,value.packet);
    if(this.isSettled){
      try {
        const pending=this.backend.expeditionReturns(this.room.room.party);
        for(const receipt of pending)this.raw(receipt.to,{t:"offline-exp-return",party:this.room.room.party,receipt});
        const deliverable=pending.some(receipt=>!this.room.departed.has(receipt.to));
        if(!deliverable&&!this.reliable.size&&!this.returned){
          this.returned=true;this.room.transmit("room-return",this.room.room.party);
        }
      }catch{/* Pending returns remain in the native save. */}
    }
  }
  startTimer(){if(!this.timer){this.timer=setInterval(()=>this.pump(),1500);this.timer.unref?.();}}
  settled(){this.isSettled=true;this.pump();this.startTimer();}
  dispose(){clearInterval(this.timer);this.timer=null;}
}
