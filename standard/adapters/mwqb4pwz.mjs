// Reviewed 0.10.20 adapter. Work on AST roles, not hashed filenames.
// The accepted pristine digest is checked by prepare.mjs before this executes.
import path from "node:path";
import {parse as parseJS} from "acorn";
import {patchNativeOriginGate} from "../../scripts/native-origin.ts";
import {nodesOf, one, maybeName, literal} from "../../scripts/source.ts";
import {bindTemplate} from "./reviewed-bindings.mjs";
import {localContracts} from "./local-contracts.mjs";
import {patchTowerPage, patchMutationPage, patchBossRush} from "./event-pages.mjs";
import {patchGuidePages} from "./guide.mjs";
import {expeditionContract, patchExpeditionPages, patchSystemTheme} from "./expedition.mjs";
import {patchLanRoom,patchLanLanding} from "./lan-room.mjs";
import {requireCoopRecoveryContract} from "./coop-recovery.mjs";
import {graphicsEdits, fpsSettingsReplacements} from "./graphics.mjs";
import {patchRentalBuilds,patchRentalGallery} from "./rentals.mjs";
import {patchExpeditionTeam} from "./expedition-team.mjs";
import {coopBossHudEdits} from "./boss-hud.mjs";

export function patchSnapshot(input, {bindings} = {}) {
const output = new Map(input);
const names = [...input.keys()].filter(name=>name.startsWith("assets/")).map(name=>path.posix.basename(name));
const get = name => input.get("assets/"+name).toString();
const module = (predicate,label) => one(names.filter(name=>name.endsWith(".js")&&predicate(get(name))),label);
const main = module(source => source.includes("async signedIn(") && source.includes("fpsCap()") &&
  source.includes("requestAnimationFrame(this.loop)"), "application lifecycle module");
const bootPath = one([...input.keys()].filter(name=>name.endsWith(".js")&&input.get("index.html").toString().includes(`src="./${name}"`)), "HTML module bootstrap");
const boot = path.posix.basename(bootPath);
const menus = module(source=>source.includes("mm-top")&&source.includes("ls-grid scroll"), "menu scene module");
const rules = one(names.filter(name=>name.startsWith("buildshare-")&&name.endsWith(".js")), "progression rules module");
const config = module(source=>source.includes("slot-move")&&source.includes("data/pokemon.json"), "game catalogs");
const cosmetics = one(names.filter(name=>name.startsWith("cosmetics-")&&name.endsWith(".js")), "cosmetics module");
const training = module(source=>source.includes("as trainingSetup"), "training setup");
const parse = source => parseJS(source, { ecmaVersion: "latest", sourceType: "module" });
const enableExpedition = ["mwsewi0r", "mwv6wzyo"].some(build =>
  input.get("index.html").toString().includes(`content="${build}"`));
const expedition = enableExpedition ? expeditionContract(input) : null;
const enableExpeditionTeam=input.get("index.html").toString().includes('content="mwv6wzyo"');
const expeditionTeam=enableExpeditionTeam?module(source=>source.includes("xt-entry")&&source.includes("xt-slots")&&source.includes("exb-team-room"),
  "original Expedition team UI"):null;
const edits = new Map();
const add = (file, node, text) => {
  if (file === menus && !bindings) {
    // Translate declaration names before parsing intermediate modules, so
    // exports remain valid even when a structural target has been renamed.
    text = text.replace(/^((?:async )?function )([\w$]+)/,
      (match, prefix, name) => prefix + (roleActual.get(name) ?? name));
  }
  const list = edits.get(file) ?? [];
  list.push({ start: node.start, end: node.end, text });
  edits.set(file, list);
};
const menuBinding = name => bindings ? roleActual.get(name) ?? bindings.resolve("menus", name) : name;
function template(file, text, method = false) {
  if (!bindings) return text;
  if (file === menus) text = text.replace(/^((?:async )?function )([\w$]+)/,
    (_match, prefix, name) => prefix + (roleActual.get(name) ?? name));
  return bindTemplate(text, name => file === menus ? menuBinding(name) : bindings.resolve("main", name), {method});
}
const addTemplate = (file, node, text, method = false) => add(file, node, template(file, text, method));
const sourceMain = get(main);
const mainTree=parse(sourceMain);
for (const edit of graphicsEdits(sourceMain,mainTree)) add(main,edit,edit.text);
if(enableExpeditionTeam)
  for (const edit of coopBossHudEdits(sourceMain,mainTree)) add(main,edit,edit.text);
if(enableExpedition){
  const {run}=requireCoopRecoveryContract(mainTree);
  const constructor=one(run.body.body.filter(method=>maybeName(method.key)==="constructor"),"game run constructor");
  const rush=one(nodesOf(constructor,"AssignmentExpression",node=>maybeName(node.left.property)==="rush"&&
    node.right.type==="NewExpression"),"weekly co-op boss rotation");
  const clock=rush.right.arguments[1];
  if(clock?.type!=="CallExpression"||maybeName(clock.callee.property)!=="now")
    throw Error("Unsupported upstream: weekly boss-rotation clock.");
  add(main,clock,`(this.meta.ticket?.lan&&Number.isSafeInteger(this.meta.ticket.coopRulesAt)?this.meta.ticket.coopRulesAt:${sourceMain.slice(clock.start,clock.end)})`);
}
const factory=one(nodesOf(mainTree,"FunctionDeclaration",n=>sourceMain.slice(n.start,n.end).includes("https://api.pokebonk.com")),"HTTP backend factory");
const backendClass=one(nodesOf(factory,"NewExpression"),"backend construction").callee.name;
const backendDefinition=one(nodesOf(mainTree,"VariableDeclarator",node=>maybeName(node.id)===backendClass&&
  node.init?.type==="ClassExpression"),"backend implementation").init;
const heartbeat=one(backendDefinition.body.body.filter(node=>node.value?.params.length===3&&
  sourceMain.slice(node.start,node.end).includes("`pb.liveBeat`")&&
  sourceMain.slice(node.start,node.end).includes("`pb.pending`")),"local checkpoint API");
const heartbeatName=maybeName(heartbeat.key);
if(!heartbeatName)throw new Error("Unsupported checkpoint method key.");
const appClass=maybeName(one(nodesOf(mainTree,"VariableDeclarator",node=>
  node.init?.type==="ClassExpression"&&["boot","signedIn","toMenu","fpsCap"].every(key=>
    node.init.body.body.some(method=>maybeName(method.key)===key))),"application lifecycle class").id);
const resultClass=one(nodesOf(mainTree,"VariableDeclarator",n=>n.init?.type==="ClassExpression"&&n.init.body.body.some(m=>maybeName(m.key)==="recordBlock")),"results class").id.name;
const hudLook=one(nodesOf(mainTree,"MethodDefinition",n=>maybeName(n.key)==="look"&&
  sourceMain.slice(n.start,n.end).includes("`--hs`")&&sourceMain.slice(n.start,n.end).includes("touchScale")),"HUD presentation settings");
const hudSettings=maybeName(hudLook.value.params[0]);
if(!hudSettings)throw new Error("Unsupported HUD settings parameter.");
const minimapProperty=one(nodesOf(hudLook,"CallExpression",node=>
  node.callee.type==="MemberExpression"&&maybeName(node.callee.property)==="setProperty"&&
  literal(node.arguments[0])==="--mm"),"minimap scale property");
const minimapString=minimapProperty.arguments[1];
if(minimapString?.type!=="CallExpression"||maybeName(minimapString.callee)!=="String"||minimapString.arguments.length!==1)
  throw new Error("Unsupported minimap scaling expression.");
const minimapValue=minimapString.arguments[0];
const hudTail=sourceMain.slice(hudLook.value.body.start+1,minimapValue.start)+
  `globalThis.PokeBonkOfflineUI.minimapScale(${hudSettings}.mapScale,${sourceMain.slice(minimapValue.start,minimapValue.end)})`+
  sourceMain.slice(minimapValue.end,hudLook.end);
add(main,hudLook,sourceMain.slice(hudLook.start,hudLook.value.body.start+1)+
  `${hudSettings}=globalThis.PokeBonkOfflineUI.presentationSettings(${hudSettings});`+
  hudTail);

for (const node of parse(sourceMain).body) {
  if (node.type === "FunctionDeclaration" && node.id.name === factory.id.name) {
    add(main, node, `function ${factory.id.name}(data){
      const backend=new globalThis.PokeBonkOfflineBackend({data,rules:__OFFLINE_RULES__,config:__OFFLINE_CONFIG__,cosmetics:__OFFLINE_COSMETICS__,modes:__OFFLINE_MODES__,${enableExpedition ? "expedition:__OFFLINE_EXPEDITION__," : ""}});
      backend[${JSON.stringify(heartbeatName)}]=(...args)=>backend.checkpoint(...args);return backend
    }`);
  }
  if (node.type !== "VariableDeclaration") continue;
  for (const declaration of node.declarations) {
    if (declaration.id.name === backendClass) add(main, declaration.init, "class {}");
    if (declaration.id.name === resultClass) {
      for (const method of declaration.init.body.body) {
        if (method.key.name === "recordBlock") {
          addTemplate(main, method, `recordBlock(run,result,info,error){
            if(!info)return this.saveFailed(run,error);
            const best=info.killsPb||info.endlessPb||info.pb;
            const short=!result.victory&&result.time<60;
            return q("div",{class:"sm-rec"},
              q("div",{class:"sm-best"+(best?" pb":"")},
                q("div",{class:"sm-best-n"},q("small",{},best?"New personal best!":"Local result"),
                  q("b",{},R(result.kills)+" KOs"),q("em",{},Xn(result.time)))),
              q("div",{class:"sm-note"},J("check",22),
                q("div",{},q("b",{},"Progress saved on this device"),
                  q("span",{},short?"Rewards saved. Runs under 60 seconds are not added to the recent-run history.":"Your rewards, captures, and personal records stay in your local save."))),
              info.medal?q("div",{class:"sm-medal"},J(ir[info.medal-1].icon,44),
                q("div",{},q("b",{},ir[info.medal-1].name),q("span",{},"+"+info.medalDust+" Stardust"))):null);
          }`, true);
        }
        if (method.key.name === "saveFailed") {
          addTemplate(main, method, 'saveFailed(run,error){return q("div",{class:"sm-note warn"},J("lock",22),q("div",{},q("b",{},"Could not save the local run"),q("span",{},error?String(error.message??error):"Check that the Standard application-data directory is writable.")))}', true);
        }
        if (method.key.name === "showRushEnd") {
          add(main, method, "showRushEnd(run,info,error){return globalThis.PokeBonkOfflineUI.challengeResult(this,run,info,error)}");
        }
        if (sourceMain.slice(method.start, method.end).includes(',`sm-recs`,this.recordBlock')) {
          const old = sourceMain.slice(method.start, method.end);
          const recordPanel = one(nodesOf(method,"CallExpression",node=>literal(node.arguments[2])==="sm-recs"&&
            node.arguments[3]?.type==="CallExpression"&&maybeName(node.arguments[3].callee.property)==="recordBlock"),
            "end-of-run local record panel");
          const bodyStart = method.value.body.start + 1 - method.start;
          const [run, , info, error] = method.value.params.map(param => param.name);
          const guard = `if(${run}.tower||${run}.rush)return globalThis.PokeBonkOfflineUI.challengeResult(this,${run},${info},${error});`;
          const from=recordPanel.arguments[0].start-method.start,to=recordPanel.arguments[1].end-method.start;
          const rewritten=old.slice(0,from)+'"Personal records","Saved on this device"'+old.slice(to);
          add(main, method, rewritten.slice(0, bodyStart) + guard + rewritten.slice(bodyStart));
        }
      }
    }
    if (declaration.id.name !== appClass) continue;
    for (const method of declaration.init.body.body) {
      if (enableExpedition && method.key.name === "startRun") {
        const argument=maybeName(method.value.params[0]),body=method.value.body;
        if(!argument)throw new Error("Unsupported application run config.");
        add(main,method,sourceMain.slice(method.start,body.start+1)+
          `if(!${argument}.coop&&["hosting","connecting","lobby","preparing","playing"].includes(globalThis.PokeBonkLocalCoop?.state().phase)){this.notice("Leave the local co-op room before starting a solo or practice run.");return false;}`+
          sourceMain.slice(body.start+1,method.end));
      }
      if (enableExpedition && method.key.name === "launch") {
        const hook=one(nodesOf(method,"AssignmentExpression",n=>maybeName(n.left.property)==="onCoop"),"co-op return action");
        add(main,hook.right,"()=>{this.toMenu();globalThis.PokeBonkOfflineUI.localCoop()}");
      }
      if (method.key.name === "constructor") {
        const loop=one(nodesOf(method,"CallExpression",node=>literal(node.arguments[1])==="loop"&&
          node.arguments[2]?.type==="ArrowFunctionExpression"),"game frame callback").arguments[2];
        const timestamp=maybeName(loop.params[0]);
        const guard=one(nodesOf(loop,"IfStatement",node=>{
          const text=sourceMain.slice(node.test.start,node.test.end);
          return text.includes("this.nextDraw")&&text.includes("this.r.needsDraw");
        }),"renderer frame-cap bypass");
        const interval=maybeName(one(nodesOf(loop,"VariableDeclarator",node=>
          node.init?.type==="CallExpression"&&node.init.callee.type==="MemberExpression"&&
          node.init.callee.object.type==="ThisExpression"&&node.init.arguments.length===0),
          "animation frame interval").id);
        if(!timestamp||!interval)throw new Error("Unsupported animation timestamp/interval parameter.");
        add(main,method,sourceMain.slice(method.start,guard.test.start)+
          `globalThis.PokeBonkOfflineUI.skipBatteryFrame(this,${timestamp},${interval})||(!this.saver&&(${sourceMain.slice(guard.test.start,guard.test.end)}))`+
          sourceMain.slice(guard.test.end,method.end-1)+";globalThis.PokeBonkNativeApp=this}");
      }
      if (method.key.name === "fpsCap") {
        const value=one(nodesOf(method,"ReturnStatement"),"effective FPS limit").argument;
        add(main,method,`fpsCap(){return globalThis.PokeBonkOfflineUI.batteryFpsCap(this.saver,(${sourceMain.slice(value.start,value.end)}))}`);
      }
      if (method.key.name === "signedIn") addTemplate(main,method,`async signedIn(account){
        await this.meta.load(account);this.applySettings();
        const stored=await this.backend.savedOnServer();
        jv(account.id);Uv(account.id);
        if(stored){const blob=await this.backend.downloadSave(account,stored.id);if(blob){
          const kept=await Nv(account.id,blob.ticket,blob.text);if(!kept)throw new Error("Could not restore the preserved run checkpoint.");
        }}
        await globalThis.PokeBonkOfflineUI.waitForMusic(this,W,IE());
        Nl(this);
        if(this.saved())await this.offerSaved("visit");
      }`, true);
      if (method.key.name === "offline") add(main,method,`offline(){globalThis.PokeBonkOfflineUI.startupError(new Error("Native save could not be loaded. Use Saves > Import backup. The original is preserved."))}`);
      if (method.key.name === "boot") {
        const old = sourceMain.slice(method.start, method.end);
        const marker = "requestAnimationFrame(this.loop),this.backend.onMaintenance=";
        const at = old.indexOf(marker);
        if (at < 0) throw new Error("Could not locate the game's server sign-in boot stage.");
        add(main, method, old.slice(0, at) + "requestAnimationFrame(this.loop);this.meta.onError=e=>this.notice(e);this.inviteOnly=false;await this.signedIn(await this.backend.restore())}");
      }
      if (method.key.name === "watchMaintenance") add(main, method, "watchMaintenance(){}");
      if (method.key.name === "askOffline") add(main, method, 'askOffline(){return Promise.resolve("play")}');
    }
  }
}

let checkpointHooks = 0;
const manualWriter = one(nodesOf(mainTree,"FunctionDeclaration",fn=>fn.async&&sourceMain.slice(fn.start,fn.end).includes("save:r,hash:i")), "manual snapshot writer");
const cacheCall = one(nodesOf(manualWriter,"CallExpression",n=>n.callee.type==="MemberExpression"&&maybeName(n.callee.property)==="setItem"),"manual snapshot cache");
const cacheKey = cacheCall.arguments[0].callee.name;
const digestName = one(nodesOf(manualWriter,"AwaitExpression"),"snapshot digest").argument.callee.name;
for(const fn of nodesOf(mainTree,"FunctionDeclaration")){
  const source=sourceMain.slice(fn.start,fn.end);
  if(fn===manualWriter){
    const [user,ticket,saved]=fn.params.map(p=>p.name);
    add(main,fn,`async function ${fn.id.name}(${user},${ticket},${saved}){
      const __text=JSON.stringify(${saved}),__hash=await ${digestName}(__text);
      await globalThis.PokeBonkNativeApp.backend.uploadSave(null,${ticket},__hash,__text);
      __STANDARD_MANUAL__.set(${user},{ticket:${ticket},hash:__hash,text:__text});
      try{localStorage.setItem(${cacheKey}(${user}),JSON.stringify({ticket:${ticket},hash:__hash,save:__text}))}catch{}
      return __hash
    }`);
    checkpointHooks++;
  } else if(fn.async&&source.includes("save:n,hash:r}")&&source.includes("localStorage.setItem")){
    const [user,ticket,text]=fn.params.map(p=>p.name);
    add(main,fn,`async function ${fn.id.name}(${user},${ticket},${text}){
      const __hash=await ${digestName}(${text});
      __STANDARD_MANUAL__.set(${user},{ticket:${ticket},hash:__hash,text:${text}});return __hash
    }`);
  } else if(source.includes("save:JSON.parse(n.save)}:null")){
    const user=fn.params[0].name;
    add(main,fn,`function ${fn.id.name}(${user}){const entry=__STANDARD_MANUAL__.get(${user});return entry?{ticket:structuredClone(entry.ticket),hash:entry.hash,save:JSON.parse(entry.text)}:null}`);
  } else if(source.includes("typeof t?.save==`string`?t.save:null")){
    const user=fn.params[0].name;
    add(main,fn,`function ${fn.id.name}(${user}){return __STANDARD_MANUAL__.get(${user})?.text??null}`);
  } else if(fn.async&&source.includes(`${cacheKey}(`)&&source.includes(`await ${digestName}(t.save)`)){
    const user=fn.params[0].name;
    add(main,fn,`async function ${fn.id.name}(${user}){const entry=__STANDARD_MANUAL__.get(${user});return entry?await ${digestName}(entry.text):null}`);
  } else if(fn.end-fn.start<80&&source.includes(`.del(${cacheKey}(`)){
    const user=fn.params[0].name;
    add(main,fn,source.slice(0,source.indexOf("{")+1)+`__STANDARD_MANUAL__.delete(${user});`+source.slice(source.indexOf("{")+1));
  }
  if(source.includes("localStorage.setItem")&&source.includes("save:n,hash:r,at:Date.now()")&&fn.async){
    const [user,ticket,text]=fn.params.map(p=>p.name);
    add(main,fn,`async function ${fn.id.name}(${user},${ticket},${text}){
      const __hash=await ${digestName}(${text});
      await globalThis.PokeBonkNativeApp.backend.uploadSave(null,${ticket},__hash,${text});
      return __hash
    }`);
    checkpointHooks++;
  }
}
if(checkpointHooks!==2)throw new Error("Native checkpoint contract changed");

const sourceBoot = get(boot);
for (const node of parse(sourceBoot).body) {
  if (node.type !== "FunctionDeclaration") continue;
  if (sourceBoot.slice(node.start,node.end).includes("Esta copia de PokéBonk no es la oficial")) {
    add(boot, node, `function ${node.id.name}(){const panel=document.createElement("section");panel.className="offline-boot-error";panel.textContent="Could not start the bundled Standard game. Reinstall this app without deleting its application-data folder.";document.body.append(panel)}`);
  }
  if (sourceBoot.slice(node.start,node.end).includes("document.title=l[e].title")) {
    const old = sourceBoot.slice(node.start, node.end);
    add(boot, node, old.replace("document.title=l[e].title", 'document.title="PokéBonk Offline"'));
  }
}

const offlineMenu = `function Lw(e){
  let t=e.meta,n=t.profile;
  if(!n.starter){zw(e);document.documentElement.dataset.standardReady="true";return}
  if(!n.starterJ&&zc.every(Xt)){zw(e,true);document.documentElement.dataset.standardReady="true";return}
  e.menuScene?.setBiome(n.lastBiome);e.menuScene?.setView("main");Yx(null);
  const buttons=[];
  let selected=0;
  const focus=()=>buttons.forEach((node,index)=>node.classList.toggle("focus",index===selected));
  const item=(cls,icon,title,sub,color,fn,badge=0)=>{
    const node=q("button",{class:"mm-item "+cls,style:{"--c":color,"--d":buttons.length*.05+"s"},onclick:()=>{W.click();fn()}},
      q("span",{class:"mm-ic"},icon),q("span",{class:"mm-tx"},q("b",{},title),q("small",{},sub)),
      badge?q("span",{class:"mm-badge"},String(badge)):null);
    node.addEventListener("pointerenter",event=>{
      if(event.pointerType==="mouse"){selected=buttons.indexOf(node);focus()}
    });
    node.addEventListener("focus",()=>{selected=buttons.indexOf(node);focus()});
    buttons.push(node);return node;
  };
  const saved=e.saved();
  const dex=localDexData.pokemon,seen=dex.filter(mon=>n.seen.includes(mon.id)).length,total=dex.length;
  const usable=localPlayableCatalog.filter(mon=>t.inLeague(mon.id)).length;
  const play=saved?item("play",K("poke-ball"),"Continue","Saved run","var(--red)",()=>e.offerSaved("menu")):
    item("play",K("poke-ball"),"Play","Classic mode","var(--red)",()=>mT(e));
  play.append(q("span",{class:"mm-partner"},J(n.lastSpecies)),q("span",{class:"mm-shine","aria-hidden":"true"}));
  const endless=item("endless",K("moon-stone"),"Survival","Endless mode","#5a4cd8",()=>mT(e,"endless"));
  endless.querySelector(".mm-ic").append(...[0,1,2].map(index=>q("i",{class:"mm-star",style:{"--k":index}})));
  const coop=${enableExpedition ? 'item("endless coop offline-lan-entry",Z("friends",40),"Co-op","With friends","#1fa86a",()=>globalThis.PokeBonkOfflineUI.localCoop())' : "null"};
  if(coop)coop.title="Co-op: five modes with up to three friends over LAN or optional Internet connections";
  const hub=localModeHub(item,()=>localModeOptions(e));
  hub.querySelector(".mm-tx b").textContent="Modes";hub.querySelector(".mm-tx small").textContent="4 modes";
  hub.setAttribute("aria-label","Game modes");
  const modes=q("div",{class:"mm-modes"},play,coop?q("div",{class:"mm-pair"},endless,coop):endless,hub);
  const event=item("event",Z("rush-trophy",40),"Mewtwo Strikes Back","Event challenge","#8a3aff",()=>localEventView(e,"rush26"));
  event.style.setProperty("--ev-img",'url("assets/ui/events/rush-card.jpg")');
  event.title="Boss Rush · earned pass rewards and missions · no deadline";
  const claimed=n.daily.claimed.slice(0,3).filter(Boolean).length;
  const ready=t.tasksReady();
  const tasks=item("tasks",K("great-ball"),"Tasks",ready?String(ready)+" ready":"Daily & weekly","#f2a516",()=>YT(e),ready);
  tasks.querySelector(".mm-tx b").after(q("span",{class:"mm-pips","aria-label":String(claimed)+" of 3 daily tasks claimed"},
    ...[0,1,2].map(index=>q("i",{class:index<claimed?"on":""}))));
  const today=q("div",{class:"mm-today"},event,tasks);
  const tiles=q("div",{class:"mm-tiles"},
    item("tile",K("ultra-ball"),${input.get("index.html").toString().includes('content="mwv6wzyo"') ? '"Pokédex+"' : '"Pokédex"'},seen+"/"+total,"var(--blue)",()=>OT(e)),
    item("tile",K("rare-candy"),"Lab",U(n.stardust)+" dust","var(--purple)",()=>VT(e)),
    item("tile",K("star-piece"),"Achievements",String(Object.keys(n.quests).length)+" earned","var(--orange)",()=>XT(e),t.claimable()),
    item("tile",K("tm-case"),"Builds","Plan a build","#1fb7a6",()=>jm(e)));
  const trainer=q("div",{class:"trainer"},
    q("button",{class:"tr-av",title:"Appearance",onclick:()=>CE(e,()=>Lw(e))},Y(n.avatar,n.frame,n.lastSpecies,44,n.skins)),
    q("div",{class:"tr-tx",title:n.name},q("b",{},n.name)),
    q("div",{class:"tr-cur"},q("span",{class:"currency"},Z("stardust",24),U(n.stardust)),q("span",{class:"currency bonk"},Z("bonk",24),U(n.bonk??0)),
      q("span",{class:"currency tr-playable",title:"Pokémon available in Play","aria-label":usable+" of "+localPlayableCatalog.length+" usable Pokémon"},K("poke-ball"),usable+"/"+localPlayableCatalog.length)),
    q("button",{class:"btn small ghost offline-local-button",onclick:()=>globalThis.PokeBonkOfflineUI.profile(e)},"Player & saves"));
  const small=q("div",{class:"mm-small"},
    item("mini",K("metronome"),"Settings","","var(--ink-2)",()=>PE(e)),
    item("mini",Z("target",26),"Practice","","#397dc9",()=>mT(e,"training")),
    item("mini guide",Z("idea",26),"Guide","","var(--yellow-d)",()=>OC(t)),
    item("mini round bug offline-report-entry",Z("bug",26),"Report a bug","","var(--ink-2)",()=>globalThis.PokeBonkOfflineUI.reportBug(e)));
  small.querySelector(".offline-report-entry").setAttribute("aria-label","Report a bug");
  small.querySelector(".offline-report-entry").title="Report a bug on GitHub";
  UC(e,"mm offline-menu",q("div",{class:"mm-top"},
      q("div",{class:"offline-top-tools"},ph(),ge()?Pw():null,FC(e),WT(e)),trainer),
    q("div",{class:"mm-layout"},q("div",{class:"mm-left"},XC("hero"),q("nav",{class:"mm-nav"},modes,today,tiles,small)),
      globalThis.PokeBonkOfflineUI.recordsPanel(e)),
    q("div",{class:"mm-foot"},q("span",{},"Unofficial fan game · saved on this device"),
      q("div",{class:"offline-credit-links"},
        q("button",{class:"btn small ghost",onclick:()=>RE(e)},"Credits"),
        globalThis.PokeBonkOfflineUI.creatorCredit())));
  focus();WC(event=>{
    if(event.target?.closest?.(".offline-modal, input, select, textarea"))return;
    if(event.target?.closest?.("button")&&!event.target.closest(".mm-item"))return;
    if(["ArrowDown","ArrowRight"].includes(event.key)){selected=(selected+1)%buttons.length;focus();event.preventDefault()}
    else if(["ArrowUp","ArrowLeft"].includes(event.key)){selected=(selected+buttons.length-1)%buttons.length;focus();event.preventDefault()}
    else if(event.key==="Enter"||event.key===" "){buttons[selected].click();event.preventDefault()}
  });
  globalThis.PokeBonkOfflineUI.firstVisit(e,options=>OC(t,options));
}`;

const sourceMenus = get(menus);
const lanRoom = enableExpedition ? patchLanRoom(sourceMenus) : null;
const lanLanding = enableExpedition ? patchLanLanding(sourceMenus) : null;
if (lanRoom) add(menus, lanRoom.change, lanRoom.change.text);
if (lanRoom) add(menus, lanRoom.cleanupChange, lanRoom.cleanupChange.text);
if (lanRoom) add(menus, lanRoom.returnChange, lanRoom.returnChange.text);
// Resolve UI entry points by their DOM/content contracts. The replacement
// templates below use reviewed 0.10.20 bindings, translated to discovered names.
// Unknown or ambiguous shapes fail BEFORE touching the previous built payload.
const menuTree = parse(sourceMenus);
const expeditionPages = enableExpedition ? patchExpeditionPages(sourceMenus,{team:enableExpeditionTeam}) : null;
if (expeditionPages) for (const change of expeditionPages.changes) add(menus, change, change.text);
const declarations = menuTree.body.filter(n=>n.type==="FunctionDeclaration");
const roleActual = new Map();
for(const [role, marker] of Object.entries({
  Lw:"mm-tiles", Bb:"logo-ver", XC:"logo-com", Pw:"lang-btn fs-btn", SE:"bd-mons scroll", bE:"lb-list",
  jE:"pf-body scroll", dg:"fb-kinds", OC:"g-stage", LE:"st-range", jm:"bd-rents",
  mT:"ls-grid scroll", xT:"rg-regions", XT:"q-wrap scroll", dm:"Build de {mon} de {name}", CE:"lk-grid scroll",
  Ng:"Hay una versión nueva de la app de PokéBonk", M_:"cp-lineup", Uy:"No se pudieron cargar los clanes",
  Pb:"ml-wrap scroll", Sw:"seg auth-tabs", Nw:"Guardar premios y", Uw:"auth-beta", bp:"dk-strip",
  sC:".season-modal, .wipe", gg:"./version.json?t=",
  localEventView:"ev-body scroll", localMutationView:"mu-scr",
  localModeHub:"mh-cluster n",
})){
  let matches=declarations.filter(n=>["gg","Nw"].includes(role)
    ?sourceMenus.slice(n.start,n.end).includes(marker)
    :nodesOf(n,"Literal").concat(nodesOf(n,"TemplateLiteral")).some(value=>literal(value)===marker));
  if(role==="Ng") matches=matches.filter(n=>!sourceMenus.slice(n.start,n.end).includes("desktopapp-"));
  if(role==="Pw") matches=matches.filter(n=>sourceMenus.slice(n.start,n.end).includes("fullscreenchange"));
  roleActual.set(role,one(matches,`Standard ${role} structural role`).id.name);
}
roleActual.set("Fg",one(declarations.filter(n=>{
  const text=sourceMenus.slice(n.start,n.end);
  return text.includes("desktopapp-")&&text.includes("upd-bar");
}),"desktop website updater").id.name);
const calls = (fn,name) => nodesOf(fn,"CallExpression",n=>n.callee.type==="Identifier"&&n.callee.name===name).length>0;
const originalMenu = one(declarations.filter(node => node.id.name === roleActual.get("Lw")), "homepage catalog owner");
const originalBoard = one(declarations.filter(node=>nodesOf(node,"Literal").concat(nodesOf(node,"TemplateLiteral"))
  .some(value=>literal(value)==="mm-sp-scope")),"homepage leaderboard scope owner");
const scopeBiomes = one([...new Set(nodesOf(originalBoard,"CallExpression",node=>
  maybeName(node.callee.property)==="filter"&&node.callee.object?.type==="Identifier")
  .map(node=>node.callee.object.name))],"leaderboard map-scope palette");
const scopeSky = one(nodesOf(originalBoard,"Property",node=>literal(node.key)==="--sky"),"leaderboard map-scope sky");
const scopeColor = maybeName(scopeSky.value?.callee);
if(!scopeColor)throw new Error("Unsupported leaderboard palette color helper.");
roleActual.set("localDexData", one([...new Set(nodesOf(originalMenu, "MemberExpression", node =>
  maybeName(node.property) === "length" && maybeName(node.object?.property) === "pokemon" &&
  node.object.object.type === "Identifier").map(node=>node.object.object.name))], "national Pokédex menu catalog"));
roleActual.set("localModeOptions", one(declarations.filter(node =>
  ["relay", "mutation", "expedition"].every(id => nodesOf(node, "Property",
    property => maybeName(property.key) === "id" && literal(property.value) === id).length === 1)),
"offline modes options").id.name);
const selector = one(declarations.filter(node => node.id.name === roleActual.get("mT")), "playable Pokémon selector");
const leagueList = one(nodesOf(selector, "ArrowFunctionExpression", node => {
  const first = node.body?.body?.[0], list = first?.declarations?.[0]?.init;
  return node.params.length === 0 && first?.type === "VariableDeclaration" &&
    list?.type === "CallExpression" && maybeName(list.callee.property) === "map" &&
    list.callee.object?.type === "CallExpression" && maybeName(list.callee.object.callee.property) === "filter" &&
    first.declarations.some(item => maybeName(item.init?.callee?.object?.property) === "team" &&
      maybeName(item.init?.callee?.object?.object?.property) === "profile");
}), "Play-screen owned/favorite Pokémon reconciliation");
roleActual.set("localPlayableCatalog", maybeName(leagueList.body.body[0].declarations[0].init.callee.object.callee.object));
if (!roleActual.get("localPlayableCatalog")) throw new Error("Unsupported usable Pokémon catalog.");
roleActual.set("localGuidePages", one(declarations.filter(node =>
  nodesOf(node, "ObjectExpression", item => item.properties.some(property =>
    maybeName(property.key) === "title" && literal(property.value?.arguments?.[0]) === "¡Bienvenido a PokéBonk!")).length === 1),
"illustrated trainer-guide content").id.name);
roleActual.set("localRentalGallery",one(declarations.filter(node=>
  nodesOf(node,"CallExpression",call=>maybeName(call.callee.property)==="rentalBuilds").length===1),
  "rental gallery entry").id.name);
const updaterWrapper=one(declarations.filter(n=>n.async&&n.end-n.start<200&&n.params.length===1&&
  !nodesOf(n,"AssignmentExpression").length&&calls(n,roleActual.get("gg"))),"website check wrapper");
roleActual.set("yg",updaterWrapper.id.name);
roleActual.set("bg",one(declarations.filter(n=>n.end-n.start<500&&calls(n,updaterWrapper.id.name)&&
  sourceMenus.slice(n.start,n.end).includes("document.visibilityState")),"website polling hook").id.name);
roleActual.set("P_",one(declarations.filter(n=>n.end-n.start<250&&calls(n,roleActual.get("M_"))),"coop notice wrapper").id.name);
const canonicalRole=new Map([...roleActual].map(([role,actual])=>[actual,role]));
const textValue = node => node?.type === "Literal" ? node.value :
  node?.type === "TemplateLiteral" && !node.expressions.length ? node.quasis[0].value.cooked : null;
function rewriteFunction(node, replacements) {
  let source = sourceMenus.slice(node.start, node.end);
  for (const change of replacements.sort((a, b) => b.node.start - a.node.start)) {
    const text=bindings&&!change.raw?template(menus,change.text):change.text;
    source = source.slice(0, change.node.start - node.start) + text + source.slice(change.node.end - node.start);
  }
  add(menus, node, source);
}
const disabled = new Set(["bg", "gg", "yg", "Ng", "Fg", "Nw", "sC", "Pb", "Uy", "M_", "P_", "Sw", "Uw", "bp"]);
for (const node of parse(sourceMenus).body) {
  if (node.type !== "FunctionDeclaration") continue;
  // A newly minified, unrelated function can reuse an old role's short name.
  // Only positively resolved roles may be rewritten in a different build.
  const name = canonicalRole.get(node.id.name) ?? (bindings ? null : node.id.name);
  if (name === "Lw") addTemplate(menus, node, offlineMenu);
  else if (name === "M_" && lanLanding) add(menus, node, lanLanding.change.text);
  else if (name === "Pw") add(menus, node, `function ${node.id.name}(){return globalThis.PokeBonkOfflineUI.fullscreenButton()}`);
  else if (name === "Bb") add(menus, node, `function ${node.id.name}(){return globalThis.PokeBonkOfflineUI.versionBadge()}`);
  else if (name === "localEventView") add(menus, node, patchTowerPage(sourceMenus, node));
  else if (name === "localMutationView") add(menus, node, patchMutationPage(sourceMenus, node));
  else if (name === "localModeOptions") addTemplate(menus, node, `function localModeOptions(e){
    const daily=e.backend.dailyChallenge(),mutation=daily.mutation;
    const members=e.meta.profile.league.filter(Xt),portraits=[members[0],members[Math.floor(members.length/2)],members[members.length-1]]
      .filter((id,index,all)=>id!=null&&all.indexOf(id)===index);
    return [
      {id:"relay",icon:()=>q("span",{class:"rv-hubic n"+portraits.length},...portraits.map(id=>J(id))),title:"Relay",color:"#e0306a",chip:"TEAM",
        sub:"Four Pokémon · one at a time",desc:"Recruit your League and swap during the run",action:()=>mT(e,"relay")},
      {id:"mutation",icon:()=>Z(mutation.icon,50),title:mutation.name,color:mutation.color,chip:"DAILY",
        sub:"Daily Mutation",desc:"Daily rules · local rewards",action:()=>localMutationView(e)},
      {id:"tower",icon:()=>Z("torre",50),title:"Lavender Tower",color:"#9a6aff",chip:"EVENT",
        sub:"Climb the tower",desc:"Earn Candles, pass rewards and missions",action:()=>localEventView(e,"halloween26")},
      {id:"expedition",icon:()=>Z("exp-bag",50),title:"The Great Expedition",color:"#1f9a6a",chip:${enableExpeditionTeam?'"SOLO / CO-OP"':enableExpedition ? '"SOLO"' : '"PREVIEW"'},
        sub:${enableExpeditionTeam?'"Solo or with friends"':'"Solo loot & extraction"'},desc:${enableExpedition ? '"Keep the loot you extract"' : '"Offline adaptation in progress"'},action:()=>${enableExpedition ?
          "globalThis.PokeBonkOpenExpedition(e)" : 'globalThis.PokeBonkOfflineUI.expeditionPreview(e,{mount:content=>UC(e,"dim ex exp3d exb offline-expedition",content)})'}}
    ];
  }`);
  else if (name === "XC") {
    const replacements = [];
    walk(node, child => {
      if (child.type === "CallExpression" && child.callee.name === menuBinding("q") &&
          child.arguments[1]?.properties?.some(p => p.key.name === "class" && textValue(p.value) === "logo-com")) {
        replacements.push({ node: child, text: "null" });
      }
    });
    rewriteFunction(node, replacements);
  }
  else if (name === "SE" || name === "bE") addTemplate(menus, node, `function ${name}(e){return globalThis.PokeBonkOfflineUI.records(e)}`);
  else if (name === "jE") addTemplate(menus, node, "function jE(e){return globalThis.PokeBonkOfflineUI.profile(e)}");
  else if (name === "dg") addTemplate(menus, node, "function dg(e){return globalThis.PokeBonkOfflineUI.unavailable(e)}");
  else if (name === "localGuidePages") add(menus, node, patchGuidePages(sourceMenus, node));
  else if (name === "localRentalGallery") add(menus,node,patchRentalGallery(sourceMenus,node));
  else if (name === "LE") {
    const replacements = fpsSettingsReplacements(sourceMenus,node);
    const offlineOnlyKeys = new Set(["mateFx", "showLadder", "teamChat", ...enableExpedition ? [] : ["lootMinRarity",
      "lootShinyMin", "lootMinLevel", "lootUse", "lootTreasure", "lootHideUse", "lootHideTreasure"]]);
    const unavailableRows = new Set(node.body.body.filter(statement=>statement.type==="VariableDeclaration")
      .flatMap(statement=>statement.declarations)
      .filter(declaration=>!enableExpedition&&["ArrowFunctionExpression","FunctionExpression"].includes(declaration.init?.type)&&
        /lootMinRarity|lootShinyMin|lootMinLevel|lootUse|lootTreasure/.test(sourceMenus.slice(declaration.init.start,declaration.init.end)))
      .map(declaration=>maybeName(declaration.id)));
    walk(node, child => {
      if (child.type === "CallExpression" && (
        child.arguments.some(arg => offlineOnlyKeys.has(textValue(arg))) ||
        unavailableRows.has(maybeName(child.callee))
      )) replacements.push({ node: child, text: "null" });
      if (textValue(child) === "Todo el juego explicado por capítulos: la partida, la Liga, los modos, el Laboratorio, los clanes…") {
        replacements.push({ node: child, text: '"Controls and help for the local single-player edition."' });
      }
      if (textValue(child) === "La de la temporada o la del evento activo") {
        replacements.push({ node: child, text: '"Default local menu theme"' });
      }
      if (textValue(child) === "Los que sigues desde Logros, bajo la tarjeta de la temporada") {
        replacements.push({ node: child, text: '"The achievements you track during a local run"' });
      }
      if (textValue(child) === "Limita a 30 fps y baja la resolución: el móvil gasta menos batería") {
        replacements.push({ node: child, text: '"Limits rendering to 30 FPS, lowers 3D resolution, and reduces glow."' });
      }
    });
    rewriteFunction(node, replacements.filter(change=>!replacements.some(parent=>
      parent!==change&&parent.node.start<=change.node.start&&parent.node.end>=change.node.end)));
  }
  else if (name === "jm") {
    add(menus,node,patchRentalBuilds(sourceMenus,node));
  }
  else if (name === "mT") {
    const replacements = [];
    walk(node, child => {
      const value = textValue(child);
      if (value === "Clasificación") replacements.push({ node: child, text: '"Personal records"' });
      else if (value === "Clasificación de {name}") replacements.push({ node: child, text: '"Personal records: {name}"' });
    });
    rewriteFunction(node, replacements);
  }
  else if (name === "xT") {
    const replacements = [];
    walk(node, child => {
      if (child.type === "VariableDeclarator" && child.id.name === "k" &&
          sourceMenus.slice(child.init.start, child.init.start + 30).startsWith("()=>{if(!O)return")) {
        replacements.push({ node: child.init, text: '()=>{if(O)G(O).append(q("span",{},"Personal best · saved on this device"))}' });
        return;
      }
      if (child.type === "CallExpression" && child.callee.type === "MemberExpression" &&
          ["records", "endlessRecords"].includes(child.callee.property.name) &&
          child.callee.object.type === "MemberExpression" && child.callee.object.property.name === "backend") {
        replacements.push({ node: child, text: "Promise.resolve([])" });
      }
      if (child.type === "CallExpression" && child.callee.name === menuBinding("q")) {
        const cls = child.arguments[1]?.properties?.find(p => p.key.name === "class");
        if (textValue(cls?.value) === "rg-season") replacements.push({ node: child, text: "null" });
        if (textValue(cls?.value) === "rg-rank" && child.arguments.length > 2) {
          replacements.push({ node: child, text: 'q("div",{class:"rg-rank"},"Personal best · saved on this device")' });
        }
      }
      const value = textValue(child);
      if (value === "Clasificación") replacements.push({ node: child, text: '"Personal records"' });
      else if (value === "Clasifica por tiempo sobrevivido (las bajas desempatan) y suma a tu clan en su propia tabla.") {
        replacements.push({ node: child, text: '"Your best survival time and KOs are saved locally on this device."' });
      }
      else if (value === "Llegará en una próxima temporada") {
        replacements.push({ node: child, text: '"Not included in this archived build"' });
      }
    });
    // Drop edits inside replaced subtrees (for example a removed season panel).
    rewriteFunction(node, replacements.filter(change => !replacements.some(parent =>
      parent !== change && parent.node.start <= change.node.start && parent.node.end >= change.node.end)));
  }
  else if (name === "XT") {
    const replacements = [];
    walk(node, child => {
      if (String(textValue(child)).startsWith("Estos retos solo avanzan con tu Pokémon de la Liga")) {
        replacements.push({ node: child, text: '"These achievements advance in clean, single-player runs with your League Pokémon. Wins require a Classic victory. Counters add up between games; single-run goals keep your best result."' });
      }
    });
    rewriteFunction(node, replacements);
  }
  else if (name === "dm") {
    const remote=one(nodesOf(node,"ConditionalExpression",child=>child.test.type==="LogicalExpression"&&child.test.operator==="&&"&&
      nodesOf(child.consequent,"CallExpression",call=>call.callee.type==="MemberExpression"&&
        maybeName(call.callee.property)==="player"&&call.callee.object.type==="MemberExpression"&&
        maybeName(call.callee.object.property)==="backend").length>0),"build-author lookup");
    const app=maybeName(node.params[0]);
    const old=sourceMenus.slice(node.start,node.end);
    add(menus,node,old.slice(0,remote.test.start-node.start)+
      `${app}.backend.kind==="http"&&(${sourceMenus.slice(remote.test.start,remote.test.end)})`+
      old.slice(remote.test.end-node.start));
  }
  else if (name === "CE") {
    const replacements = [];
    const unavailableCatalogs = new Set(["cn", "$i", "Aa", "la", "ro", "$n", "Pa", "Sa"].map(menuBinding));
    walk(node, child => {
      if (child.type === "Identifier") {
        const owned = "globalThis.PokeBonkNativeApp.meta.profile.cosmetics.includes(item.id)";
        if (unavailableCatalogs.has(child.name)) replacements.push({ node: child,
          text: `${child.name}.filter(item=>${owned})`, raw: true });
        else if (child.name === menuBinding("Mi")) replacements.push({ node: child, text: `Mi.filter(item=>item.free||item.research||item.quest||${owned})` });
        else if (child.name === menuBinding("ya")) replacements.push({ node: child, text: `ya.filter(item=>item.star||item.id==="bg:allcaught"||${owned})` });
        else if (child.name === menuBinding("ja")) replacements.push({ node: child, text: `ja.filter(item=>item.star||item.treasure||item.quest||${owned})` });
      }
      const value = textValue(child);
      if (typeof value !== "string") return;
      if (value === "season-modal") {
        replacements.push({ node: child, text: '"season-modal offline-appearance"' });
      }
      else if (value.startsWith("El fondo sale detrás de tu nombre en tu ficha")) {
        replacements.push({ node: child, text: '"Backgrounds are earned through local collection achievements or bought in the Shop."' });
      }
      else if (value.startsWith("Acaba una temporada como n.º 1 de la clasificación de un Pokémon (con")) {
        replacements.push({ node: child, text: '"Earn titles through local achievements and Pokémon friendship."' });
      }
      else if (value === "Sale bajo tu nombre en la clasificación y en tu ficha.") {
        replacements.push({ node: child, text: '"Shown on your local player card."' });
      }
      else if (value === "Tu imagen en la clasificación y tu ficha") {
        replacements.push({ node: child, text: '"Your local player appearance"' });
      }
      else if (value.startsWith("Los avatares exclusivos y los marcos se ganan con los premios de temporada")) {
        replacements.push({ node: child, text: '"Unlock avatars and frames through local research, achievements, friendship, treasures, and the Shop."' });
      }
    });
    rewriteFunction(node, replacements);
  }
  else if (disabled.has(name)) {
    addTemplate(menus, node, `${node.async ? "async " : ""}function ${name}(){return null}`);
  }
}

// Restore the original challenge/pass/mission presentation at every entry
// point. Board/prize tabs and their requested-tab shortcuts are unavailable.
for (const file of names.filter(name => name.startsWith("bossrush-") && name.endsWith(".js"))) {
  for (const change of patchBossRush(get(file))) add(file, change.node, change.text);
}

// The relay's in-game record button must show local history, not an online board.
for (const file of names.filter(name => name.startsWith("relayboard-") && name.endsWith(".js"))) {
  const source = get(file);
  const ast = parse(source);
  const exported = ast.body.filter(node => node.type === "ExportNamedDeclaration")
    .flatMap(node => node.specifiers).find(item => item.exported.name === "relayBoard")?.local.name;
  const declaration = ast.body.find(node => node.type === "FunctionDeclaration" && node.id.name === exported);
  if (declaration) add(file, declaration, `function ${exported}(app){return globalThis.PokeBonkOfflineUI.records(app)}`);
}

function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end") continue;
    if (Array.isArray(value)) value.forEach(child => walk(child, fn));
    else if (value && typeof value === "object") walk(value, fn);
  }
}
function withoutExternalDestinations(source) {
  const changes = [];
  walk(parse(source), node => {
    const value = node.type === "Literal" && typeof node.value === "string" ? node.value :
      node.type === "TemplateLiteral" ? node.quasis[0]?.value.cooked : null;
    if (typeof value !== "string") return;
    if (/^(?:https?:\/\/|mailto:|ftp:|tel:)/i.test(value) && !/^http:\/\/www\.w3\.org\//.test(value)) {
      changes.push({ start: node.start, end: node.end, text: JSON.stringify("#") });
    } else if (/^(?:wss?|stun|turn|turns):/.test(value)) {
      changes.push({ start: node.start, end: node.end, text: JSON.stringify("") });
    }
  });
  for (const change of changes.sort((a, b) => b.start - a.start)) source = source.slice(0, change.start) + change.text + source.slice(change.end);
  return source;
}

