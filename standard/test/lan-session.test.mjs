import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {LanSession} from '../runtime/lan-session.js';
import {privateIPv4,sameSubnet,invitation,lanDescription,lanFrame,lanState} from '../common/lan-policy.mjs';
import {allowLanBrokerPermission} from '../desktop/protocol.mjs';
const sdp='v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\na=candidate:1 1 udp 123 192.168.1.10 42000 typ host\r\n';
const sleep=()=>new Promise(resolve=>setImmediate(resolve));
test("local-network permission is limited to the active native broker, never the game or arbitrary origins",()=>{
  const scope={trusted:true,isMainFrame:true,phase:"lobby"},origin="pokebonk-standard://game";
  assert.equal(allowLanBrokerPermission("local-network",origin,scope),true);
  assert.equal(allowLanBrokerPermission("local-network-access",origin,scope),true);
  for(const permission of ["media","clipboard-read","geolocation","loopback-network"])assert.equal(allowLanBrokerPermission(permission,origin,scope),false);
  assert.equal(allowLanBrokerPermission("local-network",origin,{...scope,trusted:false}),false);
  assert.equal(allowLanBrokerPermission("local-network","https://example.invalid",scope),false);
  assert.equal(allowLanBrokerPermission("local-network",origin,{...scope,phase:"closed"}),false);
});
async function cluster(count){
  const sessions=[],events=[],errors=[],rtc=[];
  for(let i=0;i<count;i++){
    events[i]=[];rtc[i]=[];
    sessions[i]=new LanSession({random:randomUUID,seed:()=>123456,network:(connection,value)=>queueMicrotask(()=>{
      if(i===0)sessions[+connection.slice(1)].received('host',structuredClone(value));
      else sessions[0].received('c'+i,structuredClone(value));
    }),rtc:message=>rtc[i].push(message),emit:value=>events[i].push(value),terminate:reason=>errors.push({i,reason})});
  }
  sessions[0].enter('host',{id:'lan-p0',name:'Host',species:4},'192.168.1.10:42000#0123456789abcdef0123456789abcdef');
  for(let i=1;i<count;i++){
    sessions[i].enter('client',{id:'lan-p'+i,name:'Trainer '+i,species:155});
    sessions[0].opened('c'+i);sessions[i].opened('host');await sleep();
  }
  await sleep();
  for(let i=0;i<count;i++)for(const m of rtc[i].filter(m=>m.type==='configure')){
    sessions[i].rtcEvent({type:'signal',peer:m.peer,token:m.token,description:{type:m.offerer?'offer':'answer',sdp}});
    sessions[i].rtcEvent({type:'link',peer:m.peer,token:m.token,state:'open'});
  }
  await sleep();await sleep();
  return {sessions,events,errors,rtc,close(){for(const session of sessions)session.reset();}};
}
test('private destinations, canonical invitations and same-subnet policy reject Internet/loopback/hostnames',()=>{
  for(const address of ['10.1.2.3','172.16.0.2','192.168.1.2','169.254.10.2'])assert.ok(privateIPv4(address));
  for(const address of ['127.0.0.1','8.8.8.8','localhost','192.168.001.2','172.32.0.2','10.1.2.999','::1'])assert.equal(privateIPv4(address),false);
  assert.ok(sameSubnet('192.168.1.2','192.168.1.9','255.255.255.0'));
  assert.equal(sameSubnet('192.168.1.2','192.168.2.9','255.255.255.0'),false);
  assert.equal(sameSubnet('192.168.1.2','192.168.2.9','0.0.0.0'),false);
  assert.throws(()=>invitation('8.8.8.8:42000#0123456789abcdef0123456789abcdef'));
  assert.equal(invitation('192.168.1.2:42000#0123456789abcdef0123456789abcdef').port,42000);
});
test("Expedition uses the existing mesh/start barrier and returns the same room only after both saved runs finish",async()=>{
  const c=await cluster(2);try{
    const [host,peer]=c.sessions;
    host.action("settings",{biome:"wilds",tier:4});await sleep();
    const summary={worn:[{b:"choice-band",r:1,lv:1}],bag:0,risk:30,ins:0};
    host.action("loadout",summary);peer.action("loadout",summary);await sleep();
    peer.action("ready");await sleep();
    host.action("start");await sleep();
    const party=host.value.match.party;
    assert.equal(host.value.match.mode,"expedition");
    for(const session of c.sessions)session.preparedLocal(party);await sleep();await sleep();
    peer.action("return",party);await sleep();
    assert.equal(host.value.phase,"playing");
    host.action("return",party);await sleep();await sleep();
    for(const session of c.sessions){assert.equal(session.value.phase,"lobby");assert.equal(session.value.match,undefined);assert.equal(session.value.lastParty,party);}
    assert.deepEqual(c.errors,[]);
    peer.action("ready");await sleep();host.action("start");await sleep();
    assert.equal(host.value.phase,"preparing");assert.notEqual(host.value.match.party,party);
  }finally{c.close();}
});
test('ICE accepts only local host candidates and data-only descriptions',()=>{
  const checked=lanDescription({type:'offer',sdp:sdp+'a=candidate:2 1 udp 99 8.8.8.8 4000 typ srflx\r\n'});
  assert.ok(!checked.sdp.includes('8.8.8.8'));
  for(const value of [{type:'answer',sdp:sdp.replace('192.168.1.10','8.8.8.8')},{type:'offer',sdp:sdp+'m=audio 9 RTP/AVP 0\r\n'},
    {type:'offer',sdp:sdp.replace('c=IN IP4 0.0.0.0','c=IN IP4 8.8.8.8')}])assert.throws(()=>lanDescription(value));
  assert.ok(lanFrame('ctl',{t:'ping',g:1}));assert.ok(lanFrame('snap','AAAA'));
  assert.equal(Boolean(lanFrame('snap','http://example.invalid')),false);
});
for(const count of [2,3,4])test(`${count} players form a complete peer mesh and cannot launch until every durable preparation arrives`,async()=>{
  const c=await cluster(count);try{
    const host=c.sessions[0];assert.equal(host.pairs.size,count*(count-1)/2);assert.equal(host.value.linked,true);assert.deepEqual(c.errors,[]);
    for(let i=1;i<count;i++)c.sessions[i].action('ready');await sleep();
    host.action('start');await sleep();assert.equal(host.value.phase,'preparing');
    for(let i=0;i<count-1;i++)c.sessions[i].preparedLocal(host.value.match.party);await sleep();assert.equal(host.value.phase,'preparing');
    c.sessions[count-1].preparedLocal(host.value.match.party);await sleep();await sleep();
    for(const session of c.sessions){assert.equal(session.value.phase,'playing');assert.equal(session.value.match.seed,123456);assert.equal(session.value.match.players.length,count);lanState(session.value);}
    assert.deepEqual(c.errors,[]);
  }finally{c.close();}
});
test('local chat identity is assigned by the host; a fifth player is rejected without altering the room',async()=>{
  const c=await cluster(4);try{
    c.sessions[0].received('c1',{op:'chat',from:'lan-p0',text:'Hello from client'});await sleep();
    assert.equal(c.sessions[0].value.chat[0].from,'lan-p1');
    c.sessions[0].opened('c4');c.sessions[0].received('c4',{op:'player',member:{id:'lan-extra',name:'Extra',species:4}});
    assert.equal(c.sessions[0].value.members.length,4);assert.ok(c.events[0].some(e=>e.type==='reject'&&e.connection==='c4'));assert.deepEqual(c.errors,[]);
  }finally{c.close();}
});
test('client disconnect during a run preserves the original roster and closes only that peer',async()=>{
  const c=await cluster(4);try{
    for(let i=1;i<4;i++)c.sessions[i].action('ready');await sleep();c.sessions[0].action('start');await sleep();
    for(const s of c.sessions)s.preparedLocal(c.sessions[0].value.match.party);await sleep();await sleep();
    c.sessions[0].closed('c3','left');await sleep();
    assert.equal(c.sessions[0].value.members.length,4);assert.deepEqual(c.sessions[0].value.disconnected,['lan-p3']);
    assert.equal(c.sessions[1].value.phase,'playing');assert.ok(c.events[1].some(e=>e.type==='peer-closed'&&e.peer==='lan-p3'));
  }finally{c.close();}
});
test('a private LAN resume retains the original player, match and seed instead of starting a new run',async()=>{
  const c=await cluster(2);try{
    c.sessions[1].action('ready');await sleep();c.sessions[0].action('start');await sleep();
    for(const session of c.sessions)session.preparedLocal(c.sessions[0].value.match.party);
    await sleep();await sleep();
    const before=structuredClone(c.sessions[0].value.match),me=c.sessions[1].value.me;
    c.sessions[0].closed('c1','interrupted');c.sessions[1].closed('host','interrupted');await sleep();
    assert.equal(c.sessions[1].value.phase,'playing');
    c.sessions[0].opened('c1');c.sessions[1].opened('host');await sleep();await sleep();
    for(let index=0;index<2;index++)for(const pair of c.sessions[index].pairs.values()){
      const peer=pair.a===c.sessions[index].value.me?pair.b:pair.a;
      c.sessions[index].rtcEvent({type:'link',peer,token:pair.token,state:'open'});
    }
    await sleep();await sleep();
    assert.equal(c.sessions[0].value.linked,true);assert.equal(c.sessions[1].value.me,me);
    assert.deepEqual(c.sessions[0].value.match,before);
    assert.equal(c.sessions[0].value.members.length,2);assert.deepEqual(c.errors,[]);
    assert.doesNotMatch(JSON.stringify(c.events.filter(Boolean).flat().filter(e=>e.type==='state')),/resumeToken|\"resume\"/);
  }finally{c.close();}
});
