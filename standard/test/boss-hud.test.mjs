import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {ast, nodesOf, one, maybeName, edits} from "../../scripts/source.ts";
import {coopBossHudEdits} from "../adapters/boss-hud.mjs";
import {syncCoopBossHud} from "../runtime/boss-hud.js";

const contract = `class RenamedHUD {
  miniBars(world,elapsed,mainAlive){
    this.minisEl.classList.toggle("below",mainAlive);
    this.hudEl.style.setProperty("--bbb","old");
    this.minisEl.style.setProperty("--bbh","old");
    this.hudEl.style.setProperty("--djt","old");
    this.minis.forEach(row=>{row.updated=true;});
  }
  hud(world){this.miniBars(world,0,false);}
  fitTop(){}
  hpText(hp,fraction){return this.bossPct?fraction+"%":hp;}
}`;
test("structural hook runs after original row updates without replacing any method", () => {
  const next = edits(contract, coopBossHudEdits(contract, ast(contract)));
  let calls = 0;
  const prototype = vm.runInNewContext(`(${next}).prototype`, {PokeBonkOfflineUI:{
    syncCoopBossHud(hud, run){calls++;assert.equal(hud.minis[0].updated,true);assert.equal(run.marker,42);},
  }});
  const hud = Object.assign(Object.create(prototype), {minis:[{}],minisEl:{
    classList:{toggle(){}},style:{setProperty(){}},
  },hudEl:{style:{setProperty(){}}}});
  const original = hud.miniBars;
  hud.hud({marker:42});
  assert.equal(calls,1);
  assert.equal(hud.miniBars,original);
  assert.throws(() => coopBossHudEdits(next, ast(next)), /contract/);
});
test("changed, ambiguous or incomplete HUD structures fail closed", () => {
  for (const changed of [
    contract.replace('"--bbb"','"--other"'),
    contract.replace('this.minis.forEach','this.unrelated.forEach'),
    contract.replace('row.updated=true;});','row.updated=true;});return;'),
    contract.replace('miniBars(world,elapsed,mainAlive)', 'miniBars({world},elapsed,mainAlive)'),
    contract + contract.replaceAll("RenamedHUD","DuplicateHUD"),
  ]) assert.throws(() => coopBossHudEdits(changed, ast(changed)), /boss|HUD|upstream/);
});
test("accepted upstream keeps every original HUD statement, HP child index and its four display slots", async () => {
  const root=JSON.parse(await readFile("standard/accepted.json","utf8")).snapshot;
  const manifest=JSON.parse(await readFile(root+"/snapshot.json","utf8"));
  const sources=await Promise.all(manifest.files.filter(file=>
    file.name.startsWith("assets/main-")&&file.name.endsWith(".js"))
    .map(file=>readFile(root+"/game/"+file.name,"utf8")));
  const source=one(sources.filter(value=>value.includes("async signedIn(")&&value.includes("fpsCap()")),
    "accepted lifecycle");
  const tree=ast(source), changes=coopBossHudEdits(source,tree);
  assert.equal(changes.length,1);
  assert.equal(changes[0].start,changes[0].end);
  const hud=one(nodesOf(tree,"ClassExpression",node=>node.body.body.some(method=>
    maybeName(method.key)==="miniBars")),"accepted HUD");
  const minis=one(hud.body.body.filter(method=>maybeName(method.key)==="miniBars"),"miniBars");
  assert.equal(changes[0].start,minis.value.body.end-1);
  const next=edits(source,changes);
  assert.equal(next.slice(0,changes[0].start),source.slice(0,changes[0].start));
  assert.equal(next.slice(changes[0].start+changes[0].text.length),source.slice(changes[0].start));
  assert.match(source.slice(minis.start,minis.end),/bar\.children\[2\]/);
  const constructor=hud.body.body.find(method=>maybeName(method.key)==="constructor");
  const factory=one(nodesOf(constructor,"ForStatement",node=>
    nodesOf(node,"CallExpression",call=>call.callee.type==="MemberExpression"&&
      maybeName(call.callee.property)==="push"&&
      maybeName(call.callee.object?.property)==="minis").length===1),"mini row factory");
  assert.equal(factory.test.right.value,3);
});

