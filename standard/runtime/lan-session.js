// Trusted native-owned broker only. One room state machine on every platform.
// No HTTP, discovery scan, account, save path, or public signaling service.
import {lanDescription} from '../common/lan-policy.mjs';
const copy = value => structuredClone(value);
const idOK = id => typeof id === 'string' && /^lan-[\w-]{1,80}$/.test(id);
const clean = text => String(text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
const pairKey = (a,b) => [a,b].sort().join('|');
function player(value) {
  if (!value || !idOK(value.id) || !Number.isInteger(value.species) || value.species < 1 || value.species > 10000) throw Error('Invalid LAN player.');
  return {id:value.id, name:clean(value.name)||'Player', species:value.species, slot:value.slot, ready:value.ready===true};
}
function matchOK(match, members) {
  return match && idOK(match.party) && Number.isInteger(match.seed) && match.seed>=0 && match.seed<=0xffffffff &&
    match.mode==='standard' && match.biome==='forest' && match.tier===0 && Array.isArray(match.players) &&
    JSON.stringify(match.players)===JSON.stringify(members.map(m=>m.id));
}
export class LanSession {
  constructor({network, rtc, emit, terminate, random = () => crypto.randomUUID(), seed = () => crypto.getRandomValues(new Uint32Array(1))[0]}) {
    Object.assign(this,{network,rtc,emit,terminate,random,seed}); this.connections=new Map();this.pairs=new Map();this.prepared=new Set();
    this.value={phase:'idle',members:[],linked:false,chat:[],disconnected:[]};
  }
  publish() { this.emit({type:'state',value:copy(this.value)}); }
  reset(reason='', error=false) {
    clearTimeout(this.timer); this.rtc({type:'close'});this.connections.clear();this.pairs.clear();this.prepared.clear();
    this.value={phase:error?'error':'closed',members:[],linked:false,chat:[],disconnected:[],...(reason?{error:reason}:{})};this.publish();
  }
  fail(error) { this.terminate(String(error?.message??error).slice(0,240)); }
  enter(role, mine, invitation) {
    this.reset(); const me=player(mine);me.slot=0;me.ready=role==='host';
    this.value={phase:role==='host'?'hosting':'connecting',role,me:me.id,members:[me],linked:false,chat:[],disconnected:[],
      ...(invitation?{invitation,code:invitation.split('#')[1].slice(0,4).toUpperCase()}:{})};this.publish();
  }
  opened(connection) {
    this.connections.set(connection,null);
    if(this.value.role==='client') { this.hostConnection=connection;this.network(connection,{op:'player',member:this.value.members[0]}); }
  }
  sendTo(id,message) {
    if(id===this.value.me) return;
    const connection=[...this.connections].find(([,peer])=>peer===id)?.[0];
    if(connection) this.network(connection,message);
  }
  broadcast() {
    this.value.linked=this.value.members.length>=2 && this.value.disconnected.length===0 && this.pairs.size===this.value.members.length*(this.value.members.length-1)/2 &&
      [...this.pairs.values()].every(p=>p.open.size===2);
    const {invitation,role,me,...state}=this.value;
    for(const [connection,peer] of this.connections) if(peer) this.network(connection,{op:'room',value:state});
    this.publish();
  }
  createPairs() {
    const members=this.value.members;
    for(let i=0;i<members.length;i++)for(let j=i+1;j<members.length;j++) {
      const a=members[i].id,b=members[j].id,key=pairKey(a,b);if(this.pairs.has(key))continue;
      const token=this.random().replaceAll('-','').slice(0,32);
      this.pairs.set(key,{a,b,token,open:new Set()});
      for(const [mine,peer,offerer] of [[a,b,true],[b,a,false]]) {
        const message={op:'setup',peer,token,offerer};
        if(mine===this.value.me)this.setup(message);else this.sendTo(mine,message);
      }
    }
  }
  setup(value) {
    if(!idOK(value.peer)||!this.value.members.some(m=>m.id===value.peer)||!/^[a-f0-9]{32}$/.test(value.token))throw Error('Invalid LAN peer setup.');
    const key=pairKey(this.value.me,value.peer),existing=this.pairs.get(key);
    if(this.value.role==='client')this.pairs.set(key,{a:this.value.me,b:value.peer,token:value.token,open:new Set()});
    else if(existing?.token!==value.token)throw Error('Invalid LAN pairing token.');
    this.rtc({type:'configure',peer:value.peer,token:value.token,offerer:value.offerer===true});
  }
  received(connection,value) {
    try {
      if(!value||typeof value.op!=='string')throw Error('Invalid local room message.');
      if(this.value.role==='host')this.hostReceived(connection,value);
      else if(connection===this.hostConnection)this.clientReceived(value);
    }catch(error){this.fail(error);}
  }
  hostReceived(connection,value) {
    const sender=this.connections.get(connection);
    if(value.op==='player' && !sender) {
      if(!['hosting','lobby'].includes(this.value.phase)||this.value.members.length>=4) {this.emit({type:'reject',connection,reason:'This room is full or the match has already started.'});return;}
      const peer=player(value.member);
      if(this.value.members.some(m=>m.id===peer.id))throw Error('Duplicate LAN player.');
      peer.slot=[1,2,3].find(slot=>!this.value.members.some(m=>m.slot===slot));peer.ready=false;
      this.value.members.push(peer);this.value.members.sort((a,b)=>a.slot-b.slot);this.connections.set(connection,peer.id);this.value.phase='lobby';
      // Publish roster before setup so every endpoint can validate peer IDs.
      this.broadcast();this.createPairs();this.broadcast();return;
    }
    if(!sender)throw Error('Join the local room first.');
    if(value.op==='signal') { this.routeSignal(sender,value);return; }
    if(value.op==='linked') {this.report(sender,value.peer,value.open===true,value.token);return;}
    if(value.op==='prepared') {this.markPrepared(sender,value.party);return;}
    if(value.op==='ready'&&this.value.phase==='lobby'&&typeof value.ready==='boolean') {
      this.value.members.find(m=>m.id===sender).ready=value.ready;this.broadcast();return;
    }
    if(value.op==='pick'&&this.value.phase==='lobby'&&Number.isInteger(value.species)&&value.species>0&&value.species<=10000) {
      const member=this.value.members.find(m=>m.id===sender);member.species=value.species;member.ready=false;this.broadcast();return;
    }
    if(value.op==='chat'&&['hosting','lobby'].includes(this.value.phase)) {this.chat(sender,value.text);return;}
    if(value.op==='leave') {this.emit({type:'reject',connection,reason:'Left the room.'});return;}
    if(value.op==='failed')throw Error('A player could not commit their local run. Unfinished saves are preserved.');
    throw Error('Unexpected LAN room action.');
  }
  clientReceived(value) {
    if(value.op==='rejected')throw Error(String(value.reason??'The host refused this connection.').slice(0,180));
    if(value.op==='room') {
      const room=value.value;
      if(!room||!['lobby','preparing','playing','hosting'].includes(room.phase)||!Array.isArray(room.members)||room.members.length<1||room.members.length>4)throw Error('Invalid LAN roster.');
      const members=room.members.map(player);
      if(new Set(members.map(m=>m.id)).size!==members.length||new Set(members.map(m=>m.slot)).size!==members.length||
        members.some((m,i)=>!Number.isInteger(m.slot)||m.slot<0||m.slot>3||i===0&&m.slot!==0)||!members.some(m=>m.id===this.value.me))throw Error('Invalid LAN player slots.');
      if(['preparing','playing'].includes(room.phase)&&!matchOK(room.match,members))throw Error('Invalid shared LAN run.');
      if(this.value.phase==='playing' && JSON.stringify(room.match)!==JSON.stringify(this.value.match))throw Error('A running LAN match cannot change.');
      const {role,me}=this.value;this.connections.set(this.hostConnection,members[0].id);
      this.value={phase:room.phase,role,me,members,linked:room.linked===true,code:String(room.code??'LAN').slice(0,8),
        chat:Array.isArray(room.chat)?room.chat.slice(-40):[],disconnected:Array.isArray(room.disconnected)?room.disconnected.filter(idOK):[],...(room.match?{match:copy(room.match)}:{})};
      this.publish();return;
    }
    if(value.op==='setup') {this.setup(value);return;}
    if(value.op==='signal') {this.acceptSignal(value);return;}
    if(value.op==='drop') {this.dropPeer(value.peer);return;}
    throw Error('Unexpected local host message.');
  }
  routeSignal(from,value) {
    const pair=this.pairs.get(pairKey(from,value.to));
    if(!pair||pair.token!==value.token)throw Error('Unknown local peer signal.');
    const message={op:'signal',from,to:value.to,token:pair.token,description:lanDescription(value.description)};
    if(value.to===this.value.me)this.acceptSignal(message);else this.sendTo(value.to,message);
  }
  acceptSignal(value) {
    const pair=this.pairs.get(pairKey(this.value.me,value.from));
    if(!pair||pair.token!==value.token||value.to!==this.value.me)throw Error('Invalid local signal destination.');
    this.rtc({type:'signal',peer:value.from,token:pair.token,description:lanDescription(value.description)});
  }
  report(from,peer,open,token) {
    const pair=this.pairs.get(pairKey(from,peer));if(!pair||pair.token!==token)throw Error('Unknown local peer connection.');
    if(open)pair.open.add(from);else pair.open.delete(from);this.broadcast();
  }
  rtcEvent(value) {
    try {
      const pair=this.pairs.get(pairKey(this.value.me,value.peer));if(!pair||pair.token!==value.token)return;
      if(value.type==='signal') {
        const message={op:'signal',to:value.peer,token:pair.token,description:lanDescription(value.description)};
        if(this.value.role==='host')this.routeSignal(this.value.me,message);else this.network(this.hostConnection,message);
      }else if(value.type==='link') {
        if(value.state!=='open') {this.fail('The direct local peer connection failed. Check Wi-Fi, Local Network/firewall permission and VPNs. Your save is preserved.');return;}
        if(this.value.role==='host')this.report(this.value.me,value.peer,true,pair.token);
        else this.network(this.hostConnection,{op:'linked',peer:value.peer,token:pair.token,open:true});
      }else if(value.type==='frame'&&this.value.phase==='playing')this.emit({type:'frame',peer:value.peer,channel:value.channel,data:value.data});
    }catch(error){this.fail(error);}
  }
  action(action,data) {
    try {
      if(action==='leave'){this.fail('You left the local room.');return;}
      if(!['hosting','lobby'].includes(this.value.phase))throw Error('That action is only available in the local lobby.');
      const mine=this.value.members.find(m=>m.id===this.value.me);
      if(action==='ready') {
        if(this.value.role==='host'){mine.ready=true;this.broadcast();}
        else this.network(this.hostConnection,{op:'ready',ready:!mine.ready});
      }else if(action==='pick') {
        if(!Number.isInteger(data)||data<1||data>10000)throw Error('Choose an owned Pokémon.');
        if(this.value.role==='host'){mine.species=data;mine.ready=true;this.broadcast();}
        else this.network(this.hostConnection,{op:'pick',species:data});
      }else if(action==='chat') {
        if(this.value.role==='host')this.chat(this.value.me,data);else this.network(this.hostConnection,{op:'chat',text:data});
      }else if(action==='start') {
        if(this.value.role!=='host'||!this.value.linked||this.value.members.length<2||!this.value.members.every(m=>m.ready))throw Error('Wait for 2–4 directly connected, ready players.');
        this.value.phase='preparing';this.value.chat=[];this.prepared.clear();
        this.value.match={party:'lan-'+this.random(),seed:this.seed(),biome:'forest',tier:0,mode:'standard',players:this.value.members.map(m=>m.id)};
        this.broadcast();this.timer=setTimeout(()=>this.fail('LAN start timed out. Any unfinished run has been preserved.'),25000);
      }else throw Error('Unknown LAN action.');
    }catch(error){this.emit({type:'notice',message:String(error.message).slice(0,240)});}
  }
  chat(from,text) {
    if(typeof text!=='string'||!text.trim()||text.length>140)throw Error('Use a message of 1–140 characters.');
    const now=Date.now();this.lastChat??=new Map();if(now-(this.lastChat.get(from)??0)<500)return;this.lastChat.set(from,now);
    const member=this.value.members.find(m=>m.id===from);if(!member)return;
    this.value.chat.push({id:this.random(),from,name:member.name,text:text.replace(/[\u0000-\u001f\u007f]/g,' ').trim(),at:now});
    this.value.chat=this.value.chat.slice(-40);this.broadcast();
  }
  preparedLocal(party) {
    if(party!==this.value.match?.party||this.value.phase!=='preparing')return;
    if(this.value.role==='host')this.markPrepared(this.value.me,party);else this.network(this.hostConnection,{op:'prepared',party});
  }
  markPrepared(id,party) {
    if(this.value.phase!=='preparing'||party!==this.value.match?.party||!this.value.members.some(m=>m.id===id))return;
    this.prepared.add(id);
    if(this.prepared.size===this.value.members.length){clearTimeout(this.timer);this.value.phase='playing';delete this.value.invitation;this.broadcast();}
  }
  game(channel,value) {
    if(channel==='prepared'){this.preparedLocal(value);return;}
    if(channel==='failed'){this.fail('The local run could not be committed or launched. Your save is preserved.');return;}
    if(channel==='leave'){this.action('leave');return;}
    if(this.value.phase!=='playing'||!value||!this.value.members.some(m=>m.id===value.to))return;
    const pair=this.pairs.get(pairKey(this.value.me,value.to));if(!pair)return;
    this.rtc({type:'frame',peer:value.to,token:pair.token,channel,data:value.payload});
  }
  dropPeer(peer) {
    if(!idOK(peer))return;
    this.rtc({type:'drop',peer});this.pairs.delete(pairKey(this.value.me,peer));this.emit({type:'peer-closed',peer});
  }
  closed(connection,reason) {
    const peer=this.connections.get(connection);this.connections.delete(connection);
    if(this.value.role==='client'){this.fail(reason||'The host disconnected. Your unfinished run is preserved.');return;}
    if(!peer)return;
    if(this.value.phase==='preparing'){this.fail('A player left before the match started. Prepared saves have not been launched.');return;}
    this.dropPeer(peer);
    for(const [key,pair]of this.pairs)if(pair.a===peer||pair.b===peer)this.pairs.delete(key);
    for(const [,id]of this.connections)if(id)this.sendTo(id,{op:'drop',peer});
    if(this.value.phase==='playing')this.value.disconnected.push(peer);
    else {this.value.members=this.value.members.filter(m=>m.id!==peer);this.value.phase=this.value.members.length>1?'lobby':'hosting';}
    this.broadcast();
  }
}
