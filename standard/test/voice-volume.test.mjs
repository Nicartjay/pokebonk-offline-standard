import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import * as policy from "../common/voice-state.mjs";
import {VoiceAudioDucker,VOICE_MUSIC_PERCENT} from "../runtime/voice-audio.js";
import {voiceAudioEdits} from "../adapters/voice-audio.mjs";
import {edits} from "../../scripts/source.ts";
import {NativeCoop} from "../desktop/coop.mjs";

const key="pokebonk.offline.standard.voice.mic-volume";
const ui=await readFile(new URL("../runtime/voice-ui.js",import.meta.url),"utf8");
function audioFixture(output){
  const nodes=[];
  function node(kind){
    const value={kind,outputs:[],gain:{value:1,cancelAndHoldAtTime(){},
      setTargetAtTime(value){this.value=value;}},
      connect(target){this.outputs.push(target);return target;}};
    nodes.push(value);return value;
  }
  const audio={vol:{master:.8,music:.5,sfx:.7,cries:.6},
    applyVolumes(){
      this.master.gain.value=this.vol.master;
      this.musicBus.gain.value=this.vol.music*.32;
      this.sfxBus.gain.value=this.vol.sfx*.55;
      this.cryBus.gain.value=this.vol.cries*.45;
    }};
  const level=bus=>audio[bus].outputs[0].gain.value;
  function rebuild(){
    audio.ctx={state:"running",currentTime:1,createGain:()=>node("duck")};
    audio.master=node("master");audio.cryFilter=node("cry filter");audio.cryFilter.connect(audio.master);
    for(const [bus,destination]of [["musicBus","master"],["sfxBus","master"],["cryBus","cryFilter"]]){
      audio[bus]=node(bus);
      audio[bus].connect(output(audio.ctx,bus,audio[destination]));
    }
    audio.applyVolumes();
  }
  rebuild();return {audio,nodes,rebuild,levels:()=>["musicBus","sfxBus","cryBus"].map(level)};
}
function uiFixture(stored=null){
  const sent=[],events=new Map(),saved=new Map(stored===null?[]:[[key,stored]]);
  class Element {
    constructor(tag,text){this.tagName=tag;this.textContent=text??"";this.children=[];this.isConnected=true;
      this.events={};this.attributes={};this.style={setProperty(){}};}
    setAttribute(key,value){this.attributes[key]=value;}
    append(...nodes){this.children.push(...nodes);}
    addEventListener(type,listener){this.events[type]=listener;}
  }
  const doc={hidden:false,addEventListener:(name,fn)=>events.set(name,fn)};
  const sandbox={...policy,VoiceAudioDucker,VOICE_MUSIC_PERCENT,document:doc,
    window:{addEventListener(){},localStorage:{getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,value)}},
    setInterval(){}};
  vm.runInNewContext(ui.replace(/^import .*;\s*$/gm,"")
    .replace("export function installVoiceUI","globalThis.installVoiceUI=function installVoiceUI"),sandbox);
  const api={lan:{state:()=>({phase:"idle",members:[]}),send:(...args)=>sent.push(args)}};
  sandbox.installVoiceUI(api,{el:(tag,text)=>new Element(tag,text)});
  return {api,sent,saved,doc,events};
}

test("microphone volume defaults to 100% and ignores absent or malformed device preferences",()=>{
  assert.equal(policy.DEFAULT_VOICE_VOLUME,100);
  for(const value of [null,undefined,""," ","-1","101","NaN","1e2","075",{},75])
    assert.equal(policy.voiceVolumePreference(value),100);
  for(const value of ["0","5","75","100"])assert.equal(policy.voiceVolumePreference(value),Number(value));
  for(const value of [-1,101,NaN,Infinity,null,"75",75.5,{}])assert.equal(policy.validVoiceVolume(value),false);
});

