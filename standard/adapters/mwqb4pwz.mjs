// Reviewed 0.10.20 adapter. Work on AST roles, not hashed filenames.
// The accepted pristine digest is checked by prepare.mjs before this executes.
import path from "node:path";
import {parse as parseJS} from "acorn";
import {patchNativeOriginGate} from "../../scripts/native-origin.ts";
import {nodesOf, one, maybeName, literal} from "../../scripts/source.ts";

export function patchSnapshot(input) {
const output = new Map(input);
const names = [...input.keys()].filter(name=>name.startsWith("assets/")).map(name=>path.posix.basename(name));
const get = name => input.get("assets/"+name).toString();
const module = (predicate,label) => one(names.filter(name=>name.endsWith(".js")&&predicate(get(name))),label);
const main = module(source=>/ as App}/.test(source), "exported App module");
const bootPath = one([...input.keys()].filter(name=>name.endsWith(".js")&&input.get("index.html").toString().includes(`src="./${name}"`)), "HTML module bootstrap");
const boot = path.posix.basename(bootPath);
const menus = module(source=>source.includes("mm-top")&&source.includes("ls-grid scroll"), "menu scene module");
const rules = one(names.filter(name=>name.startsWith("buildshare-")&&name.endsWith(".js")), "progression rules module");
const config = module(source=>source.includes("slot-move")&&source.includes("data/pokemon.json"), "game catalogs");
const cosmetics = one(names.filter(name=>name.startsWith("cosmetics-")&&name.endsWith(".js")), "cosmetics module");
const training = module(source=>source.includes("as trainingSetup"), "training setup");
const parse = source => parseJS(source, { ecmaVersion: "latest", sourceType: "module" });
const edits = new Map();
const add = (file, node, text) => {
  if (file === menus) {
    // Translate declaration names before parsing intermediate modules, so
    // exports remain valid even when a structural target has been renamed.
    text = text.replace(/^((?:async )?function )([\w$]+)/,
      (match, prefix, name) => prefix + (roleActual.get(name) ?? name));
  }
  const list = edits.get(file) ?? [];
  list.push({ start: node.start, end: node.end, text });
  edits.set(file, list);
};
const sourceMain = get(main);
const mainTree=parse(sourceMain);
const factory=one(nodesOf(mainTree,"FunctionDeclaration",n=>sourceMain.slice(n.start,n.end).includes("https://api.pokebonk.com")),"HTTP backend factory");
const backendClass=one(nodesOf(factory,"NewExpression"),"backend construction").callee.name;
const appClass=one(nodesOf(mainTree,"ExportSpecifier",n=>maybeName(n.exported)==="App"),"App export").local.name;
const resultClass=one(nodesOf(mainTree,"VariableDeclarator",n=>n.init?.type==="ClassExpression"&&n.init.body.body.some(m=>maybeName(m.key)==="recordBlock")),"results class").id.name;
const hudLook=one(nodesOf(mainTree,"MethodDefinition",n=>maybeName(n.key)==="look"&&
  sourceMain.slice(n.start,n.end).includes("`--hs`")&&sourceMain.slice(n.start,n.end).includes("touchScale")),"HUD presentation settings");
const hudSettings=maybeName(hudLook.value.params[0]);
if(!hudSettings)throw new Error("Unsupported HUD settings parameter.");
add(main,hudLook,sourceMain.slice(hudLook.start,hudLook.value.body.start+1)+
  `${hudSettings}=globalThis.PokeBonkOfflineUI.presentationSettings(${hudSettings});`+
  sourceMain.slice(hudLook.value.body.start+1,hudLook.end));

