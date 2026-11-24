// One isolated transport pass: real native controllers + sandboxed RTC brokers
// + the deployed Worker. No game UI automation, real profiles or save writes.
import {app,BrowserWindow,ipcMain,protocol,session,powerSaveBlocker} from "electron";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {mkdirSync} from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {NativeCoop} from "../desktop/coop.mjs";
import {configureBrokerSession} from "../desktop/coop-session.mjs";
import {gatewayOrigin} from "../common/internet-coop.mjs";
import {lanIdentity} from "../common/lan-policy.mjs";
import {ORIGIN,CSP,MIME,resolveAsset} from "../desktop/protocol.mjs";

// Electron requires scheme registration before the first asynchronous yield.
protocol.registerSchemesAsPrivileged([{scheme:"pokebonk-standard",privileges:{
  standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true,
}}]);
const root=process.cwd(),game=path.join(root,"build/standard-game"),out=path.join(root,"evidence/cloudflare-setup");
const fixtureDirectory=path.join(out,"isolated-native-check-profile");
mkdirSync(fixtureDirectory,{recursive:true});app.setPath("userData",fixtureDirectory);
app.setName("PokéBonk Co-op Transport Check");
app.on("window-all-closed",()=>{}); // The report, not Electron's default quit, owns the result.
app.commandLine.appendSwitch("disable-background-timer-throttling");
process.on("uncaughtException",error=>{console.error(error.message);app.exit(1);});
const config=JSON.parse(await readFile("standard/config.json","utf8")),gateway=gatewayOrigin(config);
const forcedRelay=process.argv.includes("--force-relay"),mode=forcedRelay?"turn-fallback":"stun-only";
const inventory=JSON.parse(await readFile(path.join(game,"asset-manifest.json"),"utf8"));
const identity=lanIdentity(config,inventory.gameDigest),brokerURL=ORIGIN+"/offline/lan-broker.html";
await mkdir(out,{recursive:true});
const fixtures=[],byContents=new Map();
let brokerSession,powerBlock;
const record={checkedAt:new Date().toISOString(),gameDigest:inventory.gameDigest,
  kind:"real sandboxed WebRTC brokers on one Mac through the deployed gateway",
  realSavesTouched:false,differentNetworksTested:false,physicalAndroidTested:false,published:false,forcedRelay};
