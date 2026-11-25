// Trusted broker only. Full peer mesh; original game's two data channels.
import {lanDescription} from '../common/lan-policy.mjs';
export class RtcMesh {
  constructor(emit){this.emit=emit;this.peers=new Map();}
  drop(id){
    const p=this.peers.get(id);if(!p)return;this.peers.delete(id);
    clearTimeout(p.timeout);clearTimeout(p.disconnectTimer);
    for(const c of [p.ctl,p.snap]){c.onopen=c.onclose=c.onmessage=null;try{c.close();}catch{}}
    p.pc.onconnectionstatechange=p.pc.oniceconnectionstatechange=null;try{p.pc.close();}catch{}
  }
  async describe(p,type){
    await p.pc.setLocalDescription(type==='offer'?await p.pc.createOffer():await p.pc.createAnswer());
    await new Promise(resolve=>{if(p.pc.iceGatheringState==='complete')return resolve();
      const until=setTimeout(done,5000);function done(){clearTimeout(until);p.pc.removeEventListener('icegatheringstatechange',changed);resolve();}
      function changed(){if(p.pc.iceGatheringState==='complete')done();}p.pc.addEventListener('icegatheringstatechange',changed);
    });
    if(this.peers.get(p.id)===p)this.emit({type:'signal',peer:p.id,token:p.token,description:lanDescription({type,sdp:p.pc.localDescription.sdp})});
  }
  async input(m){
    let p;
    try{
      if(m.type==='close'){for(const id of [...this.peers.keys()])this.drop(id);return;}
      if(m.type==='drop'){this.drop(m.peer);return;}
      if(m.type==='configure'){
        this.drop(m.peer);if(this.peers.size>=3)throw Error('LAN mesh is limited to four players.');
        const pc=new RTCPeerConnection({iceServers:[],iceTransportPolicy:'all'});
        p={id:m.peer,token:m.token,pc,ctl:pc.createDataChannel('ctl',{negotiated:true,id:0,ordered:true}),
          snap:pc.createDataChannel('snap',{negotiated:true,id:1,ordered:false,maxRetransmits:0})};
        this.peers.set(p.id,p);p.snap.binaryType='arraybuffer';
        const emit=v=>{if(this.peers.get(p.id)===p)this.emit({...v,peer:p.id,token:p.token});};
        const opened=()=>{if(p.ctl.readyState==='open'&&p.snap.readyState==='open'){
          clearTimeout(p.timeout);clearTimeout(p.disconnectTimer);emit({type:'link',state:'open'});}};
        for(const c of [p.ctl,p.snap]){c.onopen=opened;c.onclose=()=>emit({type:'link',state:'failed'});}
        p.ctl.onmessage=e=>{if(typeof e.data!=='string'||e.data.length>32768)return;try{const data=JSON.parse(e.data);if(data&&typeof data.t==='string')emit({type:'frame',channel:'ctl',data});}catch{}};
        p.snap.onmessage=e=>{if(!(e.data instanceof ArrayBuffer)||e.data.byteLength>16384)return;let s='';for(const b of new Uint8Array(e.data))s+=String.fromCharCode(b);emit({type:'frame',channel:'snap',data:btoa(s)});};
        const changed=()=>{
          if(['failed','closed'].includes(pc.connectionState)||pc.iceConnectionState==='failed')emit({type:'link',state:'failed'});
          else if(pc.connectionState==='connected'||['connected','completed'].includes(pc.iceConnectionState))opened();
          else if(pc.connectionState==='disconnected'||pc.iceConnectionState==='disconnected'){
            emit({type:'link',state:'reconnecting'});
            clearTimeout(p.disconnectTimer);p.disconnectTimer=setTimeout(()=>emit({type:'link',state:'failed'}),2500);
          }
        };
        pc.onconnectionstatechange=pc.oniceconnectionstatechange=changed;
        p.timeout=setTimeout(()=>emit({type:'link',state:'failed'}),20000);
        if(m.offerer)await this.describe(p,'offer');return;
      }
      p=this.peers.get(m.peer);if(!p||p.token!==m.token)return;
      if(m.type==='signal'){const description=lanDescription(m.description);await p.pc.setRemoteDescription(description);if(description.type==='offer')await this.describe(p,'answer');}
      else if(m.type==='frame'&&m.channel==='ctl'&&p.ctl.readyState==='open'){
        const s=JSON.stringify(m.data);if(s.length<=32768&&p.ctl.bufferedAmount<262144)p.ctl.send(s);
      }else if(m.type==='frame'&&m.channel==='snap'&&p.snap.readyState==='open'&&p.snap.bufferedAmount<65536&&typeof m.data==='string'&&m.data.length<=21856){
        const s=atob(m.data);if(s.length<=16384)p.snap.send(Uint8Array.from(s,c=>c.charCodeAt(0)));
      }
    }catch(error){if(p&&this.peers.get(p.id)===p||!p&&m.type==='configure')this.emit({type:'link',peer:p?.id??m.peer,token:p?.token??m.token,state:'failed',error:String(error.message).slice(0,200)});}
  }
}
