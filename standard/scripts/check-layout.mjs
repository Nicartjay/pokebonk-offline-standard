// Real bundled UI in a headless, temporary browser profile. No native app save,
// live website, updater, or user's browser/profile is touched.
import {chromium} from "playwright-core";
import {createServer} from "node:http";
import {readFile, writeFile, stat, mkdir} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {MIME} from "../desktop/protocol.mjs";
const root = path.resolve("build/standard-game");
const gameDigest = JSON.parse(await readFile(path.join(root, "asset-manifest.json"), "utf8")).gameDigest;
const platform = process.env.CHECK_PLATFORM ?? "darwin";
assert.ok(["darwin", "win32", "android"].includes(platform), "Unsupported CHECK_PLATFORM.");
const output = path.resolve("evidence/standard-layout", platform);
const androidInsets = {left: 44, top: 20, right: 28, bottom: 24};
await mkdir(output, {recursive: true});
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const pathname = url.pathname.replace(/^\/assets\/assets\//, "/assets/");
    const file = path.resolve(root, "." + (pathname === "/" ? "/index.html" : decodeURIComponent(pathname)));
    if (!file.startsWith(root + path.sep) || !(await stat(file)).isFile()) throw new Error("Not a bundled asset.");
    response.writeHead(200, {"Content-Type": MIME[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store"});
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [], requests = [], results = [];
try {
  // Prefer Playwright's already-installed headless shell, not the user's Chrome
  // app/updater. CHROME_PATH is an explicit fallback; this never downloads one.
  browser = await chromium.launch({...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {}), headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"]});
  const context = await browser.newContext({viewport: {width: 1280, height: 720}, colorScheme: "dark",
    ...(platform === "android" ? {isMobile: true, hasTouch: true, deviceScaleFactor: 3,
      userAgent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/138 Mobile Safari/537.36"} : {})});
  await context.route("**/*", route => {
    if (route.request().url().startsWith(origin + "/") || /^(?:data:|blob:)/.test(route.request().url())) return route.continue();
    requests.push(route.request().url());
    return route.abort();
  });
  await context.addInitScript(platform => {
    let saved = null;
    if (platform === "android") window.PokeBonkStandardAndroid = Object.freeze({
      loadState() { return JSON.stringify({ok: true, value: saved}); },
      saveState(text) { saved = JSON.parse(text); return '{"ok":true,"value":true}'; },
    });
    else window.PokeBonkStandard = Object.freeze({
      async loadState() { return structuredClone(saved); },
      async saveState(value) { saved = structuredClone(value); },
    });
    addEventListener("DOMContentLoaded", () => {
      document.documentElement.dataset.standardPlatform = platform;
      document.documentElement.dataset.standardFullscreen = "false";
      if (platform !== "android") {
        const drag = document.createElement("div");
        drag.id = "standard-titlebar";
        document.body.append(drag);
      }
    }, {once: true});
  }, platform);
  const page = await context.newPage();
  const activate = locator => platform === "android" ? locator.tap() : locator.click();
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/index.html?lang=en");
  await page.locator(".screen.sp .sp-go").waitFor();
  await page.evaluate(() => {
    // These are UI/layout checks, not a GPU benchmark. Keep the real DOM and 2D
    // character sprites, but stop the unrelated 3D background in headless mode.
    globalThis.PokeBonkNativeApp.halted = true;
    document.querySelector("canvas#game").style.visibility = "hidden";
  });
  const sizes = platform === "android" ? [[800, 360], [960, 432], [1024, 600], [1280, 800], [1600, 1000], [640, 360]]
    : [[960, 540], [1100, 650], [1280, 720], [1440, 900], [1920, 1080], [640, 360]];
  async function setSize(size) {
    await page.setViewportSize({width: size[0], height: size[1]});
    if (platform === "android") await page.evaluate(({insets, width, height}) => {
      // Simulate the one-way native message, not a new callable native API.
      dispatchEvent(new CustomEvent("standard:android-insets", {detail: {
        width: width * 3, height: height * 3,
        menuSize: 0, menuGap: 0,
        ...Object.fromEntries(Object.entries(insets).map(([side, value]) => [side, value * 3])),
      }}));
    }, {insets: androidInsets, width: size[0], height: size[1]});
  }
  async function measure(screen, size, phase = screen.includes(".sp") ? "starters" : "menu") {
    await setSize(size);
    await page.waitForTimeout(600); // Wait for the game's resize/entry animation.
    if (platform === "android") {
      // Touch code deliberately changes the virtual viewport on short phones.
      // Under CPU load the resize can finish after a fixed 600 ms sleep. Wait
      // for its required fit condition, keeping the same hard assertions below.
      await page.waitForFunction(selector => {
        const root=document.querySelector(selector);
        return root && root.scrollWidth<=root.clientWidth+2 &&
          (!root.classList.contains("sp") || root.scrollHeight<=root.clientHeight+1);
      }, screen, {timeout:10000});
    }
    await page.locator(screen).evaluate(async root => {
      await Promise.all(root.getAnimations({subtree: true})
        .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
        .map(animation => animation.finished.catch(() => {})));
    });
    const geometry = await page.locator(screen).evaluate(root => {
      const outer = root.getBoundingClientRect();
      const boxes = [...root.querySelectorAll(root.classList.contains("sp")
        ? ".sp-head,.sp-card,.sp-go"
        : ".mm-top,.mm-left,.mm-modes,.mm-modes .mm-tx b,.mm-modes .mm-tx small,.mm-foot")].map(node => {
        const r = node.getBoundingClientRect(), style = getComputedStyle(node);
        return {text: node.textContent.slice(0, 65), left: r.left, right: r.right, top: r.top, bottom: r.bottom,
          width: r.width, height: r.height, textOverflow: style.textOverflow, whiteSpace: style.whiteSpace,
          modeText: ["B", "SMALL"].includes(node.tagName) && Boolean(node.closest(".mm-modes")),
          scrollWidth: node.scrollWidth, clientWidth: node.clientWidth};
      });
      return {left: outer.left, right: outer.right, top: outer.top, height: outer.height,
        viewport: {width: innerWidth, height: innerHeight}, platform: document.documentElement.dataset.standardPlatform,
        padding: getComputedStyle(root).padding,
        safeLeft: getComputedStyle(document.documentElement).getPropertyValue("--standard-android-safe-left"),
        clientHeight: root.clientHeight, scrollHeight: root.scrollHeight, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth,
        overflowElements: [...root.querySelectorAll("*")].filter(node => {
          const rect = node.getBoundingClientRect();
          return rect.width && (rect.left < outer.left - 1 || rect.right > outer.right + 1);
        }).slice(0, 12).map(node => ({className: node.className, text: node.textContent.slice(0, 60),
          left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right})),
        boxes, nativeSaveBridgeOnly: Object.keys(window.PokeBonkStandard ?? window.PokeBonkStandardAndroid),
        starterCompact: root.classList.contains("standard-starter-compact"),
        artHeights: [...root.querySelectorAll(".sp-show")].map(node => node.getBoundingClientRect().height),
        starterNames: [...root.querySelectorAll(".sp-show .ls-plate h1")].map(node => ({
          text: node.textContent, lines: node.getBoundingClientRect().height / parseFloat(getComputedStyle(node).lineHeight),
          scrollWidth: node.scrollWidth, clientWidth: node.clientWidth,
        })),
        sprites: [...root.querySelectorAll(".sp-show .ls-spr")].map(canvas => ({
          width: canvas.width, height: canvas.height,
          cssWidth: canvas.getBoundingClientRect().width, cssHeight: canvas.getBoundingClientRect().height,
          alphaBounds: (() => {
            const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
            let left = canvas.width, top = canvas.height, right = 0, bottom = 0, pixels = 0, hidden = 0;
            const r = canvas.getBoundingClientRect(), art = canvas.closest(".sp-show").getBoundingClientRect();
            const plate = canvas.closest(".sp-show").querySelector(".ls-plate").getBoundingClientRect();
            for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
              if (data[(y * canvas.width + x) * 4 + 3]) {
                left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
                pixels++;
                const px = r.left + (x + .5) * r.width / canvas.width, py = r.top + (y + .5) * r.height / canvas.height;
                if (px < art.left || px > art.right || py < art.top || py > art.bottom ||
                    px >= plate.left && px <= plate.right && py >= plate.top && py <= plate.bottom) hidden++;
              }
            }
            return {left, right, top, bottom, pixels, hiddenFraction: hidden / pixels};
          })(),
        }))};
    });
    // Upstream deliberately scales the mobile layout viewport to fit short
    // phones. DOM geometry is in layout CSS pixels, not screen/device pixels.
    // Native geometry must not add margins or reserve a removed ⋮ button.
    const safe = {left: 0, top: 0, right: 0, bottom: 0};
    if (geometry.scrollWidth > geometry.clientWidth + 2) {
      await writeFile(path.join(output, "layout-failure.json"), JSON.stringify({screen, size, geometry}, null, 2));
      await page.screenshot({path: path.join(output, "layout-failure.png")});
    }
    assert.ok(geometry.scrollWidth <= geometry.clientWidth + 2,
      `${screen} has horizontal overflow at ${size}: ${JSON.stringify(geometry.overflowElements)}`);
    if (platform === "android" && geometry.artHeights.length) {
      if (geometry.scrollHeight > geometry.clientHeight + 1) {
        await writeFile(path.join(output, "layout-failure.json"), JSON.stringify({screen,size,geometry},null,2));
        await page.screenshot({path:path.join(output,"layout-failure.png")});
      }
      assert.equal(geometry.artHeights.length, 3);
      assert.ok(Math.max(...geometry.artHeights) - Math.min(...geometry.artHeights) <= 1,
        `Starter image containers have different heights at ${size}: ${geometry.artHeights}`);
      assert.ok(geometry.scrollHeight <= geometry.clientHeight + 1,
        `Android starter selection needs vertical scrolling at ${size}.`);
      for (const box of geometry.boxes) assert.ok(box.top >= -1 && box.bottom <= geometry.viewport.height + 1,
        `Starter content leaves the viewport at ${size}: ${JSON.stringify(box)}`);
      if (size[1] >= 800) assert.equal(geometry.starterCompact, false, "A roomy tablet must retain the full layout.");
      if (!geometry.starterCompact) assert.ok(Math.min(...geometry.artHeights) >= 219,
        "Roomy mode was selected without enough artwork space.");
    }
    for (const sprite of geometry.sprites) assert.ok(sprite.alphaBounds.hiddenFraction <= .05,
      `Character pixels are clipped/covered at ${size}: ${JSON.stringify(sprite)}`);
    for (const name of geometry.starterNames) assert.ok(name.lines <= 1.1 && name.scrollWidth <= name.clientWidth + 1,
      `Starter name wraps or overflows at ${size}: ${JSON.stringify(name)}`);
    for (const box of geometry.boxes) {
      assert.ok(box.left >= geometry.left - 1 && box.right <= geometry.right + 1, `${screen}: clipped ${box.text} at ${size}`);
      if (platform === "android") assert.ok(box.left >= safe.left - 1 && box.right <= geometry.viewport.width - safe.right + 1,
        `Android content entered a side cutout at ${size}: ${JSON.stringify({box, padding: geometry.padding, viewport: geometry.viewport, platform: geometry.platform, safeLeft: geometry.safeLeft})}`);
      assert.ok(box.width > 0 && box.height > 0, `Hidden ${box.text} at ${size}`);
      if (box.modeText) {
        assert.equal(box.whiteSpace, "normal");
        assert.notEqual(box.textOverflow, "ellipsis");
        assert.ok(box.scrollWidth <= box.clientWidth + 1, `Mode text overflows at ${size}: ${box.text}`);
      }
    }
    // Start/end remain reachable even if a short window needs vertical scrolling.
    await page.locator(screen).evaluate(node => { node.scrollTop = 0; });
    const first = await page.locator(screen + (screen.includes(".sp") ? " .sp-head" : " .mm-top")).boundingBox();
    assert.ok(first.y >= (platform === "android" ? safe.top : geometry.top) - 1, `Header starts above the safe viewport at ${size}`);
    const last = page.locator(screen + (screen.includes(".sp") ? " .sp-go" : " .mm-foot"));
    await last.scrollIntoViewIfNeeded();
    // Reachability includes scrolling all the way down, not merely Chromium's
    // definition of "visible" (which may include an Android gesture inset).
    await page.locator(screen).evaluate(node => { node.scrollTop = node.scrollHeight; });
    const end = await last.boundingBox();
    assert.ok(end.y >= geometry.top - 1 && end.y + end.height <= geometry.viewport.height - (platform === "android" ? safe.bottom : 0) + 1,
      `Footer is unreachable at ${size}: ${JSON.stringify({end, viewport: geometry.viewport, safe, padding: geometry.padding})}`);
    await page.locator(screen).evaluate(node => { node.scrollTop = 0; });
    results.push({screen, phase, size, geometry});
    await writeFile(path.join(output, "progress.json"), JSON.stringify(results, null, 2));
    await page.screenshot({path: path.join(output, `${phase}-${size[0]}x${size[1]}.png`)});
    console.log(`Checked ${phase} at ${size[0]}x${size[1]}`);
  }
  for (const size of sizes) await measure(".screen.sp", size);
  await setSize([1280, 720]);
  for (const name of ["Charmander", "Cyndaquil"]) {
    await activate(page.locator(".sp-go"));
    await activate(page.getByRole("button", {name: `Yes, I choose ${name}`, exact: true}));
    if (name === "Charmander") {
      await page.getByRole("heading", {name: "Choose your Johto partner!"}).waitFor();
      await measure(".screen.sp", [960, 540], "johto-starters");
      await setSize([1280, 720]);
    }
  }
  await page.locator(".screen.offline-menu").waitFor();
  await page.locator(".pb-guide .g-skip").waitFor({timeout: 30000});
  await activate(page.locator(".pb-guide .g-skip"));
  await page.locator(".pb-guide").waitFor({state: "detached"});
  await page.locator(".offline-name-setup").waitFor();
  await page.getByLabel("Player name", {exact: true}).fill("Test Trainer");
  await activate(page.getByRole("button", {name: "Start adventure", exact: true}));
  await page.locator(".offline-name-setup").waitFor({state: "detached"});
  if (platform !== "android") {
    await page.locator(".mm-item.endless:not(.relay)").hover();
    assert.equal(await page.locator(".mm-item.endless:not(.relay)").evaluate(node => node.classList.contains("focus")), true,
      "Mouse hover must select the same animated focus state as the keyboard.");
    await page.mouse.move(0, 0);
    await page.locator(".mm-item.endless:not(.relay)").focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.locator(".mm-item.relay").evaluate(node => node.classList.contains("focus")), true);
    const relay = await page.locator(".mm-item.relay").evaluate(node => ({
      modeStyle: node.classList.contains("endless"), background: getComputedStyle(node).backgroundImage,
    }));
    assert.equal(relay.modeStyle, true, "Relay must use the same decorated mode-button design.");
    assert.ok(relay.background.includes("gradient"), "Relay still looks like an unstyled white utility button.");
    await page.mouse.move(0, 0);
  } else assert.equal(await page.locator(".offline-fullscreen").count(), 0, "Android still creates a fullscreen menu control.");
  if (platform === "android") assert.equal(await page.locator(".offline-menu .mm-top").evaluate(node =>
    getComputedStyle(node).paddingRight), "0px", "The removed Android overlay still reserves a slot.");
  for (const size of sizes) await measure(".screen.offline-menu", size);
  const backdrop = await page.locator(".screen.offline-menu").evaluate(node => {
    const style = getComputedStyle(node, "::before");
    return {position: style.position, top: style.top, height: parseFloat(style.height),
      width: parseFloat(style.width), viewportWidth: innerWidth, viewportHeight: innerHeight};
  });
  assert.equal(backdrop.position, "fixed", "Menu tint must not start below the transparent title bar.");
  assert.equal(backdrop.top, "0px");
  assert.ok(Math.abs(backdrop.height - backdrop.viewportHeight) <= 1 &&
    Math.abs(backdrop.width - backdrop.viewportWidth) <= 1, "Menu backdrop does not fill the viewport.");
  results.push({phase: "full-bleed-menu-backdrop", backdrop});

  await setSize([1280, 720]);
  await activate(page.getByRole("button", {name: "Appearance", exact: true}));
  const appearance = page.locator(".offline-appearance .lk-card");
  await appearance.waitFor();
  await activate(appearance.locator(":scope > .seg").getByRole("button", {name: "Pokémon", exact: true}));
  for (const size of platform === "android" ? [[800, 360], [1024, 600]] : [[960, 540], [1280, 720], [1920, 1080]]) {
    await setSize(size);
    await page.waitForTimeout(450);
    const layout = await appearance.evaluate(panel => {
      const grid = panel.querySelector(":scope > .lk-grid");
      grid.scrollTop = grid.scrollHeight / 2;
      const hint = panel.querySelector(":scope > .lk-info");
      const footer = panel.lastElementChild;
      const box = node => {
        const r = node.getBoundingClientRect();
        return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height};
      };
      const gridBox = box(grid), footerBox = box(footer);
      const empty = {gap: footerBox.top - gridBox.bottom, display: getComputedStyle(hint).display};
      // A real help message must still be shown, rather than hiding all hints.
      hint.textContent = "Locked avatar: capture this Pokémon to unlock its appearance.";
      const message = {display: getComputedStyle(hint).display, hint: box(hint), footer: box(footer)};
      hint.textContent = "";
      return {panel: box(panel), grid: box(grid), footer: box(footer), empty, message,
        panelScrollHeight: panel.scrollHeight, panelClientHeight: panel.clientHeight,
        gridClientHeight: grid.clientHeight, gridScrollHeight: grid.scrollHeight,
        viewportHeight: innerHeight};
    });
    assert.equal(layout.empty.display, "none", "An empty appearance hint reserves footer space.");
    assert.ok(layout.empty.gap >= 0 && layout.empty.gap <= 12, `Oversized appearance footer gap: ${JSON.stringify(layout)}`);
    assert.ok(layout.gridScrollHeight > layout.gridClientHeight && layout.gridClientHeight > 40,
      `Avatar list cannot scroll: ${JSON.stringify(layout)}`);
    assert.ok(layout.footer.top >= layout.grid.bottom && layout.footer.bottom <= layout.panel.bottom,
      "Avatar list overlaps the action buttons.");
    assert.notEqual(layout.message.display, "none");
    assert.ok(layout.message.hint.height > 0 && layout.message.footer.top >= layout.message.hint.bottom,
      "A populated appearance hint is hidden or overlaps the footer.");
    assert.ok(layout.panel.top >= 0 && layout.panel.bottom <= layout.viewportHeight + 1, "Appearance dialog extends offscreen.");
    results.push({phase: "appearance-footer", size, layout});
    await page.screenshot({path: path.join(output, `appearance-footer-${size[0]}x${size[1]}.png`)});
    console.log(`Checked appearance footer at ${size[0]}x${size[1]}`);
  }
  await activate(appearance.getByRole("button", {name: "Cancel", exact: true}));
  for (const [phase, button] of [["settings-background", "Settings"], ["play-background", null]]) {
    await setSize([1280, 720]);
    await activate(button ? page.getByRole("button", {name: button, exact: true}) : page.locator(".mm-modes > .play"));
    const scene = page.locator("#ui > .screen").last();
    await scene.locator(".back-btn").waitFor();
    for (const size of platform === "android" ? [[800, 360]] : [[960, 540], [1280, 720]]) {
      await setSize(size);
      await page.waitForTimeout(400);
      await scene.evaluate(async screen => {
        // setScreen() has a delayed Web Animations entrance in addition to CSS
        // fadeIn. Measure its settled layout, not an intermediate swipe frame.
        await Promise.all(screen.getAnimations({subtree: true})
          .filter(animation => Number.isFinite(animation.effect.getComputedTiming().endTime))
          .map(animation => animation.finished.catch(() => {})));
      });
      const bounds = await scene.evaluate(screen => {
        const rect = node => {
          const r = node.getBoundingClientRect();
          return {top: r.top, bottom: r.bottom, width: r.width, height: r.height};
        };
        return {screen: rect(screen), ui: rect(document.getElementById("ui")),
          canvas: rect(document.querySelector("canvas#game")),
          header: rect(screen.querySelector(".scr-head") ?? screen.querySelector("h1")),
          titlebarHeight: document.getElementById("standard-titlebar")?.getBoundingClientRect().height ?? 0,
          className: screen.className, background: getComputedStyle(screen).backgroundImage,
          viewportHeight: innerHeight};
      });
      // Preserve evidence even if a layout assertion fails.
      await page.screenshot({path: path.join(output, `${phase}-${size[0]}x${size[1]}.png`)});
      for (const name of ["screen", "ui", "canvas"]) {
        assert.equal(bounds[name].top, 0, `${phase}: ${name} is inset, cutting off its background.`);
        assert.ok(Math.abs(bounds[name].height - bounds.viewportHeight) <= 1, `${phase}: ${name} is not full-height.`);
      }
      assert.ok(bounds.header.top >= bounds.titlebarHeight, `${phase}: controls overlap the native title bar: ${JSON.stringify(bounds)}`);
      results.push({phase, size, bounds});
      console.log(`Checked ${phase} at ${size[0]}x${size[1]}`);
    }
    await activate(scene.locator(".back-btn"));
    await page.locator(".screen.offline-menu").waitFor();
  }
  await setSize(sizes.at(-1));

  if (platform !== "android") {
  const drag = await page.locator("#standard-titlebar").boundingBox();
  assert.equal(drag.x, platform === "win32" ? 0 : 88);
  assert.equal(drag.y, 0);
  assert.equal(drag.height, 40);
  if (platform === "win32") assert.ok(drag.x + drag.width <= 640 - 160, "Drag hitbox covers native Windows caption buttons.");
  const fullscreen = page.getByRole("button", {name: "Enter fullscreen", exact: true});
  assert.equal(await fullscreen.locator("svg path").count(), 1);
  assert.equal(await fullscreen.locator("img").count(), 0);
  const enterPath = await fullscreen.locator("svg path").getAttribute("d");
  await page.evaluate(() => {
    document.documentElement.dataset.standardFullscreen = "true";
    document.dispatchEvent(new Event("standard:window-state"));
  });
  for (const size of [[960, 540], [1920, 1080]]) await measure(".screen.offline-menu", size, "fullscreen-menu");
  const exit = page.getByRole("button", {name: "Exit fullscreen", exact: true});
  assert.equal(await exit.locator("svg path").count(), 1);
  assert.equal(await exit.locator("img").count(), 0);
  assert.notEqual(await exit.locator("svg path").getAttribute("d"), enterPath);
  assert.equal(await page.locator("#ui").evaluate(node => getComputedStyle(node).top), "0px");
  assert.equal(await page.locator("#standard-titlebar").isVisible(), false);
  } else {
    await setSize([800, 360]);
    assert.equal(await page.locator("#test-native-android-menu,.offline-app-menu-card").count(),0,
      "The removed Android menu overlay must not be recreated.");
    // Real upstream touch-control and HUD CSS, with isolated geometry fixtures.
    // Do not create a run or mutate the user's profile just to inspect padding.
    const controls = await page.evaluate(insets => {
      const fixture = document.createElement("div");
      fixture.className = "passthru";
      fixture.innerHTML = '<div class="tc on"><div class="tc-btn tc-sm tc-pause"></div><div class="tc-btn tc-jump"></div><div class="tc-stick"></div></div><div id="hud"><div class="hud-tl">HUD</div><div class="hud-top">Timer</div><div class="hud-tr">Map</div><div class="hud-bl">Skills</div><div class="hud-br">Bag</div></div>';
      Object.assign(fixture.style, {position: "absolute", inset: "0"});
      document.getElementById("ui").append(fixture);
      const results = [];
      const wasTouch = document.documentElement.classList.contains("touch");
      for (const touch of [false, true]) for (const scale of [.65, 1, 1.3]) {
        document.documentElement.classList.toggle("touch", touch);
        const effective = window.PokeBonkOfflineUI.presentationSettings({hudScale: 1, touchScale: scale});
        fixture.style.setProperty("--tcs", String(effective.touchScale));
        fixture.querySelector("#hud").style.setProperty("--hs", String(effective.hudScale));
        for (const node of fixture.querySelectorAll(".tc-pause,.tc-jump,.tc-stick,.hud-tl,.hud-top,.hud-tr,.hud-bl,.hud-br")) {
          const r = node.getBoundingClientRect();
          if (r.width && r.height) results.push({touch, scale, effective, control: node.className,
            left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height});
        }
      }
      document.documentElement.classList.toggle("touch", wasTouch);
      const canvas = document.querySelector("canvas#game").getBoundingClientRect();
      fixture.remove();
      return {insets, results, viewport: {width: innerWidth, height: innerHeight},
        canvas: {left: canvas.left, top: canvas.top, width: canvas.width, height: canvas.height}};
    }, androidInsets);
    for (const box of controls.results) {
      assert.ok(box.left >= -1 && box.right <= controls.viewport.width + 1 &&
        box.top >= -1 && box.bottom <= controls.viewport.height + 1,
      `Android control leaves the normal viewport: ${JSON.stringify(box)}`);
      assert.equal(box.effective.hudScale, .9);
      assert.ok(Math.abs(box.effective.touchScale - box.scale * .9) < 1e-9);
      if (box.control.includes("tc-pause")) {
        assert.ok(Math.abs(box.width - 45) <= 1 && Math.abs(box.height - 45) <= 1, "Android toolbar is not 10% smaller.");
        assert.ok(box.top < 16, "The removed corner margin still pushes Android controls inward.");
      }
      if (box.control === "hud-tl") assert.ok(box.left <= 15 && box.top <= 13, "Android HUD retains an extra corner inset.");
    }
    assert.equal(controls.canvas.left, 0);
    assert.equal(controls.canvas.top, 0);
    assert.ok(Math.abs(controls.canvas.width - controls.viewport.width) <= 1 &&
      Math.abs(controls.canvas.height - controls.viewport.height) <= 1, "Android game background is no longer full-bleed.");
    results.push({phase: "android-normal-edge-controls", controls});
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(requests, []);
  await writeFile(path.join(output, "checks.json"), JSON.stringify({
    observedAt: new Date().toISOString(), gameDigest, browser: "isolated headless Chromium", platform, nativeOSFullscreenTested: false,
    fullscreenPresentationAndBothIconStatesTested: platform !== "android", physicalAndroidTested: false,
    background3DRenderingPaused: true,
    saveBackend: "in-memory test fixture only", results, errors, externalRequests: requests,
  }, null, 2));
  console.log(`Layout checks passed at ${sizes.length} sizes for starters and menu. Screenshots: ${output}`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
