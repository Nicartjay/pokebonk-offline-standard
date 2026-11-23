// Real bundled UI/engine smoke checks. All saves are synthetic in-memory
// fixtures, all remote requests are blocked, no installed game is controlled.
import {chromium} from "playwright-core";
import {createServer} from "node:http";
import {readFile, stat, mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {MIME} from "../desktop/protocol.mjs";

const root = path.resolve("build/standard-game"), output = "evidence/update-feedback-check";
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
const historyEntries = JSON.parse(await readFile("standard/history.json", "utf8"));
const engineOnly = process.env.CHECK_CONTENT_ENGINES_ONLY === "1";
const uiOnly = process.env.CHECK_CONTENT_UI_ONLY === "1";
if (engineOnly && uiOnly) throw new Error("Choose UI-only or engines-only, not both.");
const scope = engineOnly ? "engines-only" : uiOnly ? "ui-only" : "ui-and-engines";
const gameDigest = JSON.parse(await readFile("build/standard-game/asset-manifest.json", "utf8")).gameDigest;
await mkdir(output, {recursive: true});
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const name = url.pathname.replace(/^\/assets\/assets\//, "/assets/");
    const file = path.resolve(root, "." + (name === "/" ? "/index.html" : decodeURIComponent(name)));
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) throw new Error("Not bundled.");
    response.writeHead(200, {"Content-Type": MIME[path.extname(file)] ?? "application/octet-stream"});
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [], missing = [], external = [], results = [];
let browser;
async function session(platform) {
  const context = await browser.newContext({viewport: {width: 1440, height: 900}, colorScheme: "dark",
    ...(platform === "android" ? {isMobile: true, hasTouch: true, deviceScaleFactor: 1,
      userAgent: "Mozilla/5.0 (Linux; Android 13; Tablet) AppleWebKit/537.36 Chrome/108.0.0.0 Safari/537.36"} : {})});
  await context.route("**/*", route => {
    if (route.request().url().startsWith(origin + "/") || /^(?:data:|blob:)/.test(route.request().url())) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await context.addInitScript(platform => {
    let save = null;
    window.__testSave = () => structuredClone(save);
    if (platform === "android") window.PokeBonkStandardAndroid = Object.freeze({
      loadState: () => JSON.stringify({ok: true, value: save}),
      saveState: text => { save = JSON.parse(text); return '{"ok":true,"value":true}'; },
    });
    else window.PokeBonkStandard = Object.freeze({
      loadState: async () => structuredClone(save),
      saveState: async value => { save = structuredClone(value); },
    });
    addEventListener("DOMContentLoaded", () => {
      document.documentElement.dataset.standardPlatform = platform;
      if (platform !== "android") {
        const strip = document.createElement("div"); strip.id = "standard-titlebar"; document.body.append(strip);
      }
    }, {once: true});
  }, platform);
  const page = await context.newPage();
  page.on("pageerror", error => errors.push({platform, message: error.message}));
  page.on("console", message => {
    if (message.type() === "error" && message.text().includes("[pokebonk]")) errors.push({platform, message: message.text()});
  });
  page.on("response", response => { if (response.status() >= 400) missing.push(response.url()); });
  await page.goto(origin + "/index.html?lang=en");
  await page.locator(".screen.sp .sp-go").waitFor({timeout: 30000});
  assert.equal(await page.locator(".pb-guide").count(), 0, "Guide must not cover starter selection.");
  await page.evaluate(async () => {
    const app = window.PokeBonkNativeApp, account = app.meta.account;
    app.halted = true;
    await app.backend.chooseStarter(account, 4);
    await app.backend.chooseStarter(account, 155);
    app.meta.adopt(await app.backend.loadProfile());
    Object.assign(app.meta.profile.settings, {quality: "low", pixel: .5, tips: false});
    app.applySettings(); await app.meta.saveNow(); app.toMenu();
  });
  await page.locator(".offline-menu").waitFor();
  await page.locator(".pb-guide .g-skip").waitFor({timeout: 30000});
  assert.equal(await page.evaluate(() => window.PokeBonkNativeApp.backend.state.onboarding?.trainerGuide), 1);
  if (platform === "android") await page.locator(".pb-guide .g-skip").tap();
  else await page.locator(".pb-guide .g-skip").click();
  await page.locator(".pb-guide").waitFor({state: "detached"});
  await page.locator(".offline-name-setup").waitFor();
  await page.getByLabel("Player name", {exact: true}).fill("Test Trainer");
  if (platform === "android") await page.getByRole("button", {name: "Start adventure", exact: true}).tap();
  else await page.getByRole("button", {name: "Start adventure", exact: true}).click();
  await page.locator(".offline-name-setup").waitFor({state: "detached"});
  return {context, page};
}
try {
  browser = await chromium.launch({headless: true,
    ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]});
  for (const platform of ["darwin","android"]) {
    const {page,context} = await session(platform);
    await page.setViewportSize(platform === "android" ? {width:844,height:390} : {width:1280,height:800});
    // Model only the fixed native click acknowledgement. Native networking,
    // signature checks and concurrency are covered by the updater unit tests.
    await page.evaluate(() => {
      window.__updateClicks = 0;
      document.addEventListener("click", event => {
        const link = event.target.closest?.("a[data-standard-native-action='check-for-updates']");
        if (event.isTrusted && link) {event.preventDefault(); window.__updateClicks++;}
      },true);
    });
    const before = await page.evaluate(() => window.PokeBonkNativeApp.backend.profile());
    await page.getByRole("button",{name:"Player & saves",exact:true}).click();
    await page.locator(".offline-player-card [data-standard-native-action='check-for-updates']").click();
    const modal = page.locator(".offline-update-card");
    await modal.waitFor();
    assert.equal(await modal.getAttribute("data-update-state"),"checking");
    assert.equal(await modal.getAttribute("aria-busy"),"true");
    assert.equal(await modal.getByRole("progressbar").count(),1);
    assert.equal(await modal.getByRole("progressbar").getAttribute("aria-valuenow"),null);
    assert.match(await modal.textContent(),/Nothing is being downloaded or installed/);
    await modal.getByRole("button",{name:"Hide",exact:true}).click();
    await page.evaluate(version => window.PokeBonkOfflineUI.updateFeedback({state:"current",latestVersion:version}),config.version);
    await modal.waitFor();
    assert.equal(await modal.getAttribute("aria-busy"),"false");
    assert.equal(await modal.getByRole("progressbar").count(),0);
    assert.match(await modal.textContent(),/You’re up to date/);
    assert.equal(await modal.locator("dd").nth(0).textContent(),"v"+config.version);
    assert.equal(await modal.locator("dd").nth(1).textContent(),"v"+config.version);
    await modal.getByRole("link",{name:"Check again",exact:true}).click();
    assert.equal(await modal.getAttribute("data-update-state"),"checking");
    assert.equal(await page.evaluate(() => window.__updateClicks),2);
    await page.evaluate(() => window.PokeBonkOfflineUI.updateFeedback({state:"error",detail:"Timed out <script>not code</script>"}));
    assert.match(await modal.textContent(),/keep playing offline/);
    assert.equal(await modal.locator("script").count(),0);
    await page.screenshot({path:`${output}/${platform}-failed-check.png`});
    await page.evaluate(() => window.PokeBonkOfflineUI.updateFeedback({state:"ahead",latestVersion:"1.0.0"}));
    assert.match(await modal.textContent(),/newer test build/);
    await modal.getByRole("button",{name:"Done",exact:true}).click();
    const guarded = await page.evaluate(() => {
      const app = window.PokeBonkNativeApp;
      window.PokeBonkNativeApp = {run:{state:"play"}};
      try {return window.PokeBonkOfflineUI.updateFeedback({state:"error"});}
      finally {window.PokeBonkNativeApp=app;}
    });
    assert.equal(guarded,false); assert.equal(await modal.count(),0,"Feedback must not interrupt active gameplay.");
    for(let index=0;index<3;index++) {
      await page.locator(".offline-home-tabs button").nth(index).click();
      const aligned = await page.locator("td.offline-home-empty").evaluate(node => ({text:getComputedStyle(node).textAlign,
        vertical:getComputedStyle(node).verticalAlign,columns:node.colSpan}));
      assert.deepEqual(aligned,{text:"center",vertical:"middle",columns:3});
    }
    await page.getByRole("button",{name:"View all personal records",exact:true}).click();
    for(let index=0;index<3;index++) {
      await page.locator(".offline-record-tabs button").nth(index).click();
      assert.equal(await page.locator(".offline-records-card .offline-empty").evaluate(node=>getComputedStyle(node).textAlign),"center");
    }
    await page.screenshot({path:`${output}/${platform}-empty-records.png`});
    assert.deepEqual(await page.evaluate(() => window.PokeBonkNativeApp.backend.profile()),before,"Update feedback must not alter progress.");
    results.push({platform,loadingVisible:true,retry:true,equalAndAhead:true,failureRecoverable:true,allEmptyTabsCentered:true});
    await context.close();
  }
  assert.deepEqual(errors,[]); assert.deepEqual(missing,[]); assert.deepEqual(external,[]);
  await writeFile(`${output}/result.json`,JSON.stringify({gameDigest,results,errors,missing,external},null,2));
  console.log("PASS: update loading/results/retry, idle-only feedback, unchanged saves and centered empty messages on desktop/Android.");
} finally {
  await writeFile(`${output}/diagnostics.json`,JSON.stringify({gameDigest,results,errors,missing,external},null,2));
  await browser?.close(); await new Promise(resolve=>server.close(resolve));
}
