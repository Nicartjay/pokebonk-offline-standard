import test from "node:test";
import assert from "node:assert/strict";
import {endsLanSessionForNavigation} from "../desktop/protocol.mjs";

test("room-to-Lab history changes and subframe loading do not end the native room",()=>{
  assert.equal(endsLanSessionForNavigation({isMainFrame:true,isSameDocument:true}),false);
  assert.equal(endsLanSessionForNavigation({isMainFrame:false,isSameDocument:false}),false);
  assert.equal(endsLanSessionForNavigation({}),false);
});
test("actual main-document reloads still end the room and preserve the unfinished run",()=>{
  assert.equal(endsLanSessionForNavigation({isMainFrame:true,isSameDocument:false}),true);
});
test("the legacy Electron navigation signature preserves the same distinction",()=>{
  assert.equal(endsLanSessionForNavigation({},true,true),false);
  assert.equal(endsLanSessionForNavigation({},false,false),false);
  assert.equal(endsLanSessionForNavigation({},false,true),true);
  assert.equal(endsLanSessionForNavigation({isMainFrame:true,isSameDocument:true},false,true),false);
});
