import test from "node:test";
import assert from "node:assert/strict";
import {installLanUI} from "../runtime/lan-ui.js";
import {COOP_CONNECTION_MODES} from "../common/coop-mode.mjs";

test("invitations show the selected connection as text, never a disabled dropdown or waiting subtitle",()=>{
  const previous=globalThis.document;
  const document=new EventTarget();
  document.createElement=()=>assert.fail("The fixed connection must not create a dropdown.");
  globalThis.document=document;
  const el=(tag,text,cls)=>({
    tag,text,cls,children:[],dataset:{},attributes:new Map(),
    style:{setProperty(){}},
    setAttribute(name,value){this.attributes.set(name,value);},
    append(...children){this.children.push(...children);},
  });
  try{
    const api={};installLanUI(api,{}, {el});
    for(const mode of COOP_CONNECTION_MODES){
      for(const transport of ["waiting","connecting","lan","stun","turn"]){
        const fields=api.lanInvitation({connectionMode:mode.value,transport,
          code:mode.value==="lan"?"BONK":"BONK23"});
        const label=fields.children[0];
        assert.equal(label.tag,"b");
        assert.equal(label.text,mode.title);
        assert.equal(label.cls,"offline-lan-connection");
        assert.equal(label.attributes.get("aria-label"),"Connection: "+mode.title);
        assert.equal(label.attributes.has("aria-haspopup"),false);
        assert.equal(label.attributes.has("aria-disabled"),false);
        assert.deepEqual(label.children,[]);
        assert.equal(fields.children[1].text,"Share this room code");
      }
    }
  }finally{globalThis.document=previous;}
});
