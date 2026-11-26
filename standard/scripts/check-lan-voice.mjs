// Real Chromium audio/ICE with an in-memory LAN signaling wire and synthetic
// microphones. No hardware capture, game saves, gateway, STUN, or TURN.
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {chromium} from "playwright-core";

const origin="http://127.0.0.1";
const modules=new Map([
  "runtime/voice-rtc.js","runtime/lan-session.js","runtime/stun-first.js",
  "common/voice-signaling.mjs","common/voice-state.mjs","common/lan-policy.mjs",
  "common/coop-mode.mjs","common/coop-recovery.mjs","common/coop-rules.mjs",
].map(name=>["/"+name,new URL("../"+name,import.meta.url)]));
const browser=await chromium.launch({headless:true,
  ...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),
  args:["--autoplay-policy=no-user-gesture-required","--mute-audio"],
});
try{
  const context=await browser.newContext({permissions:[]});
  await context.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.origin!==origin)return route.abort();
    if(url.pathname==="/")return route.fulfill({contentType:"text/html",body:"<!doctype html><title>LAN voice regression</title>"});
    const module=modules.get(url.pathname);
    if(!module)return route.abort();
    await route.fulfill({contentType:"text/javascript",body:await readFile(module,"utf8")});
  });
  const page=await context.newPage();
  await page.goto(origin);
  const results=await page.evaluate(async()=>{
    const {DirectVoice}=await import("/runtime/voice-rtc.js");
    const {LanSession}=await import("/runtime/lan-session.js");
    const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const voices=[],rooms=[],sources=[],errors=[],result=[];
    const trace=[];
    function failure(stage,error){
      // Log the failing operation and its first error line; no SDP or ICE
      // addresses are needed in the local test report.
      trace.push(`${stage}: ${error.name}: ${String(error.message).split(/[\r\n]/,1)[0]}`);
    }
    class Peer extends RTCPeerConnection {
      async setRemoteDescription(description){
        try{await super.setRemoteDescription(description);}
        catch(error){failure(`setRemoteDescription(${description.type})`,error);throw error;}
      }
    }
    const ids=["lan-voice-host","lan-voice-guest"];
    function require(condition,message){if(!condition)throw Error(message);}
    async function waitFor(predicate,label){
      const deadline=performance.now()+16000;
      while(performance.now()<deadline){
        if(await predicate())return;
        await sleep(100);
      }
      throw Error(`${label}: ${JSON.stringify(voices.map(v=>v.value))}; ${[...errors,...trace].join("; ")}`);
    }
    function device(i){
      const voice=new DirectVoice({Peer,emit(){},signal:(peer,message)=>rooms[i].voiceSend(peer,message),
        media:{async getUserMedia(){
          const source=new AudioContext(),tone=source.createOscillator(),gain=source.createGain(),
            output=source.createMediaStreamDestination();
          sources.push(source);tone.frequency.value=i?660:440;gain.gain.value=.16;
          tone.connect(gain).connect(output);tone.start();await source.resume();
          return output.stream;
        }}});
      const describe=voice.describe.bind(voice);
      voice.describe=async(peer,type)=>{
        try{await describe(peer,type);}
        catch(error){failure(`describe(${type})`,error);throw error;}
      };
      const room=new LanSession({
        network:(connection,packet)=>queueMicrotask(
          ()=>rooms[1-i].received(i?"guest":"host",structuredClone(packet))),
        rtc(){},
        emit:event=>{
          if(event.type==="state")voice.room(event.value,"lan",true,id=>room.voiceGeneration(id));
          if(event.type==="voice-signal")voice.receive(event.peer,event.payload);
        },
        terminate:reason=>errors.push(reason),
      });
      voices.push(voice);rooms.push(room);
    }
    device(0);device(1);
    const [host,guest]=rooms,[a,b]=voices;
    const trainer=i=>({id:ids[i],name:i?"Guest":"Host",species:i?7:4});
    const currentPeer=i=>voices[i].peers.get(ids[1-i]);
    const openLink=i=>rooms[i].rtcEvent({type:"link",peer:ids[1-i],
      token:rooms[i].voiceGeneration(ids[1-i]),state:"open"});
    try{
      host.enter("host",trainer(0),"192.168.1.10:42000#"+"a".repeat(32));
      await a.action("enable");
      let previous;
      for(const round of [1,2]){
        guest.enter("client",trainer(1));host.opened("guest");guest.opened("host");
        await waitFor(()=>guest.voiceGeneration(ids[0]),"LAN roster not ready");
        const generation=host.voiceGeneration(ids[1]);
        require(generation&&generation!==previous,"Rejoin must use a fresh pair");
        previous=generation;
        await b.action("enable");await b.action("open-mic");
        openLink(1);
        await waitFor(()=>host.pendingVoiceHello.has(ids[1]),"Early hello was not staged");
        openLink(0);
        await waitFor(()=>voices.every((_,i)=>currentPeer(i)?.direct),`Round ${round}: direct audio not ready`);
        await a.action("open-mic");
        await waitFor(async()=>{
          const incoming=await Promise.all(voices.map((_,i)=>currentPeer(i).pc.getStats()));
          return incoming.every(stats=>[...stats.values()].some(row=>row.type==="inbound-rtp"&&
            row.kind==="audio"&&row.packetsReceived>10&&row.totalAudioEnergy>0));
        },`Round ${round}: no non-silent audio in both directions`);
        const sendRecv=voices.map((_,i)=>currentPeer(i).pc.getTransceivers()
          .filter(value=>value.mid!=null).map(value=>value.currentDirection));
        require(sendRecv.every(tracks=>tracks.length===1&&tracks[0]==="sendrecv"),
          "Each peer should use exactly one bidirectional audio m-line");
        const old=voices.map((_,i)=>currentPeer(i).pc);
        host.closed("guest","left");guest.reset();
        require(old.every(pc=>pc.connectionState==="closed"),"The old voice connections must close on leave");
        require(!b.value.enabled&&b.value.microphone==="off","Rejoining starts with the guest's mic off");
        result.push({round,nonSilentAudio:["host to guest","guest to host"],freshPair:true});
      }
      require(!errors.length,"LAN signaling reported a game-room failure");
      return result;
    }finally{
      for(const voice of voices)voice.close();
      for(const room of rooms)room.reset();
      await Promise.all(sources.map(source=>source.close()));
    }
  });
  assert.equal(results.length,2);
  console.log(JSON.stringify({status:"passed",syntheticOnly:true,rounds:results},null,2));
}finally{await browser.close();}