function fixture() {
  const metrics={bottom:220,height:90,rackReads:0,hostReads:0};
  const style = () => {
    const map=new Map();
    return {display:"",getPropertyValue:key=>map.get(key)??"",
      setProperty:(key,value)=>map.set(key,value),removeProperty:key=>map.delete(key)};
  };
  const doc={createElement:tag=>new Node(tag)};
  class Node {
    constructor(tag){
      this.tag=tag;this.ownerDocument=doc;this.children=[];this.parentNode=null;
      this.style=style();this.className="";this.hidden=false;this.textContent="";
      this.classList={
        contains:key=>this.className.split(" ").includes(key),
        toggle:(key,on)=>{
          const keys=new Set(this.className.split(" ").filter(Boolean));
          on?keys.add(key):keys.delete(key);this.className=[...keys].join(" ");
        },
      };
    }
    append(...nodes){
      for(const node of nodes){
        if(node.parentNode)node.parentNode.children.splice(node.parentNode.children.indexOf(node),1);
        this.children.push(node);node.parentNode=this;
      }
    }
    insertBefore(node,before){
      this.children.splice(this.children.indexOf(before),0,node);node.parentNode=this;
    }
    get offsetHeight(){return this.style.display==="none"?0:this.height??0;}
    getBoundingClientRect(){
      if(this.classList.contains("offline-boss-rack")){
        metrics.rackReads++;return {bottom:metrics.bottom,height:metrics.height};
      }
      if(this===host){metrics.hostReads++;return {top:20};}
      return {bottom:this.bottom,height:this.offsetHeight};
    }
  }
  const host=new Node("hud"),main=new Node("boss"),minis=new Node("minis");
  main.height=72;main.bottom=190;minis.height=160;minis.bottom=390;
  main.children=[{healthChildIndex:4},{shield:true},{phase:true}];
  const rows=Array.from({length:3},()=>({el:new Node("mini")}));
  for(const row of rows)minis.append(row.el);
  host.append(main,minis);
  const hud={els:{boss:main},minisEl:minis,hudEl:host,minis:rows,hs:1,
    fitKey:"initial",bossPct:false,barsLow:"",dojoLow:""};
  const show = (mainShown,miniCount) => {
    main.style.display=mainShown?"":"none";
    rows.forEach((row,index)=>{row.el.style.display=index<miniCount?"":"none";});
    minis.height=miniCount?160:0;
  };
  return {hud,host,main,minis,rows,metrics,show,rack:()=>host.children.find(node=>
    node.classList?.contains("offline-boss-rack"))};
}
test("solo and single-bar co-op are untouched; 1→4→1→0 transitions restore the original stack", () => {
  const f=fixture(),{hud,host,main,minis}=f,children=main.children;
  f.show(true,3);syncCoopBossHud(hud,{coop:null},0);
  assert.deepEqual(host.children,[main,minis]);
  assert.equal(host.style.getPropertyValue("--bbb"),"");
  f.show(true,0);syncCoopBossHud(hud,{coop:{}},1);
  assert.equal(f.rack(),undefined);
  f.show(true,3);syncCoopBossHud(hud,{coop:{},dojo:{}},2);
  const rack=f.rack();
  assert.equal(rack.classList.contains("is-compact"),true);
  assert.deepEqual(rack.children.slice(1),[main,minis]);
  assert.equal(rack.children[0].textContent,"BOSSES · 4");
  assert.equal(host.style.getPropertyValue("--bbb"),"206px");
  assert.equal(host.style.getPropertyValue("--djt"),"208px");
  assert.equal(hud.bossPct,false);assert.equal(main.children,children);
  assert.ok(f.rows.every(row=>minis.children.includes(row.el)));
  f.show(true,0);hud.hs=1.5;
  syncCoopBossHud(hud,{coop:{}},3);
  assert.equal(rack.classList.contains("is-compact"),false);
  assert.equal(host.style.getPropertyValue("--bbb"),"176px");
  assert.equal(host.style.getPropertyValue("--djt"),"");
  assert.equal(minis.style.getPropertyValue("--bbh"),"108px");
  assert.equal(hud.barsLow,"176px");
  f.show(false,2);syncCoopBossHud(hud,{coop:{}},4);
  assert.equal(rack.classList.contains("is-compact"),true);
  assert.equal(rack.children[0].textContent,"BOSSES · 2");
  f.show(false,0);syncCoopBossHud(hud,{coop:{}},5);
  assert.equal(rack.classList.contains("is-compact"),false);
  assert.equal(host.style.getPropertyValue("--bbb"),"");
  assert.equal(hud.barsLowT,0);assert.equal(hud.miniBelowT,0);assert.equal(hud.dojoLowT,0);
});
test("whole-rack reservations track scale/resize/status growth without layout reads every frame", () => {
  const f=fixture(),{hud,metrics,host}=f;
  f.show(true,3);syncCoopBossHud(hud,{coop:{},dojo:{}},0);
  assert.equal(metrics.rackReads,1);
  host.style.setProperty("--bbb","wrong upstream pre-update measurement");
  hud.barsLow="wrong";
  syncCoopBossHud(hud,{coop:{},dojo:{}},100);
  assert.equal(metrics.rackReads,1);
  assert.equal(host.style.getPropertyValue("--bbb"),"206px");
  metrics.bottom=260;hud.fitKey="resized";
  syncCoopBossHud(hud,{coop:{},dojo:{}},101);
  assert.equal(metrics.rackReads,2);
  assert.equal(host.style.getPropertyValue("--djt"),"248px");
  metrics.bottom=280;hud.hs=.8;
  syncCoopBossHud(hud,{coop:{},dojo:{}},102);
  assert.equal(metrics.rackReads,3);
  metrics.bottom=320; // Attack/status footer grows.
  syncCoopBossHud(hud,{coop:{}},351);
  assert.equal(metrics.rackReads,3);
  assert.equal(host.style.getPropertyValue("--djt"),"");
  syncCoopBossHud(hud,{coop:{}},352);
  assert.equal(metrics.rackReads,4);
  assert.equal(host.style.getPropertyValue("--bbb"),"306px");
  hud.bossPct=true;
  f.show(true,3);syncCoopBossHud(hud,{coop:null},353);
  assert.equal(f.rack().classList.contains("is-compact"),false);
  assert.equal(host.style.getPropertyValue("--bbb"),"376px");
  assert.equal(hud.bossPct,true);
});
test("production deliberately bundles only approved runtime/CSS, with no preview monkey-patch", async () => {
  const [runtime,css,prepare,ui,adapter]=await Promise.all([
    "standard/runtime/boss-hud.js","standard/runtime/boss-hud.css",
    "standard/scripts/prepare.mjs","standard/runtime/ui.js","standard/adapters/mwqb4pwz.mjs",
  ].map(name=>readFile(name,"utf8")));
  assert.match(prepare,/"boss-hud.js", "boss-hud.css"/);
  assert.match(prepare,/href="\/offline\/boss-hud.css"/);
  assert.match(ui,/import \{syncCoopBossHud\}/);
  assert.match(adapter,/coopBossHudEdits\(sourceMain,mainTree\)/);
  assert.doesNotMatch(runtime+prepare,/installCompactBossPreview|compact-boss-preview|miniBars\s*=/);
  assert.match(css,/repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/min\(440px,/);
  assert.match(css,/\.is-compact > \.minibars > \.bossbar \{ display:flex; \}/);
  assert.match(css,/\.bb-st \{[^}]*flex-wrap:wrap/);
  assert.match(css,/\.bb-seals \{[^}]*flex-wrap:wrap/);
  assert.match(css,/\.bb-sub\.move \{[^}]*white-space:normal/);
  assert.doesNotMatch(css,/overflow:\s*hidden|max-height:|\.bb-foot[^}]*display:none/);
});
