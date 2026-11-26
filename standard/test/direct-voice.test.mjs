import test from "node:test";
import assert from "node:assert/strict";
import {DirectVoice} from "../runtime/voice-rtc.js";
import {emptyVoiceState,voiceState,voiceAvailable} from "../common/voice-state.mjs";
import {voiceSignal,voiceDescription,selectedVoicePair} from "../common/voice-signaling.mjs";
import {STUN_VOICE_SERVERS} from "../runtime/stun-first.js";
import {allowLanBrokerPermission} from "../desktop/protocol.mjs";

const session="a".repeat(32),remote="b".repeat(32);
const sdp="v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\n"+
  "a=rtpmap:111 opus/48000/2\r\na=rtcp-mux\r\n"+
  "a=candidate:1 1 udp 123 192.168.1.20 42000 typ host\r\n";
const stats=(local="host",remote="host")=>new Map([
  ["transport",{type:"transport",selectedCandidatePairId:"pair"}],
  ["pair",{type:"candidate-pair",state:"succeeded",localCandidateId:"local",remoteCandidateId:"remote"}],
  ["local",{candidateType:local,address:"192.168.1.20"}],
  ["remote",{candidateType:remote,address:"192.168.1.21"}],
]);
const room=(extra={})=>({phase:"playing",me:"lan-me",members:[
  {id:"lan-me",slot:0},{id:"lan-peer",slot:1}],peerLinks:["lan-peer"],...extra});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,mode="lan",mediaOverride) {
  t.mock.timers.enable({apis:["setTimeout","setInterval","Date"],now:10000});
  const signals=[],emissions=[],pcs=[],tracks=[],captures=[],contexts=[];
  function track(){
    const value={kind:"audio",enabled:true,stopped:false,
      stop(){this.enabled=false;this.stopped=true;},clone:()=>track()};
    tracks.push(value);return value;
  }
  const stream=()=>{const value=track();return {getTracks:()=>[value],getAudioTracks:()=>[value]};};
  class Audio {
    state="running";currentTime=0;nodes=[];
    constructor(){contexts.push(this);}
    node(kind){
      const node={kind,outputs:[],connect(target){this.outputs.push(target);return target;}};
      this.nodes.push(node);return node;
    }
    createMediaStreamSource(stream){const node=this.node("source");node.stream=stream;return node;}
    createGain(){const node=this.node("gain");node.gain={value:1};return node;}
    createMediaStreamDestination(){const node=this.node("destination");node.stream=stream();return node;}
    async resume(){this.state="running";}
    async close(){this.state="closed";}
  }
  class Peer {
    constructor(config){this.config=config;this.stats=new Map();this.iceGatheringState="complete";this.transceivers=[];pcs.push(this);}
    addTransceiver(kind,options){
      return this.transceiver=this.newTransceiver(kind,options,null);
    }
    newTransceiver(kind,options,mid){
      const value={kind,options,mid,direction:options.direction,receiver:{track:{kind}},
        sender:{replaceTrack:async track=>{value.track=track;},
          getParameters:()=>({encodings:[{}]}),setParameters:async value=>{this.parameters=value;}}};
      this.transceivers.push(value);
      return value;
    }
    getTransceivers(){return this.transceivers;}
    async createOffer(){return {type:"offer",sdp};}
    async createAnswer(){return {type:"answer",sdp};}
    async setLocalDescription(value){this.localDescription=value;}
    async setRemoteDescription(value){
      this.remoteDescription=value;
      // A remote offer does not bind a transceiver created by addTransceiver.
      if(value.type==="offer")this.negotiated=this.newTransceiver("audio",{direction:"recvonly"},"0");
    }
    async getStats(){return this.stats;}
    close(){this.closed=true;}
  }
  const voice=new DirectVoice({Peer,media:mediaOverride??{getUserMedia:async options=>{
    captures.push(options);return stream();
  }},makeAudioContext:()=>new Audio(),emit:value=>emissions.push(structuredClone(value)),signal:(id,value)=>signals.push({id,value})});
  voice.room(room(),mode,true);
  t.after(()=>voice.close());
  return {voice,pcs,signals,emissions,tracks,captures,contexts,stream,Audio,
    async connect(){
      await voice.action("enable");
      voice.receive("lan-peer",{v:1,kind:"hello",session:remote});await flush();
      return voice.peers.get("lan-peer");
    }};
}

