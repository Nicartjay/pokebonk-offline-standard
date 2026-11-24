import {LanSession} from './lan-session.js';
import {RtcMesh} from './lan-rtc.js';
import {InternetBroker} from './internet-broker.js';
const emit=value=>globalThis.PokeBonkLanBrokerNative.emit(JSON.stringify(value));
const internet=new InternetBroker(emit);
const rtc=new RtcMesh(value=>room.rtcEvent(value));
const room=new LanSession({network:(connection,value)=>emit({type:'send',connection,value}),rtc:value=>void rtc.input(value),emit,
  terminate:reason=>emit({type:'terminate',reason})});
function input(value){
  try{
    if(value.scope==="internet"){
      if(value.type==="reset")void internet.close();
      else if(value.type==="action"&&value.epoch===internet.epoch)internet.action(value.channel,value.data);
      else if(["host","join","find","browse"].includes(value.type))void internet.begin(value).catch(()=>emit({
        scope:"internet",epoch:value.epoch,type:"state",value:{phase:"error",members:[],linked:false,error:"Internet transport could not start."}}));
      return;
    }
    if(value.type==='reset'){room.reset(value.reason,value.error);void internet.close();}
    else if(value.type==='enter')room.enter(value.role,value.member,value.invitation);
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