test("Settings and room share a device-only level without enabling voice",()=>{
  const f=uiFixture(),settings=f.api.voiceVolumeRow(),room=f.api.voiceVolumeRow();
  assert.deepEqual(f.sent,[["voice-volume",100]]);
  assert.equal(settings.children[1].value,"100");assert.equal(room.children[2].textContent,"100%");
  settings.children[1].value="35";settings.children[1].events.input();
  assert.equal(room.children[1].value,"35");assert.equal(room.children[2].textContent,"35%");
  assert.equal(f.saved.get(key),"35");assert.deepEqual(f.sent.at(-1),["voice-volume",35]);
  assert.ok(f.sent.every(([channel])=>channel==="voice-volume"));
  const restarted=uiFixture(f.saved.get(key));
  assert.equal(restarted.api.voiceVolumeRow().children[1].value,"35","Keep deliberate device preferences, not reset every launch.");
});

test("the adapter keeps the original output destinations, including the cry filter",()=>{
  const source=`const audio=new class {
    setVolumes(){}
    playTrack(){}
    preloadTrack(){}
    build(){this.musicBus.connect(this.master);this.sfxBus.connect(this.master);
      this.cryBus.connect(shelf);shelf.connect(lowpass);lowpass.connect(this.master);this.kitBus.connect(this.sfxBus)}
  }`;
  const patched=edits(source,voiceAudioEdits(source));
  assert.match(patched,/this\.musicBus\.connect\(globalThis\.PokeBonkOfflineUI\.voiceAudioOutput\(this\.ctx,"musicBus",this\.master\)\)/);
  assert.match(patched,/this\.sfxBus\.connect\(globalThis\.PokeBonkOfflineUI\.voiceAudioOutput\(this\.ctx,"sfxBus",this\.master\)\)/);
  assert.match(patched,/this\.cryBus\.connect\(globalThis\.PokeBonkOfflineUI\.voiceAudioOutput\(this\.ctx,"cryBus",shelf\)\)/);
  assert.match(patched,/shelf\.connect\(lowpass\);lowpass\.connect\(this\.master\);this\.kitBus\.connect\(this\.sfxBus\)/);
});

test("voice lowers music, SFX and cries independently without changing master or saved levels",()=>{
  const ducker=new VoiceAudioDucker(),f=audioFixture((...args)=>ducker.output(...args)),
    before=structuredClone(f.audio.vol),{master,cryFilter}=f.audio;
  assert.deepEqual(f.levels(),[1,1,1]);
  assert.deepEqual(f.audio.musicBus.outputs[0].outputs,[master]);
  assert.deepEqual(f.audio.sfxBus.outputs[0].outputs,[master]);
  assert.deepEqual(f.audio.cryBus.outputs[0].outputs,[cryFilter]);
  assert.deepEqual(cryFilter.outputs,[master]);
  ducker.setActive(true);
  assert.deepEqual(f.levels(),[.1,.5,.4]);
  assert.equal(master.gain.value,.8);
  assert.equal(f.audio.musicBus.gain.value,.5*.32,"Do not interrupt original game music fades.");
  assert.deepEqual(f.audio.vol,before);
  Object.assign(f.audio.vol,{music:.1,sfx:0,cries:.9});f.audio.applyVolumes();
  assert.deepEqual(f.levels(),[.1,.5,.4]);
  ducker.setActive(false);assert.deepEqual(f.levels(),[1,1,1]);
  assert.equal(f.audio.musicBus.gain.value,.1*.32);
  assert.equal(f.audio.sfxBus.gain.value,0);
  assert.equal(f.audio.cryBus.gain.value,.9*.45,"Restore the latest user level.");
});

test("voice mix ratios survive a normal audio-engine rebuild without compounding",()=>{
  const ducker=new VoiceAudioDucker(),f=audioFixture((...args)=>ducker.output(...args));
  ducker.setActive(true);
  const first=f.audio.musicBus.outputs[0];f.rebuild();
  assert.notEqual(f.audio.musicBus.outputs[0],first);
  assert.equal(ducker.gains.size,3);
  assert.deepEqual(f.levels(),[.1,.5,.4]);
  f.audio.applyVolumes();assert.deepEqual(f.levels(),[.1,.5,.4]);
  ducker.setActive(false);assert.deepEqual(f.levels(),[1,1,1]);
  assert.equal(first.gain.value,.1,"The retired context no longer receives volume changes.");
});

