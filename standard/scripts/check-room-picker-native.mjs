// One isolated pass through real native controllers, sockets and RTC brokers.
// No installed-app launch, real save access, device installation or publication.
import {app,BrowserWindow,ipcMain,protocol,session,powerSaveBlocker} from "electron";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {mkdirSync} from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import {NativeCoop} from "../desktop/coop.mjs";
import {lanInterfaces} from "../desktop/lan.mjs";
import {configureBrokerSession} from "../desktop/coop-session.mjs";
import {gatewayOrigin} from "../common/internet-coop.mjs";
import {lanIdentity} from "../common/lan-policy.mjs";
import {ORIGIN,CSP,MIME,resolveAsset} from "../desktop/protocol.mjs";

protocol.registerSchemesAsPrivileged([{scheme:"pokebonk-standard",privileges:{
  standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true,
}}]);
const root=process.cwd(),out=path.join(root,"evidence/cloudflare-setup"),game=path.join(root,"build/standard-game");
const directory=path.join(out,"isolated-room-picker-profile");
mkdirSync(directory,{recursive:true});app.setPath("userData",directory);
app.setName("PokéBonk Isolated Room Check");app.on("window-all-closed",()=>{});
app.commandLine.appendSwitch("disable-background-timer-throttling");
const config=JSON.parse(await readFile("standard/config.json","utf8"));
const inventory=JSON.parse(await readFile(path.join(game,"asset-manifest.json"),"utf8"));
const gateway=gatewayOrigin(config),identity=lanIdentity(config,inventory.gameDigest),url=ORIGIN+"/offline/lan-broker.html";
const fixtures=[],contents=new Map(),requests=[];
const record={checkedAt:new Date().toISOString(),gameDigest:inventory.gameDigest,androidVersionCode:config.androidVersionCode,
  kind:"Real native LAN and deployed Internet room-picker/code-join check on one Mac",
  physicalAndroidTested:false,differentNetworksTested:false,realSavesTouched:false,forcedRelayTested:false,modes:[],published:false};
