import {InternetMesh} from "./internet-rtc.js";
import {gatewayOrigin,internetInvitation,internetState} from "../common/internet-coop.mjs";
import {COOP_RECONNECT_MS, retryDelay, coopPair, COOP_MAX_PEER_ROUND} from "../common/coop-recovery.mjs";
import {voiceSignal} from "../common/voice-signaling.mjs";

// Native-owned, isolated broker. A lease owns its socket, mesh and callbacks:
// nothing from a failed match may act on the next reserved seat.
export class InternetBroker {
  constructor(emit,{request=globalThis.fetch.bind(globalThis),Socket=globalThis.WebSocket,Mesh=InternetMesh,joinTimeoutMs=45000}={}){
    Object.assign(this,{emit,request,Socket,Mesh,joinTimeoutMs});this.serial=0;
  }
  get epoch(){return this.run?.epoch;}
  live(run,attempt){return this.run===run&&(!attempt||run.attempt===attempt);}
  output(run,value){if(this.live(run))this.emit({...value,scope:"internet",epoch:run.epoch});}
  state(run,phase="connecting",extra={}){
    this.output(run,{type:"state",value:{phase,members:[],linked:false,...extra}});
  }
  async api(run,route,value,token,signal=run.abort.signal,timeoutMs=route.endsWith("/turn")?30000:15000){
    const headers={"Content-Type":"application/json"};if(token)headers.Authorization="Bearer "+token;
    // Android's installed WebView can support fetch/WebRTC without the newer
    // AbortSignal.any/timeout static methods. Keep cancellation and a bounded
    // timeout, including response-body reading, using the older controller API.
    const controller=new AbortController(),cancel=()=>controller.abort();
    let timedOut=false,timer;
    try{
      signal?.addEventListener("abort",cancel,{once:true});
      if(signal?.aborted){cancel();throw Error("Co-op request cancelled.");}
      timer=setTimeout(()=>{timedOut=true;cancel();},timeoutMs);
      const response=await this.request(run.gateway+route,{method:"POST",headers,body:JSON.stringify(value??{}),
        signal:controller.signal,redirect:"error",credentials:"omit",cache:"no-store"});
      const text=await response.text();if(text.length>48000)throw Error("Oversized service response.");
      const data=JSON.parse(text);
      if(!response.ok){const error=Error(String(data.error??"connection_failed"));error.code=data.error;throw error;}
      return data;
    }catch(error){
      if(timedOut){const timeout=Error("The room service did not respond in time.");timeout.code="request_timeout";throw timeout;}
      throw error;
    }finally{
      clearTimeout(timer);signal?.removeEventListener("abort",cancel);
    }
  }
  async release(run,lease){
    if(!lease)return;
    // Releasing a reserved seat must still work after the room run is aborted.
    try{await this.api(run,`/v1/rooms/${lease.code}/leave`,{},lease.sessionToken,null,5000);}catch{}
  }
  detach(run){
    if(!run)return;
    const attempt=run.attempt;run.attempt=null;
    if(!attempt)return;
    clearTimeout(attempt.timer);attempt.reject?.(Error("Cancelled."));
    clearTimeout(attempt.retryTimer);clearTimeout(attempt.recoveryTimer);clearInterval(attempt.heartbeat);
    attempt.mesh?.close();
    if(attempt.socket){
      attempt.socket.onmessage=attempt.socket.onclose=attempt.socket.onerror=null;
      try{attempt.socket.close();}catch{}
    }
    return attempt.lease;
  }
  async close(){
    this.serial++;const run=this.run;this.run=null;
    if(!run)return;
    run.abort.abort();await this.release(run,this.detach(run));
  }
  async begin(command){
    const serial=++this.serial,previous=this.run;this.run=null;
    if(previous){previous.abort.abort();await this.release(previous,this.detach(previous));}
    if(serial!==this.serial)return;
    if(gatewayOrigin({internetCoop:{enabled:true,url:command.gateway}})!==command.gateway)throw Error("Unconfigured co-op gateway.");
    const run={epoch:command.epoch,gateway:command.gateway,mode:command.data.connectionMode,command,abort:new AbortController()};
    this.run=run;
    const finding=command.type==="find",browsing=command.type==="browse",exclude=[];
    if(browsing){
      this.state(run,"idle",{roomListing:{status:"loading",rooms:[]}});
      try{
        const data=await this.api(run,"/v1/matchmaking/rooms",{buildId:command.identity,connectionMode:run.mode,protocolVersion:3,destination:command.data.destination??""});
        if(this.live(run)){
          const value=internetState({phase:"idle",members:[],linked:false,
            roomListing:{status:data.rooms?.length?"ready":"empty",rooms:data.rooms}},run.mode);
          this.output(run,{type:"state",value});
        }
      }catch{this.state(run,"idle",{roomListing:{status:"error",rooms:[],message:"Couldn’t load Internet rooms. Check your connection and refresh."}});}
      return;
    }
    this.state(run,"connecting",{discovery:{status:finding?"searching":"idle",rooms:0}});
    try{
      for(let index=0;index<(finding?3:1);index++){
        if(!this.live(run))return;
        const join=command.type==="join"?internetInvitation(command.data.invitation):null;
        const player={name:command.player.name,maps:command.player.maps,species:command.data.species,buildId:command.identity,connectionMode:run.mode,
          protocolVersion:join?.joinSecret?1:3,destination:command.data.destination??""};
        run.protocol=player.protocolVersion;
        let lease;
        try{
          lease=await this.api(run,finding?"/v1/matchmaking/find":command.type==="host"?"/v1/rooms":
            `/v1/rooms/${join.code}/join`,
          {...player,...(finding?{exclude}:command.type==="join"?(join.joinSecret?{joinSecret:join.joinSecret}:{}):{discoverable:false})});
        }catch(error){if(error.code==="no_matching_room")break;throw error;}
        if(!this.live(run)){await this.release(run,lease);return;}
        const codePattern=join?.joinSecret?/^[A-Z2-7]{8}$/:/^[A-Z2-7]{6}$/;
        if(!lease||!codePattern.test(lease.code)||!/^lan-[\w-]{1,80}$/.test(lease.member)||
          !/^[A-Za-z0-9_-]{43}$/.test(lease.sessionToken)||lease.connectionMode!==run.mode)throw Error("Invalid seat reservation.");
        exclude.push(lease.code);
        this.state(run,"connecting",{discovery:{status:finding?"joining":"idle",rooms:exclude.length}});
        try{await this.connect(run,lease);return;}
        catch(error){
          await this.release(run,this.detach(run));
          if(!this.live(run))return;
          if(!finding)throw error;
        }
      }
      this.state(run,"idle",{discovery:{status:"empty",rooms:0}});
    }catch{
      await this.release(run,this.detach(run));
      this.state(run,"error",{error:"Internet co-op could not connect. Check the service, matching builds and network; LAN remains available.",discovery:{status:"error",rooms:0}});
    }
  }
  connect(run,lease){
    return new Promise((resolve,reject)=>{
      const attempt={lease,resolve,reject,joined:false,routes:new Map(),peerWork:new Map(),linkedPeers:new Set(),
        retries:0,received:Promise.resolve()};run.attempt=attempt;
      attempt.timer=setTimeout(()=>reject(Error("Peer connection timed out.")),run.mode==="turn-fallback"?Math.max(55000,this.joinTimeoutMs):this.joinTimeoutMs);
      attempt.mesh=new this.Mesh({mode:run.mode,
        relay:peer=>this.api(run,`/v1/rooms/${lease.code}/turn`,{peer,directAttemptFailed:true},lease.sessionToken),
        emit:value=>{if(this.live(run,attempt))this.rtc(run,attempt,value);}});
      this.openSocket(run,attempt);
    });
  }
  endConnection(run,attempt,message){
    if(!this.live(run,attempt))return;
    if(!attempt.joined){attempt.reject(Error(message));return;}
    const lease=this.detach(run);void this.release(run,lease);
    this.state(run,"closed",{error:message+" Your unfinished run is preserved."});
  }
  openSocket(run,attempt){
      let socket;
      try{socket=new this.Socket(run.gateway.replace("https:","wss:")+`/v1/rooms/${attempt.lease.code}/socket`,
        ["pb-coop-v1",attempt.lease.sessionToken]);}
      catch{this.endConnection(run,attempt,"The room socket could not open.");return;}
      attempt.socket=socket;attempt.heardAt=Date.now();
      const failed=message=>this.reconnect(run,attempt,socket,message);
      socket.onmessage=event=>{
        if(attempt.socket!==socket||!this.live(run,attempt))return;
        attempt.heardAt=Date.now();
        // Ordered WebSocket messages can involve asynchronous ICE work.
        // Keep the work ordered too, and re-check the exact reservation.
        attempt.received=attempt.received.then(()=>attempt.socket===socket&&this.live(run,attempt)?this.received(run,attempt,event.data):undefined)
          .catch(()=>this.endConnection(run,attempt,"Invalid room response."));
      };
      socket.onerror=()=>failed("Room connection failed.");
      socket.onclose=event=>{
        if(attempt.socket!==socket||!this.live(run,attempt))return;
        if(event?.code===1000||event?.code===1008)this.endConnection(run,attempt,"The room closed.");
        else failed("Room connection interrupted.");
      };
      clearInterval(attempt.heartbeat);
      if(run.protocol>=3)attempt.heartbeat=setInterval(()=>{
        if(!this.live(run,attempt)||attempt.socket!==socket)return;
        if(Date.now()-attempt.heardAt>35000){failed("Room keepalive timed out.");return;}
        this.send(attempt,{type:"heartbeat"});
      },15000);
      attempt.heartbeat?.unref?.();
  }
  reconnect(run,attempt,socket,message){
    if(!this.live(run,attempt)||attempt.socket!==socket)return;
    if(!attempt.joined||run.protocol<3||attempt.room?.phase==="preparing"){this.endConnection(run,attempt,message);return;}
    attempt.signalingDown=true;attempt.recoveryUntil??=Date.now()+COOP_RECONNECT_MS;
    socket.onmessage=socket.onclose=socket.onerror=null;try{socket.close();}catch{}
    attempt.socket=null;clearInterval(attempt.heartbeat);
    attempt.mesh.close();attempt.linkedPeers.clear();attempt.routes.clear();
    if(Date.now()>=attempt.recoveryUntil){this.endConnection(run,attempt,"Could not reconnect in time.");return;}
    this.publishRoom(run,attempt);
    clearTimeout(attempt.retryTimer);
    attempt.retryTimer=setTimeout(()=>{
      if(this.live(run,attempt))this.openSocket(run,attempt);
    },retryDelay(attempt.retries++));
  }
  send(attempt,value){if(attempt?.socket?.readyState===1)attempt.socket.send(JSON.stringify(value));}
  queuePeer(run,attempt,peer,work){
    if(!attempt.room?.members.some(member=>member.id===peer&&member.id!==attempt.lease.member&&member.connected))
      throw Error("Invalid signaling peer.");
    const round=attempt.room?.peerRounds?.[coopPair(attempt.lease.member,peer)]??0;
    const current=()=>round===(attempt.room?.peerRounds?.[coopPair(attempt.lease.member,peer)]??0);
    const previous=attempt.peerWork.get(peer)??Promise.resolve();
    const pending=previous.then(async()=>{
      if(!this.live(run,attempt)||!current())return;
      try{await work();}
      catch{
        const p=attempt.mesh.peers.get(peer);
        if(this.live(run,attempt)&&current()&&p)attempt.mesh.fail(p,"peer_link_failed");
      }
    }).finally(()=>{if(attempt.peerWork.get(peer)===pending)attempt.peerWork.delete(peer);});
    attempt.peerWork.set(peer,pending);
  }
  async received(run,attempt,text){
    if(!this.live(run,attempt))return;
    if(typeof text!=="string"||text.length>48000)throw Error("Invalid room message.");
    const value=JSON.parse(text),mesh=attempt.mesh;
    if(value.type==="heartbeat")return;
    if(value.type==="voice"){
      const peer=attempt.room?.members.find(member=>member.id===value.from&&member.id!==attempt.lease.member);
      if(peer&&!peer.departed&&value.round===(attempt.room.peerRounds?.[coopPair(attempt.lease.member,peer.id)]??0)){
        try{this.output(run,{type:"voice-signal",peer:peer.id,payload:voiceSignal(value.payload,run.mode)});}catch{}
      }
      return;
    }
    if(value.type==="voice-unavailable"){
      this.output(run,{type:"notice",message:"Direct voice signaling is unavailable. Gameplay can continue."});return;
    }
    // Preserve ordering WITHIN each link, but do not make the other two peers
    // wait through somebody else's asynchronous ICE gathering. A room-wide
    // queue can otherwise time out the fourth player's third connection.
    if(value.type==="signal"||value.type==="fallback"){
      if(run.protocol>=3&&value.round!==(attempt.room?.peerRounds?.[coopPair(attempt.lease.member,value.from)]??0))return;
      this.queuePeer(run,attempt,value.from,()=>value.type==="signal"?mesh.signal(value.from,value.description,value.attempt):mesh.restart(value.from,value.attempt,true));return;
    }
    if(value.type==="peer-left"){mesh.drop(value.peer);attempt.routes.delete(value.peer);attempt.linkedPeers.delete(value.peer);
      this.output(run,{type:"peer-closed",peer:value.peer,permanent:true});return;}
    if(value.type==="notice"){
      if(typeof value.message==="string")this.output(run,{type:"notice",message:value.message.slice(0,180)});
      return;
    }
    if(value.type!=="room"||value.code!==attempt.lease.code||value.connectionMode!==run.mode||
      value.buildId!==run.command.identity||!Array.isArray(value.members))throw Error("Wrong room.");
    const mine=value.members.find(member=>member.id===attempt.lease.member);if(!mine)throw Error("Reservation ended.");
    if(mine.departed)throw Error("This seat was left.");
    if(run.protocol>=3){
      if(!value.peerRounds||Array.isArray(value.peerRounds)||Object.keys(value.peerRounds).length>6)throw Error("Invalid recovery generations.");
      for(const [key,round] of Object.entries(value.peerRounds??{})){
        const pair=key.split("|");
        if(pair.length!==2||pair.some(id=>!value.members.some(member=>member.id===id))||
          pair[0]===pair[1]||coopPair(...pair)!==key||
          !Number.isSafeInteger(round)||round<0||round>COOP_MAX_PEER_ROUND)throw Error("Invalid recovery generation.");
      }
    }
    const members=value.members.map(({id,name,species,slot,ready,maps,loadout,returned})=>({id,name,species,slot,ready,maps,
      ...(loadout!==undefined?{loadout}:{}),...(returned?{returned:true}:{})}));
    const phase=mine.pending?"connecting":value.phase==="lobby"?(mine.id===value.host&&members.length===1?"hosting":"lobby"):value.phase;
    const state=internetState({phase,role:mine.id===value.host?"host":"client",me:mine.id,members,code:value.code,
      linked:value.linked,chat:value.chat??[],match:value.match,settings:value.settings,seats:value.seats,rulesAt:value.rulesAt,
      ...(value.lastParty?{lastParty:value.lastParty}:{}),
      discovery:{status:run.command.type==="find"&&mine.pending?"joining":"idle",rooms:1},
      disconnected:value.phase==="playing"?value.members.filter(member=>!member.connected).map(member=>member.id):[]},run.mode);
    // Compare two validated, canonical match objects. The Worker's property
    // insertion order differs from lanState's; raw JSON text would otherwise
    // eject an unchanged room on its second preparation/playing broadcast.
    if(attempt.state?.match&&JSON.stringify(attempt.state.match)!==JSON.stringify(state.match)&&
      !(["hosting","lobby"].includes(state.phase)&&!state.match&&state.lastParty===attempt.state.match.party&&attempt.returnedParty===state.lastParty))
      throw Error("A running co-op match cannot change.");
    state.departed=value.members.filter(member=>member.departed&&member.id!==mine.id).map(member=>member.id);
    attempt.room=value;
    attempt.signalingDown=false;
    // A guest is not joined until every required peer link is confirmed.
    if(!mine.pending){attempt.joined=true;clearTimeout(attempt.timer);attempt.resolve();}
    attempt.state=state;this.publishRoom(run,attempt);
    await Promise.all(value.members.filter(peer=>peer.id!==mine.id&&peer.connected&&!peer.departed)
      .map(peer=>mesh.configure(peer.id,mine.slot<peer.slot,value.peerRounds?.[coopPair(mine.id,peer.id)]??0)));
    if(!this.live(run,attempt))return;
    for(const id of [...mesh.peers.keys()])if(!members.some(member=>member.id===id))mesh.drop(id);
    for(const id of [...(mesh.failedPeers??[])])if(!members.some(member=>member.id===id))mesh.failedPeers.delete(id);
  }
  publishRoom(run,attempt){
    if(!this.live(run,attempt)||!attempt.state)return;
    const peers=attempt.room.members.filter(peer=>peer.id!==attempt.lease.member&&peer.connected&&!peer.departed);
    const routes=peers.map(peer=>attempt.routes.get(peer.id));
    const transport=!peers.length?"waiting":routes.includes("turn")?"turn":routes.some(route=>!route||route==="connecting")?"connecting":
      routes.includes("stun")?"stun":routes.includes("direct")?"direct":"lan";
    const recovering=attempt.signalingDown||attempt.state.phase==="playing"&&!attempt.room.linked;
    if(recovering){
      attempt.recoveryUntil??=attempt.room.recoveryUntil||Date.now()+COOP_RECONNECT_MS;
      attempt.recoveryTimer??=setTimeout(()=>this.endConnection(run,attempt,"Could not reconnect in time."),
        Math.max(0,attempt.recoveryUntil-Date.now()));
    }else{clearTimeout(attempt.recoveryTimer);attempt.recoveryTimer=null;attempt.recoveryUntil=null;attempt.retries=0;}
    this.output(run,{type:"state",value:{...attempt.state,transport,linked:attempt.state.linked&&!attempt.signalingDown,
      voiceAvailable:attempt.room.voiceProtocol===1&&!attempt.signalingDown,
      peerLinks:[...attempt.linkedPeers].filter(id=>peers.some(peer=>peer.id===id)),
      ...(recovering?{recovery:{status:"reconnecting",until:attempt.recoveryUntil,attempt:attempt.retries}}:{})}});
  }
  voiceSend(peer,payload){
    const run=this.run,attempt=run?.attempt;
    if(!attempt || attempt.room?.voiceProtocol!==1 || attempt.signalingDown ||
        !attempt.linkedPeers.has(peer))return;
    this.send(attempt,{type:"voice",to:peer,payload:voiceSignal(payload,run.mode),
      round:attempt.room.peerRounds?.[coopPair(attempt.lease.member,peer)]??0});
  }
  rtc(run,attempt,value){
    if(value.round!==undefined&&value.round!==(attempt.room?.peerRounds?.[coopPair(attempt.lease.member,value.peer)]??0))return;
    const round=attempt.room?.peerRounds?.[coopPair(attempt.lease.member,value.peer)]??0;
    if(value.type==="signal")this.send(attempt,{type:"signal",to:value.peer,description:value.description,attempt:value.attempt,round});
    else if(value.type==="fallback")this.send(attempt,{type:"fallback",to:value.peer,attempt:value.attempt,round});
    else if(value.type==="link"){
      if(value.open)attempt.linkedPeers.add(value.peer);else attempt.linkedPeers.delete(value.peer);
      this.send(attempt,{type:"link",peer:value.peer,open:value.open,round});
      if(!value.open){attempt.routes.delete(value.peer);this.publishRoom(run,attempt);}
    }else if(value.type==="route"){
      if(["lan","stun","turn","direct","connecting"].includes(value.route)){
        attempt.routes.set(value.peer,value.route);this.publishRoom(run,attempt);
      }
    }
    else if(value.type==="failed"){
      if(["peer_link_failed","relay_authorization_failed","relay_configuration_failed","relay_signaling_failed"].includes(value.code))
        this.output(run,{type:"transport-diagnostic",code:value.code});
      if(!attempt.joined)attempt.reject(Error("Direct peer connection failed."));
      else{
        attempt.routes.delete(value.peer);
        attempt.linkedPeers.delete(value.peer);
        this.send(attempt,{type:"link",peer:value.peer,open:false,round});
        if(run.protocol>=3&&attempt.room?.phase==="playing"&&value.code==="peer_link_failed"){
          this.send(attempt,{type:"recover",peer:value.peer,round});
        }
        this.output(run,{type:"peer-closed",peer:value.peer});this.publishRoom(run,attempt);
      }
    }else if(value.type==="frame")this.output(run,value);
  }
  action(channel,data){
    const run=this.run,attempt=run?.attempt;if(!attempt)return;
    if(channel==="ctl"||channel==="snap"){attempt.mesh.send(channel,data);return;}
    if(channel==="prepared"){this.send(attempt,{type:"prepared",party:data});return;}
    if(channel==="room-return"){attempt.returnedParty=data;this.send(attempt,{type:"returned",party:data});return;}
    if(channel==="room-start"){this.send(attempt,{type:"start"});return;}
    if(channel==="room-ready"){
      const mine=attempt.room?.members.find(member=>member.id===attempt.lease.member);
      this.send(attempt,{type:"ready",ready:!mine?.ready});return;
    }
    if(channel==="room-pick")this.send(attempt,{type:"pick",species:data});
    else if(channel==="room-chat")this.send(attempt,{type:"chat",text:data});
    else if(channel==="room-settings")this.send(attempt,{type:"settings",value:data});
    else if(channel==="room-seats")this.send(attempt,{type:"seats",value:data});
    else if(channel==="room-loadout")this.send(attempt,{type:"loadout",value:data});
  }
}
