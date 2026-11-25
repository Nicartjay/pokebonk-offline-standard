import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFile} from "node:fs/promises";
import {ast,nodesOf,one,maybeName,edits} from "../../scripts/source.ts";
import {graphicsEdits,fpsSettingsReplacements} from "../adapters/graphics.mjs";
import {graphicsQuality,renderPixelRatio,batteryFpsCap,skipBatteryFrame,
  fpsSettingsRow,syncGraphicsSettings} from "../runtime/graphics.js";

const policy = {graphicsQuality,renderPixelRatio,batteryFpsCap,skipBatteryFrame,syncGraphicsSettings};
const preset = (level,saver=false) => ({
  pixelScale:0,bloom:level==="high",hires:level!=="low",dyn:true,saver,
});
test("Battery Saver always selects effective 30 FPS, on every shell, without changing the stored preference",()=>{
  for(const saved of [0,20,30,60,90,120,144,240]){
    assert.equal(batteryFpsCap(true,saved),30);
    assert.equal(batteryFpsCap(false,saved),saved);
  }
});
test("battery pacing gates actual work on 60–240 Hz displays, including persistent needsDraw",()=>{
  for(const hz of [60,64,90,120,144,155,165,240]){
    const app={saver:true,fpsCap:()=>30,r:{needsDraw:true}},accepted=[];
    for(let n=0;n<hz*4;n++){
      const now=n*1000/hz;
      if(!skipBatteryFrame(app,now,1000/30))accepted.push(now);
    }
    assert.ok(accepted.length<=121&&accepted.length>=118,`${hz} Hz: ${accepted.length} frames`);
    for(const start of accepted)
      assert.ok(accepted.filter(at=>at>=start&&at<start+1000).length<=31,"No accumulated over-target rendering.");
  }
});
test("pacing respects slower paused intervals and resets when disabled, without a catch-up burst",()=>{
  const app={saver:true,fpsCap:()=>30};
  assert.equal(skipBatteryFrame(app,0,50),false);
  assert.equal(skipBatteryFrame(app,40,50),true);
  assert.equal(skipBatteryFrame(app,50,50),false);
  assert.equal(skipBatteryFrame({...app},51,50),false);
  assert.equal(skipBatteryFrame(app,5000,50),false);
  assert.equal(skipBatteryFrame(app,5001,50),true);
  app.saver=false;assert.equal(skipBatteryFrame(app,5002,50),false);
  app.saver=true;assert.equal(skipBatteryFrame(app,5003,50),false);
});
test("battery pacing tolerates real-world 60 Hz timestamp jitter instead of falling to 20–25 FPS",()=>{
  const app={saver:true,fpsCap:()=>30},frames=[];
  for(let n=0;n<240;n++){
    const now=n*1000/60+Math.sin(n*1.7)*.45;
    if(!skipBatteryFrame(app,now,1000/30))frames.push(now);
  }
  assert.ok(frames.length>=118&&frames.length<=121,`${frames.length} frames over four seconds`);
});
test("High, Medium, Low and Saver have decreasing real pixel budgets even at DPR 1 or fixed/native resolution",()=>{
  for(const [w,h]of [[800,360],[1280,720],[1920,1080],[3840,2160],[7680,4320]]){
    const high=renderPixelRatio({quality:preset("high")},w,h,1.5);
    const medium=renderPixelRatio({quality:preset("medium")},w,h,1.5);
    const low=renderPixelRatio({quality:preset("low")},w,h,1);
    const saver=renderPixelRatio({quality:preset("high",true)},w,h,3);
    assert.ok(high>medium&&medium>low&&low>saver);
    assert.ok(w*h*medium**2<=1600000+.001);
    assert.ok(w*h*low**2<=1280*720+.001);
    assert.ok(w*h*saver**2<=960*540+.001);
    assert.ok(low<=.75&&saver<=.5);
    assert.ok(renderPixelRatio({quality:preset("low")},w,h,.2)<=.2);
  }
});
test("Saver removes bloom without mutating High preferences; turning it off restores the original quality",()=>{
  const chosen=preset("high",true),before=structuredClone(chosen);
  assert.deepEqual(graphicsQuality(chosen),{...chosen,bloom:false,hires:false});
  assert.deepEqual(chosen,before);
  const high=preset("high");
  assert.equal(graphicsQuality(high),high);
  for(const level of ["medium","low"])assert.equal(graphicsQuality(preset(level)).bloom,false);
});