let brokerSession,blocker;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function poll(label,check,timeout=45000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    if(check())return;
    const failed=fixtures.find(f=>f.controller.value.phase==="error"&&!f.leaving);
    if(failed)throw Error(label+": "+String(failed.controller.value.error??"native room error"));
    await sleep(50);
  }
  throw Error("Timed out: "+label);
}
async function fixture(index){
  let resolve,reject;
  const ready=new Promise((yes,no)=>{resolve=yes;reject=no;});
  const timer=setTimeout(()=>reject(Error("Bundled broker did not start.")),15000);
  const f={frames:[],ticket:null,prepared:false,consoleErrors:0,leaving:false};fixtures.push(f);
  f.ready=()=>{clearTimeout(timer);resolve();};
  f.controller=new NativeCoop({config,identity,profile:async()=>({name:"Isolated trainer "+index,league:[4,7],unfinished:false,ticket:f.ticket}),
    broker:async value=>{await ready;if(!f.window.isDestroyed())f.window.webContents.send("standard:lan-broker-input",value);},
    emit:value=>{
      if(value.type==="frame")f.frames.push(value);
      if(value.type==="state"&&value.value.phase==="preparing"&&!f.prepared){
        f.prepared=true;const state=value.value;
        f.ticket={party:state.match.party,seed:state.match.seed,lan:{me:state.me,size:state.members.length,launched:false}};
        queueMicrotask(()=>void f.controller.fromGame("prepared",state.match.party).catch(()=>{f.prepareFailed=true;}));
      }
    }});
  f.window=new BrowserWindow({show:false,width:32,height:32,skipTaskbar:true,webPreferences:{
    preload:path.join(root,"standard/desktop/lan-broker-preload.cjs"),sandbox:true,contextIsolation:true,nodeIntegration:false,
    session:brokerSession,webSecurity:true,backgroundThrottling:false,devTools:false,
  }});
  contents.set(f.window.webContents.id,f);
  f.window.webContents.setWindowOpenHandler(()=>({action:"deny"}));
  f.window.webContents.on("will-navigate",event=>event.preventDefault());
  f.window.webContents.on("will-redirect",event=>event.preventDefault());
  f.window.webContents.on("preload-error",()=>reject(Error("Isolated preload failed.")));
  f.window.webContents.on("console-message",(event,...legacy)=>{
    if(event.level==="error"||event.level===3||legacy[0]===3)f.consoleErrors++;
  });
  await f.window.loadURL(url);await ready;return f;
}
async function main(){
  let exit=1;const watchdog=setTimeout(()=>app.exit(1),180000);
  try{
    await app.whenReady();blocker=powerSaveBlocker.start("prevent-app-suspension");
    session.defaultSession.webRequest.onBeforeRequest({urls:["http://*/*","https://*/*","ws://*/*","wss://*/*"]},(_value,done)=>done({cancel:true}));
    brokerSession=session.fromPartition("pokebonk-isolated-room-picker");
    configureBrokerSession(brokerSession,{gateway,trusted:sender=>contents.has(sender?.id),phase:()=>"connecting"});
    brokerSession.webRequest.onCompleted({urls:[gateway+"/*"]},value=>{
      requests.push({method:value.method,path:new URL(value.url).pathname,status:value.statusCode});
    });
    brokerSession.protocol.handle("pokebonk-standard",async request=>{
      try{
        const file=resolveAsset(game,request.url),bytes=await readFile(file);
        const csp=new URL(request.url).pathname==="/offline/lan-broker.html"?
          CSP.replace("connect-src 'self' blob: data:",`connect-src 'self' blob: data: ${gateway} ${gateway.replace("https:","wss:")}`):CSP;
        return new Response(bytes,{headers:{"Content-Type":MIME[path.extname(file)]??"application/octet-stream","Content-Security-Policy":csp,"Cache-Control":"no-store"}});
      }catch{return new Response(null,{status:404});}
    });
    ipcMain.on("standard:lan-broker",(event,text)=>{
      const f=contents.get(event.sender.id);
      if(!f||event.senderFrame!==event.sender.mainFrame||event.senderFrame.url!==url||typeof text!=="string"||text.length>48000)return;
      const value=JSON.parse(text);if(value.type==="ready")f.ready();else f.controller.fromBroker(value);
    });
    const network=lanInterfaces().sort((a,b)=>Number(b.label==="en0")-Number(a.label==="en0"))[0];
    assert.ok(network,"A private interface is needed for the LAN discovery check.");
    for(const mode of ["lan","stun-only","turn-fallback"]){
      const host=await fixture(fixtures.length+1),guest=await fixture(fixtures.length+1);
      await host.controller.command("host",{species:4,connectionMode:mode,...(mode==="lan"?{address:network.address}:{})});
      await poll("host "+mode,()=>host.controller.value.phase==="hosting");
      const code=host.controller.state().code;
      assert.equal(code.length,mode==="lan"?4:6);
      await guest.controller.command("browse",{species:7,connectionMode:mode});
      await poll("list "+mode,()=>["ready","empty","error"].includes(guest.controller.state().roomListing?.status),15000);
      const listing=guest.controller.state().roomListing;
      assert.ok(listing.rooms.some(room=>room.code===code),"Hosted room was absent from its compatible list.");
      assert.equal(host.controller.value.members.length,1,"Browsing reserved a seat.");
      assert.doesNotMatch(JSON.stringify(listing),/invitation|sessionToken|joinSecret|credential|iceServers|address/);
      await guest.controller.command("join",{species:7,connectionMode:mode,invitation:code});
      await poll("join "+mode,()=>host.controller.value.members.length===2&&guest.controller.value.members.length===2&&host.controller.value.linked&&guest.controller.value.linked);
      for(const f of [host,guest])assert.equal(f.controller.state().invitation,undefined);
      await guest.controller.fromGame("room-chat","Room picker check");
      await poll("chat "+mode,()=>[host,guest].every(f=>f.controller.value.chat?.some(item=>item.text==="Room picker check")));
      await guest.controller.fromGame("room-ready");
      await poll("ready "+mode,()=>host.controller.value.members.every(member=>member.ready));
      await host.controller.fromGame("room-start");
      await poll("prepared start "+mode,()=>[host,guest].every(f=>f.controller.value.phase==="playing"));
      for(const [sender,receiver] of [[host,guest],[guest,host]]){
        await sender.controller.fromGame("ctl",{to:receiver.controller.value.me,payload:{t:"room-picker-check"}});
      }
      await poll("reliable frames "+mode,()=>[host,guest].every(f=>f.frames.some(frame=>frame.channel==="ctl"&&frame.data.t==="room-picker-check")),10000);
      for(let sample=0;sample<8&&[host,guest].some(f=>!f.frames.some(frame=>frame.channel==="snap"));sample++){
        for(const [sender,receiver] of [[host,guest],[guest,host]])
          await sender.controller.fromGame("snap",{to:receiver.controller.value.me,payload:Buffer.from([1,2,3,4]).toString("base64")});
        await sleep(150);
      }
      assert.ok([host,guest].every(f=>f.frames.some(frame=>frame.channel==="snap")),"Binary peer frames were not received.");
      const result={mode,codeLength:code.length,listedWithoutReservation:true,joined:true,chat:true,preparedStart:true,
        reliableFrames:true,binaryFrames:true,routes:[host.controller.state().transport??"lan",guest.controller.state().transport??"lan"]};
      host.leaving=guest.leaving=true;host.controller.stop();
      await poll("leave "+mode,()=>["closed","error"].includes(guest.controller.value.phase),15000);
      result.hostLeaveClosedGuest=true;record.modes.push(result);
      for(const f of [host,guest]){f.controller.stop();f.controller.local.discovery.close();}
      await sleep(250);
      console.log("Passed isolated "+mode+" room listing, code join and peer packets.");
    }
    record.relayRequests=requests.filter(request=>request.path.endsWith("/turn")).length;
    record.newProtocolRequests=requests.filter(request=>request.method==="POST"&&request.path==="/v1/matchmaking/rooms").length;
    record.passed=true;exit=0;
  }catch(error){record.passed=false;record.error=String(error.message).slice(0,500);}
  finally{
    for(const f of fixtures){f.controller.stop();f.controller.local.discovery.close();}
    await sleep(250);clearTimeout(watchdog);await mkdir(out,{recursive:true});
    await writeFile(path.join(out,"room-picker-native-check.json"),JSON.stringify(record,null,2)+"\n");
    console.log(JSON.stringify(record,null,2));
    for(const f of fixtures)if(!f.window.isDestroyed())f.window.destroy();
    if(blocker!==undefined&&powerSaveBlocker.isStarted(blocker))powerSaveBlocker.stop(blocker);
    app.exit(exit);
  }
}
void main();
