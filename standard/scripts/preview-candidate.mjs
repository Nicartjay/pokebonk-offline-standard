// Design approval only: current source + immutable capture, never an installer
// or production save. Does not prepare/build a game payload or contact services.
import http from "node:http";
import path from "node:path";
import {readFile, readdir} from "node:fs/promises";
import {sha} from "./prepare.mjs";
import {readSnapshotManifest} from "../../scripts/upstream-snapshot.ts";
import {readRentalSnapshot} from "./rental-snapshot.mjs";
import {addReviewedImages} from "./asset-additions.mjs";
import {CSP} from "../desktop/protocol.mjs";
import {addRecord} from "../runtime/records.js";

const accepted = JSON.parse(await readFile("standard/accepted.json", "utf8"));
if (accepted.build !== "mwv6wzyo") throw Error("Review this preview for the next candidate.");
const {patchSnapshot} = await import("../adapters/mwv6wzyo.mjs");
const snapshot = await readSnapshotManifest(accepted.snapshot);
if (snapshot.digest !== accepted.digest) throw Error("Preview snapshot identity mismatch.");
const vendor = path.resolve(accepted.snapshot, "game");
const inventory = new Map(snapshot.files.map(entry => [entry.name, entry]));
async function pristine(name) {
  const entry = inventory.get(name);
  if (!entry) throw Error("Not in the pristine capture.");
  const bytes = await readFile(path.join(vendor, name));
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw Error("Preview asset integrity mismatch.");
  return bytes;
}
const input = new Map(await Promise.all(snapshot.files.filter(entry =>
  entry.name === "index.html" || entry.name.endsWith(".js")).map(async entry => [entry.name, await pristine(entry.name)])));
const {files, modules} = patchSnapshot(input);
await addReviewedImages(files, accepted.build);
const rentals = await readRentalSnapshot(accepted);
files.set("offline/rentals/catalog.json", rentals.bytes);
const runtime = new Set(await readdir("standard/runtime")), common = new Set(await readdir("standard/common"));
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
const gameConfig = {productName: config.productName, version: config.version, edition: config.edition,
  saveSchema: config.saveSchema, upstream: config.upstream, compatibleRunBuilds: config.compatibleRunBuilds,
  rentals: rentals.publicInfo, history: JSON.parse(await readFile("standard/history.json", "utf8")),
  pokemonNames: Object.fromEntries(JSON.parse(await pristine("data/pokemon.json")).map(mon => [mon.id, mon.name]))};