test("voice projections strip broker data and reject non-member or impossible microphone state",()=>{
  const members=room().members,value={...emptyVoiceState(),enabled:true,mode:"open",microphone:"ready",
    transmitting:true,peers:[{id:"lan-peer",status:"connected",sdp:"private"}],credential:"private"};
  assert.deepEqual(voiceState(value,members,"lan-me"),{
    version:1,enabled:true,mode:"open",microphone:"ready",transmitting:true,
      peers:[{id:"lan-peer",status:"connected"}],error:""});
  for(const change of [{enabled:false},{mode:"muted"},{microphone:"off"},
    {peers:[{id:"lan-outsider",status:"connected"}]},{peers:[{id:"lan-me",status:"connected"}]},
    {peers:[{id:"lan-peer",status:"connected"},{id:"lan-peer",status:"connected"}]}])
    assert.throws(()=>voiceState({...value,...change},members,"lan-me"));
  assert.equal(voiceAvailable({phase:"lobby",connectionMode:"lan"}),true);
  assert.equal(voiceAvailable({phase:"lobby",connectionMode:"stun-only"}),false);
  assert.equal(voiceAvailable({phase:"closed",connectionMode:"lan",voiceAvailable:true}),false);
});

test("audio signaling admits only bounded direct audio and rejects TURN, video, data and extra keys",()=>{
  assert.equal(voiceDescription({type:"offer",sdp},"lan").sdp,sdp);
  assert.equal(voiceSignal({v:1,kind:"hello",session},"turn-fallback").session,session);
  assert.throws(()=>voiceSignal({v:1,kind:"hello",session,credential:"not-allowed"},"stun-only"));
  assert.throws(()=>voiceSignal({v:1,kind:"hello",session:"not-a-session"},"lan"));
  for(const mode of ["lan","stun-only","turn-fallback"]){
    for(const text of [sdp.replace("typ host","typ relay"),sdp+"m=video 9 UDP/TLS/RTP/SAVPF 96\r\n",
      sdp+"m=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n",sdp+"a=remote-candidates:1 8.8.8.8 4000\r\n",
      sdp.replace("a=rtcp-mux\r\n",""),sdp+"a=x:"+"x".repeat(16000)])
      assert.throws(()=>voiceDescription({type:"offer",sdp:text},mode));
  }
  const reflexive=sdp.replace("192.168.1.20","203.0.113.20").replace("typ host","typ srflx");
  assert.throws(()=>voiceDescription({type:"offer",sdp:reflexive},"lan"));
  assert.match(voiceDescription({type:"answer",sdp:reflexive},"turn-fallback").sdp,/typ srflx/);
});

test("selected candidate verification fails closed and LAN never accepts a public or reflexive route",()=>{
  assert.equal(selectedVoicePair(new Map()),"connecting");
  assert.equal(selectedVoicePair(stats()),"direct");
  assert.equal(selectedVoicePair(stats("host","srflx")),"direct");
  assert.equal(selectedVoicePair(stats("host","srflx"),true),"connecting");
  for(const pair of [stats("relay","host"),stats("host","relay")])
    assert.equal(selectedVoicePair(pair),"blocked");
  const publicHost=stats();publicHost.get("remote").address="203.0.113.10";
  assert.equal(selectedVoicePair(publicHost,true),"connecting");
  assert.equal(selectedVoicePair(stats(),true),"direct");
});

for(const mode of ["lan","stun-only","turn-fallback"])test(`${mode} voice has independent audio-only ICE without relay credentials`,async t=>{
  const f=fixture(t,mode);
  assert.equal(f.captures.length,0,"Constructing/changing room must not capture.");
  const peer=await f.connect(),pc=f.pcs[0];
  assert.equal(f.voice.value.mode,"muted");assert.equal(f.captures.length,0);
  assert.deepEqual(pc.config.iceServers,mode==="lan"?[]:STUN_VOICE_SERVERS);
  assert.equal(pc.transceiver.kind,"audio");assert.equal(pc.transceiver.options.direction,"sendrecv");
  assert.doesNotMatch(JSON.stringify(pc.config),/turn:|turns:|credential|username/);
  assert.match(pc.localDescription.sdp,/usedtx=1/);assert.match(pc.localDescription.sdp,/maxaveragebitrate=24000/);
  assert.equal(peer.direct,false);
  assert.ok(f.signals.some(message=>message.value.kind==="description"));
});

