import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {androidTextDeclarations,androidTextRules,installAndroidTextOutlines,splitTextCSS} from "../runtime/android-text.js";

function style(values,priorities={}) {
  return {getPropertyValue:key=>values[key]??"",getPropertyPriority:key=>priorities[key]??""};
}
const rule=(selector,values)=>({type:1,selectorText:selector,style:style(values)});

test("CSS token splitting retains nested functions, selector lists and quoted attributes",()=>{
  assert.deepEqual(splitTextCSS(".a:is(.b,.c),.d[data-label=\",\"]"),[".a:is(.b,.c)",'.d[data-label=","]']);
  assert.deepEqual(splitTextCSS("calc(var(--s) * .07) color-mix(in srgb, var(--c) 35%, #120a28)"," "),
    ["calc(var(--s) * .07)","color-mix(in srgb, var(--c) 35%, #120a28)"]);
});

test("variable-containing strokes become behind-fill shadows without changing text fill or metrics",()=>{
  const css=androidTextDeclarations(style({
    "-webkit-text-stroke":".14em var(--dk)","text-shadow":"0 .09em 0 var(--dk)"
  }));
  assert.match(css,/--standard-text-outline-size:\.14em/);
  assert.match(css,/--standard-text-outline-color:var\(--dk\)/);
  assert.match(css,/--standard-text-original-shadow:0 \.09em 0 var\(--dk\)/);
  assert.match(css,/-webkit-text-stroke:0 transparent!important/);
  assert.match(css,/text-shadow:calc\(var\(--standard-text-outline-size,0px\) \* -0\.353553\)/);
  assert.doesNotMatch(css,/(?:^|;)(?:color|font[^:]*|-webkit-text-fill-color|width|height|padding|margin):/);
  assert.doesNotMatch(css,/paint-order/);
});

test("combat popups retain their colored fill and original white outline color",()=>{
  const css=androidTextDeclarations(style({"-webkit-text-stroke-width":"4px","-webkit-text-stroke-color":"rgba(255, 255, 255, 0.95)"}));
  assert.match(css,/--standard-text-outline-size:4px/);
  assert.match(css,/--standard-text-outline-color:rgba\(255, 255, 255, 0.95\)/);
  assert.doesNotMatch(css,/(?:^|;)color:|-webkit-text-fill-color/);
});

test("responsive width-only rules inherit the existing outline color and preserve their drop-shadow changes",()=>{
  const css=androidTextDeclarations(style({"-webkit-text-stroke-width":"4px","text-shadow":"0 3px 0 var(--deep)"}));
  assert.match(css,/--standard-text-outline-size:4px/);
  assert.doesNotMatch(css,/--standard-text-outline-color:/);
  assert.match(css,/--standard-text-original-shadow:0 3px 0 var\(--deep\)/);
});

test("zero-stroke shine layers stay transparent and ordinary text gains no outline",()=>{
  const shine=androidTextDeclarations(style({"-webkit-text-stroke":"0","text-shadow":"none"}));
  assert.match(shine,/-webkit-text-stroke:0 transparent!important/);
  assert.doesNotMatch(shine,/text-shadow:calc|-webkit-text-fill-color|(?:^|;)color:/);
  const ordinary=androidTextDeclarations(style({"text-shadow":"0 2px #0006"}));
  assert.equal(ordinary,"--standard-text-original-shadow:0 2px #0006");
  assert.equal(androidTextDeclarations(style({color:"white"})),"");
});

