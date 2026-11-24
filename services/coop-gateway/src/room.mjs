import {POLICY, MATCH_RULES, internetMode, coopProtocol, Fault, requireValue, json, body, profile, hash, equalHashes, randomToken, signalDescription} from "./policy.mjs";
const command=(route,value)=>new Request("https://internal"+route,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(value)});
const linked=(room,a,b)=>room.links[a+"|"+b]===true&&room.links[b+"|"+a]===true;

// Admission and signaling only. Pending seats have leases; no game data,
// assets, music, voice or video are relayed through this Worker.
export class CoopRoom {
  constructor(ctx,env){this.ctx=ctx;this.env=env;}
  async fetch(request){
    return this.ctx.blockConcurrencyWhile(async()=>{
      // Expected denials must be caught inside the gate. A callback rejection
      // resets a real Durable Object, which would disrupt the existing room.
      try{return await this.route(request);}
      catch(error){return json({error:error instanceof Fault?error.code:"room_unavailable"},error.status??503);}
    });
  }
  control(){return this.env.CONTROL.get(this.env.CONTROL.idFromName("account"));}
  sockets(){return this.ctx.getWebSockets().filter(socket=>socket.readyState===1);}
  socketFor(id){return this.sockets().find(socket=>socket.deserializeAttachment()?.member===id);}
  snapshot(room){
    const members=room.members.map(({id,name,species,slot,ready,pending})=>({id,name,species,slot,ready,pending,
      connected:Boolean(this.socketFor(id))}));
    return {type:"room",code:room.code,phase:room.phase,buildId:room.buildId,connectionMode:room.connectionMode,
      host:room.host,members,chat:room.chat,links:room.links,expiresAt:room.expiresAt,
      linked:members.length>=2&&members.every(a=>!a.pending&&a.connected&&members.every(b=>a.id===b.id||linked(room,a.id,b.id))),
      ...(room.match?{match:room.match}:{})};
  }
  broadcast(value,except){
    const text=JSON.stringify(value);
    for(const socket of this.sockets())if(socket!==except)try{socket.send(text);}catch{}
  }
  async persist(room){
    await this.ctx.storage.put("room",room);
    const deadlines=[...room.members.map(member=>member.deadline),room.prepareDeadline].filter(value=>Number.isFinite(value)&&value>Date.now());
    await this.ctx.storage.setAlarm(Math.min(room.expiresAt,...deadlines));
  }
  async member(request,room){
    const protocols=request.headers.get("Sec-WebSocket-Protocol")?.split(",").map(value=>value.trim());
    let token;
    if(protocols){
      requireValue(protocols.length===2&&protocols[0]==="pb-coop-v1",401,"session_required");
      token=protocols[1];
    }else token=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.get("Authorization")??"")?.[1];
    requireValue(typeof token==="string"&&/^[A-Za-z0-9_-]{43}$/.test(token),401,"session_required");
    const fingerprint=await hash(token),member=room.members.find(value=>equalHashes(value.tokenHash,fingerprint));
    requireValue(member,401,"session_required");return member;
  }
  async expire(room){
    if(room.prepareDeadline&&room.prepareDeadline<=Date.now()){
      await this.closeRoom(room,"Run preparation timed out. Prepared saves are preserved.");return null;
    }
    if(room.expiresAt<=Date.now()||room.members.some(member=>member.id===room.host&&member.deadline&&member.deadline<=Date.now())){
      await this.closeRoom(room,"Room expired.");return null;
    }
    for(const id of room.members.filter(member=>member.pending&&member.deadline<=Date.now()).map(member=>member.id))
      await this.removeMember(room,id,"Connection timed out.");
    return room;
  }
  async route(request){
    const route=new URL(request.url).pathname;
    let room=await this.ctx.storage.get("room");
    if(route==="/initialize"){
      requireValue(!room,409,"room_exists");
      const value=await body(request),player=profile(value),mode=internetMode(value.connectionMode);
      const token=randomToken(),joinSecret=randomToken(),host="lan-"+randomToken(16);
      room={code:value.code,generation:value.generation,buildId:value.buildId,connectionMode:mode,rules:MATCH_RULES,protocolVersion:coopProtocol(value.protocolVersion),
        host,phase:"lobby",discoverable:value.discoverable===true,expiresAt:Date.now()+POLICY.roomLifetimeMs,
        joinHash:await hash(joinSecret),signalBytes:0,links:{},prepared:[],chat:[],
        members:[{id:host,...player,slot:0,tokenHash:await hash(token),ready:true,pending:false,
          deadline:Date.now()+POLICY.reservationLifetimeMs}]};
      await this.persist(room);
      return json({code:room.code,joinSecret,member:host,sessionToken:token,connectionMode:mode,expiresAt:room.expiresAt});
    }
    room=room&&await this.expire(room);requireValue(room,410,"room_closed");
    if(route==="/listing"){
      const value=await body(request);
      requireValue(room.discoverable&&room.phase==="lobby"&&room.members.length<POLICY.maxPlayers&&
        this.socketFor(room.host),409,"room_not_open");
      requireValue(room.buildId===value.buildId&&room.connectionMode===internetMode(value.connectionMode)&&
        (room.protocolVersion??1)===2&&coopProtocol(value.protocolVersion)===2,409,"matching_build_and_mode_required");
      const host=room.members.find(member=>member.id===room.host);
      return json({code:room.code,name:host.name,players:room.members.length});
    }
    if(route==="/join"||route==="/reserve"){
      const value=await body(request),player=profile(value);
      requireValue(room.phase==="lobby"&&room.members.length<POLICY.maxPlayers,409,"room_full_or_started");
      requireValue(value.buildId===room.buildId&&internetMode(value.connectionMode)===room.connectionMode&&
        coopProtocol(value.protocolVersion)===(room.protocolVersion??1),409,"matching_build_and_mode_required");
      if(route==="/reserve")requireValue(room.discoverable&&this.socketFor(room.host),409,"room_not_open");
      else if(value.joinSecret===undefined)requireValue(room.protocolVersion===2&&room.discoverable&&this.socketFor(room.host),403,"invitation_required");
      else requireValue(typeof value.joinSecret==="string"&&value.joinSecret.length===43&&equalHashes(await hash(value.joinSecret),room.joinHash),403,"invitation_required");
      const token=randomToken(),id="lan-"+randomToken(16),deadline=Date.now()+POLICY.reservationLifetimeMs;
      const slot=[1,2,3].find(slot=>!room.members.some(member=>member.slot===slot));
      room.members.push({id,...player,slot,tokenHash:await hash(token),ready:false,pending:true,deadline});
      room.members.sort((a,b)=>a.slot-b.slot);
      await this.persist(room);this.broadcast(this.snapshot(room));
      return json({code:room.code,member:id,sessionToken:token,pending:true,deadline,connectionMode:room.connectionMode,expiresAt:room.expiresAt});
    }
    const member=await this.member(request,room);
    if(route==="/leave"){await this.removeMember(room,member.id,"Player left.");return json({left:true});}
    if(route==="/turn"){
      requireValue(room.connectionMode==="turn-fallback",403,"turn_forbidden_in_stun_only");
      const value=await body(request);
      requireValue(Object.keys(value).sort().join(",")==="directAttemptFailed,peer"&&value.directAttemptFailed===true&&
        room.members.some(peer=>peer.id===value.peer&&peer.id!==member.id),400,"direct_attempt_required");
      requireValue(this.socketFor(member.id),403,"active_room_required");
      requireValue(this.socketFor(value.peer),403,"active_peer_required");
      const now=Date.now();
      if(!member.relayWindow||now-member.relayWindow>=60000){member.relayWindow=now;member.relayRequests=0;}
      requireValue(++member.relayRequests<=POLICY.maxRelayRequestsPerMinute,429,"relay_request_rate_limited");
      await this.persist(room);
      return this.control().fetch(command("/issue",{room:room.code,generation:room.generation,member:member.id}));
    }
    if(route==="/socket"){
      requireValue(request.headers.get("Upgrade")?.toLowerCase()==="websocket",426,"websocket_required");
      requireValue(!this.socketFor(member.id),409,"member_already_connected");
      const [client,server]=Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server,[member.id]);
      server.serializeAttachment({member:member.id,generation:room.generation,window:Date.now(),count:0,signals:{}});
      if(member.id===room.host){delete member.deadline;await this.persist(room);}
      this.broadcast(this.snapshot(room));
      return new Response(null,{status:101,webSocket:client,headers:{"Sec-WebSocket-Protocol":"pb-coop-v1"}});
    }
    throw new Fault(404,"not_found");
  }
  async webSocketMessage(socket,data){return this.ctx.blockConcurrencyWhile(()=>this.message(socket,data));}
  async message(socket,data){
    try{
      requireValue(typeof data==="string"&&new TextEncoder().encode(data).byteLength<=POLICY.maxBodyBytes,413,"signaling_only");
      let room=await this.ctx.storage.get("room");room=room&&await this.expire(room);requireValue(room,410,"room_closed");
      const attachment=socket.deserializeAttachment(),member=room.members.find(member=>member.id===attachment?.member);
      requireValue(member&&attachment.generation===room.generation,401,"session_required");
      if(Date.now()-attachment.window>=60000){attachment.window=Date.now();attachment.count=0;}
      requireValue(++attachment.count<=POLICY.maxMessagesPerMinute,429,"message_rate_limited");
      const message=JSON.parse(data);requireValue(message&&typeof message==="object"&&!Array.isArray(message),400,"invalid_message");
      if(message.type==="signal"){
        const peer=room.members.find(peer=>peer.id===message.to&&peer.id!==member.id);
        requireValue(peer&&Number.isSafeInteger(message.attempt)&&message.attempt>=0&&message.attempt<=POLICY.maxIceGeneration,400,"invalid_signal_peer");
        requireValue(message.attempt===0||room.connectionMode==="turn-fallback",403,"turn_forbidden_in_stun_only");
        const description=signalDescription(message.description,room.connectionMode);
        requireValue(description.type===(member.slot<peer.slot?"offer":"answer"),400,"invalid_signaling_role");
        const previous=attachment.signals[peer.id]??{attempt:0,count:0};
        requireValue(message.attempt===previous.attempt||message.attempt===previous.attempt+1,400,"invalid_ice_generation");
        const count=message.attempt===previous.attempt?previous.count+1:1;
        requireValue(count<=2,429,"signal_retry_limited");
        attachment.signals[peer.id]={attempt:message.attempt,count};
        room.signalBytes+=new TextEncoder().encode(description.sdp).byteLength;
        requireValue(room.signalBytes<=POLICY.maxRoomSignalBytes,429,"room_signaling_budget_reached");
        const target=this.socketFor(peer.id);requireValue(target,409,"peer_not_connected");
        target.send(JSON.stringify({type:"signal",from:member.id,attempt:message.attempt,description}));
      }else if(message.type==="fallback"){
        requireValue(room.connectionMode==="turn-fallback"&&room.members.some(peer=>peer.id===message.to&&peer.id!==member.id),403,"turn_not_allowed");
        requireValue(Number.isSafeInteger(message.attempt)&&message.attempt>=1&&message.attempt<=POLICY.maxIceGeneration,400,"invalid_ice_generation");
        this.socketFor(message.to)?.send(JSON.stringify({type:"fallback",from:member.id,attempt:message.attempt}));
      }else if(message.type==="link"){
        requireValue(room.members.some(peer=>peer.id===message.peer&&peer.id!==member.id)&&typeof message.open==="boolean",400,"invalid_peer_link");
        room.links[member.id+"|"+message.peer]=message.open;
        for(const pending of room.members.filter(peer=>peer.pending)){
          if(this.socketFor(pending.id)&&room.members.every(peer=>peer.id===pending.id||linked(room,pending.id,peer.id))){
            pending.pending=false;delete pending.deadline;
          }
        }
      }else if(message.type==="ready"&&room.phase==="lobby"){
        requireValue(!member.pending&&typeof message.ready==="boolean",400,"invalid_ready");member.ready=member.id===room.host||message.ready;
      }else if(message.type==="pick"&&room.phase==="lobby"){
        member.species=profile({name:member.name,species:message.species}).species;member.ready=member.id===room.host;
      }else if(message.type==="chat"&&room.phase==="lobby"){
        requireValue(!member.pending&&typeof message.text==="string"&&message.text.trim().length>0&&message.text.length<=140&&!/[\u0000-\u001f\u007f]/.test(message.text),400,"invalid_chat");
        room.chat.push({id:randomToken(16),from:member.id,name:member.name,text:message.text.trim(),at:Date.now()});room.chat=room.chat.slice(-40);
      }else if(message.type==="start"){
        const snapshot=this.snapshot(room);
        requireValue(room.phase==="lobby"&&member.id===room.host&&snapshot.linked&&room.members.every(peer=>peer.ready),409,"players_not_ready");
        room.phase="preparing";room.prepared=[];room.prepareDeadline=Date.now()+30000;
        room.match={party:"lan-net-"+randomToken(16),seed:crypto.getRandomValues(new Uint32Array(1))[0],
          mode:"standard",biome:"forest",tier:0,players:room.members.map(peer=>peer.id)};
      }else if(message.type==="prepared"){
        requireValue(room.phase==="preparing"&&message.party===room.match.party&&!member.pending,409,"preparation_not_current");
        if(!room.prepared.includes(member.id))room.prepared.push(member.id);
        if(room.prepared.length===room.members.length){room.phase="playing";delete room.prepareDeadline;}
      }else throw new Fault(400,"unsupported_signaling_message");
      socket.serializeAttachment(attachment);await this.persist(room);
      if(message.type!=="signal"&&message.type!=="fallback")this.broadcast(this.snapshot(room));
    }catch{
      try{socket.close(1008,"Invalid or excessive room message.");}catch{}
      const room=await this.ctx.storage.get("room"),attachment=socket.deserializeAttachment();
      if(room&&room.generation===attachment?.generation)await this.removeMember(room,attachment.member,"Invalid room message.");
    }
  }
  async closeRoom(room,reason){
    for(const socket of this.sockets())try{socket.close(1000,reason);}catch{}
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    await this.control().fetch(command("/release",{room:room.code,generation:room.generation})).catch(()=>{});
    await this.control().fetch(command("/unregister-room",{code:room.code,generation:room.generation}));
  }
  async removeMember(room,id,reason){
    if(!room.members.some(member=>member.id===id))return;
    if(id===room.host){await this.closeRoom(room,"Host left the room.");return;}
    if(room.phase==="preparing"){await this.closeRoom(room,"A player disconnected before the run started.");return;}
    const pending=room.members.find(member=>member.id===id).pending;
    if(room.phase==="lobby"||pending)room.members=room.members.filter(member=>member.id!==id);
    for(const key of Object.keys(room.links))if(key.split("|").includes(id))delete room.links[key];
    const socket=this.socketFor(id);try{socket?.close(1000,reason);}catch{}
    await this.control().fetch(command("/release",{room:room.code,generation:room.generation,member:id})).catch(()=>{});
    await this.persist(room);this.broadcast({type:"peer-left",peer:id});this.broadcast(this.snapshot(room));
  }
  async webSocketClose(socket){
    return this.ctx.blockConcurrencyWhile(async()=>{
      const room=await this.ctx.storage.get("room"),attachment=socket.deserializeAttachment();
      if(room&&attachment?.generation===room.generation)await this.removeMember(room,attachment.member,"Peer disconnected.");
    });
  }
  async webSocketError(socket){return this.webSocketClose(socket);}
  async alarm(){return this.ctx.blockConcurrencyWhile(async()=>{
    const room=await this.ctx.storage.get("room");
    if(room){const remaining=await this.expire(room);if(remaining)await this.persist(remaining);}
  });}
}
