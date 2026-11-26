// Authored for the next approved verification pass; no native/network access.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
const source=await readFile(new URL("../runtime/guard.js",import.meta.url),"utf8");
test("offline cleanup retains only the reviewed results-room action, not old website Co-op/account entries",()=>{
  let changed;
  const control=(text,{marked=false,footer=false}={})=>({
    textContent:text,dataset:marked?{standardCoopReturn:"true"}:{},removed:false,
    classList:{contains:()=>false},getAttribute:()=>null,
    closest:selector=>selector===".sm-foot"&&footer?{}:null,
    remove(){this.removed=true;}
  });
  const retained=control("Co-op",{marked:true,footer:true});
  const removed=[control("Co-op"),control("Cooperativo"),control("Co-op",{marked:true}),control("Sign in")];
  const menu=control("Menu"),buttons=[retained,...removed,menu];
  const sandbox={
    URL,location:new URL("https://appassets.androidplatform.net/index.html"),
    localStorage:{getItem:()=>null},matchMedia:()=>({matches:false}),
    fetch:async()=>{},XMLHttpRequest:class {open(){}},navigator:{},open(){},addEventListener(){},
    document:{
      documentElement:{dataset:{}},querySelector:()=>null,addEventListener(){},
      querySelectorAll:selector=>selector==="button"?buttons:[],
    },
    MutationObserver:class {constructor(callback){changed=callback;}observe(){}},
    queueMicrotask:callback=>callback(),
  };
  sandbox.window=sandbox;
  vm.runInNewContext(source,sandbox);changed();
  assert.equal(retained.removed,false);assert.equal(menu.removed,false);
  for(const button of removed)assert.equal(button.removed,true,button.textContent);
});