function classList(values=[]){
  const keys=new Set(values);
  return {contains:key=>keys.has(key),add:key=>keys.add(key),
    toggle(key,on){on??=!keys.has(key);on?keys.add(key):keys.delete(key);return on;}};
}
function rowFixture(selected="144"){
  const values=["0","30","60","90","120","144"],listeners=new Map(),hint={textContent:"Original translated hint."};
  const button=value=>({classList:classList(value===selected?["on"]:[]),disabled:false,attributes:new Map(),
    setAttribute(key,value){this.attributes.set(key,value);},removeAttribute(key){this.attributes.delete(key);}});
  const row={isConnected:true,dataset:{},classList:classList(),buttons:values.map(button),attributes:new Map(),
    querySelectorAll:()=>row.buttons,querySelector:()=>hint,
    setAttribute(key,value){this.attributes.set(key,value);},
    addEventListener(name,fn){listeners.set(name,fn);}};
  return {row,values,hint,listeners,button};
}
test("the original FPS row shows 30 selected and disables every option; turning Saver off restores the previous selection",()=>{
  const app={saver:false,meta:{profile:{settings:{fpsLimit:"144"}}}},f=rowFixture();
  assert.equal(fpsSettingsRow(app,f.row,f.values),f.row);
  app.saver=true;syncGraphicsSettings(app);
  assert.ok(f.row.buttons.every(button=>button.disabled));
  assert.deepEqual(f.row.buttons.map(button=>button.classList.contains("on")),[false,true,false,false,false,false]);
  assert.equal(app.meta.profile.settings.fpsLimit,"144");
  assert.match(f.hint.textContent,/locked to 30/);
  let prevented=0,stopped=0;
  f.listeners.get("click")({target:{closest:()=>f.row.buttons[4]},preventDefault(){prevented++;},stopImmediatePropagation(){stopped++;}});
  assert.equal(prevented,1);assert.equal(stopped,1);
  app.saver=false;syncGraphicsSettings(app);
  assert.ok(f.row.buttons.every(button=>!button.disabled));
  assert.equal(f.row.buttons[5].classList.contains("on"),true);
  assert.equal(f.hint.textContent,"Original translated hint.");
  // The original UI recreates these buttons after selecting a different cap.
  app.meta.profile.settings.fpsLimit="60";f.row.buttons=f.values.map(f.button);
  app.saver=true;syncGraphicsSettings(app);
  assert.ok(f.row.buttons.every(button=>button.disabled));
  app.saver=false;syncGraphicsSettings(app);
  assert.equal(f.row.buttons[2].classList.contains("on"),true);
});
test("settings adapter targets the original FPS row/options, independently of private names",()=>{
  const source='function settings(app){const saved=app.meta.profile.settings;const renamed=()=>{const app=()=>null;const options=["0","30","60"];options.map(value=>()=>{saved.fpsLimit=value;});return app(),makeRow();};return renamed();}';
  const owner=ast(source).body[0],changes=fpsSettingsReplacements(source,owner);
  const next=edits(source,changes.map(change=>({start:change.node.start,end:change.node.end,text:change.text})));
  assert.match(next,/const __offlineGraphicsApp=app;/);
  assert.match(next,/fpsSettingsRow\(__offlineGraphicsApp,\(app\(\),makeRow\(\)\),\["0","30","60"\]\)/);
  assert.throws(()=>fpsSettingsReplacements(source.replaceAll("fpsLimit","unrelated"),ast(source.replaceAll("fpsLimit","unrelated")).body[0]),/FPS setting/);
});
test("the actual accepted renderer changes canvas AND composer buffers and restores High when Saver is disabled",async()=>{
  const {snapshot:root}=JSON.parse(await readFile("standard/accepted.json","utf8"));
  const manifest=JSON.parse(await readFile(root+"/snapshot.json","utf8"));
  const candidates=await Promise.all(manifest.files.filter(file=>file.name.startsWith("assets/main-")&&file.name.endsWith(".js"))
    .map(async file=>readFile(root+"/game/"+file.name,"utf8")));
  const original=one(candidates.filter(source=>source.includes("async signedIn(")&&source.includes("fpsCap()")),"accepted lifecycle");
  const source=edits(original,graphicsEdits(original,ast(original))),tree=ast(source);
  const renderer=one(nodesOf(tree,"ClassExpression",node=>node.body.body.some(method=>maybeName(method.key)==="setQuality")),"renderer");
  const methods=renderer.body.body.filter(method=>["setQuality","setFixedRes","resize","hires","pixelScale"].includes(maybeName(method.key)));
  const sandbox={window:{innerWidth:1920,innerHeight:1080,devicePixelRatio:2},PokeBonkOfflineUI:policy,Math,k:false};
  // Resolve the device-class flag by syntax rather than the minifier's name.
  const resize=methods.find(method=>maybeName(method.key)==="resize");
  const flags=nodesOf(resize,"ConditionalExpression",node=>node.test.type==="Identifier").map(node=>node.test.name);
  for(const flag of flags)if(!["n"].includes(flag))sandbox[flag]=false;
  const context=vm.createContext(sandbox);
  const prototype=vm.runInContext(`(class {${methods.map(method=>source.slice(method.start,method.end)).join("\n")}}).prototype`,context);
  const canvas={style:{}},camera={updateProjectionMatrix(){}},composer={setSize(w,h){this.width=Math.floor(w*this.owner.ratio);this.height=Math.floor(h*this.owner.ratio);}};
  const gpu={setPixelRatio(value){this.ratio=value;},setSize(w,h){canvas.width=Math.floor(w*this.ratio);canvas.height=Math.floor(h*this.ratio);}};
  composer.owner=gpu;
  const render=Object.assign(Object.create(prototype),{quality:{},bloom:{},bloomK:1,canvas,renderer:gpu,composer,camera,dynRes:1,fixedRes:-1,pickFinal(){}});
  render.setQuality(preset("high"));
  const highPixels=canvas.width*canvas.height;
  render.setQuality(preset("low"));
  assert.ok(canvas.width*canvas.height<highPixels);
  render.setQuality(preset("high",true));
  assert.equal(render.bloom.intensity,0);
  assert.ok(canvas.width*canvas.height<=960*540);
  assert.equal(composer.width,canvas.width);assert.equal(composer.height,canvas.height);
  render.setFixedRes(2160);assert.ok(canvas.width*canvas.height<=960*540);
  render.setFixedRes(-1);render.setQuality(preset("high"));
  assert.equal(canvas.width*canvas.height,highPixels);
  assert.ok(render.bloom.intensity>0);
});
