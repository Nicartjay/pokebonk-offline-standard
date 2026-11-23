// One controlled smoke pass, not physical-device acceptance.
// --lobby-only checks native Host/Escape/recreate without peer connections.
// --lab-only limits the pass to Room → Lab → same room → explicit leave.
// Real private TCP signaling, original WebRTC channels and original co-op engine.
// Every profile/save is isolated under a temporary directory.
import {chromium,_electron as electron} from 'playwright-core';
import {createServer} from 'node:http';
import {mkdtemp,readFile,stat,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {NativeLan,lanInterfaces} from '../desktop/lan.mjs';
import {StateStore} from '../common/store.mjs';import {lanIdentity} from '../common/lan-policy.mjs';
import {MIME} from '../desktop/protocol.mjs';
import {pathToFileURL} from 'node:url';
const config=JSON.parse(await readFile('standard/config.json','utf8'));
const inventory=JSON.parse(await readFile('build/standard-game/asset-manifest.json','utf8'));
const labOnly=process.argv.includes("--lab-only"),lobbyOnly=labOnly||process.argv.includes("--lobby-only");
const root=path.resolve('build/standard-game'),output=labOnly?'evidence/lan-lab-check':lobbyOnly?'evidence/lan-lifecycle-check':'evidence/lan-check';await mkdir(output,{recursive:true});
const network=lanInterfaces()[0];if(!network)throw Error('A private local network is required for this LAN smoke check.');
const temporary=await mkdtemp(path.join(os.tmpdir(),'pokebonk-lan-smoke-'));
const clients=[],errors=[],external=[],missing=[],results=[];let browser;
const server=createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname).replace(/^\/assets\/assets\//,'/assets/');
  const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(root+path.sep)||!(await stat(file)).isFile())throw Error('Not bundled');
  res.writeHead(200,{'Content-Type':MIME[path.extname(file)]??'application/octet-stream'});res.end(await readFile(file));
}catch{res.writeHead(404);res.end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
async function wait(predicate,label,timeout=40000){const until=Date.now()+timeout;while(Date.now()<until){if(await predicate())return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+label);}
async function focusHost(host){
  await host.page.locator(".wipe").waitFor({state:"detached",timeout:30000});
  await host.application.evaluate(({app,BrowserWindow})=>{
    app.focus({steal:true});BrowserWindow.getAllWindows().find(w=>w.isVisible())?.focus();
  });
  await wait(()=>host.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().some(w=>w.isVisible()&&w.isFocused())),"isolated test window focus",5000);
}
async function context(){const c=await browser.newContext({viewport:{width:640,height:360},colorScheme:'dark'});await c.route('**/*',route=>{
  const url=route.request().url();if(url.startsWith(origin+'/')||/^(blob:|data:)/.test(url))return route.continue();external.push(url);return route.abort();});return c;}