const changed = [];
output.set("offline/upstream-modes.js", localContracts(input, {menus, config, cosmetics}));
if (expedition) output.set("offline/upstream-expedition.js", expedition.bytes);
for (const file of names.filter(name => name.endsWith(".js"))) {
  let source = get(file);
  for (const change of (edits.get(file) ?? []).sort((a, b) => b.start - a.start)) source = source.slice(0, change.start) + change.text + source.slice(change.end);
  if(file===menus&&!bindings){
    const renames=[];
    // Replacement declarations still use template role names at this
    // intermediate stage; exports are checked again after translating them.
    walk(parseJS(source,{ecmaVersion:"latest",sourceType:"module",allowUndeclaredExports:true}),node=>{
      if(node.type==="Identifier"&&roleActual.has(node.name)&&roleActual.get(node.name)!==node.name)
        renames.push({...node,text:roleActual.get(node.name)});
    });
    for(const change of renames.sort((a,b)=>b.start-a.start))source=source.slice(0,change.start)+change.text+source.slice(change.end);
  }
  if (/^(?:training-|relay-)/.test(file)) {
    const copy = new Map([
      ["Prueba builds sin que cuente: nada se guarda en tu progreso ni en las clasificaciones.", "Practice builds without changing your local progress."],
      ["Esta partida no cuenta para la clasificación.", "Practice runs do not change your local records."],
      ["Clasificación y premios", "Personal records"],
    ]);
    const changes = [];
    walk(parse(source), node => {
      const replacement = copy.get(textValue(node));
      if (replacement) changes.push({ start: node.start, end: node.end, text: JSON.stringify(replacement) });
    });
    for (const change of changes.sort((a, b) => b.start - a.start)) source = source.slice(0, change.start) + change.text + source.slice(change.end);
  }
  if(file===expeditionTeam)source=patchExpeditionTeam(source);
  try { source = withoutExternalDestinations(source); }
  catch(error){throw new Error(`Invalid offline rewrite in ${file}: ${error.message}`,{cause:error});}
  if (file === main) {
    source = patchSystemTheme(source);
    const localModesImport = 'import * as __OFFLINE_MODES__ from "../offline/upstream-modes.js";';
    if(bindings){
      const exports={
        rules:["wn","Jt","qt","Yt","Kt","Wt","Gt","cn","sn","Qt","$t","an","Ut"],
        config:["Nr","Wn"],cosmetics:["Yn","Wn","Jn"],
      };
      for(const [role,keys]of Object.entries(exports)){
        const file={rules,config,cosmetics}[role],kind={rules:"buildshare",config:"assets",cosmetics:"cosmetics"}[role];
        const declarations=keys.map(key=>`${bindings.exported(kind,key)} as ${key}`).join(",");
        output.set(`offline/upstream-${role}.js`,Buffer.from(`export {${declarations}} from "../assets/${file}";\n`));
      }
      source = localModesImport + `import * as __OFFLINE_RULES__ from "../offline/upstream-rules.js";import * as __OFFLINE_CONFIG__ from "../offline/upstream-config.js";import * as __OFFLINE_COSMETICS__ from "../offline/upstream-cosmetics.js";const __STANDARD_MANUAL__=new Map();\n`+source;
    }else source = localModesImport + `import * as __OFFLINE_RULES__ from "./${rules}";import * as __OFFLINE_CONFIG__ from "./${config}";import * as __OFFLINE_COSMETICS__ from "./${cosmetics}";const __STANDARD_MANUAL__=new Map();\n` + source;
  }
  if (file === main && expedition) source = 'import * as __OFFLINE_EXPEDITION__ from "../offline/upstream-expedition.js";\n' + source;
  if (file === menus && expeditionPages) source += `\nglobalThis.PokeBonkOpenExpedition=${expeditionPages.entry};\n`;
  if (file === menus && lanRoom) source += `\nglobalThis.PokeBonkOpenLocalRoom=${lanRoom.entry};\n`;
  if (file === menus && lanRoom) source += `\nglobalThis.PokeBonkTrackRoomReturn=${lanRoom.returnEntry};\n`;
  if (file === menus && lanLanding) source += `\nglobalThis.PokeBonkOpenLanHome=${lanLanding.entry};\n`;
  if (file === menus) source += `\nglobalThis.PokeBonkOfflineUI.setScopePalette(${scopeBiomes}.map(map=>({id:map.id,sky:${scopeColor}(map.sky[0]),ground:${scopeColor}(map.ground[1])})));\n`;
  try { parse(source); }
  catch(error){throw new Error(`Invalid offline patch in ${file}: ${error.message}; near ${source.slice(Math.max(0,(error.pos??0)-120),(error.pos??0)+220)}`,{cause:error});}
  if(file===boot)source=patchNativeOriginGate(source).replaceAll("pokebonk://game/","pokebonk-standard://game/");
  output.set("assets/"+file,Buffer.from(source));
  if (source !== get(file)) changed.push(file);
}

return {files:output, modules:{main,boot,menus,rules,config,cosmetics,training,
  backendModes:"offline/upstream-modes.js",
  ...(expedition ? {backendExpedition:"offline/upstream-expedition.js"} : {}),
  ...(bindings?{backendRules:"offline/upstream-rules.js",backendConfig:"offline/upstream-config.js",backendCosmetics:"offline/upstream-cosmetics.js"}:{})},changed};
}