test("microphone tracks wait for verified direct routing; hold/release and watchdog never latch open",async t=>{
  const f=fixture(t),peer=await f.connect(),pc=peer.pc;
  await f.voice.action("open-mic");
  assert.equal(f.captures.length,1);assert.equal(f.captures[0].video,false);
  assert.equal(f.captures[0].audio.channelCount.ideal,1);
  assert.equal(peer.track.enabled,false,"No media before selected-pair verification.");
  pc.stats=stats();await f.voice.check(peer);
  assert.equal(peer.track.enabled,true);assert.equal(f.voice.value.transmitting,true);
  assert.equal(pc.parameters.encodings[0].maxBitrate,24000);
  await f.voice.action("ptt");assert.equal(peer.track.enabled,false);
  await f.voice.action("press");assert.equal(peer.track.enabled,true);
  await f.voice.action("release");assert.equal(peer.track.enabled,false);
  await f.voice.action("press");f.voice.holdUntil=Date.now()-1;f.voice.tick();
  assert.equal(peer.track.enabled,false,"Lost native releases expire without ongoing refresh.");
  await f.voice.action("mute");
  assert.equal(f.voice.value.mode,"muted");assert.equal(f.voice.value.microphone,"off");
  assert.ok(f.tracks.every(track=>track.stopped));
});

for(const mode of ["before","after"])test(`LAN answerer transmits on the offered m-line with capture ${mode} the offer`,async t=>{
  const f=fixture(t);
  f.voice.room(room({members:[{id:"lan-peer",slot:0},{id:"lan-me",slot:1}]}),"lan");
  const peer=await f.connect(),pc=peer.pc;
  if(mode==="before")await f.voice.action("open-mic");
  assert.equal(pc.getTransceivers().length,0,"Answerer must not pre-create an unnegotiated audio sender.");
  f.voice.receive("lan-peer",{v:1,kind:"description",session:remote,for:f.voice.session,description:{type:"offer",sdp}});
  await flush();
  if(mode==="after")await f.voice.action("open-mic");
  assert.equal(pc.getTransceivers().length,1);
  assert.equal(pc.negotiated.direction,"sendrecv");assert.equal(peer.sender,pc.negotiated.sender);
  assert.equal(pc.negotiated.track,peer.track);assert.equal(peer.track.enabled,false);
  assert.equal(f.signals.at(-1).value.description.type,"answer");
  pc.stats=stats();await f.voice.check(peer);
  assert.equal(pc.negotiated.track.enabled,true);assert.equal(f.voice.value.transmitting,true);
});

test("outgoing direct audio does not wait for incoming playback to receive packets",async t=>{
  const f=fixture(t),peer=await f.connect();
  await f.voice.action("open-mic");
  peer.audio={muted:true,play:()=>new Promise(()=>{}),pause(){},remove(){}};
  peer.pc.stats=stats();await f.voice.check(peer);
  assert.equal(peer.track.enabled,true);assert.equal(peer.audio.muted,false);
  assert.equal(f.voice.value.transmitting,true);
});

test("a replacement LAN pair negotiates cleanly even if work from the former pair rejects late",async t=>{
  const f=fixture(t);
  const keepRoom=generation=>f.voice.room(room(),"lan",true,()=>generation);
  keepRoom("old");const old=await f.connect(),hello={v:1,kind:"hello",session:remote};
  let reject;
  old.pc.setRemoteDescription=()=>new Promise((_,fail)=>{reject=fail;});
  f.voice.receive("lan-peer",{v:1,kind:"description",session:remote,for:f.voice.session,description:{type:"answer",sdp}});
  await flush();assert.equal(typeof reject,"function");
  keepRoom("new");
  assert.equal(old.pc.closed,true);
  f.voice.receive("lan-peer",hello);await flush();const next=f.voice.peers.get("lan-peer");
  assert.ok(next&&next!==old,"The new pair must not be queued behind an old PC.");
  reject(Error("Old connection closed"));await flush();
  assert.equal(f.voice.peers.get("lan-peer"),next);assert.equal(next.failed,false);
});