test("the voice chat toggle controls the game mix independently of mic state or permission",()=>{
  const f=uiFixture(),a=audioFixture(f.api.voiceAudioOutput),normal=[1,1,1],ducked=[.1,.5,.4];
  const setState=(room={},voice={})=>{
    f.events.get("standard:lan-state")({detail:{phase:"lobby",connectionMode:"lan",members:[],
      ...room,voice:{...policy.emptyVoiceState(),...voice}}});
  };
  setState();assert.deepEqual(a.levels(),normal);
  setState({}, {enabled:true});assert.deepEqual(a.levels(),ducked,"Voice on ducks game audio for listeners.");
  for(const voice of [{mode:"open",microphone:"requesting"}, {mode:"open",microphone:"ready"},
    {mode:"ptt",microphone:"ready",transmitting:true}, {mode:"ptt",microphone:"ready"},
    {mode:"muted"}, {mode:"muted",microphone:"denied",error:"permission-denied"}]){
    f.events.get("standard:lan-voice")({detail:{...policy.emptyVoiceState(),enabled:true,...voice}});
    assert.deepEqual(a.levels(),ducked,"Microphone changes never restore game audio while voice chat remains enabled.");
  }
  f.events.get("standard:lan-voice")({detail:policy.emptyVoiceState()});
  assert.deepEqual(a.levels(),normal,"Voice off restores game audio without leaving the room.");
  setState({}, {enabled:true});assert.deepEqual(a.levels(),ducked);
  setState({phase:"closed"}, {enabled:true});assert.deepEqual(a.levels(),normal,"Leaving restores even when the last voice event is stale.");
});

test("desktop volume commands are bounded, do not request a profile, and carry no capture action",async()=>{
  const messages=[];let profiles=0;
  const native=new NativeCoop({config:{internetCoop:{enabled:false}},identity:"voice-volume-test",
    profile:async()=>{profiles++;return {};},interfaces:()=>[],emit(){},broker:value=>messages.push(value),
    discovery:{cancel(){},advertise(){},close(){}}});
  assert.equal(native.microphoneVolume,100);
  for(const value of [-1,101,"25",null,{},Infinity,2.5])await native.fromGame("voice-volume",value);
  assert.equal(native.microphoneVolume,100);assert.equal(messages.length,0);
  await native.fromGame("voice-volume",25);
  assert.equal(native.microphoneVolume,25);assert.equal(messages.length,0,"Idle settings do not start a broker.");
  native.local.value={phase:"hosting",me:"lan-me",role:"host",members:[],linked:false};
  await native.fromGame("voice-volume",60);
  assert.deepEqual(messages.at(-1),{type:"voice-volume",owner:"lan-me",volume:60});
  assert.equal(profiles,0);assert.equal(native.voice.enabled,false);
});

test("the isolated preload admits only integer microphone levels, never a voice-on instruction",async()=>{
  const exposed={},sent=[];
  vm.runInNewContext(await readFile(new URL("../desktop/preload.cjs",import.meta.url),"utf8"),{
    document:{addEventListener(){}},window:{addEventListener(){}},
    require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>{exposed[name]=value;}},
      ipcRenderer:{on(){},send:(...args)=>sent.push(args)}})});
  for(const value of [-1,101,"25",null,{},NaN,75.5])exposed.PokeBonkLAN.send("voice-volume",value);
  assert.equal(sent.length,0);
  exposed.PokeBonkLAN.send("voice-volume",100);
  assert.deepEqual(sent,[["standard:lan-game","voice-volume",100]]);
});

test("Android includes capture and routing permissions while the game WebView still denies capture",async()=>{
  const manifest=await readFile(new URL("../android/app/src/main/AndroidManifest.xml",import.meta.url),"utf8");
  for(const name of ["RECORD_AUDIO","MODIFY_AUDIO_SETTINGS"])assert.match(manifest,new RegExp('android:name="android.permission.'+name+'"'));
  const java=await readFile(new URL("../android/app/src/main/java/dev/nicartjay/pokebonk/offline/standard/MainActivity.java",import.meta.url),"utf8");
  assert.match(java,/onPermissionRequest\(PermissionRequest request\)\{request.deny\(\);\}/);
  assert.match(java,/VoicePolicy.microphone\(/);assert.match(java,/request.grant\(new String\[\]\{PermissionRequest.RESOURCE_AUDIO_CAPTURE\}\)/);
});