for (const node of parse(sourceMain).body) {
  if (node.type === "FunctionDeclaration" && node.id.name === factory.id.name) {
    add(main, node, `function ${factory.id.name}(data){return new globalThis.PokeBonkOfflineBackend({data,rules:__OFFLINE_RULES__,config:__OFFLINE_CONFIG__,cosmetics:__OFFLINE_COSMETICS__})}`);
  }
  if (node.type !== "VariableDeclaration") continue;
  for (const declaration of node.declarations) {
    if (declaration.id.name === backendClass) add(main, declaration.init, "class {}");
    if (declaration.id.name === resultClass) {
      for (const method of declaration.init.body.body) {
        if (method.key.name === "recordBlock") {
          add(main, method, `recordBlock(run,result,info,error){
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
          }`);
        }
        if (method.key.name === "saveFailed") {
          add(main, method, 'saveFailed(run,error){return q("div",{class:"sm-note warn"},J("lock",22),q("div",{},q("b",{},"Could not save the local run"),q("span",{},error?String(error.message??error):"Check that the Standard application-data directory is writable.")))}');
        }
        if (sourceMain.slice(method.start, method.end).includes(',`sm-recs`,this.recordBlock')) {
          const old = sourceMain.slice(method.start, method.end);
          const at = old.indexOf('f(e.coop?j(`Clasificación cooperativa`):j(`Clasificación`),');
          const end = old.indexOf(',`sm-recs`,this.recordBlock', at);
          if (at < 0 || end < 0) throw new Error("Could not locate the end-of-run ranking panel.");
          add(main, method, old.slice(0, at) + 'f("Personal records","Saved on this device"' + old.slice(end));
        }
      }
    }
    if (declaration.id.name !== appClass) continue;
    for (const method of declaration.init.body.body) {
      if (method.key.name === "constructor") add(main,method,sourceMain.slice(method.start,method.end-1)+";globalThis.PokeBonkNativeApp=this}");
      if (method.key.name === "signedIn") add(main,method,`async signedIn(account){
        await this.meta.load(account);this.applySettings();
        const stored=await this.backend.savedOnServer();
        jv(account.id);Uv(account.id);
        if(stored){const blob=await this.backend.downloadSave(account,stored.id);if(blob){
          const kept=await Nv(account.id,blob.ticket,blob.text);if(!kept)throw new Error("Could not restore the preserved run checkpoint.");
        }}
        Nl(this);
        if(this.saved())await this.offerSaved("visit");
      }`);
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
  if(!n.starter){zw(e);return}
  if(!n.starterJ&&zc.every(Xt)){zw(e,true);return}
  e.menuScene?.setBiome(n.lastBiome);e.menuScene?.setView("main");Yx(null);
  const buttons=[];
  const item=(cls,icon,title,sub,color,fn)=>{
    const node=q("button",{class:"mm-item "+cls,style:{"--c":color},onclick:()=>{W.click();fn()}},
      q("span",{class:"mm-ic"},icon),q("span",{class:"mm-tx"},q("b",{},title),q("small",{},sub)));
    buttons.push(node);return node;
  };
  const saved=e.saved();
  const play=saved?item("play",K("poke-ball"),"Continue saved game","Saved on this device","var(--red)",()=>e.offerSaved("menu")):
    item("play",K("poke-ball"),"Play","Classic single-player · local progress","var(--red)",()=>mT(e));
  play.append(q("span",{class:"mm-partner"},J(n.lastSpecies)));
  const modes=q("div",{class:"mm-modes"},play,
    item("endless",K("moon-stone"),"Endless","Survive as long as you can","#5a4cd8",()=>mT(e,"endless")),
    item("relay",K("exp-share"),"Relay","Recruit and swap members of your League","#e0306a",()=>mT(e,"relay")));
  const tiles=q("div",{class:"mm-tiles"},
    item("tile",K("ultra-ball"),"Pokédex",String(n.seen.length)+" seen","var(--blue)",()=>OT(e)),
    item("tile",K("rare-candy"),"Laboratory",U(n.stardust)+" Stardust","var(--purple)",()=>VT(e)),
    item("tile",K("star-piece"),"Achievements",String(Object.keys(n.quests).length)+" claimed","var(--orange)",()=>XT(e)),
    item("tile",K("great-ball"),"Tasks","Daily and weekly local challenges","#d99b16",()=>YT(e)),
    item("tile",K("tm-case"),"Builds","Plan your Pokémon builds","#1fb7a6",()=>jm(e)),
    item("tile",Z("record",32),"Personal records","Only your results on this device","#7562c6",()=>globalThis.PokeBonkOfflineUI.records(e)));
  const trainer=q("div",{class:"trainer"},
    q("button",{class:"tr-av",title:"Appearance",onclick:()=>CE(e,()=>Lw(e))},Y(n.avatar,n.frame,n.lastSpecies,44,n.skins)),
    q("div",{class:"tr-tx"},q("b",{},n.name),q("small",{},"Local player")),
    q("div",{class:"tr-cur"},q("span",{class:"currency"},Z("stardust",24),U(n.stardust)),q("span",{class:"currency bonk"},Z("bonk",24),U(n.bonk??0))),
    q("button",{class:"btn small ghost offline-local-button",onclick:()=>globalThis.PokeBonkOfflineUI.profile(e)},"Player & saves"));
  const small=q("div",{class:"mm-small"},
    item("mini",K("metronome"),"Settings","","var(--ink-2)",()=>PE(e)),
    item("mini",Z("target",26),"Practice","","#397dc9",()=>mT(e,"training")),
    item("mini",Z("idea",26),"Controls","","var(--yellow-d)",()=>globalThis.PokeBonkOfflineUI.controls(e)));
  UC(e,"mm offline-menu",q("div",{class:"mm-top"},ph(),q("span",{class:"offline-label"},"OFFLINE · LOCAL SAVES"),ge()?Pw():null,FC(e),WT(e),trainer),
    q("div",{class:"mm-left"},XC("hero"),q("nav",{class:"mm-nav"},modes,tiles,small)),
    q("div",{class:"mm-foot"},q("span",{},"Unofficial fan game · no online accounts or services"),
      q("button",{class:"btn small ghost",onclick:()=>RE(e)},"Credits")));
  let selected=0;
  const focus=()=>buttons.forEach((node,index)=>node.classList.toggle("focus",index===selected));
  focus();WC(event=>{
    if(["ArrowDown","ArrowRight"].includes(event.key)){selected=(selected+1)%buttons.length;focus();event.preventDefault()}
    else if(["ArrowUp","ArrowLeft"].includes(event.key)){selected=(selected+buttons.length-1)%buttons.length;focus();event.preventDefault()}
    else if(event.key==="Enter"||event.key===" "){buttons[selected].click();event.preventDefault()}
  });
}`;

const sourceMenus = get(menus);
// Resolve UI entry points by their DOM/content contracts. The replacement
// templates below use reviewed 0.10.20 bindings, translated to discovered names.
// Unknown or ambiguous shapes fail BEFORE touching the previous built payload.
const menuTree = parse(sourceMenus);
const declarations = menuTree.body.filter(n=>n.type==="FunctionDeclaration");
const roleActual = new Map();
for(const [role, marker] of Object.entries({
  Lw:"mm-tiles", Bb:"logo-ver", XC:"logo-com", Pw:"lang-btn fs-btn", SE:"bd-mons scroll", bE:"lb-list",
  jE:"pf-body scroll", dg:"fb-kinds", OC:"g-stage", LE:"st-range", jm:"bd-rents",
  mT:"ls-grid scroll", xT:"rg-regions", XT:"q-wrap scroll", dm:"Build de {mon} de {name}", CE:"lk-grid scroll",
  Ng:"Hay una versión nueva de la app de PokéBonk", M_:"cp-lineup", Uy:"No se pudieron cargar los clanes",
  Pb:"ml-wrap scroll", Sw:"seg auth-tabs", Nw:"Guardar premios y", Uw:"auth-beta", bp:"dk-strip",
  sC:".season-modal, .wipe", gg:"./version.json?t=",
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
    source = source.slice(0, change.node.start - node.start) + change.text + source.slice(change.node.end - node.start);
  }
  add(menus, node, source);
}
const disabled = new Set(["bg", "gg", "yg", "Ng", "Fg", "Nw", "sC", "Pb", "Uy", "M_", "P_", "Sw", "Uw", "bp"]);
for (const node of parse(sourceMenus).body) {
  if (node.type !== "FunctionDeclaration") continue;
  const name = canonicalRole.get(node.id.name) ?? node.id.name;
  if (name === "Lw") add(menus, node, offlineMenu);
  else if (name === "Pw") add(menus, node, `function ${node.id.name}(){return globalThis.PokeBonkOfflineUI.fullscreenButton()}`);
  else if (name === "Bb") add(menus, node, 'function Bb(){return q("span",{class:"logo-ver offline-version"},"Offline edition")}');
  else if (name === "XC") {
    const replacements = [];
    walk(node, child => {
      if (child.type === "CallExpression" && child.callee.name === "q" &&
          child.arguments[1]?.properties?.some(p => p.key.name === "class" && textValue(p.value) === "logo-com")) {
        replacements.push({ node: child, text: "null" });
      }
    });
    rewriteFunction(node, replacements);
  }
  else if (name === "SE" || name === "bE") add(menus, node, `function ${name}(e){return globalThis.PokeBonkOfflineUI.records(e)}`);
  else if (name === "jE") add(menus, node, "function jE(e){return globalThis.PokeBonkOfflineUI.profile(e)}");
  else if (name === "dg") add(menus, node, "function dg(e){return globalThis.PokeBonkOfflineUI.unavailable(e)}");
  else if (name === "OC") add(menus, node, 'function OC(meta,options={}){dc(meta,"gd");return globalThis.PokeBonkOfflineUI.controls(options)}');
  else if (name === "LE") {
    const replacements = [];
    walk(node, child => {
      if (child.type === "CallExpression" && (
        child.arguments.some(arg => ["mateFx", "showLadder", "teamChat"].includes(textValue(arg))) ||
        child.callee.name === "y" && ["use", "treasure"].includes(textValue(child.arguments[0])) ||
        ["p", "_", "m"].includes(child.callee.name) && child.arguments.length === 0
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
    });
    rewriteFunction(node, replacements);
  }
  else if (name === "jm") {
    const replacements = [];
    walk(node, child => {
      if (child.type === "VariableDeclarator" && child.id.name === "g" &&
          sourceMenus.slice(child.init.start, child.init.start + 30).startsWith("()=>{if(G(m)")) {
        replacements.push({ node: child.init, text: "()=>{}" });
      }
      if (child.type === "VariableDeclarator" && child.id.name === "O" &&
          sourceMenus.slice(child.init.start, child.init.start + 40).startsWith("()=>G(E).append")) {
        replacements.push({ node: child.init, text: "()=>G(E)" });
      }
      if (child.type === "Property" && child.key.name === "rent") {
        replacements.push({ node: child.value, text: "null" });
      }
      if (child.type === "CallExpression" && child.callee.name === "Vo" &&
          child.arguments[0]?.arguments?.[1]?.properties?.some(p =>
            p.key.name === "class" && sourceMenus.slice(p.value.start, p.value.end).includes("bs-priv"))) {
        replacements.push({ node: child, text: "null" });
      }
      if (textValue(child) === "Buscar Pokémon o creador…") {
        replacements.push({ node: child, text: '"Search Pokémon…"' });
      }
    });
    rewriteFunction(node, replacements);
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
      if (child.type === "CallExpression" && child.callee.name === "q") {
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
    const old = sourceMenus.slice(node.start, node.end);
    if (!old.includes("d&&d!==s.id?")) throw new Error("Could not locate the build-author lookup.");
    add(menus, node, old.replace("d&&d!==s.id?", 'e.backend.kind==="http"&&d&&d!==s.id?'));
  }
  else if (name === "CE") {
    const replacements = [];
    const unavailableCatalogs = new Set(["cn", "$i", "Aa", "la", "ro", "$n", "Pa", "Sa"]);
    walk(node, child => {
      if (child.type === "Identifier") {
        if (unavailableCatalogs.has(child.name)) replacements.push({ node: child, text: "[]" });
        else if (child.name === "Mi") replacements.push({ node: child, text: "Mi.filter(item=>item.free||item.research||item.quest)" });
        else if (child.name === "ya") replacements.push({ node: child, text: 'ya.filter(item=>item.star||item.id==="bg:allcaught")' });
        else if (child.name === "ja") replacements.push({ node: child, text: "ja.filter(item=>item.star||item.treasure||item.quest)" });
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
    add(menus, node, `${node.async ? "async " : ""}function ${name}(){return null}`);
  }
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
for (const file of names.filter(name => name.endsWith(".js"))) {
  let source = get(file);
  for (const change of (edits.get(file) ?? []).sort((a, b) => b.start - a.start)) source = source.slice(0, change.start) + change.text + source.slice(change.end);
  if(file===menus){
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
  source = withoutExternalDestinations(source);
  if (file === main) {
    source = `import * as __OFFLINE_RULES__ from "./${rules}";import * as __OFFLINE_CONFIG__ from "./${config}";import * as __OFFLINE_COSMETICS__ from "./${cosmetics}";const __STANDARD_MANUAL__=new Map();\n` + source;
  }
  parse(source);
  if(file===boot)source=patchNativeOriginGate(source).replaceAll("pokebonk://game/","pokebonk-standard://game/");
  output.set("assets/"+file,Buffer.from(source));
  if (source !== get(file)) changed.push(file);
}

return {files:output, modules:{main,boot,menus,rules,config,cosmetics,training},changed};
}