test("LAN hello retry is bounded and restarts for a new link without opening the microphone",async t=>{
  const f=fixture(t);await f.voice.action("enable");
  for(let repeat=0;repeat<10;repeat++){t.mock.timers.tick(1200);f.voice.tick();}
  assert.equal(f.signals.filter(({value})=>value.kind==="hello").length,5);
  f.voice.room(room({peerLinks:[]}),"lan");f.voice.room(room(),"lan");
  assert.equal(f.signals.filter(({value})=>value.kind==="hello").length,6);
  f.voice.receive("lan-peer",{v:1,kind:"hello",session:remote});await flush();
  const before=f.signals.length;t.mock.timers.tick(2400);
  assert.equal(f.signals.length,before);assert.equal(f.captures.length,0);
});

test("mute, background and leaving discard a late microphone permission result",async t=>{
  let resolve;
  const f=fixture(t,"stun-only",{getUserMedia:()=>new Promise(done=>{resolve=done;})});
  await f.voice.action("enable");
  for(const action of ["mute","suspend","leave"]){
    if(!f.voice.context)f.voice.room(room(),"stun-only");
    await f.voice.action("enable");
    const pending=f.voice.action("open-mic");assert.equal(f.voice.value.microphone,"requesting");
    if(action==="leave")f.voice.room({phase:"closed",members:[]},"stun-only");
    else await f.voice.action(action);
    const late=f.stream();resolve(late);await pending;
    assert.equal(late.getTracks()[0].stopped,true);
    assert.equal(f.voice.value.mode,"muted");assert.equal(f.voice.value.transmitting,false);
  }
});

test("permission denial is local to voice and does not request media again automatically",async t=>{
  let attempts=0;
  const f=fixture(t,"lan",{getUserMedia:async()=>{attempts++;throw Object.assign(Error("denied"),{name:"NotAllowedError"});}});
  await f.connect();await f.voice.action("open-mic");f.voice.tick();
  assert.equal(f.voice.value.microphone,"denied");assert.equal(f.voice.value.error,"permission-denied");
  assert.equal(f.voice.value.mode,"muted");assert.equal(attempts,1);
  assert.equal(f.voice.context.owner,"lan-me");
});

test("mic volume starts at 100%, applies to outgoing gain only and never enables capture",async t=>{
  const f=fixture(t);
  assert.equal(f.voice.microphoneVolume,100);
  f.voice.setVolume(75);assert.equal(f.captures.length,0);assert.equal(f.voice.value.enabled,false);
  const peer=await f.connect();await f.voice.action("open-mic");
  const audio=f.contexts[0],source=audio.nodes.find(node=>node.kind==="source"),
    gain=audio.nodes.find(node=>node.kind==="gain"),destination=audio.nodes.find(node=>node.kind==="destination");
  assert.equal(gain.gain.value,.75);assert.deepEqual(source.outputs,[gain]);assert.deepEqual(gain.outputs,[destination]);
  assert.notEqual(peer.track,source.stream.getAudioTracks()[0],"Do not attach the hardware track directly.");
  assert.equal(peer.track.enabled,false,"Gain does not bypass direct-route verification.");
  for(const invalid of [-1,101,NaN,Infinity,"25",null,{}])f.voice.setVolume(invalid);
  assert.equal(gain.gain.value,.75);
  f.voice.setVolume(0);assert.equal(gain.gain.value,0);
  f.voice.setVolume(100);assert.equal(gain.gain.value,1);assert.equal(f.captures.length,1);
  await f.voice.action("mute");
  assert.equal(audio.state,"closed");assert.ok(f.tracks.every(track=>track.stopped));
});