test("fallback rules remain Android-only and retain media/supports conditions, not keyframe selectors",()=>{
  const css=androidTextRules([
    rule(".dm-id h1,.dmv-id h1",{"-webkit-text-stroke":"3px var(--dk)"}),
    {type:4,cssText:"@media (max-height: 560px) {}",cssRules:[
      {type:12,cssText:"@supports (display: grid) {}",cssRules:[
        rule(".mu-name",{"-webkit-text-stroke-width":"4px"})
      ]}
    ]},
    {type:7,cssText:"@keyframes hop {}",cssRules:[rule("from",{"text-shadow":"none"})]},
  ]);
  assert.match(css,/:root\[data-standard-platform="android"\] \.dm-id h1/);
  assert.match(css,/:root\[data-standard-platform="android"\] \.dmv-id h1/);
  assert.match(css,/@media \(max-height: 560px\)\s*\{@supports \(display: grid\)\s*\{/);
  assert.doesNotMatch(css,/keyframes|\] from/);
});

test("all 63 accepted upstream stroke declarations, including Pokédex+, popups and later event/Relay CSS, are convertible",async()=>{
  const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
  const snapshot=JSON.parse(await readFile(accepted.snapshot+"/snapshot.json","utf8"));
  const selectors=new Set();let count=0;
  for(const entry of snapshot.files.filter(entry=>entry.name.endsWith(".css"))){
    const source=await readFile(accepted.snapshot+"/game/"+entry.name,"utf8");
    for(const match of source.matchAll(/([^{}]+)\{([^{}]*)\}/g)){
      const values=Object.fromEntries(match[2].split(";").filter(value=>value.includes(":"))
        .map(value=>[value.slice(0,value.indexOf(":")).trim(),value.slice(value.indexOf(":")+1).trim()]));
      if(!Object.keys(values).some(key=>/^(-webkit-)?text-stroke/.test(key)))continue;
      const css=androidTextDeclarations(style(values));count++;
      assert.match(css,/-webkit-text-stroke:0 transparent!important/,entry.name+":"+match[1]);
      for(const selector of splitTextCSS(match[1]))selectors.add(selector);
    }
  }
  assert.equal(count,63,"Review coverage when upstream adds or changes outlined text.");
  for(const selector of [".dm-id h1",".dmv-id h1",".popup",".floater",".streak b",".rc-tx b",
    ".rr-pace-tx b",".exp5-badge b",".exb-pod-step span",".screen.exb .exr5-head h2"])
    assert.ok(selectors.has(selector),selector);
});

test("desktop and ordinary browsers never inspect or change stylesheets",()=>{
  for(const win of [{},{PokeBonkStandard:{}},{PokeBonkStandard:{},PokeBonkStandardAndroid:{}}]){
    assert.equal(installAndroidTextOutlines({window:win,document:{
      createElement(){throw Error("Non-Android CSS must not be inspected.");}
    }}),null);
  }
});

test("lazy packaged styles compile once, retry unloaded CSS, preserve exceptions, and install no per-frame observer",()=>{
  const events=new Map(),output={dataset:{},textContent:"",remove(){this.removed=true;}};
  const exceptions={};
  let reads=0,ready=false,remoteReads=0;
  const base={href:"https://appassets.androidplatform.net/assets/main.css",cssRules:[
    rule(".popup",{"-webkit-text-stroke":"4px #fff"})
  ]};
  const lazy={href:"https://appassets.androidplatform.net/assets/menus.css",
    get cssRules(){reads++;if(!ready)return null;return [rule(".dmv-id h1",{"-webkit-text-stroke":".13em var(--dk)"})];}};
  const remote={href:"https://example.invalid/assets/third-party.css",
    get cssRules(){remoteReads++;throw Error("Cross-origin styles must not be read.");}};
  const doc={styleSheets:[base,lazy,remote],createElement:()=>output,
    head:{querySelector:()=>exceptions,insertBefore(node,before){assert.equal(node,output);assert.equal(before,exceptions);}},
    addEventListener(name,fn,capture){assert.equal(capture,true);events.set(name,fn);},
    removeEventListener(name,fn,capture){assert.equal(events.get(name),fn);assert.equal(capture,true);events.delete(name);}};
  const win={PokeBonkStandardAndroid:{},location:{href:"https://appassets.androidplatform.net/index.html"},
    requestAnimationFrame(){throw Error("Text compatibility must not run every frame.");},
    MutationObserver:class {constructor(){throw Error("No gameplay DOM observer is needed.");}}};
  const dispose=installAndroidTextOutlines({window:win,document:doc});
  assert.match(output.textContent,/\.popup/);assert.doesNotMatch(output.textContent,/\.dmv-id/);
  ready=true;events.get("load")({target:{tagName:"LINK",rel:"stylesheet",sheet:lazy}});
  assert.match(output.textContent,/\.dmv-id h1/);
  const loadedReads=reads;
  events.get("load")({target:{tagName:"LINK",rel:"modulepreload"}});
  assert.equal(reads,loadedReads);assert.equal(remoteReads,0);
  dispose();assert.equal(output.removed,true);assert.equal(events.size,0);
});
