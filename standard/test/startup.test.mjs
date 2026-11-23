import test from "node:test";
import assert from "node:assert/strict";
import {waitForStartupMusic} from "../runtime/startup.js";
import {installOfflineUI} from "../runtime/ui.js";
import {validateState} from "../common/state.mjs";
import {state} from "./fixtures.mjs";

function musicFixture(settings={}) {
  const tags=[],notices=[],calls=[],children=[];
  const label={textContent:"Loading"};
  const loading={querySelector:()=>label,append:node=>children.push(node)};
  const doc={querySelector:()=>loading,createElement(tag){
    tags.push(tag); return {setAttribute(){},remove(){children.pop();},textContent:""};
  }};
  const app={meta:{profile:{settings:{master:.8,music:.5,...settings}}},applySettings(){calls.push("settings");},
    notice:message=>notices.push(message)};
  const audio={running:true,track:null,trackWant:null,trackGaveUp:new Set(),init(){calls.push("init");},
    playTrack(name){calls.push("play");this.trackWant=name;},stopTrack(){calls.push("stop");this.track=null;}};
  return {doc,app,audio,tags,notices,calls,children,label};
}
test("music-ready gate uses the actual decoded source and never creates a continue button", async () => {
  const f=musicFixture();
  f.audio.playTrack=function(name){f.calls.push("play");this.track={name,src:{buffer:{duration:90}}};};
  assert.equal(await waitForStartupMusic(f.app,f.audio,"menu",{document:f.doc}),"ready");
  assert.deepEqual(f.calls,["init","settings","play"]); assert.deepEqual(f.tags,["p"]);
  assert.equal(f.children.length,0); assert.equal(f.notices.length,0);
});
test("suspended autoplay does not hold up already-decoded BGM", async () => {
  const f=musicFixture(); f.audio.running=false;
  f.audio.playTrack=function(name){this.track={name,src:{buffer:{}}};};
  assert.equal(await waitForStartupMusic(f.app,f.audio,"johto-menu",{document:f.doc}),"ready");
  assert.match(f.notices[0],/loaded.*enable sound/);
});
test("muted music/master skips audio initialization and preserves the saved volumes", async () => {
  for(const settings of [{music:0},{master:0}]) {
    const f=musicFixture(settings);
    assert.equal(await waitForStartupMusic(f.app,f.audio,"menu",{document:f.doc}),"muted");
    assert.deepEqual(f.calls,[]); assert.deepEqual(f.app.meta.profile.settings,{master:.8,music:.5,...settings});
    assert.equal(f.children.length,0);
  }
});
test("unavailable audio continues automatically at twelve seconds with no user action", async t => {
  t.mock.timers.enable({apis:["setTimeout","setInterval"]});
  const f=musicFixture();
  const pending=waitForStartupMusic(f.app,f.audio,"menu",{document:f.doc});
  t.mock.timers.tick(11999); assert.equal(f.calls.includes("stop"),false);
  t.mock.timers.tick(1); assert.equal(await pending,"unavailable");
  assert.equal(f.audio.trackWant,null); assert.equal(f.calls.at(-1),"stop");
  assert.match(f.notices[0],/Continuing automatically/); assert.equal(f.tags.includes("button"),false);
});
test("audio decode failure fails forward without replacing or mutating progression", async t => {
  const f=musicFixture(); f.audio.trackGaveUp.add("menu");
  assert.equal(await waitForStartupMusic(f.app,f.audio,"menu",{document:f.doc,intervalMs:1,timeoutMs:100}),"unavailable");
  assert.equal(f.audio.trackWant,null);
});
test("first-guide marker is optional/additive, but unknown marker formats are not silently reset", () => {
  const value=state(); assert.equal(validateState(value),value);
  value.onboarding={trainerGuide:1}; assert.equal(validateState(value),value);
  for(const marker of [true,"1",2,null]) {
    value.onboarding={trainerGuide:marker};
    assert.throws(()=>validateState(value),/first-use guide/);
    value.onboarding={playerName:marker};
    assert.throws(()=>validateState(value),/player-name/);
  }
  value.onboarding={trainerGuide:1,playerName:1}; assert.equal(validateState(value),value);
});
test("first-use Guide waits for the homepage, opens once after 1.2 seconds and avoids active/preserved runs", async t => {
  const original=Object.fromEntries(["window","document","addEventListener"].map(key=>[key,globalThis[key]]));
  t.after(()=>{for(const [key,value]of Object.entries(original)) if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
  t.mock.timers.enable({apis:["setTimeout"]});
  globalThis.window={};
  let blocked=false, manualGuide=false;
  globalThis.document={documentElement:{dataset:{}},querySelector:selector=>selector===".pb-guide"?manualGuide:blocked};
  globalThis.addEventListener=()=>{};
  installOfflineUI({});
  const ui=window.PokeBonkOfflineUI; let opens=0,claims=0;
  const screen=(home=true)=>({isConnected:true,matches:selector=>home&&selector===".offline-menu"});
  const fixture=()=>({screenEl:screen(),backend:{state:{profile:{}},async claimFirstGuide(){
    claims++; this.state.onboarding={trainerGuide:1};}},notice(){}});
  const starter=fixture(); starter.screenEl=screen(false);
  ui.firstVisit(starter,()=>opens++); t.mock.timers.tick(5000);
  assert.equal(opens,0); assert.equal(claims,0);
  const app=fixture();
  ui.firstVisit(app,()=>opens++); ui.firstVisit(app,()=>opens++);
  t.mock.timers.tick(1199); assert.equal(opens,0);
  t.mock.timers.tick(1); await Promise.resolve();
  assert.equal(opens,1); assert.equal(claims,1);
  ui.firstVisit(app,()=>opens++); t.mock.timers.tick(5000); assert.equal(opens,1);
  for(const kind of ["run","activeRun","suspended"]) {
    const other=fixture();
    if(kind==="run")other.run={}; else other.backend.state[kind]={};
    ui.firstVisit(other,()=>opens++); t.mock.timers.tick(1500);
    assert.equal(opens,1);
  }
  const changed=fixture();
  ui.firstVisit(changed,()=>opens++); changed.screenEl.isConnected=false;
  t.mock.timers.tick(1200); assert.equal(opens,1); assert.equal(claims,1);
  // Returning before the previous timer fires must still schedule this home.
  const returning=fixture();
  ui.firstVisit(returning,()=>opens++);
  returning.screenEl.isConnected=false; returning.screenEl=screen();
  ui.firstVisit(returning,()=>opens++); t.mock.timers.tick(1200); await Promise.resolve();
  assert.equal(opens,2); assert.equal(claims,2);
  const dialog=fixture(); blocked=true;
  ui.firstVisit(dialog,()=>opens++); t.mock.timers.tick(1200);
  assert.equal(opens,2); blocked=false; t.mock.timers.tick(500); await Promise.resolve();
  assert.equal(opens,3); assert.equal(claims,3);
  const interrupted=fixture();
  ui.firstVisit(interrupted,()=>opens++); interrupted.run={};
  t.mock.timers.tick(1200); assert.equal(opens,3); assert.equal(claims,3);
  const manual=fixture(); manualGuide=true;
  ui.firstVisit(manual,()=>opens++); t.mock.timers.tick(1200); await Promise.resolve();
  assert.equal(opens,3); assert.equal(claims,4);
});
test("initial name setup follows guide dismissal, never covers it and preserves existing custom names", async t => {
  const original=Object.fromEntries(["window","document","addEventListener"].map(key=>[key,globalThis[key]]));
  t.after(()=>{for(const [key,value]of Object.entries(original)) if(value===undefined)delete globalThis[key];else globalThis[key]=value;});
  t.mock.timers.enable({apis:["setTimeout"]});
  let guideVisible=false, names=0, endGuide;
  const element=()=>({classList:{add(){}},append(){},addEventListener(){},focus(){},remove(){},
    querySelector:()=>({textContent:""}),setAttribute(key,value){
      if(key==="aria-label"&&value==="Choose your player name")names++;
    }});
  globalThis.window={};
  globalThis.document={documentElement:{dataset:{}},body:{append(){}},createElement:element,
    addEventListener(){},removeEventListener(){},querySelector:selector=>selector.includes(".pb-guide")&&guideVisible};
  globalThis.addEventListener=()=>{};
  installOfflineUI({});
  const ui=window.PokeBonkOfflineUI;
  const fixture=(name="Player")=>({screenEl:{isConnected:true,matches:()=>true},
    backend:{state:{profile:{name}},async claimFirstGuide(){this.state.onboarding={trainerGuide:1};}},notice(){}});
  const open=options=>{guideVisible=true;endGuide=options.onEnd;};
  const app=fixture();
  ui.firstVisit(app,open);t.mock.timers.tick(1200);await Promise.resolve();
  assert.equal(guideVisible,true); assert.equal(names,0);
  t.mock.timers.tick(5000); assert.equal(names,0);
  endGuide(); t.mock.timers.tick(240); assert.equal(names,0,"The exiting guide must not be covered.");
  guideVisible=false;t.mock.timers.tick(500);assert.equal(names,1);
  const named=fixture("Existing Trainer"); named.backend.state.onboarding={trainerGuide:1};
  ui.firstVisit(named,open);t.mock.timers.tick(2000);assert.equal(names,1);
  const completed=fixture();completed.backend.state.onboarding={trainerGuide:1,playerName:1};
  ui.firstVisit(completed,open);t.mock.timers.tick(2000);assert.equal(names,1);
  const interrupted=fixture();interrupted.backend.state.onboarding={trainerGuide:1};
  ui.firstVisit(interrupted,open);interrupted.run={};t.mock.timers.tick(1200);assert.equal(names,1);
});