let admin;
async function status(){
  if(!admin)admin=JSON.parse(await readFile("../pokebonk-standard-signing/cloudflare-gateway-secrets.json","utf8")).ADMIN_TOKEN;
  const response=await fetch(gateway+"/admin/status",{headers:{Authorization:"Bearer "+admin},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);return response.json();
}
const poll=async(label,check,timeout=45000)=>{
  const until=Date.now()+timeout;
  while(Date.now()<until){
    if(check())return;
    const failure=fixtures.find(f=>f.controller.value.phase==="error");
    if(failure)throw Error(label+": "+failure.controller.value.error);
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  throw Error("Timed out: "+label+"; "+JSON.stringify(fixtures.map(f=>({
    index:f.index,phase:f.controller.value.phase,players:f.controller.value.members.length,errors:f.errors.slice(-3),
    ctl:f.frames.filter(frame=>frame.channel==="ctl").length,snap:f.frames.filter(frame=>frame.channel==="snap").length,
  }))));
};
async function fixture(index){
  const f={index,frames:[],errors:[],ticket:null,outbound:{ctl:0,snap:0},rawFrames:{ctl:0,snap:0}};fixtures.push(f);
  let readyResolve,readyReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const timer=setTimeout(()=>readyReject(Error("Bundled broker did not become ready.")),15000);
  f.ready=()=>{clearTimeout(timer);readyResolve();};
  f.controller=new NativeCoop({config,identity,interfaces:()=>[],
    discovery:{cancel(){},advertise(){},find:async()=>({rooms:[]})},
    profile:async()=>({name:"Co-op check "+(index+1),league:[4,7,1,155],unfinished:false,ticket:f.ticket}),
    broker:async value=>{
      if(value.type==="action"&&["ctl","snap"].includes(value.channel))f.outbound[value.channel]++;
      await ready;if(!f.window.isDestroyed())f.window.webContents.send("standard:lan-broker-input",value);
    },
    emit:value=>{
      if(value.type==="frame")f.frames.push(value);
      if(value.type==="state"&&value.value.phase==="preparing"&&!f.prepared){
        f.prepared=true;const state=value.value;
        f.ticket={party:state.match.party,seed:state.match.seed,lan:{me:state.me,size:state.members.length,launched:false}};
        queueMicrotask(()=>void f.controller.fromGame("prepared",state.match.party).catch(error=>f.errors.push(error.message)));
      }
    },
  });
  f.window=new BrowserWindow({show:false,width:32,height:32,skipTaskbar:true,webPreferences:{
    preload:path.join(root,"standard/desktop/lan-broker-preload.cjs"),sandbox:true,
    session:brokerSession,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,devTools:false,
  }});
  byContents.set(f.window.webContents.id,f);
  f.window.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  f.window.webContents.on("will-navigate",event=>event.preventDefault());
  f.window.webContents.on("will-redirect",event=>event.preventDefault());
  f.window.webContents.on("preload-error",()=>readyReject(Error("Broker preload failed.")));
  f.window.webContents.on("console-message",(event,...legacy)=>{
    const level=event.level??legacy[0],message=event.message??legacy[1];
    if(level==="error"||level===3)f.errors.push(String(message).slice(0,300));
  });
  await f.window.loadURL(brokerURL);await ready;return f;
}
// Do not top-level-await app.whenReady(): Electron waits for ESM evaluation
// before emitting ready, so that would deadlock the check's own startup.
async function main(){
let exit=1;
const watchdog=setTimeout(()=>app.exit(1),forcedRelay?600000:240000);
try{
  assert.ok(gateway,"Native Internet feature is not configured.");
  console.log("Starting isolated native transport check.");
  await app.whenReady();
  powerBlock=powerSaveBlocker.start("prevent-app-suspension");
  session.defaultSession.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*","ws://*/*","wss://*/*"]},
    (_request,callback)=>callback({cancel:true}));
  brokerSession=session.fromPartition("pokebonk-isolated-coop-check");
  configureBrokerSession(brokerSession,{gateway,trusted:contents=>byContents.has(contents?.id),phase:()=>"connecting"});
  record.requests=[];
  brokerSession.webRequest.onCompleted({urls:[gateway+"/*",gateway.replace("https:","wss:")+"/*"]},details=>{
    record.requests.push({method:details.method,path:new URL(details.url).pathname,status:details.statusCode});
  });
  brokerSession.webRequest.onErrorOccurred({urls:[gateway+"/*",gateway.replace("https:","wss:")+"/*"]},details=>{
    record.requests.push({method:details.method,path:new URL(details.url).pathname,error:details.error});
  });
  brokerSession.protocol.handle("pokebonk-standard",async request=>{
    try{
      const file=resolveAsset(game,request.url);let bytes=await readFile(file);
      if(forcedRelay&&new URL(request.url).pathname==="/offline/internet-rtc.js"){
        // Test-only response override. Both peers get relay-only ICE so this
        // cannot pass by silently selecting LAN. Never written to the payload
        // or packaged app. Empty initial candidates exercise real fallback.
        const source=bytes.toString("utf8");
        assert.ok(source.includes("new this.Peer(policy.begin())")&&source.includes('iceTransportPolicy:"all"'));
        bytes=Buffer.from(source.replace("new this.Peer(policy.begin())",'new this.Peer({...policy.begin(),iceTransportPolicy:"relay"})')
          .replaceAll('iceTransportPolicy:"all"','iceTransportPolicy:"relay"'));
      }
      if(forcedRelay&&new URL(request.url).pathname==="/offline/lan-broker.js"){
        // Fixture-only numeric diagnostics. Never return ICE credentials,
        // candidates, addresses, session bearers or native profile data.
        bytes=Buffer.from(bytes.toString("utf8")+`
Object.defineProperty(globalThis,"__coopCheck",{value:async()=>{
  const a=internet.run?.attempt;
  return {phase:a?.state?.phase,peers:await Promise.all([...(a?.mesh?.peers?.values()??[])].map(async p=>({
    attempt:p.attempt,remoteAttempt:p.remoteAttempt,ctl:p.ctl.readyState,snap:p.snap.readyState,
    ice:p.pc.iceConnectionState,signaling:p.pc.signalingState,
    channels:[...(await p.pc.getStats()).values()].filter(s=>s.type==="data-channel").map(s=>({
      label:s.label,state:s.state,sent:s.messagesSent,received:s.messagesReceived
    }))
  })))};
}});`);
      }
      const csp=new URL(request.url).pathname==="/offline/lan-broker.html"?
        CSP.replace("connect-src 'self' blob: data:",`connect-src 'self' blob: data: ${gateway} ${gateway.replace("https:","wss:")}`):CSP;
      return new Response(bytes,{headers:{"Content-Type":MIME[path.extname(file)]??"application/octet-stream",
        "Content-Security-Policy":csp,"Cache-Control":"no-store"}});
    }catch{return new Response(null,{status:404});}
  });
  ipcMain.on("standard:lan-broker",(event,text)=>{
    const f=byContents.get(event.sender.id);
    if(!f||event.senderFrame!==event.sender.mainFrame||event.senderFrame.url!==brokerURL||typeof text!=="string"||text.length>48000)return;
    const value=JSON.parse(text);
    if(value.type==="frame"&&["ctl","snap"].includes(value.channel))f.rawFrames[value.channel]++;
    if(value.type==="ready")f.ready();
    else if(value.type==="transport-diagnostic"&&["peer_link_failed","relay_authorization_failed","relay_configuration_failed","relay_signaling_failed"].includes(value.code))
      f.errors.push(value.code);
    else f.controller.fromBroker(value);
  });
  const health=await (await fetch(gateway+"/health",{signal:AbortSignal.timeout(15000)})).json();
  assert.equal(health.enabled,true);assert.equal(health.turn,forcedRelay?"guarded-payg":"disabled");record.health=health;
  const baseline=await status();
  if(forcedRelay){
    assert.equal(config.internetCoop.relayEnabled,true);assert.equal(baseline.disabled,false);
    assert.equal(baseline.liveLeases,0,"Wait for other TURN sessions to end; do not disturb them for this check.");
  }
  const wrong=await fetch(gateway+"/v1/matchmaking/find",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({buildId:"unaccepted-check-build",connectionMode:"stun-only",name:"Co-op check",species:4}),signal:AbortSignal.timeout(15000)});
  assert.equal(wrong.status,409);record.wrongBuildRejected=true;
  const host=await fixture(0);
  await host.controller.command("host",{species:4,connectionMode:mode});
  await poll("host lobby",()=>host.controller.value.phase==="hosting");
  console.log("Native host connected to the deployed gateway.");
  for(let index=1;index<4;index++){
    const guest=await fixture(index);
    await guest.controller.command("find",{species:[4,7,1,155][index],connectionMode:mode});
    await poll(`find + full ${index+1}-player mesh`,()=>fixtures.every(f=>f.controller.value.members.length===index+1&&f.controller.value.linked),60000);
    console.log(`Find a match established the ${index+1}-player peer mesh.`);
  }
  const full=await fetch(gateway+"/v1/matchmaking/find",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({buildId:identity,connectionMode:mode,name:"Fifth check player",species:4}),signal:AbortSignal.timeout(15000)});
  const denial=await full.json();record.fullRoomResponse={status:full.status,error:denial.error};
  assert.equal(full.status,404);assert.equal(denial.error,"no_matching_room");record.fullRoomNotMatched=true;
  console.log("Full-room denial passed.");
  await fixtures[1].controller.fromGame("room-chat","Transport check");
  await poll("room chat",()=>fixtures.every(f=>f.controller.value.chat?.some(message=>message.text==="Transport check")));
  record.chat=true;
  console.log("Four-player room chat passed.");
  for(const f of fixtures.slice(1))await f.controller.fromGame("room-ready");
  await poll("all ready",()=>host.controller.value.members.every(member=>member.ready));
  await host.controller.fromGame("room-start");
  await poll("native prepared barrier",()=>fixtures.every(f=>f.controller.value.phase==="playing"));
  record.preparedBarrier="passed with isolated in-memory ticket fixtures";
  console.log("All four native profiles passed the prepared/start barrier.");
  await new Promise(resolve=>setTimeout(resolve,1500));
  for(const sender of fixtures)for(const peer of sender.controller.value.members.filter(member=>member.id!==sender.controller.value.me)){
    await sender.controller.fromGame("ctl",{to:peer.id,payload:{t:"transport-check",from:sender.index}});
    await sender.controller.fromGame("snap",{to:peer.id,payload:Buffer.from([1,2,3,4,sender.index]).toString("base64")});
  }
  const coverage=(f,channel,type)=>new Set(f.frames.filter(frame=>frame.channel===channel&&
    (channel==="snap"||frame.data.t===type)).map(frame=>frame.peer)).size;
  // snap is deliberately unreliable. Sample the same way gameplay does:
  // another bounded fresh snapshot, not an assertion that UDP never drops.
  for(let retry=0;retry<12&&fixtures.some(f=>coverage(f,"snap")<3);retry++){
    await new Promise(resolve=>setTimeout(resolve,500));
    for(const sender of fixtures)for(const receiver of fixtures.filter(f=>f!==sender)){
      if(!receiver.frames.some(frame=>frame.channel==="snap"&&frame.peer===sender.controller.value.me))
        await sender.controller.fromGame("snap",{to:receiver.controller.value.me,payload:Buffer.from([1,2,3,4,sender.index]).toString("base64")});
    }
  }
  await poll("reliable and binary peer frames",()=>fixtures.every(f=>
    coverage(f,"ctl","transport-check")===3&&coverage(f,"snap")===3),15000);
  record.players=4;record.ctlFrames=fixtures.reduce((n,f)=>n+f.frames.filter(frame=>frame.channel==="ctl"&&frame.data.t==="transport-check").length,0);
  record.binaryFrames=fixtures.reduce((n,f)=>n+f.frames.filter(frame=>frame.channel==="snap").length,0);
  record.binaryPeerPairs=12;
  console.log("Reliable and binary packets reached all twelve directed peer links.");
  record.transports=fixtures.map(f=>f.controller.value.transport??"not reported");
  if(forcedRelay){
    await poll("actual selected relay routes",()=>fixtures.every(f=>f.controller.value.transport==="turn"),15000);
    const issued=await status();assert.ok(issued.liveLeases>=4);
    // One pass includes a complete initial-credential lifetime. A mere
    // "fallback allowed" flag is not evidence that TURN/rotation works.
    console.log("Forced TURN mesh established; checking renewal across the original credential expiry.");
    await new Promise(resolve=>setTimeout(resolve,330000));
    const renewed=await status();assert.equal(renewed.disabled,false);
    assert.ok(renewed.reservedBytes>=issued.reservedBytes+4*512000000);
    for(const sender of fixtures)for(const peer of sender.controller.value.members.filter(member=>member.id!==sender.controller.value.me))
      await sender.controller.fromGame("ctl",{to:peer.id,payload:{t:"post-renewal-check"}});
    await poll("data channels after original credential expiry",()=>fixtures.every(f=>f.frames.filter(frame=>
      frame.channel==="ctl"&&frame.data.t==="post-renewal-check").length===3),15000);
    record.renewalPastInitialExpiry=true;
    record.turnCredentialsIssued=(renewed.reservedBytes-baseline.reservedBytes)/512000000;
    record.transports=fixtures.map(f=>f.controller.value.transport);
    assert.ok(record.transports.every(route=>route==="turn"));
  }else assert.ok(!record.transports.includes("turn"));
  const previous=host.controller.value.invitation;
  host.controller.stop();
  await poll("host leave closes guests",()=>fixtures.slice(1).every(f=>f.controller.value.phase==="closed"),15000);
  host.ticket=null;host.prepared=false;
  await host.controller.command("host",{species:4,connectionMode:mode});
  await poll("host can create another room",()=>host.controller.value.phase==="hosting");
  assert.notEqual(host.controller.value.invitation,previous);record.leaveAndRehost=true;
  let final=await status();
  if(forcedRelay){
    const until=Date.now()+90000;
    while(final.liveLeases>0&&Date.now()<until){
      await new Promise(resolve=>setTimeout(resolve,5000));final=await status();
    }
  }
  if(forcedRelay){assert.equal(final.liveLeases,0);record.leaveRevokedLeases=true;}
  else{
    assert.equal(final.reservedBytes,baseline.reservedBytes);
    assert.equal(record.requests.some(request=>request.path.endsWith("/turn")),false);record.turnCredentialsIssued=0;
  }
  record.passed=true;exit=0;
}catch(error){
  record.passed=false;record.error=error.message;
  record.diagnostics=await Promise.all(fixtures.map(async f=>({index:f.index,errors:f.errors,outbound:f.outbound,rawFrames:f.rawFrames,
    ctl:f.frames.filter(frame=>frame.channel==="ctl").length,snap:f.frames.filter(frame=>frame.channel==="snap").length,
    ...(forcedRelay&&f.window&&!f.window.isDestroyed()?{rtc:await Promise.race([
      f.window.webContents.executeJavaScript("globalThis.__coopCheck?.()").catch(()=>null),
      new Promise(resolve=>setTimeout(()=>resolve(null),2000))
    ])}:{})})));
}
finally{
  for(const f of fixtures)f.controller.stop();
  clearTimeout(watchdog);
  await writeFile(path.join(out,forcedRelay?"turn-native-check.json":"internet-native-check.json"),JSON.stringify(record,null,2)+"\n");
  console.log(JSON.stringify(record,null,2));
  // Persist evidence before closing the last fixture window, which can
  // otherwise trigger Electron's normal zero-code quit during async cleanup.
  for(const f of fixtures)if(f.window&&!f.window.isDestroyed())f.window.destroy();
  if(powerBlock!==undefined&&powerSaveBlocker.isStarted(powerBlock))powerSaveBlocker.stop(powerBlock);
  app.exit(exit);
}
}
void main();