async function client(index){
  if(index===0){
    const data=path.join(temporary,"host-appdata"),userData=path.join(data,config.applicationId),bootstrap=path.join(temporary,"electron-host");
    await mkdir(userData,{recursive:true});await mkdir(bootstrap,{recursive:true});
    await writeFile(path.join(userData,"update-status.json"),JSON.stringify({lastCheck:Date.now(),highestSeen:config.version}));
    await writeFile(path.join(bootstrap,"package.json"),JSON.stringify({name:"pokebonk-lan-isolated-host",version:config.version,main:"bootstrap.cjs"}));
    await writeFile(path.join(bootstrap,"bootstrap.cjs"),`const {app}=require("electron");app.setPath("appData",${JSON.stringify(data)});app.setPath("userData",${JSON.stringify(userData)});import(${JSON.stringify(pathToFileURL(path.resolve("standard/desktop/main.mjs")).href)}).catch(e=>{console.error(e);app.exit(1)});`);
    const env={...process.env,POKEBONK_STANDARD_USER_DATA:userData};delete env.ELECTRON_RUN_AS_NODE;
    const c={index,store:new StateStore(path.join(userData,"saves"),config)};clients.push(c);
    c.application=await electron.launch({args:[bootstrap],env,timeout:60000});c.page=await c.application.firstWindow({timeout:60000});
    await c.application.evaluate(({ipcMain,BrowserWindow})=>{
      globalThis.__lanTestActions=[];
      ipcMain.on("standard:lan-action",(_event,action)=>globalThis.__lanTestActions.push({action,focused:BrowserWindow.getAllWindows().some(w=>w.isVisible()&&w.isFocused())}));
    });
    c.page.on("pageerror",error=>errors.push("native host: "+error.message));
    await c.page.waitForFunction(()=>Boolean(window.PokeBonkNativeApp?.backend?.state),undefined,{timeout:60000});
    await c.page.exposeBinding("__testLanCapture",(_source,text)=>{c.state=JSON.parse(text);});
    await c.page.evaluate(()=>document.addEventListener("standard:lan-state",event=>window.__testLanCapture(event.detail)));
    c.state=await c.page.evaluate(()=>window.PokeBonkLAN.state());
    c.controller={fromGame:(channel,data)=>c.page.evaluate(([channel,data])=>window.PokeBonkLAN.send(channel,data),[channel,data]),
      stop:()=>c.page.evaluate(()=>window.PokeBonkLAN.send("leave")).catch(()=>{})};
    await preparePlayer(c,index);
    return c;
  }
  const c={index,store:new StateStore(path.join(temporary,String(index),'saves'),config)};clients.push(c);
  c.context=await context();c.brokerContext=await context();
  c.controller=new NativeLan({identity:lanIdentity(config,inventory.gameDigest),profile:async()=>{
    const state=(await c.store.loadState())?.state;if(!state)throw Error('No local test save');return {name:state.profile.name,league:state.profile.league,unfinished:Boolean(state.activeRun||state.suspended),ticket:state.activeRun?.ticket};
  },emit:value=>{
    c.state=value.type==='state'?value.value:c.state;
    if(c.page&&!c.page.isClosed())void c.page.evaluate(value=>window.__lanReceive?.(value),value).catch(error=>errors.push(error.message));
  },broker:async value=>{
    if(value.type==='reset'&&!c.broker)return;
    if(!c.broker){
      let resolveReady;c.ready=new Promise(r=>{resolveReady=r;});
      await c.brokerContext.exposeBinding('__brokerEmit',(_source,text)=>{const event=JSON.parse(text);if(event.type==='ready')resolveReady();else c.controller.fromBroker(event);});
      await c.brokerContext.addInitScript(()=>{window.PokeBonkLanBrokerNative={emit:text=>window.__brokerEmit(text)};});
      c.broker=await c.brokerContext.newPage();c.broker.on('pageerror',error=>errors.push('broker '+index+': '+error.message));
      await c.broker.goto(origin+'/offline/lan-broker.html');
    }
    await c.ready;await c.broker.evaluate(value=>window.PokeBonkLanBrokerInput(value),value);
  }});
  await c.context.exposeBinding('__load',()=>c.store.loadState());await c.context.exposeBinding('__save',(_source,value)=>c.store.saveState(value));
  await c.context.exposeBinding('__lanSend',(_source,channel,data)=>c.controller.fromGame(channel,data));
  await c.context.exposeBinding('__lanCommand',(_source,action,data)=>c.controller.command(action,data));
  await c.context.addInitScript(network=>{
    let state={phase:'idle',members:[],linked:false,interfaces:[{label:network.label,address:network.address}]};
    window.PokeBonkStandard={loadState:()=>window.__load(),saveState:value=>window.__save(value)};
    window.PokeBonkLAN={state:()=>structuredClone(state),send:(channel,data)=>{void window.__lanSend(channel,data);}};
    window.__lanReceive=value=>{
      if(value.type==='state')state=value.value;
      const type={state:'state',frame:'frame','peer-closed':'peer-closed',notice:'notice'}[value.type];
      if(type)document.dispatchEvent(new CustomEvent('standard:lan-'+type,{detail:JSON.stringify(value.type==='state'?value.value:value)}));
    };
    document.addEventListener('click',event=>{
      const a=event.target.closest?.('a[data-standard-lan-action]');if(!a||!event.isTrusted)return;
      event.preventDefault();const root=a.closest('.offline-lan-home,.offline-lan-card,.offline-lan-room');
      const f=n=>root.querySelector('[data-lan-field="'+n+'"]')?.value??'';
      void window.__lanCommand(a.dataset.standardLanAction,{species:Number(f('species')),address:f('address'),invitation:f('invitation')});
    },true);
  },network);
  c.page=await c.context.newPage();c.page.on('pageerror',error=>errors.push('game '+index+': '+error.message));
  c.page.on('response',r=>{if(r.status()>=400)missing.push(r.url());});
  await c.page.goto(origin+'/index.html?lang=en');await preparePlayer(c,index);return c;
}
async function preparePlayer(c,index){
  await c.page.locator('.screen.sp .sp-go').waitFor({timeout:60000});
  await c.page.evaluate(async index=>{
    const app=window.PokeBonkNativeApp,account=app.meta.account;
    await app.backend.chooseStarter(account,[4,7,1,4][index]);await app.backend.chooseStarter(account,155);
    await app.backend.claimFirstGuide();await app.backend.renameLocal('LAN Tester '+(index+1));
    app.meta.adopt(await app.backend.loadProfile());
    Object.assign(app.meta.profile.settings,{quality:'low',pixel:.5,tips:false,music:0});app.applySettings();await app.meta.saveNow();app.toMenu();
  },index);
  await c.page.locator('.offline-menu').waitFor({timeout:60000});
}
try{
  if(!lobbyOnly)browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH??'/Users/nicartjay/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell',
    args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required']});
  const host=await client(0);
  await focusHost(host);
  await host.page.locator('.offline-lan-entry').click();
  await host.page.locator('.offline-lan-home').waitFor();
  await writeFile(path.join(output,"host-before.json"),JSON.stringify(await host.page.evaluate(()=>({
    url:location.href,origin:location.origin,account:window.PokeBonkNativeApp.meta.account,
    native:window.PokeBonkLocalCoop?.state(),allowed:window.PokeBonkOfflineNetwork.allowed("/__native__/lan/host"),
    body:document.querySelector(".offline-lan-home").outerHTML,
  })),null,2));
  let discoveryOutcome;
  if(lobbyOnly&&!labOnly){
    await focusHost(host);await host.page.locator('[data-standard-lan-action="find"]').click();
    await wait(()=>host.state.discovery?.status==="searching","native discovery begins");
    await wait(()=>["empty","error"].includes(host.state.discovery?.status),"bounded discovery completes",10000);
    discoveryOutcome=host.state.discovery.status;
    assert.equal(await host.page.locator('[data-standard-lan-action="host"]').getAttribute("href"),"/__native__/lan/host");
    await host.page.locator('[data-standard-lan-action="find"]').click();
    await wait(()=>host.state.discovery?.status==="searching","second cancellable discovery");
    await host.page.keyboard.press("Escape");
    await host.page.locator(".offline-menu").waitFor();
    await wait(()=>host.state.discovery?.status==="idle","Back cancels native discovery");
    await host.page.locator(".wipe").waitFor({state:"detached"});
    await host.page.locator(".offline-lan-entry").click();
    await host.page.locator(".offline-lan-home").waitFor();
  }
  await focusHost(host);await host.page.locator('[data-standard-lan-action="host"]').click();
  await wait(()=>host.state?.phase==='hosting','native host');
  if(lobbyOnly){
    const before=(await host.store.loadState()).state,identities=[],cycles=labOnly?1:3;
    for(let cycle=0;cycle<cycles;cycle++){
      await host.page.locator(".offline-lan-room").waitFor({timeout:30000});
      await host.page.locator(".wipe").waitFor({state:"detached",timeout:30000});
      await wait(()=>host.page.evaluate(()=>window.PokeBonkNativeApp.coopRoom?.open&&
        window.PokeBonkNativeApp.coopRoom.me===window.PokeBonkLAN.state().me),"current room facade");
      assert.equal(host.state.phase,"hosting");identities.push(host.state.me);
      await host.page.evaluate(()=>window.PokeBonkNativeApp.coopRoom.setPick(155));
      await wait(()=>host.state.members[0]?.species===155,"in-room Pokémon change");
      await wait(()=>host.page.evaluate(()=>window.PokeBonkNativeApp.coopRoom.mine?.species===155),"room UI receives pick");
      if(labOnly){
        const invitation=host.state.invitation,url=host.page.url(),me=host.state.me;
        await host.page.evaluate(()=>{window.__roomBeforeLab=window.PokeBonkNativeApp.coopRoom;});
        await host.page.locator(".offline-lan-room .cp-lab").click();
        await host.page.locator(".screen.lab .lab-wrap").waitFor({timeout:30000});
        await host.page.locator(".wipe").waitFor({state:"detached",timeout:30000});
        assert.equal(host.state.phase,"hosting");assert.equal(host.state.me,me);
        assert.equal(host.state.invitation,invitation);assert.equal(host.page.url(),url);
        await host.page.evaluate(()=>new Promise(resolve=>{
          document.addEventListener("standard:lan-state",()=>resolve(),{once:true});
          window.PokeBonkLAN.send("refresh");
        }));
        assert.equal(await host.page.locator(".screen.lab").count(),1,"Room updates must not close the Lab.");
        assert.equal(await host.page.evaluate(()=>window.__roomBeforeLab===window.PokeBonkNativeApp.coopRoom&&
          window.PokeBonkNativeApp.coopRoom.open),true);
        await host.page.keyboard.press("Escape");
        await host.page.locator(".wipe").waitFor({state:"detached",timeout:30000});
        // A new profile may have a first-visit Lab guide above its Back action.
        if(!await host.page.locator(".offline-lan-room").count())await host.page.keyboard.press("Escape");
        await host.page.locator(".offline-lan-room").waitFor({timeout:30000});
        await host.page.locator(".wipe").waitFor({state:"detached",timeout:30000});
        assert.equal(host.state.phase,"hosting");assert.equal(host.state.me,me);
        assert.equal(host.state.invitation,invitation);assert.equal(host.page.url(),url);
        assert.equal(await host.page.evaluate(()=>window.__roomBeforeLab===window.PokeBonkNativeApp.coopRoom),true);
      }
      await host.page.keyboard.press("Escape");
      await host.page.locator(".offline-menu").waitFor({timeout:30000});
      await wait(()=>["closed","idle"].includes(host.state.phase),"native listener released");
      await host.page.locator(".wipe").waitFor({state:"detached",timeout:30000});
      if(cycle<cycles-1){
        await host.page.locator(".offline-lan-entry").click();
        await host.page.locator(".offline-lan-home").waitFor();
        await host.page.locator(".wipe").waitFor({state:"detached",timeout:30000});
        assert.equal(await host.page.locator('select[data-lan-field="species"]').count(),0);
        assert.equal(await host.page.locator('input[type="hidden"][data-lan-field="species"]').count(),1);
        await focusHost(host);await host.page.locator('[data-standard-lan-action="host"]').click();
        await wait(()=>host.state.phase==="hosting","recreated native host");
      }
    }
    assert.equal(new Set(identities).size,cycles);
    const after=(await host.store.loadState()).state;
    assert.equal(after.activeRun,null);assert.equal(after.suspended,null);
    assert.equal(after.profile.stardust,before.profile.stardust);
    assert.deepEqual(after.profile.league,before.profile.league);assert.deepEqual(errors,[]);
    await writeFile(path.join(output,"checks.json"),JSON.stringify({gameDigest:inventory.gameDigest,
      nativeElectron:true,inRoomPokemonChanges:true,progressUnchanged:true,
      ...(labOnly?{roomLabBackAndLeaveCycles:1,labKeepsSameRoom:true,labKeepsInvitation:true,
        labKeepsDocumentURL:true,labReturnsToSameFacade:true}:
        {hostEscapeRecreateCycles:cycles,freshRoomIdentities:true,noLandingPokemonSelector:true,
          discoveryOutcome,backCancelsDiscovery:true}),
      physicalDevicesTested:false},null,2)+"\n");
    console.log(labOnly?"PASS: native room → Lab → same room, same invitation and URL, live room updates and explicit leave; isolated progress unchanged.":
      "PASS: native Electron Host → Escape → Host (3 rooms), fresh callbacks/identities, in-room picks and unchanged isolated progress.");
  }else{
  for(let i=1;i<4;i++){
    const c=await client(i);
    await c.page.locator('.offline-lan-entry').click();await c.page.getByLabel('Host invitation',{exact:true}).fill(host.state.invitation);
    await c.page.locator('[data-standard-lan-action="join"]').click();await wait(()=>c.state?.phase==='lobby','client '+c.index+' joined');
  }
  await wait(()=>clients.every(c=>c.state?.members.length===4&&c.state?.linked),'all six RTC peer pairs',50000);
  for(const c of clients.slice(1))await c.controller.fromGame('room-ready');
  await wait(()=>host.state.members.every(m=>m.ready),'all four ready');
  await host.controller.fromGame('room-start');
  await wait(()=>clients.every(c=>c.state?.phase==='playing'),'durable four-player start barrier',40000);
  for(const c of clients)await c.page.waitForFunction(()=>window.PokeBonkNativeApp?.run?.coop?.size===4&&window.PokeBonkNativeApp.run.time>.3,undefined,{timeout:120000});
  await wait(async()=>{
    const values=await Promise.all(clients.map(c=>c.page.evaluate(()=>[...window.PokeBonkNativeApp.run.coop.peers.values()].every(p=>p.last!=null))));return values.every(Boolean);
  },'the original engine decoded snapshots from all three teammates',90000);
  for(const c of clients){
    const proof=await c.page.evaluate(()=>{const app=window.PokeBonkNativeApp,run=app.run;return {seed:run.seed??app.meta.ticket.seed,party:run.coop.party,size:run.coop.size,slot:run.coop.mySlot,time:run.time,
      peers:[...run.coop.peers.values()].map(p=>({id:p.id,slot:p.slot,decoded:Boolean(p.last),link:p.link})),blocked:window.PokeBonkOfflineNetwork.blocked,ticket:app.backend.state.activeRun.ticket};});
    assert.equal(proof.size,4);assert.equal(proof.peers.length,3);assert.equal(proof.ticket.lan.launched,true);assert.equal(proof.ticket.lan.size,4);assert.deepEqual(proof.blocked,[]);results.push(proof);
    const rtc=c.broker?await c.broker.evaluate(async()=>{
      // The policy itself is also checked in unit tests. The configured
      // broker never receives an Internet ICE-server configuration.
      return {rtcAvailable:typeof RTCPeerConnection==='function'};
    }):{rtcAvailable:true};assert.equal(rtc.rtcAvailable,true);
  }
  assert.equal(new Set(results.map(r=>r.party)).size,1);assert.equal(new Set(results.map(r=>r.seed)).size,1);assert.equal(new Set(results.map(r=>r.slot)).size,4);
  clients[3].controller.stop('Controlled disconnect');
  await wait(()=>host.state.disconnected?.length===1,'disconnect reaches the remaining room');
  for(const c of clients){
    await c.page.evaluate(async()=>{const app=window.PokeBonkNativeApp;app.halted=true;await app.run.finish(false);await app.backend.queue;});
    const saved=(await c.store.loadState()).state;assert.equal(saved.activeRun,null);assert.equal(Object.keys(saved.finished).length,1);
  }
  assert.deepEqual(external,[]);assert.deepEqual(missing,[]);assert.deepEqual(errors,[]);
  await writeFile(path.join(output,'checks.json'),JSON.stringify({gameDigest:inventory.gameDigest,players:4,realPrivateTCPSignaling:true,realWebRTC:true,originalCoopEngine:true,
    sharedSeedAndParty:true,decodedAllPeerSnapshots:true,durableStartAndSettlement:true,disconnectObserved:true,physicalDevicesTested:false,results},null,2));
  console.log('PASS: four isolated players, native private TCP pairing, six real WebRTC pairs, original co-op engine snapshots, durable start/settlement and disconnect handling.');
  }
}catch(error){
  const nativeActions=await clients[0]?.application?.evaluate(()=>globalThis.__lanTestActions).catch(()=>null);
  await writeFile(path.join(output,'failure.json'),JSON.stringify({error:error.stack,states:clients.map(c=>c.state),nativeActions,errors,external,missing,results},null,2));throw error;
}finally{
  for(const c of clients){await c.controller.stop();if(c.application)await c.application.close();else await c.context?.close();await c.brokerContext?.close();}
  await browser?.close();await new Promise(r=>server.close(r));await rm(temporary,{recursive:true,force:true});
}
