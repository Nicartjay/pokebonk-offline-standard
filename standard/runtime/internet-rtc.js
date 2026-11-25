import {internetDescription,selectedInternetRoute} from "../common/internet-coop.mjs";
import {StunFirstPolicy} from "./stun-first.js";
// Trusted broker only. No media tracks, assets, or issuer/analytics keys.
const MAX_GENERATION=96, RATE=128*1024, BURST=256*1024;
export class InternetMesh {
  constructor({emit,relay,mode,Peer=globalThis.RTCPeerConnection}){Object.assign(this,{emit,relay,mode,Peer});this.peers=new Map();this.failedPeers=new Set();this.rounds=new Map();}
  drop(id){
    this.failedPeers.delete(id);
    const p=this.peers.get(id);if(!p)return;this.peers.delete(id);
    clearTimeout(p.timeout);clearTimeout(p.renewTimer);clearTimeout(p.disconnectTimer);p.policy.close();
    p.ice?.removeEventListener("selectedcandidatepairchange",p.routeCheck);
    for(const c of [p.ctl,p.snap]){c.onmessage=c.onopen=c.onclose=null;try{c.close();}catch{}}
    p.pc.onconnectionstatechange=p.pc.oniceconnectionstatechange=null;try{p.pc.close();}catch{}
  }
  close(){for(const id of [...this.peers.keys()])this.drop(id);this.failedPeers.clear();this.rounds.clear();}
  fail(p,code="peer_link_failed"){
    if(this.peers.get(p.id)!==p)return;
    // Room snapshots continue to contain a timed-out peer until the server
    // removes its seat. Never turn those snapshots into blind ICE/API retries.
    this.drop(p.id);this.failedPeers.add(p.id);
    this.emit({type:"link",peer:p.id,open:false,round:p.round});this.emit({type:"failed",peer:p.id,code,round:p.round});
  }
  armRenewal(p){
    clearTimeout(p.renewTimer);
    if(p.route!=="turn" || !p.expiresAt || p.restarting)return;
    p.renewTimer=setTimeout(()=>void this.restart(p.id,p.attempt+1),Math.max(1000,p.expiresAt-Date.now()-90000));
  }
  async configure(id,offerer,round=0){
    if(this.rounds.get(id)===round&&(this.peers.has(id)||this.failedPeers.has(id)))return;
    this.drop(id);this.rounds.set(id,round);
    if(this.peers.size>=3)throw Error("Rooms support at most four players.");
    const policy=new StunFirstPolicy({mode:this.mode,requestRelay:()=>this.relay(id)});
    const pc=new this.Peer(policy.begin());
    const p={id,pc,policy,offerer,round,attempt:0,route:"connecting",tokens:BURST,tokenAt:Date.now(),
      ctl:pc.createDataChannel("ctl",{negotiated:true,id:0,ordered:true}),
      snap:pc.createDataChannel("snap",{negotiated:true,id:1,ordered:false,maxRetransmits:0})};
    this.peers.set(id,p);p.snap.binaryType="arraybuffer";
    const emit=value=>{if(this.peers.get(id)===p)this.emit({...value,peer:id,round:p.round});};
    p.routeCheck=()=>{
      if(typeof pc.getStats!=="function")return;
      void pc.getStats().then(stats=>{
        if(this.peers.get(id)!==p || p.ctl.readyState!=="open" || p.snap.readyState!=="open")return;
        p.route=selectedInternetRoute(stats);p.policy.selected({kind:p.route});
        const transport=[...stats.values()].find(value=>value.type==="transport"&&value.selectedCandidatePairId);
        const ufrag=/^a=ice-ufrag:(.+)\r?$/m.exec(pc.localDescription?.sdp??"")?.[1]?.trim();
        if(p.remoteAttempt===p.attempt && (!transport?.iceLocalUsernameFragment || transport.iceLocalUsernameFragment===ufrag))
          clearTimeout(p.timeout);
        emit({type:"route",route:p.route});this.armRenewal(p);
      }).catch(()=>{});
    };
    const opened=()=>{
      if(p.ctl.readyState==="open"&&p.snap.readyState==="open"){
        clearTimeout(p.disconnectTimer);
        clearTimeout(p.timeout);p.policy.selected({kind:"direct"});
        if(!p.linkOpen){p.linkOpen=true;emit({type:"link",open:true});}
        if(!p.ice){p.ice=pc.sctp?.transport?.iceTransport;p.ice?.addEventListener("selectedcandidatepairchange",p.routeCheck);}
        p.routeCheck();
      }
    };
    const disconnected=()=>{
      if(!p.linkOpen)return;
      p.linkOpen=false;emit({type:"link",open:false});
      clearTimeout(p.disconnectTimer);
      p.disconnectTimer=setTimeout(()=>{
        if(this.peers.get(id)===p&&!["connected","completed"].includes(pc.iceConnectionState)&&pc.connectionState!=="connected")this.fail(p);
      },2500);
    };
    for(const c of [p.ctl,p.snap]){c.onopen=opened;c.onclose=()=>{if(this.peers.get(id)===p)this.fail(p);};}
    p.ctl.onmessage=event=>{
      if(typeof event.data!=="string"||event.data.length>32768)return;
      try{const data=JSON.parse(event.data);if(data&&typeof data.t==="string")emit({type:"frame",channel:"ctl",data});}catch{}
    };
    p.snap.onmessage=event=>{
      if(!(event.data instanceof ArrayBuffer)||event.data.byteLength>16384)return;
      let text="";for(const byte of new Uint8Array(event.data))text+=String.fromCharCode(byte);
      emit({type:"frame",channel:"snap",data:btoa(text)});
    };
    pc.onconnectionstatechange=()=>{
      if(pc.connectionState==="failed"){
        p.policy.selected({kind:"disconnected"});
        if(p.attempt===0)void this.fallback(id);else this.fail(p);
      }else if(pc.connectionState==="closed")this.fail(p);
      else if(pc.connectionState==="connected"){
        clearTimeout(p.timeout);opened();p.routeCheck();
      }else if(pc.connectionState==="disconnected"){
        disconnected();
      }
    };
    pc.oniceconnectionstatechange=()=>{
      if(["connected","completed"].includes(pc.iceConnectionState)){opened();p.routeCheck();}
      else if(pc.iceConnectionState==="disconnected")disconnected();
      else if(pc.iceConnectionState==="failed"){
        p.policy.selected({kind:"disconnected"});
        if(p.attempt===0)void this.restart(id,1);else this.fail(p);
      }
    };
    p.timeout=setTimeout(()=>void this.fallback(id),17000);
    if(offerer){
      try{await this.describe(p,"offer");}
      catch{await this.fallback(id);}
    }
  }
  async describe(p,type){
    const attempt=p.attempt;
    const description=type==="offer"?await p.pc.createOffer({iceRestart:attempt>0}):await p.pc.createAnswer();
    if(this.peers.get(p.id)!==p||p.attempt!==attempt)return;
    await p.pc.setLocalDescription(description);
    await new Promise(resolve=>{
      // After an ICE restart, "complete" may still describe the OLD gather
      // until the browser queues the new gathering-state event.
      if(p.pc.iceGatheringState==="complete"&&/^a=candidate:/m.test(p.pc.localDescription?.sdp??""))return resolve();
      const timer=setTimeout(done,5000);
      function done(){clearTimeout(timer);p.pc.removeEventListener("icegatheringstatechange",changed);resolve();}
      function changed(){if(p.pc.iceGatheringState==="complete")done();}
      p.pc.addEventListener("icegatheringstatechange",changed);
    });
    if(this.peers.get(p.id)===p&&p.attempt===attempt)this.emit({type:"signal",peer:p.id,round:p.round,attempt,
      description:internetDescription({type,sdp:p.pc.localDescription.sdp},this.mode)});
  }
  async fallback(id,attempt=1){
    const p=this.peers.get(id);if(!p)return;
    if(p.pc.connectionState==="connected"&&p.attempt===0)return;
    return this.restart(id,attempt);
  }
  async restart(id,generation,peerRequested=false){
    const p=this.peers.get(id);if(!p)return;
    if(p.restarting)return p.restarting;
    if(this.mode!=="turn-fallback"||!Number.isSafeInteger(generation)||generation<1||generation>MAX_GENERATION){
      this.fail(p);return;
    }
    if(generation<=p.attempt)return;
    if(generation!==p.attempt+1){this.fail(p);return;}
    p.restarting=(async()=>{
      let stage="relay_authorization_failed";
      try{
        if(p.attempt===0)p.policy.directFailed();
        const settings=p.attempt===0?await p.policy.fallback({peerRequested}):await p.policy.renew();
        if(this.peers.get(id)!==p)return;
        if(!settings){if(p.pc.connectionState!=="connected")this.fail(p);return;}
        p.attempt=generation;p.expiresAt=settings.expiresAt;
        stage="relay_configuration_failed";
        p.pc.setConfiguration({iceServers:settings.iceServers,iceTransportPolicy:"all"});
        // Same bounded generation on both sides; only the lower-slot peer
        // creates offers. A live direct link elsewhere is never restarted.
        if(!peerRequested)this.emit({type:"fallback",peer:id,round:p.round,attempt:generation});
        clearTimeout(p.timeout);clearTimeout(p.renewTimer);
        p.timeout=setTimeout(()=>this.fail(p),30000);
        stage="relay_signaling_failed";
        if(p.offerer)await this.describe(p,"offer");
      }catch{this.fail(p,stage);}
      finally{p.restarting=null;if(this.peers.get(id)===p)p.routeCheck();}
    })();
    return p.restarting;
  }
  async signal(id,value,attempt){
    const p=this.peers.get(id);if(!p)return;
    if(attempt===p.attempt+1)await this.restart(id,attempt,true);
    if(this.peers.get(id)!==p||attempt!==p.attempt)return;
    const description=internetDescription(value,this.mode);
    if((description.type==="offer")===p.offerer)throw Error("Unexpected peer signaling role.");
    await p.pc.setRemoteDescription(description);
    p.remoteAttempt=attempt;
    if(description.type==="offer")await this.describe(p,"answer");
    p.routeCheck();
  }
  take(p,size,control){
    const now=Date.now();p.tokens=Math.min(BURST,p.tokens+Math.max(0,now-p.tokenAt)*RATE/1000);p.tokenAt=now;
    // Preserve headroom for reliable control traffic; stale snapshots are
    // lossy by design. This limits honest app traffic, NOT hostile clients.
    if(size>p.tokens-(control?0:32768))return false;
    p.tokens-=size;return true;
  }
  send(channel,{to,payload}={}){
    const p=this.peers.get(to);if(!p)return;
    if(channel==="ctl"&&p.ctl.readyState==="open"){
      const text=JSON.stringify(payload),size=new TextEncoder().encode(text).byteLength;
      if(size<=32768&&p.ctl.bufferedAmount<262144){
        if(this.take(p,size,true))p.ctl.send(text);else this.fail(p);
      }
    }else if(channel==="snap"&&p.snap.readyState==="open"&&p.snap.bufferedAmount<65536&&typeof payload==="string"&&payload.length<=21856){
      const text=atob(payload);if(text.length<=16384&&this.take(p,text.length,false))p.snap.send(Uint8Array.from(text,c=>c.charCodeAt(0)));
    }
  }
}
