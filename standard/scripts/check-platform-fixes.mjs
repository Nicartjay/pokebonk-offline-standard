// Real bundled game, synthetic in-memory saves only. No installed save, live
// website, native updater, publication or user's running game is touched.
import {chromium} from "playwright-core";
import {createServer} from "node:http";
import {readFile, stat, mkdir, writeFile, readdir} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {parse} from "acorn";
import {nodesOf, maybeName, one} from "../../scripts/source.ts";
import {MIME} from "../desktop/protocol.mjs";

const output = "evidence/platform-fixes";
const currentRoot = path.resolve("build/standard-game");
const gameDigest = JSON.parse(await readFile(path.join(currentRoot, "asset-manifest.json"), "utf8")).gameDigest;
const compatibilityReview = process.env.CHECK_COMPAT_REVIEW === "1";
await mkdir(output, {recursive: true});
let activeRoot = path.resolve("build/standard-game");
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const name = url.pathname.replace(/^\/assets\/assets\//, "/assets/");
    const file = path.resolve(activeRoot, "." + (name === "/" ? "/index.html" : decodeURIComponent(name)));
    if (!file.startsWith(activeRoot + path.sep) || !(await stat(file)).isFile()) throw new Error("Not bundled.");
    let bytes = await readFile(file);
    // Review-only reader permission to exercise the REAL old serializers before
    // changing production's compatibility list. No game/serializer/save bytes
    // are changed; rerun without this flag after successful acceptance.
    if (compatibilityReview && activeRoot === currentRoot && name === "/offline/config.js") {
      const value = JSON.parse(bytes.toString().replace(/^export default /, "").replace(/;\s*$/, ""));
      value.compatibleRunBuilds = [...new Set([...value.compatibleRunBuilds, "mwqb4pwz", "mwro88g3"])];
      bytes = Buffer.from("export default " + JSON.stringify(value) + ";\n");
    }
    response.writeHead(200, {"Content-Type": MIME[path.extname(file)] ?? "application/octet-stream"});
    response.end(bytes);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [], external = [], missing = [], legacyMissing = [], results = [];
let browser;
async function session({root = "build/standard-game", platform = "android", saved = null,
  viewport = {width: 1280, height: 800}, legacyButtons = false} = {}) {
  activeRoot = path.resolve(root);
  const context = await browser.newContext({viewport, colorScheme: "light", deviceScaleFactor: 1,
    ...(platform === "android" ? {isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 13; Tablet) AppleWebKit/537.36 Chrome/108.0.0.0 Safari/537.36"} : {})});
  await context.route("**/*", route => {
    if (route.request().url().startsWith(origin + "/") || /^(?:blob:|data:)/.test(route.request().url())) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await context.addInitScript(({platform, saved, legacyButtons}) => {
    let disk = structuredClone(saved);
    // These test helpers are JS data closures, not native filesystem APIs.
    window.__readTestSave = () => structuredClone(disk);
    if (platform === "android") window.PokeBonkStandardAndroid = Object.freeze({
      loadState: () => JSON.stringify({ok: true, value: disk}),
      saveState: text => { disk = JSON.parse(text); return '{"ok":true,"value":true}'; },
    });
    else window.PokeBonkStandard = Object.freeze({
      loadState: async () => structuredClone(disk),
      saveState: async value => { disk = structuredClone(value); },
    });
    addEventListener("DOMContentLoaded", () => {
      document.documentElement.dataset.standardPlatform = platform;
      if (legacyButtons) {
        // Model tablet WebViews' button UA cross-axis defaults. The old build
        // collapses art under this default; the fix must not depend on it.
        const style = document.createElement("style");
        style.textContent = "button { align-items: flex-start; }";
        document.head.append(style);
      }
    }, {once: true});
  }, {platform, saved, legacyButtons});
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("response", response => {
    if (response.status() >= 400 && response.url().startsWith(origin)) {
      const url = new URL(response.url());
      // The exact published 0.1.1 fixture itself lacked this atlas. Preserve
      // that baseline verbatim and report its known omission separately.
      // The current game's corresponding request must succeed, not be waived.
      if (root === "build/compat-game-0.10.20" && response.status() === 404 &&
          url.pathname === "/assets/env/common/hazards.png" && url.searchParams.get("v") === "K_tZR6iP") {
        legacyMissing.push(response.url());
      } else missing.push(response.url());
    }
  });
  await page.goto(origin + "/index.html?lang=en");
  await page.waitForFunction(() => window.PokeBonkNativeApp?.meta?.account ||
    document.querySelector(".offline-boot-error"), {timeout: 30000});
  const bootError = page.locator(".offline-boot-error");
  const error = await bootError.count() ? await bootError.textContent() : null;
  if (error) throw new Error(error);
  if (await page.evaluate(() => typeof window.PokeBonkOfflineUI?.firstVisit === "function")) {
    await page.waitForFunction(() => document.documentElement.dataset.standardReady === "true", undefined, {timeout: 60000});
    if (!saved && activeRoot !== currentRoot) {
      await page.locator(".pb-guide .g-skip").waitFor();
      if (platform === "android") await page.locator(".pb-guide .g-skip").tap();
      else await page.locator(".pb-guide .g-skip").click();
      await page.locator(".pb-guide").waitFor({state: "detached"});
    }
  }
  return {context, page};
}
async function starters(page) {
  await page.locator(".sp-go").waitFor();
  await page.evaluate(() => { window.PokeBonkNativeApp.halted = true; });
  await page.waitForTimeout(600);
}
async function chooseStarters(page) {
  await page.evaluate(async () => {
    const app = window.PokeBonkNativeApp, account = app.meta.account;
    await app.backend.chooseStarter(account, 4);
    await app.backend.chooseStarter(account, 155);
    app.meta.adopt(await app.backend.loadProfile());
    app.toMenu();
  });
  await page.locator(".offline-menu").waitFor();
  if (await page.evaluate(() => typeof window.PokeBonkOfflineUI?.firstName === "function")) {
    // The focused onboarding suite covers the dialog; keep engine fixtures
    // named so an unrelated first-use prompt cannot cover real gameplay.
    await page.evaluate(async () => {
      const app = window.PokeBonkNativeApp;
      app.meta.adopt(await app.backend.renameLocal("Test Trainer"));
    });
  }
  if (await page.evaluate(() => typeof window.PokeBonkOfflineUI?.firstVisit === "function" &&
      window.PokeBonkNativeApp.backend.state.onboarding?.trainerGuide !== 1)) {
    await page.locator(".pb-guide .g-skip").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".pb-guide").waitFor({state: "detached"});
  }
}
async function startRun(page, mode) {
  await page.evaluate(async mode => {
    const app = window.PokeBonkNativeApp;
    app.meta.profile.settings.quality = "low";
    app.meta.profile.settings.pixel = .5;
    app.meta.profile.settings.tips = false;
    app.applySettings();
    await app.meta.saveNow();
    const started = await app.startRun({mode, species: 4, biome: "forest", tier: 0, boosts: []});
    if (!started || !app.run) throw new Error(`Could not start ${mode}.`);
    app.halted = false;
  }, mode);
  await page.waitForTimeout(800);
}
try {
  browser = await chromium.launch({headless: true,
    ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]});

  // Reproduce the screenshots without the fix, then verify real starter
  // canvases and complete headers using identical tablet/button conditions.
  for (const [root, fixed] of [["build/compat-game-0.10.20", false], ["build/standard-game", true]]) {
    const {context, page} = await session({root, legacyButtons: true});
    try {
      await starters(page);
      const cards = await page.locator(".sp-card").evaluateAll(nodes => nodes.map(node => {
        const header = node.querySelector(".sp-show"), canvas = header.querySelector("canvas");
        const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let painted = 0; for (let n = 3; n < pixels.length; n += 4) if (pixels[n]) painted++;
        return {card: node.getBoundingClientRect().width, header: header.getBoundingClientRect().width,
          canvas: canvas.getBoundingClientRect().width, painted};
      }));
      assert.equal(cards.length, 3);
      if (fixed) {
        for (const card of cards) {
          assert.ok(card.header >= card.card - 2 && card.canvas > 0 && card.painted > 0, JSON.stringify(card));
        }
      } else assert.ok(cards.some(card => card.header < 2), "The tablet regression fixture no longer models collapsed headers.");
      await page.screenshot({path: `${output}/tablet-starters-${fixed ? "fixed" : "reproduced"}.png`});
      results.push({phase: "tablet-starters", fixed, cards});
      console.log(`Checked tablet starter headers: ${fixed ? "fixed" : "original regression reproduced"}`);
    } finally { await context.close(); }
  }

  // Real game HUD and level-up cards, not hand-built geometry substitutes.
  const {context, page} = await session({legacyButtons: true});
  try {
    await starters(page); await chooseStarters(page); await startRun(page, "standard");
    const scales = await page.evaluate(() => {
      const app = window.PokeBonkNativeApp, result = [];
      app.halted = true;
      for (const scale of [.6, 1, 1.2, 1.5, 2]) {
        app.meta.profile.settings.mapScale = scale; app.applySettings();
        result.push({scale, width: app.hud.minimap.getBoundingClientRect().width,
          applied: app.hud.hudEl.style.getPropertyValue("--mm")});
      }
      return result;
    });
    for (let n = 1; n < scales.length; n++) assert.ok(scales[n].width > scales[n - 1].width, JSON.stringify(scales));
    assert.ok(Math.abs(scales.at(-1).width / scales[1].width - 2) < .02);
    results.push({phase: "real-minimap-scaling", scales});
    console.log("Checked real minimap growth from 60% through 200%.");
    const metadata = JSON.parse(await readFile("build/standard-game/offline-build.json", "utf8"));
    const source = await readFile("build/standard-game/assets/" + metadata.modules.main, "utf8");
    const level = one(nodesOf(parse(source, {ecmaVersion: "latest", sourceType: "module"}), "MethodDefinition",
      node => source.slice(node.start, node.end).includes("this.pendingLevels++") &&
      source.slice(node.start, node.end).length < 300), "level-up test hook");
    await page.evaluate(hook => {
      const app = window.PokeBonkNativeApp;
      app.run[hook](); app.halted = false;
    }, maybeName(level.key));
    await page.locator(".modal .card").first().waitFor({timeout: 15000});
    await page.waitForTimeout(450);
    const choices = await page.locator(".modal .card").evaluateAll(nodes => nodes.map(node => ({
      width: node.getBoundingClientRect().width, header: node.querySelector(".top").getBoundingClientRect().width,
      images: [...node.querySelectorAll(".top img")].map(img => ({complete: img.complete, width: img.naturalWidth})),
    })));
    assert.ok(choices.length >= 3);
    for (const card of choices) {
      assert.ok(card.header >= card.width - 2, JSON.stringify(card));
      assert.ok(card.images.every(img => img.complete && img.width > 0));
    }
    await page.screenshot({path: `${output}/tablet-level-up-fixed.png`});
    results.push({phase: "real-tablet-level-up", choices});
    console.log("Checked actual tablet level-up card artwork and full-width headers.");
    await page.locator(".modal .card").first().click();
    await page.evaluate(() => {
      const app = window.PokeBonkNativeApp;
      app.meta.profile.settings.fpsLimit = "120"; app.applySettings();
      const overlay = document.createElement("div");
      overlay.className = "screen";
      Object.assign(overlay.style, {position: "fixed", inset: "0", zIndex: "50000",
        pointerEvents: "auto", background: "var(--paper)"});
      overlay.append(app.hud.settingsPanel());
      document.getElementById("ui").append(overlay);
    });
    await page.getByRole("button", {name: /^Graphics/}).click();
    const saver = page.locator(".st-row.tog").filter({hasText: /^Battery saver/});
    await saver.waitFor();
    if (!await page.evaluate(() => window.PokeBonkNativeApp.saver)) await saver.getByRole("button").click();
    const fps = await page.evaluate(() => {
      const app = window.PokeBonkNativeApp;
      if (!app.saver || app.fpsCap() !== 30) throw new Error("The real battery-saver toggle did not override 120 FPS.");
      let frames = 0;
      const render = app.r.render.bind(app.r);
      app.r.render = dt => { frames++; return render(dt); };
      const start = performance.now();
      return new Promise(resolve => setTimeout(() => resolve({
        frames, seconds: (performance.now() - start) / 1000, cap: app.fpsCap(), requested: app.meta.profile.settings.fpsLimit,
      }), 3000));
    });
    assert.equal(fps.cap, 30); assert.equal(fps.requested, "120");
    assert.ok(fps.frames / fps.seconds <= 30.8, JSON.stringify(fps));
    assert.ok(fps.frames > 0, "The frame-limit check must not pass with a stopped renderer.");
    results.push({phase: "real-android-battery-saver", ...fps});
    console.log(`Checked real Android battery saver: ${fps.frames} renders / ${fps.seconds.toFixed(2)} seconds.`);
    assert.equal(await page.locator(".tc-fs").isVisible(), false);
  } finally { await context.close(); }

  // Actual prior-engine snapshots must replay, not merely pass JSON validation.
  // Relay deliberately does not support suspended runs upstream. Do not
  // manufacture one or alter that rule to make a compatibility test pass.
  const oldAppRoot = "build/local-test-1.0.0/macos-arm64/mac-arm64";
  const oldApp = (await readdir(oldAppRoot)).find(name => name.endsWith(".app"));
  if (!oldApp) throw new Error("Preserve the previously tested 0.10.23 package for real upgrade replay.");
  const previousRoots = ["build/compat-game-0.10.20", path.join(oldAppRoot, oldApp, "Contents/Resources/game")];
  for (const previousRoot of previousRoots) for (const mode of ["standard", "endless"]) {
    let saved, before;
    const previousBuild = JSON.parse(await readFile(path.join(previousRoot, "offline-build.json"), "utf8")).upstream.build;
    const old = await session({root: previousRoot});
    try {
      await starters(old.page); await chooseStarters(old.page); await startRun(old.page, mode);
      await old.page.evaluate(() => {
        // Non-default, synthetic runtime values make a silent fresh-run reset
        // observable even on slow software-rendered CI machines.
        const run = window.PokeBonkNativeApp.run;
        run.time = 42.5; run.stageTime = 17.25; run.gold = 123;
      });
      before = await old.page.evaluate(() => {
        const app = window.PokeBonkNativeApp;
        return {mode: app.run.mode, species: app.run.player.data.id, time: app.run.time, gold: app.run.gold,
          ticket: app.meta.ticket.id, stardust: app.meta.profile.stardust};
      });
      await old.page.evaluate(async () => {
        const app = window.PokeBonkNativeApp;
        if (app.run.state === "play") app.run.pause();
        const error = await app.run.saveAndQuitOnce();
        if (error) throw new Error("Previous-engine save refused: " + error);
        await app.backend.queue;
      });
      saved = await old.page.evaluate(() => window.__readTestSave());
      assert.ok(saved.state.suspended?.text, "Previous engine did not create a real checkpoint.");
    } finally { await old.context.close(); }
    const next = await session({saved});
    try {
      await next.page.waitForFunction(() => Boolean(window.PokeBonkNativeApp?.saved()));
      // signedIn already offers the preserved run. Use that actual Continue
      // button so its prompt is removed; calling resumeSaved behind it leaves
      // a modal intercepting the later pause-screen Continue button.
      await next.page.evaluate(() => { window.PokeBonkNativeApp.halted = true; });
      await next.page.locator(".season-modal").last().getByRole("button", {name:"Continue",exact:true}).tap();
      await next.page.waitForFunction(() => Boolean(window.PokeBonkNativeApp.run), undefined, {timeout:60000});
      const after = await next.page.evaluate(() => {
        const app = window.PokeBonkNativeApp;
        return {mode: app.run?.mode, species: app.run?.player.data.id, time: app.run?.time, gold: app.run?.gold,
          ticket: app.meta.ticket?.id, stardust: app.meta.profile.stardust, failing: app.failing};
      });
      assert.equal(after.mode, before.mode); assert.equal(after.species, before.species);
      assert.equal(after.ticket, before.ticket); assert.equal(after.stardust, before.stardust);
      assert.ok(after.time >= before.time - .1); assert.equal(after.gold, before.gold); assert.equal(after.failing, 0);
      await next.page.evaluate(() => {
        const app = window.PokeBonkNativeApp;
        app.halted = false;
      });
      try {
        // Resume may intentionally finish sprite warming into a pause overlay.
        // Wait for that actual state, then use the real user-facing Resume UI.
        await next.page.waitForFunction(() => ["play","paused"].includes(window.PokeBonkNativeApp.run?.state),
          undefined, {timeout:60000});
        if (await next.page.evaluate(() => window.PokeBonkNativeApp.run.state === "paused")) {
          await next.page.getByRole("button", {name:/^(?:Resume|Continue)$/i}).first().tap();
        }
        await next.page.waitForFunction(time => window.PokeBonkNativeApp.run?.time > time + .2, before.time, {timeout: 60000});
      } catch(error) {
        const diagnostics=await next.page.evaluate(()=>{
          const app=window.PokeBonkNativeApp;
          return {state:app.run?.state,time:app.run?.time,halted:app.halted,failing:app.failing,
            visible:!document.hidden,buttons:[...document.querySelectorAll("button")].filter(n=>n.getClientRects().length).map(n=>n.textContent.slice(0,80))};
        });
        results.push({phase:"checkpoint-replay-failure",previousBuild,mode,before,after,diagnostics});
        await next.page.screenshot({path:`${output}/replay-${previousBuild}-${mode}-failure.png`});
        throw error;
      }
      const played = await next.page.evaluate(() => {
        const app = window.PokeBonkNativeApp;
        return {state: app.run.state, time: app.run.time, ticket: app.meta.ticket.id, failing: app.failing};
      });
      assert.equal(played.ticket, before.ticket); assert.equal(played.failing, 0);
      assert.ok(played.time > before.time + .2, "The restored serializer must advance real simulation, not just decode JSON.");
      results.push({phase: "previous-engine-checkpoint-replay", previousBuild, mode, before, after, played});
      console.log(`Replayed ${previousBuild} ${mode} checkpoint in the updated engine.`);
    } finally { await next.context.close(); }
  }
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(missing, []);
  await writeFile(`${output}/${compatibilityReview ? "checks-compatibility-review" : "checks"}.json`, JSON.stringify({observedAt: new Date().toISOString(),
    gameDigest, compatibilityReview,
    physicalAndroidTested: false, syntheticSavesOnly: true, results, errors, external,
    currentGameMissingResources: missing, knownOriginalFixtureOmissions: legacyMissing}, null, 2));
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  await writeFile(`${output}/failure.json`, JSON.stringify({error: error.stack, results, errors, external, missing, legacyMissing}, null, 2));
  throw error;
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
