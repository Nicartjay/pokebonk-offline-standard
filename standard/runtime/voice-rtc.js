// Native-owned broker ONLY. Audio never shares a gameplay PeerConnection,
// obtains TURN credentials, enters a data channel or passes through the Worker.
import {STUN_VOICE_SERVERS} from "./stun-first.js";
import {voiceSignal,voiceDescription,selectedVoicePair} from "../common/voice-signaling.mjs";
import {emptyVoiceState,voiceRoomActive,validVoiceVolume,DEFAULT_VOICE_VOLUME} from "../common/voice-state.mjs";
const sessionId=()=>crypto.randomUUID().replaceAll("-","");
const LAN_HELLO_RETRY_MS=1200,LAN_HELLO_LIMIT=5;
function speechSdp(sdp) {
  const id=/^a=rtpmap:(\d+) opus\/48000\/2\r?$/mi.exec(sdp)?.[1];
  if(!id)throw Error("Opus audio is required.");
  const lines=sdp.split(/\r?\n/),index=lines.findIndex(line=>line.startsWith("a=fmtp:"+id+" "));
  const values=new Map((index>=0?lines[index].slice(lines[index].indexOf(" ")+1):"").split(";")
    .map(value=>value.trim()).filter(Boolean).map(value=>value.split("=")));
  for(const [key,value]of Object.entries({stereo:"0","sprop-stereo":"0",usedtx:"1",useinbandfec:"1",maxaveragebitrate:"24000"}))
    values.set(key,value);
  const line="a=fmtp:"+id+" "+[...values].map(([key,value])=>key+"="+value).join(";");
  if(index>=0)lines[index]=line;
  else lines.splice(lines.findIndex(line=>line.startsWith("a=rtpmap:"+id+" "))+1,0,line);
  return lines.join("\r\n");
}
export class DirectVoice {
  constructor({emit,signal,Peer=globalThis.RTCPeerConnection,media=globalThis.navigator?.mediaDevices,
    makeAudio=()=>document.createElement("audio"),
    makeAudioContext=()=>new AudioContext({latencyHint:"interactive"})}={}) {
    Object.assign(this,{emit,signal,Peer,media,makeAudio,makeAudioContext});
    this.peers=new Map();this.links=new Map();this.remote=new Map();this.jobs=new Map();
    this.value=emptyVoiceState();this.epoch=0;this.context=null;this.closed=false;this.microphoneVolume=DEFAULT_VOICE_VOLUME;
    this.timer=setInterval(()=>this.tick(),400);
  }
  publish() {
    const transmitting=[...this.peers.values()].some(peer=>peer.track?.enabled===true);
    this.value.transmitting=transmitting;
    this.value.peers=[...this.peers].map(([id,peer])=>({id,status:peer.failed?"unavailable":peer.direct?"connected":"connecting"}));
    const fingerprint=JSON.stringify([this.context?.owner,this.context?.mode,this.value]);
    if(this.lastEmission===fingerprint)return;
    this.lastEmission=fingerprint;
    this.emit(structuredClone(this.value),this.context);
  }
  room(state, mode, supported = true, generationOf = () => undefined) {
    const owner=voiceRoomActive(state) && state.me;
    const identity=owner ? mode+"|"+owner : "";
    if (identity!==this.identity || !supported) {
      this.stop();this.identity=identity;
      this.context=owner?{owner,mode,supported}:null;
    }
    if (!owner) {this.context=null;this.links.clear();return;}
    this.context={owner,mode,supported};
    if(state.recovery&&this.value.enabled)this.stop("suspended");
    const mine=state.members.find(member=>member.id===owner);
    const peers=state.members.filter(member=>member.id!==owner && !(state.disconnected??[]).includes(member.id) &&
      !(state.departed??[]).includes(member.id) && (state.peerLinks??[]).includes(member.id));
    const next=new Map(peers.map(peer=>{
      const prior=this.links.get(peer.id),offerer=mine?.slot<peer.slot,generation=generationOf(peer.id);
      return [peer.id,prior&&prior.offerer===offerer&&prior.generation===generation?prior:{offerer,generation}];
    }));
    for (const [id,link] of this.links) if(next.get(id)!==link){
      this.drop(id);this.remote.delete(id);this.jobs.delete(id);
    }
    const added=[...next.keys()].filter(id=>next.get(id)!==this.links.get(id));
    this.links=next;
    if (this.value.enabled) for(const id of added)this.hello(id);
    if (this.value.enabled)this.publish();
  }
  send(id, value) {
    if (!this.context?.supported || !this.links.has(id)) return;
    try{this.signal(id,voiceSignal(value,this.context.mode));}catch{}
  }
  hello(id, {retry = false} = {}) {
    const link=this.links.get(id);
    if(!this.value.enabled||!link)return;
    // Retry only on the local room wire, not the Internet Worker. Stop once
    // negotiation starts, and start a new bounded window for each new pair.
    if(retry&&(this.peers.has(id)||!link.helloCount||link.helloCount>=LAN_HELLO_LIMIT||
      Date.now()<link.nextHello))return;
    link.helloCount=(link.helloCount??0)+1;link.nextHello=Date.now()+LAN_HELLO_RETRY_MS;
    this.send(id,{v:1,kind:"hello",session:this.session});
  }
  stop(error="") {
    if(this.value.enabled)for(const id of this.links.keys())this.send(id,{v:1,kind:"bye",session:this.session});
    this.epoch++;this.micEpoch=(this.micEpoch??0)+1;
    this.stopMicrophone();for(const id of [...this.peers.keys()])this.drop(id);
    this.remote.clear();this.jobs.clear();this.session=null;
    this.value={...emptyVoiceState(),error};this.publish();
  }
  stopMicrophone() {
    const tracks=new Set([...(this.stream?.getTracks?.()??[]),...(this.captureOutput?.getTracks?.()??[]),
      ...(this.captureStream?.getTracks?.()??[])]);
    for(const track of tracks)track.stop();
    this.stream=null;this.captureOutput=null;
    this.captureStream=null;this.captureGain=null;
    const context=this.captureContext;this.captureContext=null;
    if(context&&context.state!=="closed")void context.close().catch(()=>{});
    for(const peer of this.peers.values()){
      if(peer.track){peer.track.enabled=false;peer.track.stop();peer.track=null;}
      void peer.sender?.replaceTrack(null).catch(()=>{});
    }
    this.holdUntil=0;
  }
  setVolume(value) {
    if(!validVoiceVolume(value))return;
    this.microphoneVolume=value;
    if(this.captureGain)this.captureGain.gain.value=value/100;
  }
  async action(action) {
    if(["disable","suspend"].includes(action)){this.stop(action==="suspend"?"suspended":"");return;}
    if(action==="release"){this.holdUntil=0;this.apply();return;}
    if(!this.context?.supported)return;
    if(action==="enable"){
      if(this.value.enabled)return;
      this.session=sessionId();this.value={...emptyVoiceState(),enabled:true};
      this.epoch++;for(const [id,link] of this.links){link.helloCount=0;this.hello(id);}this.publish();return;
    }
    if(!this.value.enabled)return;
    if(action==="press"){if(this.value.mode==="ptt"){this.holdUntil=Date.now()+900;this.apply();}return;}
    if(action==="permission-denied"){
      this.micEpoch=(this.micEpoch??0)+1;this.stopMicrophone();
      Object.assign(this.value,{mode:"muted",microphone:"denied",error:"permission-denied"});this.apply();return;
    }
    if(action==="mute"){
      this.micEpoch=(this.micEpoch??0)+1;this.stopMicrophone();
      Object.assign(this.value,{mode:"muted",microphone:"off",error:""});this.apply();return;
    }
    if(!["ptt","open-mic"].includes(action))return;
    const mode=action==="ptt"?"ptt":"open",epoch=this.epoch;
    this.holdUntil=0;
    Object.assign(this.value,{mode,error:""});
    if(this.stream){this.apply();return;}
    const micEpoch=this.micEpoch=(this.micEpoch??0)+1;
    if(this.captureStream)this.stopMicrophone();
    this.value.microphone="requesting";this.apply();
    let stream,context,processed;
    try{
      if(!this.media?.getUserMedia)throw Error("Microphone unsupported.");
      stream=await this.media.getUserMedia({video:false,audio:{
        channelCount:{ideal:1},echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      // A permission prompt can finish after mute, background, leave or a new
      // room. Always stop that stale stream; never reopen capture implicitly.
      if(this.epoch!==epoch || this.micEpoch!==micEpoch || !this.value.enabled){for(const track of stream.getTracks())track.stop();return;}
      const sourceTrack=stream.getAudioTracks()[0];if(!sourceTrack)throw Error("No microphone track.");
      context=this.makeAudioContext();
      this.captureStream=stream;this.captureContext=context;
      const source=context.createMediaStreamSource(stream),gain=context.createGain(),destination=context.createMediaStreamDestination();
      gain.gain.value=this.microphoneVolume/100;
      source.connect(gain);gain.connect(destination);
      // Never connect the mic to local speakers. Only disabled, separately
      // direct-route-verified sender clones consume this output.
      this.captureGain=gain;processed=destination.stream;this.captureOutput=processed;
      if(context.state==="suspended"){
        let timer;
        try{await Promise.race([context.resume(),new Promise((_,reject)=>{
          timer=setTimeout(()=>reject(Error("Microphone audio context did not start.")),4000);
        })]);}finally{clearTimeout(timer);}
      }
      if(this.epoch!==epoch||this.micEpoch!==micEpoch||!this.value.enabled){
        for(const track of [...stream.getTracks(),...processed.getTracks()])track.stop();
        if(context.state!=="closed")void context.close().catch(()=>{});
        return;
      }
      if(context.state!=="running")throw Error("Microphone audio context unavailable.");
      const track=processed.getAudioTracks()[0];if(!track)throw Error("No microphone output track.");
      track.enabled=false;this.stream=processed;this.value.microphone="ready";
      const ended=()=>{if(this.captureStream===stream){this.stopMicrophone();this.value.mode="muted";this.value.microphone="error";
        this.value.error="microphone-unavailable";this.apply();}};
      sourceTrack.onended=ended;track.onended=ended;
      for(const peer of this.peers.values())await this.attach(peer);
      this.apply();
    }catch(error){
      for(const track of [...(stream?.getTracks?.()??[]),...(processed?.getTracks?.()??[])])track.stop();
      if(context&&context.state!=="closed")void context.close().catch(()=>{});
      if(this.epoch!==epoch || this.micEpoch!==micEpoch)return;
      this.stopMicrophone();this.value.mode="muted";
      const denied=["NotAllowedError","PermissionDeniedError","SecurityError"].includes(error?.name);
      this.value.microphone=denied?"denied":"error";
      // Safe diagnostic only: no device identifiers, SDP or raw exception text.
      console.warn("Direct microphone capture:",["NotAllowedError","PermissionDeniedError","SecurityError",
        "NotReadableError","NotFoundError","AbortError","OverconstrainedError"].includes(error?.name)?error.name:"Unavailable");
      this.value.error=denied?"permission-denied":"microphone-unavailable";this.apply();
    }
  }
  async attach(peer) {
    if(!this.stream || !peer.sender || peer.failed || this.peers.get(peer.id)!==peer)return;
    const track=this.stream.getAudioTracks()[0].clone();track.enabled=false;
    peer.track?.stop();peer.track=track;
    try{
      await peer.sender.replaceTrack(track);
      if(this.peers.get(peer.id)!==peer || peer.track!==track || !this.stream){track.stop();return;}
      const params=peer.sender.getParameters();
      if(!params.encodings?.length)params.encodings=[{}];
      params.encodings[0].maxBitrate=24000;
      await peer.sender.setParameters(params).catch(()=>{});
    }catch{track.stop();if(peer.track===track)peer.track=null;}
  }
  apply() {
    const speak=this.value.enabled && this.value.microphone==="ready" &&
      (this.value.mode==="open" || this.value.mode==="ptt"&&Date.now()<(this.holdUntil??0));
    for(const peer of this.peers.values())if(peer.track)peer.track.enabled=Boolean(speak&&peer.direct&&!peer.failed);
    this.publish();
  }
  drop(id) {
    const peer=this.peers.get(id);if(!peer)return;
    this.peers.delete(id);clearTimeout(peer.timeout);peer.track?.stop();
    peer.pc.ontrack=peer.pc.onconnectionstatechange=peer.pc.oniceconnectionstatechange=null;
    try{peer.pc.close();}catch{}
    if(peer.audio){peer.audio.pause();peer.audio.srcObject=null;peer.audio.remove();}
    if(peer.failure&&this.value.error===peer.failure)
      this.value.error=[...this.peers.values()].find(other=>other.failure===peer.failure)?.failure??"";
  }
  fail(peer, error="direct-unavailable") {
    if(this.peers.get(peer.id)!==peer)return;
    this.drop(peer.id);
    // A terminal placeholder avoids automatic signaling/capture retry loops.
    peer.failed=true;peer.failure=error;peer.direct=false;peer.track=null;peer.audio=null;
    this.peers.set(peer.id,peer);this.value.error=error;this.apply();
  }
  prepareTransceiver(peer,transceiver) {
    transceiver.direction="sendrecv";
    const codecs=globalThis.RTCRtpSender?.getCapabilities?.("audio")?.codecs?.filter(codec=>codec.mimeType.toLowerCase()==="audio/opus");
    if(codecs?.length)transceiver.setCodecPreferences?.(codecs);
    peer.sender=transceiver.sender;
  }
  async configure(id) {
    const remote=this.remote.get(id);
    const link=this.links.get(id);
    if(!this.value.enabled || !remote || !link)return;
    const existing=this.peers.get(id);
    if(existing?.remote===remote)return;
    this.drop(id);
    const local=this.context.mode==="lan";
    const pc=new this.Peer({iceServers:local?[]:structuredClone(STUN_VOICE_SERVERS),
      iceTransportPolicy:"all",bundlePolicy:"max-bundle"});
    const peer={id,pc,remote,session:this.session,direct:false,failed:false};
    this.peers.set(id,peer);
    peer.timeout=setTimeout(()=>this.fail(peer),18000);
    pc.ontrack=event=>{
      if(this.peers.get(id)!==peer || event.track.kind!=="audio")return;
      if(peer.audio){peer.audio.pause();peer.audio.srcObject=null;peer.audio.remove();}
      const audio=this.makeAudio();audio.autoplay=true;audio.muted=true;
      audio.srcObject=new MediaStream([event.track]);peer.audio=audio;
      document.body.append(audio);
    };
    const changed=()=>{
      if(this.peers.get(id)!==peer)return;
      if(["failed","closed"].includes(pc.connectionState))this.fail(peer);
      else if(pc.connectionState!=="connected"){peer.direct=false;if(peer.audio)peer.audio.muted=true;this.apply();}
      else void this.check(peer);
    };
    pc.onconnectionstatechange=pc.oniceconnectionstatechange=changed;
    // The offerer creates the audio m-line. The answerer must use the
    // transceiver Chromium creates for that remote m-line, not a separately
    // added transceiver whose sender will never be negotiated.
    if(link.offerer){
      this.prepareTransceiver(peer,pc.addTransceiver("audio",{direction:"sendrecv"}));
      await this.attach(peer);
      if(this.peers.get(id)===peer&&!peer.failed)await this.describe(peer,"offer");
    }
    this.publish();
  }
  async describe(peer,type) {
    const {pc}=peer;
    const description=type==="offer"?await pc.createOffer():await pc.createAnswer();
    await pc.setLocalDescription({type,sdp:speechSdp(description.sdp)});
    await new Promise(resolve=>{
      if(pc.iceGatheringState==="complete")return resolve();
      const timer=setTimeout(done,5000);
      function done(){clearTimeout(timer);pc.removeEventListener("icegatheringstatechange",changed);resolve();}
      function changed(){if(pc.iceGatheringState==="complete")done();}
      pc.addEventListener("icegatheringstatechange",changed);
    });
    if(this.peers.get(peer.id)!==peer || !this.value.enabled || peer.session!==this.session)return;
    const clean=voiceDescription({type,sdp:pc.localDescription.sdp},this.context.mode);
    this.send(peer.id,{v:1,kind:"description",session:this.session,for:peer.remote,description:clean});
  }
  receive(id, raw) {
    const link=this.links.get(id);
    if(!this.context?.supported || !link)return;
    let message;try{message=voiceSignal(raw,this.context.mode);}catch{return;}
    const epoch=this.epoch;
    const current=()=>epoch===this.epoch&&this.links.get(id)===link;
    const job=(this.jobs.get(id)??Promise.resolve()).catch(()=>{}).then(async()=>{
      if(!current())return;
      if(message.kind==="bye"){
        if(this.remote.get(id)===message.session){
          this.remote.delete(id);link.helloCount=0;this.drop(id);this.apply();
        }return;
      }
      if(message.kind==="hello"){
        const changed=this.remote.get(id)!==message.session;
        this.remote.set(id,message.session);
        if(this.value.enabled&&(changed||!this.peers.has(id))){if(changed)this.hello(id);await this.configure(id);}return;
      }
      if(!this.value.enabled || message.for!==this.session || this.remote.get(id)!==message.session)return;
      let peer=this.peers.get(id);if(!peer){await this.configure(id);if(!current())return;peer=this.peers.get(id);}
      if(!peer || peer.failed || (message.description.type==="offer")===link.offerer)return;
      await peer.pc.setRemoteDescription(message.description);
      if(!current()||this.peers.get(id)!==peer||peer.failed)return;
      if(message.description.type==="offer"){
        const negotiated=peer.pc.getTransceivers().find(value=>value.mid!=null&&value.receiver.track.kind==="audio"&&!value.stopped);
        if(!negotiated)throw Error("No negotiated voice sender.");
        this.prepareTransceiver(peer,negotiated);
        await this.attach(peer);
        if(current()&&this.peers.get(id)===peer&&!peer.failed)await this.describe(peer,"answer");
      }
    }).catch(()=>{
      if(!current())return;
      const peer=this.peers.get(id);if(peer)this.fail(peer);
    });
    this.jobs.set(id,job);void job.finally(()=>{if(this.jobs.get(id)===job)this.jobs.delete(id);});
  }
  async check(peer) {
    if(peer.checking || peer.failed || this.peers.get(peer.id)!==peer)return;
    peer.checking=true;
    try{
      const route=selectedVoicePair(await peer.pc.getStats(),this.context.mode==="lan");
      if(this.peers.get(peer.id)!==peer)return;
      if(route==="blocked"){this.fail(peer,"relay-blocked");return;}
      peer.direct=route==="direct";
      if(peer.direct)clearTimeout(peer.timeout);
      if(peer.audio)peer.audio.muted=!peer.direct;
      // Starting incoming playback may wait for the first remote packet.
      // Grant the verified outgoing sender first; never wait for playback
      // before applying PTT/mic state on the other half of this connection.
      this.apply();
      const audio=peer.audio;
      if(peer.direct&&audio&&audio.paused!==false&&!peer.playing){
        peer.playing=true;
        void audio.play().catch(()=>{
          if(this.peers.get(peer.id)===peer&&peer.audio===audio&&peer.direct){this.value.error="audio-blocked";this.publish();}
        }).finally(()=>{peer.playing=false;});
      }
    }catch{peer.direct=false;if(peer.audio)peer.audio.muted=true;this.apply();}
    finally{peer.checking=false;}
  }
  tick() {
    if(this.closed)return;
    if(this.context?.mode==="lan"&&this.value.enabled)
      for(const id of this.links.keys())this.hello(id,{retry:true});
    for(const peer of this.peers.values())if(!peer.failed&&Date.now()>=(peer.nextCheck??0)){
      peer.nextCheck=Date.now()+1000;void this.check(peer);
    }
    if(this.value.transmitting && this.value.mode==="ptt" && Date.now()>=(this.holdUntil??0))this.apply();
  }
  close(){this.stop();this.closed=true;clearInterval(this.timer);}
}
