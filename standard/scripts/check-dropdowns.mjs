// One focused pass of the approved dropdown design on the prepared payload.
// Synthetic profiles/records/networks only. No peer connections or real saves.
import {chromium} from "playwright-core";
import {createServer} from "node:http";
import {readFile,stat,mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {MIME} from "../desktop/protocol.mjs";
const root=path.resolve("build/standard-game"),out="evidence/dropdown-check";
const {gameDigest}=JSON.parse(await readFile(path.join(root,"asset-manifest.json"),"utf8"));
await mkdir(out,{recursive:true});
const errors=[],missing=[],external=[],results=[];
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,"http://localhost");
    const name=decodeURIComponent(url.pathname).replace(/^\/assets\/assets\//,"/assets/");
    const file=path.resolve(root,"."+(name==="/"?"/index.html":name));
    if(!file.startsWith(root+path.sep)||!(await stat(file)).isFile())throw Error("Not bundled");
    res.writeHead(200,{"Content-Type":MIME[path.extname(file)]??"application/octet-stream"});
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser,currentPage,currentPlatform;
async function open(platform){
  const context=await browser.newContext({viewport:platform==="android"?{width:1280,height:800}:{width:1600,height:1000},
    colorScheme:"dark",...(platform==="android"?{isMobile:true,hasTouch:true,deviceScaleFactor:1,
      userAgent:"Mozilla/5.0 (Linux; Android 13; Tablet) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"}:{})});
  await context.route("**/*",route=>{
    if(route.request().url().startsWith(origin+"/")||/^(data:|blob:)/.test(route.request().url()))return route.continue();
    external.push(route.request().url());return route.abort();
  });
  await context.addInitScript(platform=>{
    let saved=null,state={phase:"idle",interfaces:[{label:"Wi-Fi",address:"192.168.1.24"},{label:"Ethernet",address:"10.0.0.24"}],members:[]};
    if(platform==="android")window.PokeBonkStandardAndroid={
      loadState:()=>JSON.stringify({ok:true,value:saved}),
      saveState:text=>{saved=JSON.parse(text);return '{"ok":true,"value":true}';}
    };
    else window.PokeBonkStandard={loadState:async()=>structuredClone(saved),saveState:async value=>{saved=structuredClone(value);}};
    window.PokeBonkLocalCoop={state:()=>structuredClone(state),send:()=>{}};
    window.__dropdownLanState=next=>{state=next;document.dispatchEvent(new Event("standard:lan-state"));};
    addEventListener("DOMContentLoaded",()=>{document.documentElement.dataset.standardPlatform=platform;},{once:true});
  },platform);
  const page=await context.newPage();
  currentPage=page;currentPlatform=platform;
  page.on("pageerror",error=>errors.push({platform,error:error.message}));
  page.on("response",response=>{if(response.status()>=400)missing.push(response.url());});
  await page.goto(origin+"/index.html?lang=en",{waitUntil:"domcontentloaded"});
  await page.locator(".screen.sp .sp-go").waitFor({timeout:60000});
  await page.locator(".wipe").waitFor({state:"detached",timeout:60000});
  await page.evaluate(async()=>{
    const app=window.PokeBonkNativeApp,account=app.meta.account;
    await app.backend.chooseStarter(account,4);await app.backend.chooseStarter(account,155);
    await app.backend.claimFirstGuide();await app.backend.renameLocal("Dropdown Tester");
    app.meta.adopt(await app.backend.loadProfile());
    Object.assign(app.meta.profile.settings,{quality:"low",pixel:.5,tips:false,music:0});
    app.applySettings();await app.meta.saveNow();
    const sample=[["forest",4,"standard",0],["coast",155,"endless",1],["encina",4,"bossrush",2]]
      .map(([biome,species,mode,tier],index)=>({id:"sample-"+index,biome,species,finalSpecies:species,mode,tier,
        kills:1000-index*100,time:600+index*60,attackTime:500+index*30,date:Date.now(),victory:true}));
    app.backend.recordsLocal=()=>structuredClone(sample);app.toMenu();
  });
  await page.locator(".offline-menu").waitFor({timeout:60000});
  await page.locator(".wipe").waitFor({state:"detached",timeout:60000});
  return {page,context};
}
async function expanded(page,label,tap){
  const trigger=page.getByRole("button",{name:label,exact:true});
  await (tap?trigger.tap():trigger.click());
  await page.waitForFunction(()=>{
    const menu=document.querySelector(".offline-scope-menu");
    return menu&&getComputedStyle(menu).opacity==="1"&&menu.getAnimations().every(animation=>animation.playState==="finished");
  },undefined,{timeout:15000});
  assert.equal(await trigger.getAttribute("aria-expanded"),"true");
  const pose=await page.locator(".offline-scope-menu").evaluate(menu=>{
    const rect=menu.getBoundingClientRect(),style=getComputedStyle(menu);
    return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:innerWidth,height:innerHeight,
      position:style.position,animation:style.animationName,selected:menu.querySelectorAll(".on").length};
  });
  assert.equal(pose.position,"fixed");assert.equal(pose.animation,"plateIn");assert.equal(pose.selected,1);
  assert.ok(pose.left>=0&&pose.right<=pose.width+1&&pose.top>=0&&pose.bottom<=pose.height+1,JSON.stringify(pose));
  return pose;
}
async function pick(page,title,tap){
  const choice=page.getByRole("option",{name:new RegExp("^"+title)});
  await (tap?choice.tap():choice.click());
  await page.locator(".offline-scope-menu").waitFor({state:"detached"});
}
try{
  browser=await chromium.launch({headless:true,
    executablePath:process.env.CHROME_PATH??"/Users/nicartjay/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell",
    args:["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  for(const platform of ["darwin","android"]){
    const {page,context}=await open(platform),tap=platform==="android";
    const activate=locator=>tap?locator.tap():locator.click();
    const before=await page.evaluate(()=>JSON.stringify(window.PokeBonkNativeApp.backend.state.profile));
    const home=await expanded(page,"Home records map",tap);
    await pick(page,"Storm Coast",tap);
    assert.match(await page.getByRole("button",{name:"Home records map",exact:true}).textContent(),/Storm Coast/);
    assert.equal(await page.locator(".offline-home-record-table tbody tr").count(),1);
    await expanded(page,"Home records map",tap);await page.keyboard.press("Escape");
    assert.equal(await page.locator(".offline-menu").count(),1);
    assert.equal(await page.getByRole("button",{name:"Home records map",exact:true}).evaluate(node=>node===document.activeElement),true);
    await activate(page.getByRole("button",{name:"View all personal records",exact:true}));
    await expanded(page,"Filter records by map",tap);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".offline-records-card").count(),1,"Escape closes the dropdown, not its parent dialog.");
    await expanded(page,"Filter records by mode",tap);await pick(page,"Endless",tap);
    assert.equal(await page.locator(".offline-record-table tbody tr").count(),1);
    await expanded(page,"Filter records by map",tap);await page.keyboard.press("Home");await page.keyboard.press("Enter");
    await expanded(page,"Filter records by difficulty",tap);await pick(page,"Hard",tap);
    assert.equal(await page.locator(".offline-record-table tbody tr").count(),1);
    await activate(page.locator(".offline-records-card").getByRole("button",{name:"Close",exact:true}));
    await activate(page.locator(".offline-lan-entry"));
    await page.locator(".offline-lan-home").waitFor();await page.locator(".wipe").waitFor({state:"detached",timeout:30000});
    assert.equal(await page.locator(".offline-lan-middle > .cp-find").count(),1);
    assert.equal(await page.locator(".offline-lan-middle > .cp-find + .cp-howto").count(),1);
    assert.equal(await page.locator(".offline-lan-help .cp-find").count(),0);
    assert.equal(await page.locator('[data-lan-field="address"]').inputValue(),"192.168.1.24");
    const network=await expanded(page,"Local network",tap);await pick(page,"Ethernet",tap);
    assert.equal(await page.locator('[data-lan-field="address"]').inputValue(),"10.0.0.24");
    await expanded(page,"Local network",tap);
    await page.evaluate(()=>window.__dropdownLanState({phase:"idle",members:[],interfaces:[
      {label:"Wi-Fi",address:"192.168.1.24"},{label:"Ethernet",address:"10.0.0.24"}]}));
    assert.equal(await page.getByRole("option",{name:/^Ethernet/}).getAttribute("aria-selected"),"true");
    await page.keyboard.press("Escape");
    await page.evaluate(()=>window.__dropdownLanState({phase:"idle",members:[],interfaces:[{label:"Wi-Fi",address:"192.168.1.24"}]}));
    assert.equal(await page.locator('[data-lan-field="address"]').inputValue(),"192.168.1.24","A disappeared interface falls back to the current private network.");
    if(tap){
      await page.setViewportSize({width:844,height:390});
      await expanded(page,"Local network",true);
      await pick(page,"Wi-Fi",true);
    }
    await expanded(page,"Local network",tap);
    await page.evaluate(()=>window.PokeBonkNativeApp.toMenu());
    await page.locator(".offline-menu").waitFor();await page.locator(".offline-scope-menu").waitFor({state:"detached"});
    assert.equal(await page.evaluate(()=>JSON.stringify(window.PokeBonkNativeApp.backend.state.profile)),before);
    results.push({platform,home,network,filtering:true,keyboardAndEscape:true,nativeHiddenField:true,
      interfaceRefresh:true,removedTriggerCleanup:true,progressUnchanged:true});
    await context.close();currentPage=null;
  }
  assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);assert.deepEqual(external,[]);
  await writeFile(path.join(out,"checks.json"),JSON.stringify({gameDigest,status:"passed",results,errors,missing,external},null,2)+"\n");
  console.log("PASS: desktop and Android dropdowns, original animations, filtering, keyboard/Escape, native network values, refresh and cleanup.");
}catch(error){
  if(currentPage&&!currentPage.isClosed())await currentPage.screenshot({path:path.join(out,"failure.png")}).catch(()=>{});
  await writeFile(path.join(out,"failure.json"),JSON.stringify({gameDigest,platform:currentPlatform,error:error.stack,errors,missing,external,results},null,2)+"\n");
  throw error;
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
