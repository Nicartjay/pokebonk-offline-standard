import {LanSession} from './lan-session.js';
import {RtcMesh} from './lan-rtc.js';
import {InternetBroker} from './internet-broker.js';
import {DirectVoice} from "./voice-rtc.js";
const output=value=>globalThis.PokeBonkLanBrokerNative.emit(JSON.stringify(value));
let voiceScope={};
const voice=new DirectVoice({emit:(value,context)=>{
  if(context?.owner)output({...voiceScope,type:"voice",owner:context.owner,value});
},signal:(peer,payload)=>{
  if(voiceScope.scope==="internet")internet.voiceSend(peer,payload);
  else room.voiceSend(peer,payload);
}});
const emit=value=>{
  if(value.type==="state"){
    voiceScope=value.scope==="internet"?{scope:"internet",epoch:value.epoch}:{};
    voice.room(value.value,value.scope==="internet"?(internet.run?.mode??"stun-only"):"lan",
      value.scope!=="internet"||value.value.voiceAvailable===true,
      value.scope==="internet"?undefined:peer=>room.voiceGeneration(peer));
  }
  if(value.type==="voice-signal"){voice.receive(value.peer,value.payload);return;}
  output(value);
};
const internet=new InternetBroker(emit);
const rtc=new RtcMesh(value=>room.rtcEvent(value));
const room=new LanSession({network:(connection,value)=>emit({type:'send',connection,value}),rtc:value=>void rtc.input(value),emit,
  terminate:reason=>emit({type:'terminate',reason})});
function input(value){
  try{
    if(value.type==="voice-action"||value.type==="voice-volume"){
      if(value.owner===voice.context?.owner &&
          (value.scope==="internet"?voiceScope.scope==="internet"&&value.epoch===internet.epoch:voiceScope.scope!=="internet")){
        voice.setVolume(value.volume);
        if(value.type==="voice-action")void voice.action(value.action).catch(()=>void voice.action("mute"));
      }
      return;
    }
    if(value.type==="reset")voice.stop();
    if(value.scope==="internet"){
      if(value.type==="reset")void internet.close();
      else if(value.type==="action"&&value.epoch===internet.epoch)internet.action(value.channel,value.data);
      else if(["host","join","find","browse"].includes(value.type))void internet.begin(value).catch(()=>emit({
        scope:"internet",epoch:value.epoch,type:"state",value:{phase:"error",members:[],linked:false,error:"Internet transport could not start."}}));
      return;
    }
    if(value.type==='reset'){room.reset(value.reason,value.error);void internet.close();}
    else if(value.type==='enter')room.enter(value.role,value.member,value.invitation,value.settings);
    else if(value.type==='open')room.opened(value.connection);
    else if(value.type==='message')room.received(value.connection,value.value);
    else if(value.type==='closed')room.closed(value.connection,value.reason);
    else if(value.type==='action')room.action(value.action,value.data);
    else if(value.type==='game')room.game(value.channel,value.data);
  }catch(error){emit({type:'terminate',reason:String(error.message).slice(0,240)});}
}
Object.defineProperty(globalThis,'PokeBonkLanBrokerInput',{value:input});
addEventListener('standard:lan-broker-input',event=>{
  if(typeof event.detail!=='string'||event.detail.length>65536)return;try{input(JSON.parse(event.detail));}catch{}
});
emit({type:'ready'});
