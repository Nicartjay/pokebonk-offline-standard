// Real bundled UI/engine smoke checks. All saves are synthetic in-memory
// fixtures, all remote requests are blocked, no installed game is controlled.
import {chromium} from "playwright-core";
import {createServer} from "node:http";
import {readFile, stat, mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {MIME} from "../desktop/protocol.mjs";

const root = path.resolve("build/standard-game"), output = "evidence/expedition-check";
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
  for (const biome of ["wilds", "safari"]) {
    const {context, page} = await session("android");
    await page.setViewportSize({width: 1280, height: 800});
    await page.evaluate(() => {
      const app = window.PokeBonkNativeApp;
      app.meta.profile.settings.theme = "auto"; app.applySettings();
    });
    for (const dark of [true, false]) {
      await page.evaluate(dark => dispatchEvent(new CustomEvent("standard:system-theme", {detail: {dark}})), dark);
      assert.equal(await page.locator("html").getAttribute("data-theme"), dark ? "dark" : "light");
    }
    for (const theme of ["light", "dark"]) {
      await page.evaluate(theme => {
        const app = window.PokeBonkNativeApp; app.meta.profile.settings.theme = theme; app.applySettings();
        dispatchEvent(new CustomEvent("standard:system-theme", {detail: {dark: theme !== "dark"}}));
      }, theme);
      assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    }
    await page.locator(".mm-modes > .hub").tap();
    await page.locator(".mh-pill").filter({hasText: "The Great Expedition"}).tap();
    await page.locator(".exb-chart-name h2").waitFor();
    const edge = await page.locator(".exb-go-tile").evaluate(tile => {
      const outer = tile.getBoundingClientRect(), button = tile.querySelector(".ex-go").getBoundingClientRect();
      return {overflow: getComputedStyle(tile).overflow, left: button.left - outer.left,
        right: outer.right - button.right, bottom: outer.bottom - button.bottom};
    });
    assert.equal(edge.overflow, "visible");
    assert.ok(edge.left >= 3 && edge.right >= 3 && edge.bottom >= 13, "Keep the rounded outline and full button shadow inside its grid allocation.");
    assert.equal(await page.locator(".exb-party,.exb-season,.exb-scav").count(), 0);
    assert.equal(await page.getByRole("tab", {name: /Trading|Rivals|Leaderboard/}).count(), 0);
    assert.equal(await page.locator(".exb-chart-name h2").evaluate(el => getComputedStyle(el).webkitTextStrokeWidth), "0px");
    await page.getByRole("radio", {name: biome === "wilds" ? /Wild Valley/ : /Safari Zone/}).tap();
    await page.locator(".exb-go-tile .ex-go").tap();
    await page.waitForFunction(() => window.PokeBonkNativeApp?.run?.mode === "expedition", undefined, {timeout: 60000});
    await page.evaluate(() => { window.PokeBonkNativeApp.halted = false; });
    await page.waitForFunction(() => window.PokeBonkNativeApp.run.state === "play" && window.PokeBonkNativeApp.run.time > .2,
      undefined, {timeout: 60000});
    await page.screenshot({path: `${output}/android-${biome}-engine.png`});
    const proof = await page.evaluate(async biome => {
      const app = window.PokeBonkNativeApp, run = app.run, exp = run.expedition;
      app.halted = true;
      const advanced = run.time;
      // Accelerated fixture: exercise the original deterministic loot/pickup,
      // extraction/defeat and result paths, not a claim of a human full run.
      run.time = 181;
      exp.dropLoot("crate", 0, run.player.pos.x, run.player.pos.z, 1);
      exp.pickUp(exp.ground.at(-1)); exp.cratesOpened++;
      const carried = exp.carried().map(item => ({ref: item.ref, b: item.it.b}));
      await app.backend.checkpointExpedition(app.meta.ticket, run.result(false));
      if (biome === "wilds") exp.extract();
      else {run.player.dead = true; run.player.hp = 0;}
      await run.finish(false);
      await app.backend.queue;
      return {biome: run.biome.id, advanced, carried, summary: app.backend.state.profile.exp.last,
        active: app.backend.state.activeRun, durable: window.__testSave().state.profile.exp.last,
        blocked: window.PokeBonkOfflineNetwork.blocked};
    }, biome);
    assert.equal(proof.biome, biome); assert.ok(proof.advanced > 0); assert.ok(proof.carried.length);
    assert.equal(proof.active, null); assert.equal(proof.summary.out, biome === "wilds");
    assert.equal(proof.summary.got.length > 0, biome === "wilds");
    assert.deepEqual(proof.summary, proof.durable); assert.deepEqual(proof.blocked, []);
    await page.locator(".xs-modal").waitFor();
    await page.screenshot({path: `${output}/android-${biome}-result.png`});
    results.push(proof);
    await context.close();
  }
  assert.deepEqual(errors, [], "Engine/browser errors");
  assert.deepEqual(missing, [], "Unbundled Expedition resources");
  assert.deepEqual(external, [], "External requests");
  await writeFile(`${output}/result.json`, JSON.stringify({gameDigest, results, errors, missing, external}, null, 2));
  console.log("PASS: original Wild Valley and Safari engines, seeded loot, extraction/defeat, local durable settlement, Android theme and no network.");
} finally {
  await writeFile(`${output}/diagnostics.json`, JSON.stringify({gameDigest, results, errors, missing, external}, null, 2));
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
