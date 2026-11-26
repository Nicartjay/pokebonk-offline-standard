import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";

const source=await readFile(new URL("../desktop/preload.cjs",import.meta.url),"utf8");
function fixture(){
  const handlers={document:new Map(),window:new Map()},ipc=new Map(),sent=[];
  let time=10000,serial=0,focused=true;
  const timers=new Map();
  const later=(fn,ms,interval=0)=>{const id=++serial;timers.set(id,{fn,at:time+ms,interval});return id;};
  const mic={isConnected:true,dataset:{standardVoiceAction:"toggle"},
    getAttribute:key=>key==="aria-disabled"?"false":key==="href"?"/__native__/voice/toggle":null,
    getBoundingClientRect:()=>({left:10,right:54,top:10,bottom:54}),setPointerCapture(){},
    closest:selector=>[".offline-voice-controls","a[data-standard-voice-action]",
      ".offline-voice-hud a.offline-voice-button"].includes(selector)?mic:null};
  const doc={activeElement:null,hasFocus:()=>focused,
    addEventListener(type,fn){const list=handlers.document.get(type)??[];list.push(fn);handlers.document.set(type,list);},
    dispatchEvent(){},querySelector:selector=>selector===".offline-voice-hud a.offline-voice-button"?mic:null};
  const context=vm.createContext({document:doc,structuredClone,Event,CustomEvent:class{},
    Date:class extends Date {static now(){return time;}},performance:{now:()=>time},
    setTimeout:(fn,ms)=>later(fn,ms),clearTimeout:id=>timers.delete(id),
    setInterval:(fn,ms)=>later(fn,ms,ms),clearInterval:id=>timers.delete(id),
    window:{addEventListener(type,fn){const list=handlers.window.get(type)??[];list.push(fn);handlers.window.set(type,list);}},
    require:()=>({contextBridge:{exposeInMainWorld(){}},ipcRenderer:{
      on:(name,fn)=>ipc.set(name,fn),send:(...args)=>sent.push(args)}})});
  vm.runInContext(source,context);
  ipc.get("standard:lan-event")({}, {type:"voice",value:{enabled:true,mode:"open",microphone:"ready"}});
  function fire(surface,name,extra={}){
    const event={isTrusted:true,button:0,pointerId:7,clientX:20,clientY:20,target:mic,
      preventDefault(){},stopImmediatePropagation(){},...extra};
    for(const fn of handlers[surface].get(name)??[])fn(event);
  }
  return {mic,doc,sent,fire,blur(){focused=false;fire("window","blur");},
    tick(ms){
      const end=time+ms;
      for(;;){
        const next=[...timers].filter(([,value])=>value.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
        if(!next)break;
        const[id,value]=next;time=value.at;
        if(value.interval)value.at+=value.interval;else timers.delete(id);
        value.fn();
      }
      time=end;
    }};
}

test("a short trusted tap toggles once and suppresses the following browser click",()=>{
  const f=fixture();
  f.fire("document","pointerdown");f.tick(100);f.fire("window","pointerup");
  f.fire("document","click");
  assert.deepEqual(f.sent,[["standard:voice-action","toggle"]]);
});

test("a long press uses native PTT, refreshes while held, and releases to mute without toggling",()=>{
  const f=fixture();
  f.fire("document","pointerdown");f.tick(280);
  assert.deepEqual(f.sent[0],["standard:voice-gesture","hold-start"]);
  assert.deepEqual(f.sent[1],["standard:voice-hold",true]);
  f.tick(200);f.fire("window","pointerup");f.fire("document","click");
  assert.deepEqual(f.sent.slice(-2),[["standard:voice-gesture","hold-end"],["standard:voice-hold",false]]);
  assert.ok(!f.sent.some(([channel])=>channel==="standard:voice-action"));
  const count=f.sent.length;f.tick(1000);assert.equal(f.sent.length,count);
});

test("synthetic gestures, another pointer and a cancelled tap cannot toggle the mic",()=>{
  const f=fixture();
  f.fire("document","pointerdown",{isTrusted:false});f.tick(300);f.fire("window","pointerup",{isTrusted:false});
  assert.equal(f.sent.length,0);
  f.fire("document","pointerdown");f.tick(100);
  f.fire("window","pointerup",{pointerId:8});assert.equal(f.sent.length,0);
  f.fire("window","pointercancel");assert.equal(f.sent.length,0);
  f.fire("document","pointerdown");f.tick(100);f.fire("window","pointerup",{clientX:1000});
  assert.equal(f.sent.length,0);
});

test("blur or detached controls stop a hold; keyboard PTT is immediate and ignores text entry",()=>{
  for(const cancel of ["blur","detach"]){
    const f=fixture();f.fire("document","pointerdown");f.tick(280);
    if(cancel==="blur")f.blur();else {f.mic.isConnected=false;f.tick(200);}
    assert.ok(f.sent.some(([channel,value])=>channel==="standard:voice-gesture"&&value==="hold-end"));
    assert.ok(!f.sent.some(([channel])=>channel==="standard:voice-action"));
  }
  const f=fixture();
  f.doc.activeElement={tagName:"INPUT"};f.fire("window","keydown",{code:"Backquote"});
  assert.equal(f.sent.length,0);
  f.doc.activeElement=null;f.fire("window","keydown",{code:"Backquote"});
  assert.deepEqual(f.sent[0],["standard:voice-gesture","hold-start"]);
  f.fire("window","keyup",{code:"Backquote"});
  assert.deepEqual(f.sent.slice(-2),[["standard:voice-gesture","hold-end"],["standard:voice-hold",false]]);
});

test("the game renderer has no callable voice capture bridge and native hosts cancel stale holds",async()=>{
  const exposed=[...source.matchAll(/exposeInMainWorld\("([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(exposed,["PokeBonkStandard","PokeBonkLAN"]);
  const main=await readFile(new URL("../desktop/main.mjs",import.meta.url),"utf8");
  assert.match(main,/hold&&!voiceHudHeld/);
  assert.match(main,/generation!==voicePermissionSerial/);
  assert.match(main,/lan\.voiceAction\("release"\);lan\.voiceAction\("mute"\)/);
  const android=await readFile(new URL("../android/app/src/main/java/dev/nicartjay/pokebonk/offline/standard/MainActivity.java",import.meta.url),"utf8");
  assert.match(android,/if\(id==voiceHudPointer\)finishHudVoice\(\)/);
  assert.match(android,/if\(!voicePointers\.get\(pointer\)\|\|!voiceUsable\(\)\)return/);
  assert.match(android,/pendingVoiceSerial!=voiceSerial/);
  assert.match(android,/pendingVoiceIsHold&&!voiceHudHeld/);
  assert.match(android,/releaseVoiceHold\(\);lan\.voiceAction\("mute"\)/);
});

test("mic color follows muted/open/PTT state without recoloring the room selectors",async()=>{
  const ui=await readFile(new URL("../runtime/voice-ui.js",import.meta.url),"utf8");
  const css=await readFile(new URL("../runtime/voice.css",import.meta.url),"utf8");
  assert.match(ui,/on=view\.mode==="open"\|\|live/);
  assert.match(ui,/mic\.classList\.toggle\("red",on\)/);
  assert.match(css,/\.offline-voice-button\.btn:not\(\.mic-open\)\s*\{\s*--c:#687080;\s*--cd:#484f5e;\s*--tc:#fff/);
  assert.match(ui,/btn red small offline-voice-hold/);
  assert.match(ui,/btn small ghost offline-voice-toggle/);
});
