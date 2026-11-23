// Real bundled UI/engine smoke checks. All saves are synthetic in-memory
// fixtures, all remote requests are blocked, no installed game is controlled.
import {chromium} from "playwright-core";
import {createServer} from "node:http";
import {readFile, stat, mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {MIME} from "../desktop/protocol.mjs";

const root = path.resolve("build/standard-game"), output = "evidence/offline-content";
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
async function dialogFits(page, size, label) {
  await page.setViewportSize({width: size[0], height: size[1]});
  await page.waitForTimeout(200);
  await settle(page, ".offline-modal");
  const geometry = await page.locator(".offline-modal").last().evaluate(overlay => {
    const panel = overlay.querySelector(".offline-card"), rect = panel.getBoundingClientRect();
    return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      width: innerWidth, height: innerHeight, clientWidth: panel.clientWidth, scrollWidth: panel.scrollWidth,
      clientHeight: panel.clientHeight, scrollHeight: panel.scrollHeight};
  });
  assert.ok(geometry.left >= 0 && geometry.right <= geometry.width + 1 &&
    geometry.top >= 0 && geometry.bottom <= geometry.height + 1, `${label}: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 2, `${label} has outer horizontal overflow.`);
  results.push({phase: label, size, geometry});
}
const challengeScreen = {bossrush: ".screen.brs", tower: ".screen.ev-scr", mutation: ".screen.mu-scr"};
const challengePlay = {bossrush: ".br-go", tower: ".ev-go", mutation: ".mu-play"};
async function settle(page, selector) {
  await page.locator(selector).last().evaluate(async root => {
    await Promise.all(root.getAnimations({subtree: true})
      .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
      .map(animation => animation.finished.catch(() => {})));
  });
}
async function activateAnimated(page, locator, platform) {
  // Ready rewards deliberately pulse forever. Keep that animation and send a
  // real pointer/touch event at the live, unobscured button instead of waiting
  // for two identical animation frames or using a synthetic DOM .click().
  await locator.waitFor({state: "visible"});
  assert.equal(await locator.isEnabled(), true);
  const point = await locator.evaluate(node => {
    node.scrollIntoView({block: "center", inline: "center", behavior: "instant"});
    const box = node.getBoundingClientRect(), x = box.left + box.width / 2, y = box.top + box.height / 2;
    return {x, y, reachable: node.contains(document.elementFromPoint(x, y))};
  });
  assert.equal(point.reachable, true, "An earned reward button is obscured.");
  if (platform === "android") await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
}
async function openChallenge(page, mode, activate = locator => locator.tap()) {
  await page.locator(".offline-menu").waitFor();
  if (mode === "bossrush") await activate(page.locator(".mm-today > .event"));
  else {
    await activate(page.locator(".mm-modes > .hub"));
    await activate(page.locator(".mh-pill").filter({hasText: mode === "tower" ? "Lavender Tower" : "Daily Mutation"}));
  }
  await page.locator(challengeScreen[mode]).waitFor();
}
async function screenFits(page, selector, size, label) {
  await page.setViewportSize({width: size[0], height: size[1]});
  await page.waitForTimeout(400);
  await settle(page, selector);
  const geometry = await page.locator(selector).evaluate(root => {
    const rect = root.getBoundingClientRect();
    return {left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
      viewportWidth: innerWidth, viewportHeight: innerHeight, clientWidth: root.clientWidth, scrollWidth: root.scrollWidth,
      overflowX: getComputedStyle(root).overflowX,
      backTop: root.querySelector(".scr-head,.mu-top")?.getBoundingClientRect().top,
      titlebarHeight: document.getElementById("standard-titlebar")?.getBoundingClientRect().height ?? 0,
      overflow: [...root.querySelectorAll("*")].filter(node => {
        const box = node.getBoundingClientRect();
        return box.width && (box.left < rect.left - 1 || box.right > rect.right + 1);
      }).slice(0, 12).map(node => ({className: node.className, position: getComputedStyle(node).position,
        left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right,
        text: node.textContent.slice(0, 60)}))};
  });
  assert.ok(geometry.left >= -1 && geometry.right <= geometry.viewportWidth + 1 &&
    geometry.top >= -1 && geometry.bottom <= geometry.viewportHeight + 1, `${label}: ${JSON.stringify(geometry)}`);
  // In the upstream's scaled mobile screen, scrollWidth can include trailing
  // padding beyond an x-clipped scrollport even though every painted child is
  // inside it. That is not an offscreen button. Keep rejecting visible child
  // overflow or an actual horizontally scrollable/wider screen.
  const horizontalFit = geometry.scrollWidth <= geometry.clientWidth + 2 ||
    geometry.overflowX === "hidden" && geometry.overflow.length === 0;
  if (!horizontalFit) {
    await page.screenshot({path: `${output}/${label}-overflow.png`});
    await writeFile(`${output}/${label}-overflow.json`, JSON.stringify(geometry, null, 2));
  }
  assert.ok(horizontalFit,
    `${label} has horizontal screen overflow: ${JSON.stringify(geometry)}`);
  if (geometry.backTop != null) assert.ok(geometry.backTop >= geometry.titlebarHeight - 1,
    `${label} back controls overlap the native title bar.`);
  results.push({phase: label, size, geometry});
}
try {
  browser = await chromium.launch({headless: true,
    ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {}),
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]});
  for (const platform of engineOnly ? [] : ["darwin", "android"]) {
    const {context, page} = await session(platform);
    const activate = locator => platform === "android" ? locator.tap() : locator.click();
    try {
      assert.equal(await page.locator(".mm-modes > .play").count(), 1);
      assert.equal(await page.locator(".mm-modes > .mm-pair > .endless").count(), 2);
      assert.equal(await page.locator(".mm-modes .relay").count(), 0);
      assert.equal(await page.locator(".mm-pair .coop").count(), 1);
      await activate(page.locator(".mm-modes > .hub"));
      const relay = await page.locator(".mh-pill").filter({hasText: "Relay"}).locator(".rv-hubic img").evaluateAll(images => images.map(image => image.getAttribute("src")));
      assert.equal(relay.length, 2);
      assert.ok(relay.some(src => /portraits\/4\.png/.test(src)) && relay.some(src => /portraits\/155\.png/.test(src)),
        "Relay must show the real League Pokémon portraits, not the old item icon.");
      await page.keyboard.press("Escape");
      await page.locator(".mh").waitFor({state: "detached"});
      assert.equal(await page.locator(".mm-today > .event").count(), 1);
      assert.equal(await page.locator(".mm-today > .tasks .mm-pips > i").count(), 3);
      assert.equal(await page.locator(".mm-tiles > .tile").count(), 4);
      assert.equal(await page.locator(".mm-record-card").count(), 0);
      assert.equal(await page.locator(".offline-record-panel .offline-home-record-table").count(), 1);
      assert.equal(await page.locator(".tr-playable").getAttribute("aria-label").then(label => label.startsWith("2 of ")), true);
      assert.match(await page.locator(".offline-credit-links").textContent(), /Offline by Nicartjay/);
      assert.equal(await page.locator(".offline-label").count(), 0);
      for (const size of platform === "android" ? [[800, 360], [1024, 600], [1280, 800], [1600, 1000]] :
        [[960, 540], [1280, 720], [1440, 900], [1920, 1080]]) {
        await page.setViewportSize({width: size[0], height: size[1]});
        await page.waitForTimeout(300);
        await settle(page, ".offline-menu");
        const geometry = await page.locator(".offline-menu").evaluate(root => ({
          scrollWidth: root.scrollWidth, width: root.clientWidth,
          items: [...root.querySelectorAll(".mm-item")].map(node => {
            const rect = node.getBoundingClientRect();
            return {text: node.querySelector("b")?.textContent, left: rect.left, right: rect.right,
              width: rect.width, texts: [...node.querySelectorAll(".mm-tx b,.mm-tx small")].map(text => ({
                text: text.textContent, width: text.clientWidth, scrollWidth: text.scrollWidth,
              }))};
          }),
        }));
        assert.ok(geometry.scrollWidth <= geometry.width + 2, `${platform} ${size}: ${JSON.stringify(geometry)}`);
        for (const item of geometry.items) {
          assert.ok(item.left >= -1 && item.right <= geometry.width + 1 && item.width > 0, JSON.stringify(item));
          for (const text of item.texts) assert.ok(text.scrollWidth <= text.width + 1, JSON.stringify(text));
        }
        await page.screenshot({path: `${output}/${platform}-homepage-${size.join("x")}.png`});
      }
      await page.setViewportSize({width: 1440, height: 900});
      const badge = page.getByRole("button", {name: `PokéBonk Offline v${config.version} — version history`, exact: true});
      // The original logo floats continuously, so Playwright's "two identical
      // animation frames" stability wait is inapplicable. Exercise accessible
      // keyboard activation, then an ordinary pointer click at its live box.
      await badge.focus(); await page.keyboard.press("Enter");
      const history = page.locator(".offline-history-card");
      assert.match(await history.textContent(), new RegExp(`Installed offline app v${config.version.replaceAll(".", "\\.")}`));
      assert.equal(await history.locator(".offline-history-entry").count(), historyEntries.length);
      assert.ok((await history.textContent()).includes(`PokéBonk v${config.upstream.version}`));
      for (const size of [[960, 432], [1280, 800]]) await dialogFits(page, size, platform + "-history");
      await page.screenshot({path: `${output}/${platform}-version-history.png`});
      await activate(history.getByRole("button", {name: "Close", exact: true}));
      assert.equal(await page.locator(".offline-history-card").count(), 0);
      const badgeBox = await badge.boundingBox();
      assert.ok(badgeBox && badgeBox.width > 0 && badgeBox.height > 0);
      if (platform === "android") await page.touchscreen.tap(badgeBox.x + badgeBox.width / 2, badgeBox.y + badgeBox.height / 2);
      else await page.mouse.click(badgeBox.x + badgeBox.width / 2, badgeBox.y + badgeBox.height / 2);
      await history.waitFor();
      assert.equal(await page.locator(".offline-history-card").count(), 1);
      await activate(history.getByRole("button", {name: "Close", exact: true}));
      assert.equal(await page.locator(".offline-history-card").count(), 0);
      await page.setViewportSize({width: 1280, height: 800});
      for (const [mode, label] of [["bossrush", "Mewtwo Strikes Back"], ["tower", "Lavender Tower"], ["mutation", "Daily Mutation"]]) {
        await openChallenge(page, mode, activate);
        const screen = page.locator(challengeScreen[mode]);
        assert.equal(await screen.locator(".br-board,.br-prizes,.ev-board,.ev-prizes,.mu-board").count(), 0);
        assert.equal(await screen.getByRole("button", {name: /^(?:Leaderboard|Prizes|Clans|Co-op)$/i}).count(), 0);
        if (mode !== "mutation") {
          const tabs = screen.locator(mode === "bossrush" ? ".br-nav .br-tab" : ".ev-tabs > button");
          assert.equal(await tabs.count(), 3);
          for (let tab = 0; tab < 3; tab++) {
            await activate(tabs.nth(tab));
            assert.equal(await screen.locator(".br-board,.br-prizes,.ev-board,.ev-prizes").count(), 0);
          }
          await activate(tabs.first());
        }
        for (const size of [[800, 360], [1024, 600], [1280, 800]]) await screenFits(page, challengeScreen[mode], size, platform + "-" + mode);
        await page.screenshot({path: `${output}/${platform}-${mode}-details.png`});
        await page.keyboard.press("Escape");
        await page.locator(".offline-menu").waitFor();
      }
      await activate(page.locator(".offline-home-all"));
      assert.match(await page.locator(".offline-record-body").textContent(), /first personal best/);
      for (const label of ["KOs", "Survival", "Time Attack"]) await activate(page.locator(".offline-records-card").getByRole("tab", {name: label, exact: true}));
      await activate(page.locator(".offline-records-card").getByRole("button", {name: "Close", exact: true}));
      // Populate the local-only fixture by settling synthetic completed runs
      // through the real backend, not by inventing rows in the records UI.
      await page.evaluate(async () => {
        const app = window.PokeBonkNativeApp, backend = app.backend, account = app.meta.account;
        for (const [mode, kills, time] of [["standard", 200, 600], ["endless", 500, 1200], ["relay", 600, 1300], ["bossrush", 20, 700], ["tower", 200, 600]]) {
          const biome = mode === "bossrush" ? "newisland" : mode === "tower" ? "graveyard" : "forest";
          const ticket = await backend.startRun(account, {species: 4, mode, biome, tier: 0});
          const info = await backend.finishRun(account, ticket, {mode, species: 4, finalSpecies: 4, biome, tier: 0,
            kills, time, damage: 10000, level: 15, stage: 4, victory: ["standard", "bossrush"].includes(mode),
            alphas: 0, bosses: 5, legendaries: 1, reactions: 0, evolutions: 0, moves: ["ember"], items: [],
            splits: [180, 360, 540], ...(mode === "bossrush" ? {rush: {beaten: 5, zone: 10, done: true, week: 1, prep: 100}} : {}),
            ...(mode === "tower" ? {stage: 8, splits: [60, 120, 180, 240, 300, 360, 420],
              tower: {wave: 3, curses: [], marowak: true, won: true, reveals: 200, tricks: 5, candles: 10, offerings: []}} : {}),
            progress: {counters: {}, research: {}, seen: [], league: [], shinies: [], classics: [], forms: []}});
          app.meta.adopt(info.profile);
        }
      });
      await page.evaluate(() => window.PokeBonkNativeApp.toMenu());
      await activate(page.locator(".offline-home-all"));
      for (const [label, expected] of [["KOs", 5], ["Survival", 2], ["Time Attack", 2]]) {
        await activate(page.locator(".offline-records-card").getByRole("tab", {name: label, exact: true}));
        assert.equal(await page.locator(".offline-record-table tbody tr").count(), expected);
        assert.match(await page.locator(".offline-record-table").textContent(), /Charmander/);
        for (const size of [[800, 360], [1280, 800]]) await dialogFits(page, size, `${platform}-records-${label}`);
        await page.screenshot({path: `${output}/${platform}-records-${label.replaceAll(" ", "-").toLowerCase()}.png`});
      }
      await activate(page.locator(".offline-records-card").getByRole("tab", {name: "KOs", exact: true}));
      await activate(page.getByRole("button", {name:"Filter records by mode",exact:true}));
      await activate(page.getByRole("option", {name:/^Boss Rush/}));
      assert.equal(await page.locator(".offline-record-table tbody tr").count(), 1);
      await activate(page.locator(".offline-records-card").getByRole("button", {name: "Close", exact: true}));
      for (const [mode, id] of [["bossrush", "rush26"], ["tower", "halloween26"]]) {
        await page.setViewportSize({width: 1280, height: 800});
        await openChallenge(page, mode, activate);
        const screen = page.locator(challengeScreen[mode]);
        const tabs = screen.locator(mode === "bossrush" ? ".br-nav .br-tab" : ".ev-tabs > button");
        await activate(tabs.nth(1));
        await activateAnimated(page, screen.locator(mode === "bossrush" ? ".br-stop.ready .br-btn" : ".ev-step.ready .q-claim").first(), platform);
        await page.waitForFunction(id => window.PokeBonkNativeApp.meta.profile.events[id].got.includes(0), id);
        await activate(tabs.nth(2));
        await activateAnimated(page, screen.locator(mode === "bossrush" ? ".br-quest.ready .br-btn" : ".ev-quests .q-card.ready .q-claim").first(), platform);
        await page.waitForFunction(id => window.PokeBonkNativeApp.meta.profile.events[id].quests.length > 0, id);
        await page.keyboard.press("Escape");
        await page.locator(".offline-menu").waitFor();
      }
      await activate(page.getByRole("button", {name: "Player & saves", exact: true}));
      assert.equal(await page.locator(".offline-player-card [data-standard-native-action='check-for-updates']").getAttribute("href"),
        "/__native__/check-for-updates");
      await activate(page.locator(".offline-player-card").getByRole("button", {name: "Close", exact: true}));
      await activate(page.getByRole("button", {name: "Report a bug", exact: true}));
      assert.equal(await page.locator(".offline-report-card [data-standard-native-action='report-bug']").getAttribute("href"),
        "/__native__/report-bug");
      await activate(page.locator(".offline-report-card").getByRole("button", {name: "Close", exact: true}));
      await activate(page.locator(".mm-small .guide"));
      await page.locator(".pb-guide").waitFor();
      assert.ok(await page.locator(".pb-guide .g-tab:not([hidden])").count() > 3);
      assert.equal(await page.locator(".pb-guide").getByRole("button", {name: /co-op|clans|community/i}).count(), 0);
      await page.keyboard.press("Escape");
      await page.locator(".offline-menu").waitFor();
      await activate(page.locator(".mm-modes > .hub"));
      assert.equal(await page.locator(".mh-pill").count(), 4);
      assert.equal(await page.locator(".mh-pill").filter({hasText: "Relay"}).count(), 1);
      assert.equal(await page.locator(".mh-pill").filter({hasText: "Practice"}).count(), 0);
      await activate(page.locator(".mh-pill").filter({hasText: "The Great Expedition"}));
      await page.locator(".screen.exb .exb-chart").waitFor();
      assert.equal(await page.locator(".offline-expedition-draft").count(), 0);
      assert.equal(await page.locator(".screen.exb .exb-go-tile .ex-go").isDisabled(), false);
      assert.equal(await page.locator(".exb-party,.exb-season,.exb-scav").count(), 0);
      await page.keyboard.press("Escape");
      await page.locator(".offline-menu").waitFor();
      if (platform === "android") {
        await activate(page.getByRole("button", {name: "Player & saves", exact: true}));
        const menu = page.locator(".offline-player-card");
        assert.match(await menu.textContent(), /by Nicartjay/);
        for (const action of ["check-for-updates", "export-backup", "import-backup"]) {
          assert.equal(await menu.locator(`[data-standard-native-action="${action}"]`).count(), 1);
        }
        assert.equal(await menu.locator('input[type="file"]').count(), 0, "Android must use the native document picker.");
        assert.equal(await page.locator(".offline-app-menu-card").count(), 0);
        for (const size of [[800, 360], [1280, 800]]) await dialogFits(page, size, "android-player-saves");
        await activate(menu.getByRole("button", {name: "Close", exact: true}));
      }
      const blocked = await page.evaluate(() => window.PokeBonkOfflineNetwork.blocked);
      assert.deepEqual(blocked, []);
      results.push({phase: platform + "-ui", relay, blocked});
      console.log(`Checked ${platform} homepage, offline events, records tabs/filters and version history.`);
    } finally { await context.close(); }
  }
  // Launch the actual modes through their real Pokémon-selection button, run
  // simulation frames, then settle through the engine's result lifecycle.
  for (const mode of uiOnly ? [] : ["bossrush", "tower", "mutation"]) {
    const {context, page} = await session("android");
    try {
      await openChallenge(page, mode);
      await page.locator(challengePlay[mode]).tap();
      await page.locator(".ls-go").waitFor();
      // Back must return to the local archive—not a server board/prize page.
      await page.keyboard.press("Escape");
      await page.locator(challengeScreen[mode]).waitFor({timeout: 20000});
      await page.locator(challengePlay[mode]).tap();
      await page.locator(".ls-go").waitFor();
      const before = await page.evaluate(() => structuredClone(window.PokeBonkNativeApp.backend.state.profile));
      await page.locator(".ls-go").tap();
      await page.waitForFunction(mode => window.PokeBonkNativeApp?.run?.mode === mode, mode, {timeout: 60000});
      await page.evaluate(() => { window.PokeBonkNativeApp.halted = false; });
      // Sprite warming changes the real run to "transition". Do not mistake a
      // constructed-but-still-loading engine for a frozen game after 1 second.
      try {
        await page.waitForFunction(() => window.PokeBonkNativeApp?.run?.state === "play" &&
          window.PokeBonkNativeApp.run.time >= .2, undefined, {timeout: 60000});
      } catch (error) {
        const diagnostic = await page.evaluate(() => {
          const app = window.PokeBonkNativeApp;
          return {mode: app.run?.mode, state: app.run?.state, time: app.run?.time,
            halted: app.halted, failing: app.failing, modal: document.querySelector(".modal")?.textContent};
        });
        await page.screenshot({path: `${output}/android-${mode}-engine-failure.png`});
        console.error("Engine diagnostic:", JSON.stringify(diagnostic)); throw error;
      }
      const engine = await page.evaluate(() => {
        const app = window.PokeBonkNativeApp, run = app.run;
        app.halted = true;
        return {mode: run.mode, time: run.time, state: run.state,
          rush: run.rush && {lineup: run.rush.lineup.map(boss => boss.id), zone: run.rush.zone},
          tower: run.tower && {floor: run.tower.floor}, mutation: run.mutation?.def.id,
          ticket: app.meta.ticket.config};
      });
      assert.equal(engine.mode, mode);
      assert.ok(engine.time > 0, "Actual simulation must advance, not just construct a menu.");
      if (mode === "bossrush") assert.equal(engine.rush.lineup.length, 5);
      if (mode === "tower") assert.ok(engine.tower.floor >= 1);
      if (mode === "mutation") assert.equal(engine.mutation, engine.ticket.mutation);
      await page.screenshot({path: `${output}/android-${mode}-engine.png`});
      if (mode === "bossrush") {
        // Accelerated engine fixture, not a claim of human combat acceptance:
        // load every original room and spawn each actual clone, then drive its
        // normal defeated callback. No renderer/gameplay implementation is
        // substituted, and this context has no access to real player saves.
        engine.rooms = await page.evaluate(async () => {
          const app = window.PokeBonkNativeApp, run = app.run, rooms = [];
          run.godMode = true;
          for (let zone = 2; zone <= 10; zone++) {
            await run.rushAdvance();
            if (run.state !== "play" || run.rush.zone !== zone) throw new Error("Could not build Boss Rush room " + zone +
              ": " + JSON.stringify({state: run.state, actualZone: run.rush.zone, dead: run.player.dead, hp: run.player.hp, failing: app.failing}));
            let boss = null;
            if (zone % 2 === 0) {
              run.spawnBoss(0, 0);
              const index = run.boss.bossIndex;
              if (index < 0 || !run.enemies.alive[index]) throw new Error("Could not spawn clone in room " + zone);
              boss = run.rush.boss.id;
              // A real spawn owns an intro cinematic. Killing the fixture
              // during that intro leaves it in an impossible state; let the
              // ordinary simulation finish the intro before the test defeat.
              app.halted = false;
              const until = performance.now() + 20000;
              while (run.state !== "play" && performance.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
              app.halted = true;
              if (run.state !== "play") throw new Error("Clone intro did not complete in room " + zone + ": " + run.state);
              run.enemies.hp[index] = 0;
              run.enemies.alive[index] = 0;
              run.stats.kills++;
              run.rush.onBossKilled(index);
            }
            rooms.push({zone, boss, beaten: run.rush.beaten});
          }
          await run.finish(true);
          return rooms;
        });
        assert.equal(engine.rooms.length, 9);
        assert.equal(engine.rooms.filter(room => room.boss != null).length, 5);
        assert.equal(engine.rooms.at(-1).beaten, 5);
      } else {
        engine.expectedProgress = await page.evaluate(async () => {
          const app = window.PokeBonkNativeApp, backend = app.backend;
          let expected = null;
          if (app.run.tower) {
            // A near-empty abandonment may be ineligible under the real
            // progression rules. Compare against those reviewed rules on a
            // copy, rather than minting a free run counter to satisfy a test.
            const profile = structuredClone(backend.state.profile);
            const result = app.run.result(false);
            const normalized = {...result, progress: {
              counters: {}, research: {}, seen: [], league: [], shinies: [], classics: [], forms: [], ...result.progress,
            }};
            backend.rules.Ut(profile, normalized, backend.data(), {
              ...backend.state.activeRun.ticket, uid: backend.state.playerId,
              now: backend.now(), clean: true, ranked: true, coop: false,
            });
            expected = {counters: profile.counters, stardust: profile.stardust, totalStardust: profile.totalStardust};
          }
          await app.run.finish(false);
          return expected;
        });
      }
      if (mode !== "mutation") {
        await page.locator(".offline-challenge-result").waitFor();
        const after = await page.evaluate(() => window.PokeBonkNativeApp.backend.state.profile);
        if (mode === "tower") {
          assert.deepEqual(after.counters, engine.expectedProgress.counters);
          assert.equal(after.stardust, engine.expectedProgress.stardust);
          assert.equal(after.totalStardust, engine.expectedProgress.totalStardust);
        } else assert.equal(after.counters.runs, (before.counters.runs ?? 0) + 1);
        assert.ok(after.stardust >= before.stardust, "Earned progression must be committed with the event result.");
        assert.equal(await page.evaluate(() => Object.values(window.PokeBonkNativeApp.backend.state.finished)
          .some(info => info.localEventRewards === true)), true);
        if (mode === "bossrush") assert.ok(after.events.rush26.pts > (before.events?.rush26?.pts ?? 0));
        assert.equal(await page.locator(".offline-challenge-result").getByRole("button", {name: /prizes|leaderboard|claim/i}).count(), 0);
        if (mode === "bossrush") assert.equal(await page.evaluate(() =>
          window.PokeBonkNativeApp.backend.recordsLocal("time").filter(row => row.mode === "bossrush").length), 1);
      } else await page.locator(".sm-modal").waitFor();
      assert.deepEqual(await page.evaluate(() => window.PokeBonkOfflineNetwork.blocked), []);
      results.push({phase: "real-engine-smoke", ...engine});
      console.log(`Checked real offline ${mode} engine initialization, frames, Back navigation and settlement.`);
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, [], "Browser/engine errors.");
  assert.deepEqual(missing, [], "Missing bundled content.");
  assert.deepEqual(external, [], "External requests.");
  await writeFile(`${output}/${engineOnly ? "engine-checks" : uiOnly ? "ui-checks" : "checks"}.json`, JSON.stringify({
    scope, observedAt: new Date().toISOString(), gameDigest,
    config: {version: config.version, upstream: config.upstream},
    results, errors, missing, external}, null, 2) + "\n");
  console.log(`${engineOnly ? "Offline engine" : uiOnly ? "Offline UI" : "Offline content"} checks passed: no missing assets or attempted external requests.`);
} finally {
  await writeFile(`${output}/${engineOnly ? "engine-" : uiOnly ? "ui-" : ""}diagnostics.json`,
    JSON.stringify({scope, gameDigest, results, errors, missing, external}, null, 2) + "\n");
  if (errors.length || missing.length || external.length) console.error("Offline-content diagnostics:", JSON.stringify({errors, missing, external}));
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