test("releasing while the microphone gain context is starting stops raw and processed tracks",async t=>{
  const f=fixture(t);let resume;
  f.voice.makeAudioContext=()=>{
    const context=new f.Audio();context.state="suspended";
    context.resume=()=>new Promise(resolve=>{resume=resolve;});return context;
  };
  await f.connect();const pending=f.voice.action("open-mic");await flush();
  assert.equal(f.voice.value.microphone,"requesting");
  await f.voice.action("mute");
  assert.equal(f.contexts[0].state,"closed");assert.ok(f.tracks.every(track=>track.stopped));
  resume();await pending;
  assert.equal(f.voice.value.mode,"muted");assert.equal(f.voice.value.transmitting,false);
});

test("a microphone gain context that cannot resume times out without capture retry loops",async t=>{
  const f=fixture(t);
  f.voice.makeAudioContext=()=>{
    const context=new f.Audio();context.state="suspended";
    context.resume=()=>new Promise(()=>{});return context;
  };
  await f.connect();const pending=f.voice.action("open-mic");await flush();
  t.mock.timers.tick(4000);await pending;
  assert.equal(f.voice.value.error,"microphone-unavailable");
  assert.equal(f.contexts[0].state,"closed");assert.ok(f.tracks.every(track=>track.stopped));
  assert.equal(f.captures.length,1);
});

test("voice stops a relayed route, mutes received playback and does not retry TURN",async t=>{
  const f=fixture(t,"turn-fallback"),peer=await f.connect();
  let played=0,paused=0;
  peer.audio={muted:true,play:async()=>{played++;},pause(){paused++;},remove(){}};
  await f.voice.action("open-mic");await f.voice.check(peer);
  assert.equal(peer.audio.muted,true);assert.equal(played,0);
  peer.pc.stats=stats();await f.voice.check(peer);assert.equal(played,1);
  const audio=peer.audio;
  peer.pc.stats=stats("relay","host");await f.voice.check(peer);
  assert.equal(audio.srcObject,null);assert.equal(paused,1);assert.equal(peer.pc.closed,true);
  assert.equal(f.voice.value.error,"relay-blocked");assert.equal(f.voice.value.transmitting,false);
  f.voice.tick();assert.equal(f.pcs.length,1,"No relay fallback/retry PeerConnection is created.");
});

test("four-player voice uses the existing peer mesh; stale sessions and room recovery cannot reopen it",async t=>{
  const f=fixture(t,"lan");
  const state=room({members:[{id:"lan-me",slot:0},...[1,2,3].map(slot=>({id:"lan-peer"+slot,slot}))],
    peerLinks:["lan-peer1","lan-peer2","lan-peer3"]});
  f.voice.room(state,"lan");await f.voice.action("enable");
  for(const id of state.peerLinks)f.voice.receive(id,{v:1,kind:"hello",session:remote});
  await flush();assert.equal(f.pcs.length,3);
  f.voice.receive("lan-outsider",{v:1,kind:"hello",session:remote});
  f.voice.receive("lan-peer1",{v:1,kind:"description",session:remote,for:session,description:{type:"answer",sdp}});
  await flush();assert.equal(f.pcs.length,3);assert.equal(f.pcs[0].remoteDescription,undefined);
  f.voice.room({...state,recovery:{status:"reconnecting"}},"lan");
  assert.equal(f.voice.value.enabled,false);assert.ok(f.pcs.every(pc=>pc.closed));
  assert.equal(f.voice.value.error,"suspended");
});

test("native desktop media permission requires the trusted audio-only armed foreground broker",()=>{
  const scope={trusted:true,isMainFrame:true,phase:"playing",microphone:true,mediaTypes:["audio"]};
  const origin="pokebonk-standard://game";
  assert.equal(allowLanBrokerPermission("media",origin,scope),true);
  for(const change of [{trusted:false},{isMainFrame:false},{phase:"closed"},{microphone:false},
    {mediaTypes:[]},{mediaTypes:["video"]},{mediaTypes:["audio","video"]}])
    assert.equal(allowLanBrokerPermission("media",origin,{...scope,...change}),false);
  assert.equal(allowLanBrokerPermission("media","https://example.invalid",scope),false);
});