const styles = snapshot.files.filter(entry => /^assets\/(?:main-|fonts-).*\.css$/.test(entry.name))
  .map(entry => `<link rel="stylesheet" href="/${entry.name}">`).join("");
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="only light"><meta name="supported-color-schemes" content="light">
<title>PokéBonk Offline · ${accepted.version} source preview</title>${styles}
<link rel="stylesheet" href="/offline/offline.css"><link rel="stylesheet" href="/offline/home.css"><link rel="stylesheet" href="/offline/lan.css"><link rel="stylesheet" href="/offline/boss-hud.css">
<link rel="stylesheet" href="/offline/cloud.css">
<script src="/__preview.js"></script><script src="/offline/guard.js"></script>
<script type="module" src="/offline/entry.js"></script></head><body><canvas id="game"></canvas><div id="ui"></div></body></html>`;
const sample = {version: 1, playerId: "offline-upstream-design-preview", updatedAt: Date.now(),
  profile: {name: "Preview Trainer", starter: 4, starterJ: 155, league: [4, 155], unlocked: [4, 155],
    seen: [4, 155], lastSpecies: 4, stardust: 10000, totalStardust: 10000, bonk: 0,
    settings: {master: 0, music: 0, tips: false, quality: "medium"}},
  onboarding: {trainerGuide: 1, playerName: 1}, stash: {}, activeRun: null, suspended: null, finished: {}, spins: {}};
// Optional design fixture only. These records never enter a native/user save
// or the prepared game; they exist solely in the preview's memory bridge.
const sampleRecords={version:1,kos:{},survival:{},time:{}};
for(const [index,[species,finalSpecies,mode,kills,time,victory]]of [
  [4,6,"standard",1450,600,true],[155,157,"endless",980,1100,false],
  [155,157,"standard",870,540,true],[4,5,"relay",680,820,false],
].entries())addRecord(sampleRecords,{id:"offline-records-preview-"+index,
  species,finalSpecies,mode,kills,time,victory,biome:"forest",tier:0,date:0});
const bootstrap = `(()=>{
  let saved=${JSON.stringify({format: "pokebonk-offline-standard", edition: "standard",
    schemaVersion: config.saveSchema, upstream: config.upstream, state: sample})};
  const recordsPreview=new URL(location.href).searchParams.has("records-preview");
  const textPreview=new URL(location.href).searchParams.has("text-preview");
  const statusPreview=new URL(location.href).searchParams.has("status-preview");
  const resultsPreview=new URL(location.href).searchParams.has("coop-results-preview");
  const bossesPreview=new URL(location.href).searchParams.has("bosses-preview")||statusPreview||textPreview||resultsPreview;
  const cloudPreview=new URL(location.href).searchParams.has("cloud-preview");
  const optionsPreview=new URL(location.href).searchParams.has("app-options-preview");
  let previewRoom;
  const previewRoomChanged=()=>document.dispatchEvent(new CustomEvent("standard:lan-state",{detail:JSON.stringify(previewRoom)}));
  if(resultsPreview)window.PokeBonkLAN=Object.freeze({
    state:()=>structuredClone(previewRoom??{phase:"idle",members:[],linked:false}),
    send:(channel,data)=>{
      // Design fixture only: no sockets, service, native save or real peer.
      if(channel==="prepared"&&data===previewRoom?.match?.party){
        previewRoom.phase="playing";previewRoomChanged();
      }else if(channel==="room-return"&&data===previewRoom?.match?.party){
        previewRoom.lastParty=data;previewRoom.phase="lobby";delete previewRoom.match;
        previewRoom.members[1].ready=false;previewRoomChanged();
      }else if(channel==="failed"){
        console.error("Sample room could not launch.");
      }
    }});
  if(recordsPreview)saved.state.records=${JSON.stringify(sampleRecords)};
  if(textPreview){
    // Disposable profile only, so the original Pokédex+ can display Oddish.
    saved.state.profile.league.push(43);saved.state.profile.unlocked.push(43);
    saved.state.profile.seen.push(43);saved.state.profile.lastSpecies=43;
  }
  if(statusPreview)saved.state.profile.biomes={forest:0,desert:0}; // Disposable scene fixture only.
  const android=new URL(location.href).searchParams.get("platform")==="android";
  if(android)window.PokeBonkStandardAndroid=Object.freeze({
    loadState:()=>JSON.stringify({ok:true,value:saved}),
    saveState:text=>{saved=JSON.parse(text);return '{"ok":true,"value":true}';}});
  else window.PokeBonkStandard=Object.freeze({
    loadState:async()=>structuredClone(saved),saveState:async value=>{saved=structuredClone(value);}});
  try{localStorage.setItem("pb-battery","0");localStorage.setItem("pokebonk.theme","dark");}catch{}
  document.addEventListener("click",event=>{
    if(event.target.closest?.("a[data-standard-native-action],a[data-standard-lan-action],a[data-standard-cloud-action]"))event.preventDefault();
  },true);
  addEventListener("DOMContentLoaded",()=>{
    document.documentElement.dataset.standardPlatform=android?"android":"darwin";
    document.documentElement.dataset.standardFullscreen="true";
    const note=document.createElement("span");
    note.textContent="SOURCE PREVIEW · "+(optionsPreview?"app options · SAMPLE update data / no download or cloud service":resultsPreview?"co-op results · staged run / no connected devices":textPreview?"Android text outlines · sample save / staged combat labels":statusPreview?"restored status artwork · staged Poison/Paralysis":cloudPreview?"optional cloud UI · no service connected":bossesPreview?"integrated compact boss HUD · not a connected match":recordsPreview?"sample save & records":"sample save")+" · game ${accepted.version} · not a packaged build";
    Object.assign(note.style,{position:"fixed",bottom:"3px",left:"8px",zIndex:"50000",padding:"3px 7px",
      borderRadius:"5px",background:"#19152ae8",color:"#fff",font:"700 9px system-ui",pointerEvents:"none"});
    document.body.append(note);
    if(optionsPreview){
      const controls=document.createElement("div");
      controls.id="app-options-preview-controls";
      Object.assign(controls.style,{position:"fixed",bottom:"24px",left:"8px",zIndex:"50001",display:"flex",flexWrap:"wrap",gap:"5px"});
      const sampleUpdate={latestVersion:"1.3.1",upstreamVersion:"${accepted.version}",upstreamBuild:"${accepted.build}",
        kind:android?"apk":"dmg",totalBytes:200*1024*1024,receivedBytes:94*1024*1024,
        notes:"SAMPLE RELEASE FOR DESIGN APPROVAL ONLY\\nNo update has been published, downloaded or installed."};
      const show=state=>{
        const app=window.PokeBonkNativeApp,api=window.PokeBonkOfflineUI;
        if(!app?.backend?.state||app.run)return;
        api.dismissUpdate();
        document.querySelectorAll(".offline-modal").forEach(node=>node.remove());
        if(state==="profile")api.profile(app);
        else if(state==="cloud")api.cloudSaves();
        else api.updateFeedback({...sampleUpdate,state,open:true});
      };
      for(const [label,state]of [["Player & saves","profile"],["Checking","checking"],["Download 47%","downloading"],
        ["Verifying","verifying"],["Ready to install","ready"],["Cloud setup","cloud"]]){
        const control=document.createElement("button");control.textContent=label;control.className="btn small ghost";
        control.onclick=()=>show(state);controls.append(control);
      }
      const hide=document.createElement("button");hide.textContent="Hide sample controls";hide.className="btn small ghost";
      hide.onclick=()=>controls.remove();controls.append(hide);document.body.append(controls);
    }
    if(cloudPreview){
      const preview=document.createElement("button");
      preview.textContent="Show optional cloud saves";preview.className="btn small blue";
      Object.assign(preview.style,{position:"fixed",bottom:"24px",right:"12px",zIndex:"50001"});
      preview.onclick=async()=>{
        const app=window.PokeBonkNativeApp;
        if(!app?.backend?.state||app.run)return;
        const [{installCloudSavePreview},{default:config}]=await Promise.all([
          import("/offline/cloud-preview.js"),import("/offline/config.js")]);
        installCloudSavePreview(app,config);preview.remove();
      };
      document.body.append(preview);
    }
    if(bossesPreview){
      const preview=document.createElement("button");
      preview.textContent=resultsPreview?"Show sample co-op results":textPreview?"Show sample combat text":statusPreview?"Show restored boss status icons":"Show sample co-op boss HUD";preview.className="btn small blue";
      Object.assign(preview.style,{position:"fixed",bottom:"24px",right:"12px",zIndex:"50001"});
      preview.onclick=async()=>{
        const app=window.PokeBonkNativeApp;
        if(!app?.backend?.state||app.run)return;
        preview.disabled=true;preview.textContent="Loading sample boss HUD…";
        try{
          // Real shared engine + original HUD, but only a synthetic room and
          // disposable in-memory save. The transport is an explicit no-op.
          const {LocalRoom}=await import("/offline/lan.js");
          const biome=statusPreview?"desert":"forest";
          const session={phase:"preparing",role:"host",me:"lan-preview-self",linked:true,
            settings:{biome,tier:0},rulesAt:Date.now(),
            match:{party:"lan-boss-hud-preview",seed:123456,mode:"standard",biome,tier:0},
            members:[{id:"lan-preview-self",slot:0,name:"Preview Trainer",species:4,ready:true},
              {id:"lan-preview-friend",slot:1,name:"Sample Teammate",species:155,ready:true}]};
          if(resultsPreview){
            session.code="BONK";session.connectionMode="lan";
            session.match.players=session.members.map(member=>member.id);
            previewRoom=session;previewRoomChanged();
            // Allow the actual preparation/launch callbacks to mount the
            // original HUD before staging the still result presentation.
            await new Promise((resolve,reject)=>{
              const until=Date.now()+12000,timer=setInterval(()=>{
                if(app.run){clearInterval(timer);resolve();}
                else if(Date.now()>until){clearInterval(timer);reject(Error("The source-preview run did not open."));}
              },40);
            });
          }else{
            window.PokeBonkLocalCoop=Object.freeze({state:()=>structuredClone(session),send:()=>false});
            await app.backend.prepareLan(structuredClone(session));session.phase="playing";
            const room=new LocalRoom(session,()=>true);app.coopRoom=room;
            const started=await app.startRun({species:4,mode:"standard",biome,tier:0,
              boosts:[],coop:{party:session.match.party,room}});
            if(!started||!app.run)throw Error("Could not open the sample co-op engine.");
          }
          const run=app.run;app.halted=true;
          run.ui.bossPct=!statusPreview; // Sample presentation preference, not a user setting.
          // Freeze combat/network simulation for a readable illustration;
          // leave the original world renderer and boss/teammate HUD intact.
          run.simulate=()=>{};run.coop.tick=()=>{};run.coop.render=()=>{};
          run.ui.banner=()=>{};run.ui.bossBanner=()=>{};
          run.time=455;run.realTime=455;run.state="play";
          const p=run.player.pos,point=(x,z)=>({x:p.x+x,z:p.z+z});
          if(resultsPreview){
            run.stage=1;run.stats.kills=320;run.stats.damage=84000;
            run.stats.killsBy={16:120,19:110,10:90};
            await run.finish(false);
            document.exitPointerLock?.();preview.remove();return;
          }else if(textPreview){
            // No staged bosses are needed for the combat-text design preview.
          }else if(statusPreview){
            run.minibosses.spawnRiftAlpha(137,point(0,-10),
              {tier:1,secs:80,guard:1,dmg:1,size:1.2,calls:[]});
          }else{
            run.minibosses.spawnTotem(47,point(-5,-7));
            run.minibosses.spawnSummoner(12,point(6,-8));
            run.minibosses.spawnRiftAlpha(49,point(0,-11),
              {tier:1,secs:80,guard:1,dmg:1,size:1.2,calls:[]});
            run.boss.spawn(123,p.x+4,p.z-12,false);
          }
          run.state="play";run.cine.want=run.cine.blend=0;run.anims.length=0;
          for(const [index,mini]of run.minibosses.list.entries()){
            run.enemies.hp[mini.i]=run.enemies.maxHp[mini.i]*(statusPreview ? .96 : [.54,.38,.87][index]);
            mini.moveT=0;mini.enraged=false;
            if(statusPreview){
              run.enemies.poison[mini.i]=30;run.enemies.poisonStacks[mini.i]=1;run.enemies.para[mini.i]=30;
            }
          }
          if(run.boss.alive)run.enemies.hp[run.boss.bossIndex]=run.enemies.maxHp[run.boss.bossIndex]*.72;
          for(const peer of run.coop.peers.values()){
            peer.stage=run.stage;peer.link="open";peer.lastAt=1e9;
            peer.x=p.x+2;peer.y=p.y;peer.z=p.z+1;
            peer.last={flags:0,level:8,hp:.84,hpNow:84,maxHp:100};
          }
          run.updateCamera(.1);run.ui.hud(run);app.r.render(.016);app.halted=false;
          if(textPreview){
            // Use the original popup factory and styling. Keep a still copy
            // after its usual 900ms lifetime only for the approval screenshot.
            for(const [x,z,text,color,size]of [
              [-3,-4,"Super effective!","#ffb03a",1.1],
              [3,-7,"Critical!","#ff4e69",1],
              [0,1,"Poisoned","#bd71e5",.9],
            ])run.ui.popup(p.x+x,p.y+2,p.z+z,text,color,size,true);
            for(const popup of [...document.querySelectorAll(".popup")]){
              const still=popup.cloneNode(true);
              still.style.animation="none";still.dataset.textPreview="true";
              popup.parentNode.append(still);
            }
          }
          document.exitPointerLock?.();preview.remove();
        }catch(error){console.error(error);preview.textContent="Preview: "+error.message;preview.disabled=false;}
      };
      document.body.append(preview);
    }
    if(new URL(location.href).searchParams.has("room-preview")){
      const preview=document.createElement("button");
      preview.textContent="Show sample co-op room";preview.className="btn small blue";
      Object.assign(preview.style,{position:"fixed",bottom:"24px",right:"12px",zIndex:"50001"});
      preview.onclick=()=>{
        if(!window.PokeBonkNativeApp||!window.PokeBonkOpenLocalRoom)return;
        window.PokeBonkOfflineUI.localCoopPreview();preview.remove();
      };
      document.body.append(preview);
    }
    if(new URL(location.href).searchParams.has("expedition-preview")){
      const preview=document.createElement("button");
      preview.textContent="Show sample Expedition room";preview.className="btn small blue";
      Object.assign(preview.style,{position:"fixed",bottom:"24px",right:"12px",zIndex:"50001"});
      preview.onclick=async()=>{
        const app=window.PokeBonkNativeApp;
        if(!app?.backend?.expedition||!window.PokeBonkUseExpeditionRoom)return;
        const {LanLobby}=await import("/offline/lan-lobby.js");
        const response=await app.backend.expState();app.meta.profile=response.profile;
        // Screenshot fixture only. Never read or modify a native/user save.
        const exp=app.meta.profile.exp,rules=app.backend.expedition;
        exp.gear.held=rules.normalizeItem({id:exp.next++,b:"choice-band",lv:1,r:1,s:123,d:100});
        exp.gear.band=rules.normalizeItem({id:exp.next++,b:"power-band",lv:1,r:1,s:456,d:100});
        if(!exp.gear.band)delete exp.gear.band;
        const summary={worn:[{b:"choice-band",r:1,lv:1}],bag:0,risk:60,ins:0};
        const sample={preview:true,phase:"lobby",role:"host",me:"lan-preview-self",
          code:"BONK",connectionMode:"lan",linked:false,settings:{biome:"wilds",tier:4},
          seats:{discoverable:false,capacity:4},rulesAt:Date.now(),
          members:[{id:"lan-preview-self",slot:0,name:"Preview Trainer",species:4,ready:true,loadout:summary},
            {id:"lan-preview-friend",slot:1,name:"Sample Teammate",species:155,ready:false,loadout:summary}]};
        const room=new LanLobby(sample,()=>{});
        window.PokeBonkUseExpeditionRoom(app,room);preview.remove();
      };
      document.body.append(preview);
    }
  },{once:true});
})();`;
const mime = {".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".glb": "model/gltf-binary",
  ".ogg": "audio/ogg", ".mp3": "audio/mpeg"};
const missingPreviewAssets=new Set();
const server = http.createServer(async (req, res) => {
  let name="";
  try {
    name = (decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/+/, "") ||
      "index.html").replace(/^assets\/assets\//, "assets/");
    if (name.split("/").some(part => part.startsWith(".") || part.includes("\\"))) throw Error("Unsafe preview path.");
    let bytes;
    if (name === "index.html") bytes = Buffer.from(html);
    else if (name === "__preview.js") bytes = Buffer.from(bootstrap);
    else if (name === "offline/config.js") bytes = Buffer.from("export default " + JSON.stringify(gameConfig) + ";");
    else if (name === "offline/bindings.js") bytes = Buffer.from("export const boot=" + JSON.stringify("../assets/" + modules.boot) + ";");
    else if (name.startsWith("offline/") && runtime.has(name.slice(8))) {
      bytes = await readFile("standard/runtime/" + name.slice(8));
      // Only the source server exports its copy of these existing helpers.
      // No preview exports or cloud fixture are included by production prepare.
      if(name==="offline/ui.js")bytes=Buffer.concat([bytes,Buffer.from(
        "\nexport {modal as previewModal, el as previewEl, button as previewButton};\n")]);
    }
    else if (name.startsWith("common/") && common.has(name.slice(7))) bytes = await readFile("standard/common/" + name.slice(7));
    else if (files.has(name)) bytes = files.get(name);
    else bytes = await pristine(name);
    res.writeHead(200, {"Content-Type": mime[path.extname(name)] ?? "application/octet-stream",
      "Cache-Control": "no-store", "Content-Security-Policy": CSP});
    res.end(bytes);
  } catch {
    // Public game paths only; deduplicate retries so a screenshot's graphics
    // counter can be traced without logging saves, native data or query strings.
    if(name.startsWith("assets/")&&!missingPreviewAssets.has(name)){
      missingPreviewAssets.add(name);console.warn("Preview asset unavailable: "+name);
    }
    res.writeHead(404); res.end("Not found");
  }
});
server.listen(0, "127.0.0.1", () => console.log("Source design preview: http://127.0.0.1:" +
  server.address().port + "/?lang=en"));
