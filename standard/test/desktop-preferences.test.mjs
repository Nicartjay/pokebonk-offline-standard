import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile, readdir, rm} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {EventEmitter} from "node:events";
import {DesktopPreferences, graphicsBackends, graphicsSwitches, parsePreferences,
  fitBounds, restoreBounds, resolutionBounds} from "../desktop/preferences.mjs";
import {createDesktopControls, parseDesktopAction} from "../desktop/desktop-controls.mjs";

async function directory(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pokebonk-desktop-test-"));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}
test("graphics choices are platform allowlists, with no unsafe Auto flags", () => {
  const expected = {darwin: ["auto","metal","gl"], win32: ["auto","d3d11","gl","vulkan"], linux: ["auto","gl","vulkan"]};
  for (const [platform, ids] of Object.entries(expected)) {
    assert.deepEqual(graphicsBackends(platform).map(item => item.id), ids);
    assert.deepEqual(graphicsSwitches("auto", platform), []);
    for (const id of ids.slice(1)) assert.equal(graphicsSwitches(id, platform)[0][0], "use-angle");
    for (const invalid of ["--no-sandbox", "ignore-gpu-blocklist", "d3d12", "swiftshader", "", "../metal"]) {
      assert.throws(() => graphicsSwitches(invalid, platform), /Unsupported/);
    }
  }
  assert.throws(() => graphicsSwitches("metal", "win32"), /Unsupported/);
  assert.throws(() => graphicsSwitches("vulkan", "darwin"), /Unsupported/);
});
test("native presentation operations reject URLs, arbitrary paths, keys and wrong-platform backends", () => {
  for (const [action, value] of [["monitor","9007199254740992"], ["monitor","1/../../"], ["resolution","99999x99999"],
    ["settings","https://example.invalid"], ["backend","metal"], ["awake","yes"], ["execute","rm"], ["restart","now"]]) {
    assert.equal(parseDesktopAction(action, value, "win32"), null);
  }
  assert.deepEqual(parseDesktopAction("monitor", "-123", "darwin"), {action:"monitor", value:-123});
  assert.deepEqual(parseDesktopAction("resolution","1280x720","darwin"), {action:"resolution",value:"1280x720"});
  assert.deepEqual(parseDesktopAction("awake","off","linux"), {action:"awake",value:false});
});
test("native preference validation bounds geometry and ignores arbitrary extra fields", () => {
  const parsed = parsePreferences({schema:1, backend:"metal", keepAwake:false,
    window:{x:-1600,y:30,width:1280,height:720,maximized:true,fullscreen:false, command:"bad"},
    path:"/private/file", trial:{backend:"metal", started:false}}, "darwin");
  assert.equal(parsed.window.x, -1600); assert.equal(parsed.window.maximized, true);
  assert.equal(parsed.backend, "metal"); assert.equal(parsed.path, undefined); assert.equal(parsed.window.command, undefined);
  assert.equal(parsePreferences({schema:1,backend:"d3d11",window:{x:Infinity,y:0,width:1,height:1}}, "darwin").window, null);
  assert.equal(parsePreferences({schema:1,backend:"d3d11"}, "darwin").backend, "auto");
  assert.throws(() => parsePreferences({schema:2},"darwin"), /Unsupported/);
});
test("disconnected monitors and small usable displays restore a completely reachable window in logical pixels", () => {
  const primary = {id:1,scaleFactor:2,workArea:{x:0,y:24,width:1512,height:900}};
  const secondary = {id:2,scaleFactor:1,workArea:{x:-1920,y:0,width:1920,height:1040}};
  const saved = {x:-1800,y:40,width:1280,height:720};
  assert.deepEqual(restoreBounds(saved,[primary,secondary],primary), saved);
  const restored = restoreBounds(saved,[primary],primary);
  assert.ok(restored.x >= 0 && restored.y >= 24 && restored.x + restored.width <= 1512);
  assert.deepEqual(fitBounds({x:9999,y:-500,width:1920,height:1080},{x:0,y:0,width:800,height:480}),
    {x:0,y:0,width:800,height:480});
  const sized = resolutionBounds("1280x720", primary, {frameWidth:0,frameHeight:40});
  assert.equal(sized.width,1280); assert.equal(sized.height,760);
  const fitted = resolutionBounds("2560x1440", primary, {frameWidth:0,frameHeight:40});
  assert.ok(fitted.width <= 1512 && fitted.height <= 900);
  assert.ok(Math.abs(fitted.width/(fitted.height-40)-16/9)<.005);
});
test("presentation preferences commit atomically with a previous backup and recover from corrupt current bytes", async t => {
  const dir = await directory(t), prefs = new DesktopPreferences(dir,"darwin");
  prefs.state.window = {x:10,y:20,width:1100,height:650,maximized:false,fullscreen:false}; await prefs.save();
  const before = await readFile(prefs.file,"utf8");
  prefs.state.keepAwake = false; await prefs.save();
  assert.equal(await readFile(prefs.file+".previous","utf8"),before);
  assert.equal(new DesktopPreferences(dir,"darwin").state.keepAwake,false);
  await writeFile(prefs.file,"interrupted json");
  const recovered = new DesktopPreferences(dir,"darwin");
  assert.equal(recovered.state.keepAwake,true); assert.equal(recovered.state.window.width,1100);
  await recovered.save();
  assert.equal((await readdir(dir)).some(name=>name.endsWith(".tmp")),false);
  assert.equal((await readdir(dir)).some(name=>name==="saves"),false);
});
test("a backend trial is durable before Chromium launch and an incomplete launch falls back to Auto exactly once", async t => {
  const dir = await directory(t), prefs = new DesktopPreferences(dir,"darwin");
  prefs.state.backend = "metal"; prefs.state.trial = {backend:"metal",started:false}; await prefs.save();
  const launch = new DesktopPreferences(dir,"darwin");
  assert.equal(launch.beginGraphicsLaunch(),"metal");
  assert.equal(JSON.parse(await readFile(launch.file)).trial.started,true);
  const recovered = new DesktopPreferences(dir,"darwin");
  assert.equal(recovered.beginGraphicsLaunch(),"auto");
  const disk = JSON.parse(await readFile(launch.file));
  assert.equal(disk.backend,"auto"); assert.equal(disk.trial,null); assert.match(disk.recovery,/previous alternate-backend launch/);
  assert.equal(new DesktopPreferences(dir,"darwin").beginGraphicsLaunch(),"auto");
});
test("serial preference writes retain the final state and the immediately previous state", async t => {
  const dir = await directory(t), prefs = new DesktopPreferences(dir,"win32"), writes=[];
  for (const backend of ["auto","d3d11","gl"]) { prefs.state.backend=backend; writes.push(prefs.save()); }
  await Promise.all(writes);
  assert.equal(JSON.parse(await readFile(prefs.file)).backend,"gl");
  assert.equal(JSON.parse(await readFile(prefs.file+".previous")).backend,"d3d11");
});

function controlsFixture(t, platform="darwin", backend="auto") {
  const app = new EventEmitter(), screen = new EventEmitter(), win = new EventEmitter(), contents = new EventEmitter();
  const monitors = [{id:1,label:"Built-in",size:{width:1512,height:982},scaleFactor:2,workArea:{x:0,y:24,width:1512,height:900}},
    {id:2,label:"External",size:{width:1920,height:1080},scaleFactor:1,workArea:{x:1512,y:0,width:1920,height:1040}}];
  let bounds = {x:100,y:100,width:1280,height:760}, focused=true, minimized=false, fullscreen=false, idle=true, choice=0;
  let saves=0, starts=0, stops=0, relaunches=0, quits=0; const sent=[], notices=[];
  Object.assign(app,{getGPUInfo:async()=>({gpuDevice:[{vendorId:1,deviceId:2}]}),getGPUFeatureStatus:()=>({webgl:"enabled"}),
    relaunch:()=>relaunches++,quit:()=>quits++});
  Object.assign(screen,{getAllDisplays:()=>monitors,getPrimaryDisplay:()=>monitors[0],
    getDisplayMatching:rect=>rect.x>=1512?monitors[1]:monitors[0]});
  Object.assign(contents,{isDestroyed:()=>false,send:(...args)=>sent.push(args),
    executeJavaScript:async source=>source.includes("standardReady")?true:undefined});
  Object.assign(win,{webContents:contents,isDestroyed:()=>false,isVisible:()=>true,isFocused:()=>focused,
    isMinimized:()=>minimized,isMaximized:()=>false,isFullScreen:()=>fullscreen,getBounds:()=>({...bounds}),
    getNormalBounds:()=>({...bounds}),getContentSize:()=>[bounds.width,bounds.height-40],
    unmaximize(){},setBounds(rect){bounds={...rect};win.emit("resize");},setFullScreen(value){fullscreen=value;win.emit(value?"enter-full-screen":"leave-full-screen");}});
  const prefs={state:{backend,keepAwake:true,trial:null,recovery:""},saveSoon(){},async save(){saves++;}};
  const controls=createDesktopControls({app,screen,platform,preferences:prefs,getWindow:()=>win,idle:async()=>idle,
    dialog:{showMessageBox:async()=>({response:choice})},notify:message=>notices.push(message),
    powerSaveBlocker:{start:()=>++starts,stop:()=>stops++}});
  controls.connect(win); t.after(()=>win.emit("closed"));
  return {app,screen,win,prefs,controls,sent,notices,setIdle:value=>{idle=value;},setChoice:value=>{choice=value;},
    focus(value){focused=value;win.emit(value?"focus":"blur");},minimize(value){minimized=value;win.emit(value?"minimize":"restore");},
    snapshot:()=>({bounds,fullscreen,saves,starts,stops,relaunches,quits})};
}
test("native keep-awake releases on blur/minimize/close and respects the saved toggle", async t => {
  const f=controlsFixture(t);
  f.focus(true); f.focus(true); assert.equal(f.snapshot().starts,1);
  f.focus(false); assert.equal(f.snapshot().stops,1);
  f.focus(true); f.minimize(true); assert.equal(f.snapshot().stops,2);
  f.minimize(false); await f.controls.perform("awake","off");
  assert.equal(f.prefs.state.keepAwake,false); assert.equal(f.snapshot().stops,3);
  f.focus(true); assert.equal(f.snapshot().starts,3);
});
test("native F11 toggles once per keypress and leaves Escape to gameplay", t => {
  const f=controlsFixture(t); let prevented=0;
  for(const input of [{key:"F11",type:"keyDown",isAutoRepeat:false},{key:"F11",type:"keyDown",isAutoRepeat:true},
    {key:"F11",type:"keyUp"},{key:"Escape",type:"keyDown"}]) f.win.webContents.emit("before-input-event",{preventDefault:()=>prevented++},input);
  assert.equal(f.snapshot().fullscreen,true); assert.equal(prevented,3);
});
test("monitor/size actions fit the selected monitor without trusting renderer geometry or interrupting a run", async t => {
  const f=controlsFixture(t);
  f.setIdle(false); await f.controls.perform("resolution","960x540"); assert.equal(f.snapshot().bounds.width,1280);
  f.setIdle(true); await f.controls.perform("monitor","2"); assert.ok(f.snapshot().bounds.x>=1512);
  await f.controls.perform("resolution","1280x720");
  assert.equal(f.snapshot().bounds.height,760); assert.equal(f.snapshot().bounds.width,1280);
  await f.controls.perform("monitor","999"); assert.match(f.notices[0],/no longer connected/);
});
test("backend changes require an explicit restart confirmation and idle state, not automatic relaunch", async t => {
  const f=controlsFixture(t);
  await f.controls.perform("backend","metal");
  assert.deepEqual(f.prefs.state.trial,{backend:"metal",started:false});
  assert.equal(f.controls.metadata().restartNeeded,true); assert.equal(f.snapshot().relaunches,0);
  await f.controls.perform("restart",""); assert.equal(f.snapshot().relaunches,0);
  f.setChoice(1); f.setIdle(false); await f.controls.perform("restart",""); assert.equal(f.snapshot().relaunches,0);
  f.setIdle(true); await f.controls.perform("restart","");
  assert.equal(f.snapshot().relaunches,1); assert.equal(f.snapshot().quits,1);
});
test("repeated GPU failures select Auto for next launch without restarting a running game", async t => {
  const f=controlsFixture(t,"darwin","metal");
  f.setIdle(false);
  for(let n=0;n<3;n++) f.app.emit("child-process-gone",{}, {type:"GPU",reason:"crashed"});
  assert.equal(f.prefs.state.backend,"auto"); assert.equal(f.prefs.state.trial,null);
  assert.equal(f.snapshot().relaunches,0); assert.equal(f.notices.length,1);
});
test("failed native preference commits roll back, and later actions can still succeed", async t => {
  const f=controlsFixture(t), save=f.prefs.save;
  f.prefs.save=async()=>{throw new Error("disk full");};
  await assert.rejects(f.controls.perform("backend","metal"),/disk full/);
  assert.equal(f.prefs.state.backend,"auto");assert.equal(f.prefs.state.trial,null);
  await assert.rejects(f.controls.perform("awake","off"),/disk full/);
  assert.equal(f.prefs.state.keepAwake,true);
  f.prefs.save=save;await f.controls.perform("backend","gl");
  assert.equal(f.prefs.state.backend,"gl");
});
test("native recovery resets graphics without needing a functioning idle renderer or automatically restarting", async t => {
  const f=controlsFixture(t,"darwin","metal");
  f.setIdle(false);await f.controls.resetGraphics();
  assert.equal(f.prefs.state.backend,"auto");assert.equal(f.prefs.state.trial,null);
  assert.equal(f.snapshot().relaunches,0);
});
