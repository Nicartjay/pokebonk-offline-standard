import net from 'node:net';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {privateIPv4,invitation,lanDescription,lanFrame,lanState,sameSubnet} from '../common/lan-policy.mjs';
import {lanWire} from './lan-wire.mjs';
import {LanDiscovery} from './lan-discovery.mjs';
import {requireLanConnectionMode,lanRoomCode,roomListing} from '../common/coop-mode.mjs';
import {COOP_RECONNECT_MS,retryDelay} from '../common/coop-recovery.mjs';
import {coopMaps,coopSeats,requireCoopUnlocks,coopLoadout,coopDestination,coopRoomMatches} from '../common/coop-rules.mjs';
export function lanInterfaces(){
  return Object.entries(os.networkInterfaces()).flatMap(([label,list])=>/^(utun|tun|tap|wg|tailscale|docker|veth|br-)/i.test(label)?[]:(list??[])
    .filter(i=>i.family==='IPv4'&&!i.internal&&privateIPv4(i.address)).map(i=>({label,address:i.address,netmask:i.netmask})));
}
export class NativeLan {
  constructor({identity,profile,emit,broker,interfaces=lanInterfaces,discovery}){
    Object.assign(this,{identity,profile,emit,broker,interfaces});this.wires=new Map();this.epoch=0;this.value={phase:'idle',members:[],linked:false};
    this.findSerial=0;this.findState={status:"idle",rooms:0};this.listing={status:"idle",rooms:[]};
    this.discovery=discovery??new LanDiscovery({identity,interfaces,progress:rooms=>{
      if(this.finding&&this.findKind==="find"){this.findState={status:"searching",rooms};this.publish();}
    }});
  }
  state(){
    const {invitation:_privateInvite,...value}=this.value;
    return structuredClone({...value,discovery:this.findState,roomListing:roomListing(this.listing),
      interfaces:this.interfaces().map(({label,address})=>({label,address}))});
  }
  publish(){this.emit({type:'state',value:this.state()});}
  input(value){Promise.resolve(this.broker(value)).catch(error=>this.stop(error.message,true,false));}
  cancelFind(publish=true){
    if(this.value.phase==="connecting"&&this.findKind==="code"&&!this.server&&!this.wires.size){
      this.epoch++;this.value={phase:"idle",members:[],linked:false};this.input({type:"reset",reason:"",error:false});
    }
    this.findSerial++;this.finding=false;this.discovery.cancel();this.findState={status:"idle",rooms:0};
    this.listing={status:"idle",rooms:[]};
    if(publish)this.publish();
  }
  async find(data,kind="find",code){
    requireLanConnectionMode(data.connectionMode);
    coopDestination(data.destination??"");
    if(this.starting||this.finding||this.server||this.wires.size||['hosting','connecting','lobby','preparing','playing'].includes(this.value.phase))throw Error('Leave the current room or cancel the search first.');
    const serial=++this.findSerial;this.finding=true;this.findKind=kind;
    try{
      const profile=await this.profile();
      if(serial!==this.findSerial)return;
      if(profile.unfinished)throw Error('Finish or explicitly end your preserved run before finding a local room.');
      if(!Number.isInteger(data.species)||!profile.league.includes(data.species))throw Error('Choose an owned Pokémon.');
      if(!this.interfaces().length)throw Error('Connect to a private Wi-Fi or local hotspot first.');
      this.findState={status:kind==="find"?"searching":kind==="code"?"joining":"idle",rooms:0};
      this.listing={status:kind==="browse"?"loading":"idle",rooms:[]};
      if(kind==="code")this.value={phase:"connecting",members:[],linked:false};
      this.publish();
      const result=await this.discovery.find(kind==="code"?{code}:{});
      if(serial!==this.findSerial||result.cancelled)return;
      this.finding=false;
      if(kind!=="code")result.rooms=result.rooms.filter(room=>coopRoomMatches(room.settings,data.destination??""));
      if(kind==="browse"){
        const counts=new Map();for(const room of result.rooms){const key=lanRoomCode(room.id);counts.set(key,(counts.get(key)??0)+1);}
        const rooms=result.rooms.filter(room=>counts.get(lanRoomCode(room.id))===1)
          .map(room=>({code:lanRoomCode(room.id),name:room.name,players:room.count,capacity:room.capacity??4,settings:room.settings,rulesAt:room.rulesAt}));
        this.listing=roomListing({status:rooms.length?"ready":"empty",rooms});this.publish();return;
      }
      const candidates=code?result.rooms.filter(room=>lanRoomCode(room.id)===code):result.rooms;
      if(code&&candidates.length!==1)throw Error(candidates.length?"More than one host has that code. Ask them to create a new room.":"No compatible LAN room has that code. Check the host and Wi-Fi.");
      if(!result.rooms.length){this.findState={status:"empty",rooms:0};this.publish();return;}
      this.findState={status:"joining",rooms:result.rooms.length};this.publish();
      if(kind==="code")this.value={phase:"idle",members:[],linked:false};
      try{await this.command("join",{species:data.species,invitation:candidates[0].invitation});}
      catch(error){this.stop(error.message,true);}
    }catch(error){
      if(serial!==this.findSerial)return;
      if(kind==="code")this.value={phase:"error",members:[],linked:false,error:String(error.message).slice(0,160)};
      if(kind==="browse")this.listing={status:"error",rooms:[],message:"Couldn’t list local rooms. Check Wi-Fi and refresh."};
      this.findState={status:"error",rooms:0,message:String(error.message).slice(0,160)};this.publish();
    }finally{if(serial===this.findSerial)this.finding=false;}
  }
  stop(reason='',error=false,reset=true){
    clearTimeout(this.reconnectTimer);this.reconnectTarget=null;this.reconnectUntil=null;this.reconnectAttempts=0;
    this.cancelFind(false);this.discovery.advertise(null);
    this.epoch++;
    this.server?.close();this.server=null;
    const wires=[...this.wires.values()],leaving=!error&&this.value.phase==='playing'&&this.value.role==='client';
    this.wires.clear();
    for(const wire of wires){
      if(leaving){try{wire.send({op:'leave'});}catch{}setTimeout(()=>wire.close(),40);}
      else wire.close();
    }
    this.value={phase:error?'error':'closed',members:[],linked:false,...(reason?{error:reason}:{})};
    if(reset)this.input({type:'reset',reason,error});this.publish();
  }
  async command(action,data={}){
    if(['host','join','find','browse'].includes(action))requireLanConnectionMode(data.connectionMode);
    if(action==='cancel-find'){this.cancelFind();return;}
    if(action==='find')return this.find(data);
    if(action==='browse')return this.find(data,"browse");
    if(action==='join'&&typeof data.invitation==="string"&&/^[A-Z0-9]{4}$/.test(data.invitation.trim().toUpperCase()))
      return this.find(data,"code",data.invitation.trim().toUpperCase());
    if(action==='leave'){this.stop();return;}
    if(!['host','join'].includes(action))return this.input({type:'action',action,data});
    if(this.starting||this.server||this.wires.size||['hosting','connecting','lobby','preparing','playing'].includes(this.value.phase))throw Error('Leave the current local room first.');
    this.starting=true;
    const requestedEpoch=this.epoch;
    try{
      const profile=await this.profile();if(requestedEpoch!==this.epoch)return;
      if(profile.unfinished)throw Error('Finish or explicitly end your preserved run before joining LAN co-op.');
      if(!Number.isInteger(data.species)||!profile.league.includes(data.species))throw Error('Choose an owned Pokémon.');
      const member={id:'lan-'+randomUUID(),name:String(profile.name).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,24),species:data.species,maps:coopMaps(profile.maps)};
      const settings=coopDestination(data.destination??"");
      const invite=action==='join'?invitation(data.invitation):null;
      const selected=action==='host'?this.interfaces().find(i=>i.address===data.address):null;
      if(action==='host'&&!selected)throw Error('Choose a private local network interface.');
      if(invite&&!this.interfaces().some(i=>sameSubnet(i.address,invite.address,i.netmask)))throw Error('The host must be on your current private LAN.');
      this.stop();this.value={phase:'connecting',members:[],linked:false};this.publish();
      const generation=this.epoch;
      const secret=invite?.secret??randomBytes(16).toString('hex');
      if(action==='host'){
        const server=net.createServer(socket=>{
          if(this.server!==server){socket.destroy();return;}
          const address=socket.remoteAddress?.replace(/^::ffff:/,'');
          if(this.wires.size>=6||!privateIPv4(address)||!sameSubnet(address,selected.address,selected.netmask)){socket.destroy();return;}
          this.attach(socket,true,secret);
        });this.server=server;
        server.on('error',error=>{if(this.server===server)this.stop(error.message,true);});
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,selected.address,resolve);});
        await this.broker({type:'enter',role:'host',member,settings,invitation:`${selected.address}:${server.address().port}#${secret}`});
      }else{
        this.reconnectTarget={invite,secret,generation};
        await this.broker({type:'enter',role:'client',member});
        if(generation!==this.epoch)return;
        const socket=net.connect({host:invite.address,port:invite.port});this.attach(socket,false,secret);
      }
    }finally{this.starting=false;}
  }
  attach(socket,host,secret){
    const connection=randomUUID();
    const wire=lanWire(socket,{host,identity:this.identity,secret},{
      open:()=>this.input({type:'open',connection}),
      message:value=>{try{if(value?.op==='signal')value={...value,description:lanDescription(value.description)};this.input({type:'message',connection,value});}catch(error){wire.close(error.message);}},
      close:reason=>{
        if(this.wires.get(connection)!==wire)return;
        this.wires.delete(connection);this.input({type:'closed',connection,reason});
        if(!host&&this.value.phase==='playing'&&this.reconnectTarget)this.retryConnection();
      },
    });this.wires.set(connection,wire);
  }
  retryConnection(){
    clearTimeout(this.reconnectTimer);
    const target=this.reconnectTarget;if(!target)return;
    this.reconnectUntil??=Date.now()+COOP_RECONNECT_MS;
    if(Date.now()>=this.reconnectUntil){this.stop('Reconnection timed out. Ending this run.',true);return;}
    this.reconnectTimer=setTimeout(()=>{
      if(this.reconnectTarget!==target||target.generation!==this.epoch)return;
      if(!this.interfaces().some(network=>sameSubnet(network.address,target.invite.address,network.netmask))){this.retryConnection();return;}
      const socket=net.connect({host:target.invite.address,port:target.invite.port});
      this.attach(socket,false,target.secret);
    },retryDelay(this.reconnectAttempts=(this.reconnectAttempts??0)+1));
  }
  async fromGame(channel,data){
    if(channel==='cancel-find'){this.cancelFind();return;}
    if(channel==='refresh'){this.publish();return;}
    if(channel==='leave'){this.stop();return;}
    if(channel==="room-return"){
      const profile=await this.profile();
      if(this.value.phase!=="playing"||data!==this.value.match?.party||profile.ticket?.party===data||
        !profile.completedParties?.includes(data))throw Error("The completed co-op run has not been saved.");
      this.input({type:"action",action:"return",data});return;
    }
    if(['room-ready','room-start','room-pick','room-chat','room-settings','room-seats','room-loadout'].includes(channel)){
      if(!['hosting','lobby'].includes(this.value.phase))return;
      if(channel==='room-pick'){
        const profile=await this.profile();if(profile.unfinished||!Number.isInteger(data)||!profile.league.includes(data))throw Error('Choose an owned Pokémon and finish any preserved run first.');
      }
      if(channel==='room-chat'&&(typeof data!=='string'||data.length>140))return;
      if(channel==='room-loadout')data=coopLoadout(data);
      if(channel==='room-settings'||channel==='room-seats'){
        if(this.value.role!=="host")throw Error("Only the host can change this room.");
        if(channel==='room-settings')requireCoopUnlocks(data,this.value.members);
        else coopSeats(data,this.value.members.length);
      }
      this.input({type:'action',action:channel.slice(5),data});return;
    }
    if(channel==='prepared'){
      const profile=await this.profile(),ticket=profile.ticket;
      if(this.value.phase!=='preparing'||data!==this.value.match?.party||ticket?.party!==data||ticket.seed!==this.value.match.seed||
        ticket.lan?.me!==this.value.me||ticket.lan?.size!==this.value.members.length||ticket.lan?.launched!==false)throw Error('The LAN run has not been durably committed.');
      this.input({type:'game',channel,data});return;
    }
    if(channel==='failed'){this.stop('The local co-op run could not be committed or launched. Your save is preserved.',true);return;}
    if(this.value.phase==='playing'&&lanFrame(channel,data?.payload)&&this.value.members.some(m=>m.id===data?.to&&m.id!==this.value.me))this.input({type:'game',channel,data});
  }
  fromBroker(value){
    try{
      if(value.type==='state'){
        this.value=lanState(value.value);
        if(this.value.phase==='playing'&&this.value.linked){clearTimeout(this.reconnectTimer);this.reconnectUntil=null;this.reconnectAttempts=0;}
        this.discovery.advertise(this.value);this.publish();
      }
      else if(value.type==='send'){
        const wire=this.wires.get(value.connection);if(!wire)return;
        const message=value.value;if(message?.op==='signal')message.description=lanDescription(message.description);
        if(JSON.stringify(message).length>48000)throw Error('Oversized local signaling message.');wire.send(message);
      }else if(value.type==='reject'){
        const wire=this.wires.get(value.connection);wire?.send({op:'rejected',reason:String(value.reason).slice(0,180)});setTimeout(()=>wire?.close(),40);
      }else if(value.type==='terminate')this.stop(String(value.reason).slice(0,240),true);
      else if(value.type==='frame'&&this.value.phase==='playing'&&this.value.members.some(m=>m.id===value.peer)&&lanFrame(value.channel,value.data))this.emit(value);
      else if(value.type==='peer-closed'||value.type==='notice')this.emit(value);
    }catch(error){this.stop(error.message,true);}
  }
}
