import {NativeLan} from "./lan.mjs";
import {coopConnectionMode} from "../common/coop-mode.mjs";
import {gatewayOrigin,internetState,internetInvitation} from "../common/internet-coop.mjs";
import {lanFrame} from "../common/lan-policy.mjs";
import {coopMaps,coopSeats,requireCoopUnlocks,coopDestination,coopLoadout} from "../common/coop-rules.mjs";
import {emptyVoiceState,voiceState,voiceRoomActive,VOICE_ACTIONS,voiceAvailable,validVoiceVolume,DEFAULT_VOICE_VOLUME} from "../common/voice-state.mjs";
const occupied=value=>["connecting","hosting","lobby","preparing","playing"].includes(value.phase);
export class NativeInternet {
  constructor({identity,profile,emit,broker,gateway}){
    Object.assign(this,{identity,profile,emit,broker,gateway});this.epoch=0;this.mode="stun-only";
    this.value={phase:"idle",members:[],linked:false};
  }
  state(){return {...structuredClone(this.value),connectionMode:this.mode,interfaces:[]};}
  publish(){this.emit({type:"state",value:this.state()});}
  input(value){const epoch=this.epoch;Promise.resolve(this.broker({...value,scope:"internet",epoch})).catch(()=>{
    if(epoch!==this.epoch)return;
    this.epoch++;this.value={phase:"error",members:[],linked:false,error:"Internet transport stopped."};this.publish();
  });}
  stop(reason="",error=false,reset=true){
    this.finding=false;
    this.epoch++;if(reset)this.input({type:"reset"});
    this.value={phase:error?"error":"closed",members:[],linked:false,discovery:{status:"idle",rooms:0},...(reason?{error:reason}:{})};this.publish();
  }
  cancelFind(){if(this.finding||["searching","joining"].includes(this.value.discovery?.status))this.stop();else this.publish();}
  async command(action,data={}){
    if(action==="leave"){this.stop();return;}
    if(action==="cancel-find"){this.cancelFind();return;}
    if(!["host","join","find","browse"].includes(action))return;
    if(!this.gateway)throw Error("Internet co-op service has not been configured. LAN remains available.");
    const mode=coopConnectionMode(data.connectionMode);
    if(mode==="lan")throw Error("Choose an Internet connection mode.");
    if(this.starting||this.finding||occupied(this.value))throw Error("Leave the current room or cancel the search first.");
    this.starting=true;this.finding=action==="find"||action==="browse";
    const generation=this.epoch;
    try{
      const profile=await this.profile();if(generation!==this.epoch)return;
      if(profile.unfinished)throw Error("Finish or explicitly end the preserved run before joining co-op.");
      if(!Number.isInteger(data.species)||!profile.league.includes(data.species))throw Error("Choose an owned Pokémon.");
      if(action==="join")internetInvitation(data.invitation);
      coopDestination(data.destination??"");
      this.stop();this.mode=mode;this.finding=action==="find"||action==="browse";
      this.value={phase:action==="browse"?"idle":"connecting",members:[],linked:false,discovery:{status:action==="find"?"searching":"idle",rooms:0},
        ...(action==="browse"?{roomListing:{status:"loading",rooms:[]}}:{})};this.publish();
      this.input({type:action,gateway:this.gateway,identity:this.identity,
        player:{name:String(profile.name).replace(/[\u0000-\u001f\u007f]/g,"").slice(0,24),maps:coopMaps(profile.maps)},
        data:{species:data.species,connectionMode:mode,destination:data.destination??"",...(action==="join"?{invitation:data.invitation}:{})}});
    }finally{this.starting=false;if(this.value.phase!=="connecting"&&this.value.roomListing?.status!=="loading")this.finding=false;}
  }
  async fromGame(channel,data){
    const epoch=this.epoch;
    if(channel==="refresh"){this.publish();return;}
    if(channel==="leave"){this.stop();return;}
    if(channel==="cancel-find"){this.cancelFind();return;}
    if(channel==="failed"){this.stop("Co-op preparation failed. Your save is preserved.",true);return;}
    if(channel==="room-return"){
      const profile=await this.profile();
      if(this.value.phase!=="playing"||data!==this.value.match?.party||profile.ticket?.party===data||
        !profile.completedParties?.includes(data))throw Error("The completed co-op run has not been saved.");
    }else if(channel==="prepared"){
      const {ticket}=await this.profile(),match=this.value.match;
      if(this.value.phase!=="preparing"||data!==match?.party||ticket?.party!==data||ticket.seed!==match.seed||
        ticket.lan?.me!==this.value.me||ticket.lan?.size!==this.value.members.length||ticket.lan?.launched!==false)
        throw Error("The Internet co-op run has not been durably committed.");
    }else if(["room-start","room-ready","room-pick","room-chat","room-settings","room-seats","room-loadout"].includes(channel)){
      if(!["hosting","lobby"].includes(this.value.phase))return;
      if(channel==="room-pick"){
        const profile=await this.profile();if(profile.unfinished||!profile.league.includes(data))throw Error("Choose an owned Pokémon.");
      }
      if(channel==="room-chat"&&(typeof data!=="string"||data.length>140))return;
      if(channel==="room-loadout")data=coopLoadout(data);
      if(channel==="room-settings"||channel==="room-seats"){
        if(this.value.role!=="host")throw Error("Only the host can change this room.");
        if(channel==="room-settings")requireCoopUnlocks(data,this.value.members);
        else coopSeats(data,this.value.members.length);
      }
    }else if(!(["ctl","snap"].includes(channel)&&this.value.phase==="playing"&&
      this.value.members.some(member=>member.id===data?.to&&member.id!==this.value.me)&&lanFrame(channel,data?.payload)))return;
    if(epoch===this.epoch)this.input({type:"action",channel,data});
  }
  fromBroker(value){
    if(value.epoch!==this.epoch)return;
    try{
      if(value.type==="state"){this.value=internetState(value.value,this.mode);this.finding=["searching","joining"].includes(this.value.discovery?.status)||this.value.roomListing?.status==="loading";this.publish();}
      else if(value.type==="frame"&&this.value.phase==="playing"&&this.value.members.some(member=>member.id===value.peer)&&lanFrame(value.channel,value.data))this.emit(value);
      else if(value.type==="peer-closed"&&this.value.members.some(member=>member.id===value.peer))
        this.emit({type:"peer-closed",peer:value.peer,permanent:value.permanent===true});
      else if(value.type==="notice"&&typeof value.message==="string")this.emit({type:"notice",message:value.message.slice(0,180)});
    }catch{this.stop("Invalid Internet room state. Your save is preserved.",true);}
  }
}
export class NativeCoop {
  constructor(options){
    this.active="lan";this.gateway=gatewayOrigin(options.config);
    this.voice=emptyVoiceState();this.voiceOwner=null;this.microphoneVolume=DEFAULT_VOICE_VOLUME;
    this.relayReady=Boolean(this.gateway&&options.config?.internetCoop?.relayEnabled===true);
    const emit=(type,value)=>{
      if(this.active!==type)return;
      if(value.type==="state"){
        if(!voiceRoomActive(value.value)||value.value.me!==this.voiceOwner){this.voice=emptyVoiceState();this.voiceOwner=value.value.me??null;}
        options.emit({...value,value:{...value.value,voice:structuredClone(this.voice),capabilities:{
          internetReady:Boolean(this.gateway),relayReady:this.relayReady,voiceReady:type==="lan"||value.value.voiceAvailable===true}}});
      }else options.emit(value);
    };
    this.emit=options.emit;
    this.local=new NativeLan({...options,emit:value=>emit("lan",value)});
    this.internet=new NativeInternet({...options,gateway:this.gateway,emit:value=>emit("internet",value)});
  }
  get controller(){return this.active==="lan"?this.local:this.internet;}
  get value(){return this.controller.value;}
  state(){return {...this.controller.state(),voice:structuredClone(this.voice),
    connectionMode:this.active==="lan"?"lan":this.internet.mode,
    capabilities:{internetReady:Boolean(this.gateway),relayReady:this.relayReady,voiceReady:this.active==="lan"||this.value.voiceAvailable===true}};}
  voiceAction(action){
    if(![...VOICE_ACTIONS,"press","release","suspend","permission-denied"].includes(action))return;
    const current=["press","release"].includes(action)?
      {...this.value,connectionMode:this.active==="lan"?"lan":this.internet.mode}:this.state();
    if(!voiceRoomActive(current)||!current.me||(!voiceAvailable(current)&&!["disable","mute","release","suspend"].includes(action)))return;
    if(action==="press"&&(!this.voice.enabled||this.voice.mode!=="ptt"||this.voice.microphone!=="ready"))return;
    this.controller.input({type:"voice-action",owner:current.me,action,volume:this.microphoneVolume});
  }
  publish(){this.controller.publish();}
  stop(...args){this.controller.stop(...args);}
  cancelFind(){this.controller.cancelFind();}
  async command(action,data={}){
    if(["host","join","find","browse"].includes(action)){
      const target=coopConnectionMode(data.connectionMode)==="lan"?"lan":"internet";
      if(target==="internet"&&!this.gateway)throw Error("Internet co-op service has not been configured. LAN remains available.");
      if(target!==this.active){
        if(this.controller.starting||this.controller.finding||occupied(this.value))throw Error("Leave the current room or cancel the search first.");
        this.controller.stop();this.active=target;
      }
    }
    return this.controller.command(action,data);
  }
  async fromGame(channel,data){
    if(channel==="voice-volume"){
      if(!validVoiceVolume(data))return;
      this.microphoneVolume=data;
      if(voiceRoomActive(this.value)&&this.value.me)
        this.controller.input({type:"voice-volume",owner:this.value.me,volume:data});
      return;
    }
    return this.controller.fromGame(channel,data);
  }
  fromBroker(value){
    if(value.type==="voice"){
      if((this.active==="internet")!==(value.scope==="internet")||
          value.scope==="internet"&&value.epoch!==this.internet.epoch||value.owner!==this.value.me)return;
      try{
        this.voice=voiceState(value.value,this.value.members,this.value.me);this.voiceOwner=value.owner;
        this.emit({type:"voice",value:structuredClone(this.voice)});
      }catch{/* Optional voice failure never terminates a game. */}
      return;
    }
    if(value.scope==="internet"){if(this.active==="internet")this.internet.fromBroker(value);}
    else if(this.active==="lan")this.local.fromBroker(value);
  }
}
