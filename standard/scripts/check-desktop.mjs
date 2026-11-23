// Actual Electron shell, but an isolated pre-entry appData/userData tree.
// No installed/running app, real save, update channel or signing key is used.
import { _electron as electron } from "playwright-core";
import assert from "node:assert/strict";
import {mkdtemp, mkdir, readFile, writeFile, rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {setTimeout as delay} from "node:timers/promises";

const config = JSON.parse(await readFile("standard/config.json", "utf8"));
if (process.platform !== "darwin") throw new Error("This native controls suite currently requires macOS; do not claim it as Windows/Linux validation.");
const inventory = JSON.parse(await readFile("build/standard-game/asset-manifest.json", "utf8"));
const temporary = await mkdtemp(path.join(os.tmpdir(), "pokebonk-native-controls-"));
const data = path.join(temporary, "application-data"), userData = path.join(data, config.applicationId);
const output = path.resolve("evidence/native-desktop");
await mkdir(userData, {recursive: true}); await mkdir(output, {recursive: true});
await writeFile(path.join(userData, "update-status.json"), JSON.stringify({lastCheck: Date.now(), highestSeen: config.version}));
await writeFile(path.join(temporary, "package.json"), JSON.stringify({
  name:"pokebonk-native-isolated-test", version:config.version, main:"bootstrap.cjs",
}));
await writeFile(path.join(temporary, "bootstrap.cjs"), `
const {app}=require("electron");
app.setPath("appData",${JSON.stringify(data)});
app.setPath("userData",${JSON.stringify(userData)});
import(${JSON.stringify(pathToFileURL(path.resolve("standard/desktop/main.mjs")).href)}).catch(error=>{
  console.error(error);app.exit(1);
});
`);
const env = {...process.env, POKEBONK_STANDARD_USER_DATA:userData};
delete env.ELECTRON_RUN_AS_NODE;
const results=[];
let application, page, code;
async function launch() {
  application = await electron.launch({args:[temporary], env, timeout:60000});
  code = new Promise(resolve => application.process().once("exit", (code, signal) => resolve({code,signal})));
  page = await application.firstWindow({timeout:60000});
  page.on("pageerror", error => { results.push({phase:"renderer-error", error:error.message}); });
  await page.waitForFunction(() => document.documentElement.dataset.standardReady === "true" ||
    document.querySelector(".offline-startup-recovery,.offline-boot-error"), undefined, {timeout:90000});
  const info = await application.evaluate(async ({app,BrowserWindow}) => {
    const win=BrowserWindow.getAllWindows()[0], prefs=win.webContents.getLastWebPreferences();
    const page=await win.webContents.executeJavaScript(`({
      bridge:Object.keys(window.PokeBonkStandard??{}),
      noNode:typeof require==="undefined"&&typeof process==="undefined",
      error:document.querySelector(".offline-startup-recovery,.offline-boot-error")?.textContent??null,
      ready:document.documentElement.dataset.standardReady,
      graphics:JSON.parse(document.documentElement.dataset.standardDesktop??"null")
    })`);
    return {userData:app.getPath("userData"), appData:app.getPath("appData"),
      preferences:{nodeIntegration:prefs.nodeIntegration,sandbox:prefs.sandbox,contextIsolation:prefs.contextIsolation,
        backgroundThrottling:prefs.backgroundThrottling},page};
  });
  assert.equal(info.userData,userData); assert.equal(info.appData,data);
  assert.deepEqual(info.page.bridge,["loadState","saveState"]); assert.equal(info.page.noNode,true);
  assert.equal(info.preferences.sandbox,true); assert.equal(info.preferences.contextIsolation,true);
  assert.equal(info.preferences.nodeIntegration,false); assert.notEqual(info.preferences.backgroundThrottling,false);
  assert.equal(info.page.error,null); return info;
}
async function closeWindow() {
  await application.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();});
  const exit=await Promise.race([code, delay(15000).then(()=>{throw new Error("Native app did not exit after its last window closed.");})]);
  assert.deepEqual(exit,{code:0,signal:null});
  application=null; return exit;
}
async function focused() {
  await application.evaluate(({app,BrowserWindow})=>{
    app.focus({steal:true}); const win=BrowserWindow.getAllWindows()[0];win.show();win.focus();
  });
  for(let i=0;i<40;i++) {
    if(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFocused()))return;
    await delay(100);
  }
  throw new Error("Isolated test window could not receive native focus.");
}
try {
  const first=await launch();
  await page.locator(".screen.sp .sp-go").waitFor();
  assert.equal(await page.locator(".pb-guide").count(),0);
  await page.evaluate(async()=>{
    const app=window.PokeBonkNativeApp,account=app.meta.account;
    await app.backend.chooseStarter(account,4);await app.backend.chooseStarter(account,155);
    app.meta.adopt(await app.backend.loadProfile());app.toMenu();
  });
  await page.locator(".offline-menu").waitFor();
  await page.locator(".pb-guide .g-skip").waitFor();
  await page.locator(".pb-guide .g-skip").click();
  await page.locator(".pb-guide").waitFor({state:"detached"});
  await page.locator(".offline-name-setup").waitFor();
  await page.getByLabel("Player name",{exact:true}).fill("Test Trainer");
  await page.getByRole("button",{name:"Start adventure",exact:true}).click();
  await page.locator(".offline-name-setup").waitFor({state:"detached"});
  await focused();
  await page.getByRole("button",{name:"Player & saves",exact:true}).click();
  await page.locator('[data-standard-desktop-action="settings"]').click();
  await page.locator(".offline-desktop-card").waitFor();
  await page.locator('[data-standard-desktop-action="resolution"][data-standard-desktop-value="960x540"]').click();
  for(let i=0;i<50;i++){
    const size=await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getContentSize());
    if(size[0]===960&&size[1]===540)break;
    await delay(100);
  }
  assert.deepEqual(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getContentSize()),[960,540]);
  const display=await page.locator(".offline-desktop-card").evaluate(node=>({
    text:node.textContent,state:JSON.parse(document.documentElement.dataset.standardDesktop),
  }));
  assert.ok(display.state.displays.length>0);assert.equal(display.state.backend,"auto");
  assert.ok(display.state.graphics.renderer);assert.equal(display.state.bounds[0],960);
  await page.screenshot({path:path.join(output,"native-display-options.png")});
  // Use the actual trusted native link, not a synthetic click or raw IPC.
  await page.locator('[data-standard-desktop-action="awake"]').click();
  await page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.standardDesktop).keepAwake===false);
  assert.equal(JSON.parse(await readFile(path.join(userData,"desktop-preferences.json"))).keepAwake,false);
  await page.locator('[data-standard-desktop-action="backend"][data-standard-desktop-value="metal"]').click();
  await page.waitForFunction(()=>JSON.parse(document.documentElement.dataset.standardDesktop).backend==="metal");
  assert.equal(await page.locator('[data-standard-desktop-action="restart"]').count(),1);
  while(await page.locator(".offline-modal").count()) await page.locator(".offline-modal").last().getByRole("button",{name:"Close",exact:true}).click();
  await page.getByRole("button",{name:"Enter fullscreen",exact:true}).click();
  for(let i=0;i<50&&!await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen());i++)await delay(100);
  assert.equal(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true);
  await delay(1000);await page.keyboard.press("Escape");await delay(350);
  assert.equal(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),true,
    "Escape must not exit native fullscreen.");
  await page.getByRole("button",{name:"Exit fullscreen",exact:true}).click();
  for(let i=0;i<50&&await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen());i++)await delay(100);
  assert.equal(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isFullScreen()),false);
  await delay(1000);
  const normal=await application.evaluate(({BrowserWindow,screen})=>{
    const win=BrowserWindow.getAllWindows()[0],a=screen.getDisplayMatching(win.getBounds()).workArea;
    win.setBounds({x:a.x+30,y:a.y+30,width:1100,height:700});return win.getNormalBounds();
  });
  await delay(700);
  const beforeClose=JSON.parse(await readFile(path.join(userData,"saves/state.json")));
  assert.equal(beforeClose.state.onboarding.trainerGuide,1);
  assert.deepEqual(beforeClose.state.profile.league,[4,155]);assert.equal(beforeClose.state.profile.stardust,10000);
  const exit=await closeWindow();
  results.push({phase:"real-native-auto",first,display,normal,exit,nativeFullscreenAndEsc:true,trustedNativeControls:true});
  // The UI selected Metal but did not relaunch. This second test-owned launch
  // uses the same isolated save/profile; it is not an installation/replacement.
  const second=await launch();
  await page.locator(".offline-menu").waitFor();
  assert.equal(await page.locator(".pb-guide").count(),0);
  assert.equal(second.page.graphics.launchBackend,"metal");
  const restored=await application.evaluate(({BrowserWindow,app})=>({
    normal:BrowserWindow.getAllWindows()[0].getNormalBounds(), switch:app.commandLine.getSwitchValue("use-angle"),
  }));
  assert.deepEqual(restored.normal,normal);assert.equal(restored.switch,"metal");
  const afterRestart=JSON.parse(await readFile(path.join(userData,"saves/state.json")));
  assert.equal(afterRestart.state.playerId,beforeClose.state.playerId);
  assert.deepEqual(afterRestart.state.profile.league,beforeClose.state.profile.league);
  assert.equal(afterRestart.state.profile.stardust,beforeClose.state.profile.stardust);
  const trialStarted=JSON.parse(await readFile(path.join(userData,"desktop-preferences.json")));
  assert.equal(trialStarted.trial?.started,true);
  for(let i=0;i<45;i++){
    const prefs=JSON.parse(await readFile(path.join(userData,"desktop-preferences.json")));
    if(!prefs.trial)break;
    await delay(500);
  }
  assert.equal(JSON.parse(await readFile(path.join(userData,"desktop-preferences.json"))).trial,null);
  results.push({phase:"real-native-metal-and-restart",second,restored,exit:await closeWindow(),guideDidNotReopen:true,
    nativeSavePreserved:true,healthyTrialCleared:true});
  // Simulate an interrupted alternate launch through presentation preferences
  // only; preserve the exact same progress state.
  const prefsPath=path.join(userData,"desktop-preferences.json");
  const interrupted=JSON.parse(await readFile(prefsPath));
  interrupted.backend="gl";interrupted.trial={backend:"gl",started:true};
  await writeFile(prefsPath,JSON.stringify(interrupted));
  const recovery=await launch();await page.locator(".offline-menu").waitFor();
  assert.equal(recovery.page.graphics.launchBackend,"auto");
  assert.match(recovery.page.graphics.recovery,/previous alternate-backend launch/);
  assert.equal(JSON.parse(await readFile(path.join(userData,"saves/state.json"))).state.playerId,beforeClose.state.playerId);
  results.push({phase:"interrupted-launch-recovery",recovery,exit:await closeWindow(),savePreserved:true});
  assert.equal(results.some(item=>item.phase==="renderer-error"),false);
  await writeFile(path.join(output,"checks.json"),JSON.stringify({observedAt:new Date().toISOString(),
    platform:process.platform,gameDigest:inventory.gameDigest,isolated:true,physicalMultipleDisplaysTested:false,
    nativeBackendNamesTested:["auto","metal"],results},null,2)+"\n");
  console.log(`Passed real Electron controls, native fullscreen/Escape, Metal startup, restart persistence and crash fallback. ${output}`);
} catch(error) {
  await page?.screenshot({path:path.join(output,"failure.png")}).catch(()=>{});
  await writeFile(path.join(output,"failure.json"),JSON.stringify({error:error.stack,results,isolatedData:temporary},null,2));
  throw error;
} finally {
  if(application)await application.close().catch(()=>{});
  // Retain only diagnostic JSON/screenshots, never private real app data.
  await rm(temporary,{recursive:true,force:true});
}
