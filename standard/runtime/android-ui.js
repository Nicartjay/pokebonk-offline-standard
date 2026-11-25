const sides = ["left", "top", "right", "bottom"];
export const ANDROID_UI_SCALE = 0.9;

export function isAndroidShell(win = globalThis.window) {
  return Boolean(win?.PokeBonkStandardAndroid && !win.PokeBonkStandard);
}

export function androidPresentationSettings(settings, win = globalThis.window) {
  if (!isAndroidShell(win) || !settings || typeof settings !== "object") return settings;
  const scaled = value => (Number.isFinite(value) ? value : 1) * ANDROID_UI_SCALE;
  // Pass a copy through the game's own scale handling so layout, joystick
  // geometry and touch hit targets agree. Never rewrite the saved preferences.
  return {...settings, hudScale: scaled(settings.hudScale), touchScale: scaled(settings.touchScale)};
}

export function androidMinimapScale(requested, upstream, win = globalThis.window) {
  if (!isAndroidShell(win)) return upstream;
  // The settings slider offers 60–200%. Do not keep upstream's small-phone
  // 120% cap, which made the upper half of that slider ineffective.
  return Math.max(.6, Math.min(2, Number.isFinite(requested) ? requested : 1));
}

// Native insets arrive in physical pixels. Project into the current CSS
// viewport instead of assuming every WebView has the same density/scale.
export function projectAndroidInsets(value, width, height) {
  if (!value || typeof value !== "object" ||
      ![value.width, value.height, width, height].every(n => Number.isFinite(n) && n > 0 && n <= 32768) ||
      !sides.every(side => Number.isFinite(value[side]) && value[side] >= 0) ||
      !["menuSize", "menuGap"].every(key => value[key] === undefined ||
        Number.isFinite(value[key]) && value[key] >= 0 && value[key] < Math.min(value.width, value.height)) ||
      value.left + value.right >= value.width || value.top + value.bottom >= value.height) return null;
  const projected = Object.fromEntries(sides.map(side => [side,
    Math.ceil(value[side] * (["left", "right"].includes(side) ? width / value.width : height / value.height)),
  ]));
  for (const key of ["menuSize", "menuGap"]) {
    if (value[key] !== undefined) projected[key] = Math.ceil(value[key] * width / value.width);
  }
  return projected;
}

export function installAndroidStarterLayout({window: win = globalThis.window, document: doc = globalThis.document} = {}) {
  if (!isAndroidShell(win)) return null;
  const ui = doc.getElementById("ui");
  if (!ui) return null;
  let active, frame = 0, disposed = false;
  const schedule = () => {
    if (!disposed && !frame) frame = win.requestAnimationFrame(fit);
  };
  const sizes = win.ResizeObserver ? new win.ResizeObserver(schedule) : null;
  // offsetHeight is the layout size, unaffected by the cards' scale-in
  // animation. Measuring their painted rectangles would undersize this track.
  const infoHeight = nodes => Math.max(...nodes.map(node => node.offsetHeight)) + 1;
  function fit() {
    frame = 0;
    const screen = ui.querySelector(":scope > .screen.sp");
    if (screen !== active) {
      sizes?.disconnect();
      active = screen;
      if (screen) {
        // Observe content too: fonts, translations and narrower windows can
        // change the space needed by the longest passive description.
        for (const node of [screen, ...screen.querySelectorAll(".sp-head, .sp-row, .sp-foot, .sp-info")]) {
          sizes?.observe(node);
        }
      }
    }
    const row = screen?.querySelector(".sp-row");
    if (!row?.clientWidth || !row.clientHeight) return;
    const info = [...row.querySelectorAll(".sp-info")];
    if (!info.length) return;

    // Measure the roomy layout first, not the already compressed result.
    // Compact only when that layout cannot leave enough space for the art;
    // there is deliberately no phone/tablet or user-agent breakpoint.
    screen.classList.remove("standard-starter-compact");
    row.style.removeProperty("--standard-starter-info-height");
    const roomyInfo = infoHeight(info);
    const minimumArt = parseFloat(win.getComputedStyle(screen)
      .getPropertyValue("--standard-starter-roomy-art-min")) || 220;
    const compact = row.clientHeight - roomyInfo < minimumArt;
    screen.classList.toggle("standard-starter-compact", compact);
    // A shared description track leaves exactly the same artwork height in
    // all three cards, even when their text wraps onto different line counts.
    row.style.setProperty("--standard-starter-info-height",
      `${compact ? infoHeight(info) : roomyInfo}px`);
  }
  const changes = new win.MutationObserver(schedule);
  // Screens are mounted directly under #ui. Do not watch the entire gameplay
  // subtree or run a layout measurement on every HUD update.
  changes.observe(ui, {childList: true});
  win.addEventListener("resize", schedule);
  win.visualViewport?.addEventListener("resize", schedule);
  doc.fonts?.ready.then(schedule);
  schedule();
  return () => {
    disposed = true;
    if (frame) win.cancelAnimationFrame(frame);
    sizes?.disconnect();
    changes.disconnect();
    win.removeEventListener("resize", schedule);
    win.visualViewport?.removeEventListener("resize", schedule);
  };
}

export function installAndroidSafeArea({window: win = globalThis.window, document: doc = globalThis.document} = {}) {
  // Positive native-shell detection only; desktop and browser layouts are
  // unchanged. This adds no renderer-callable native capabilities.
  if (!isAndroidShell(win)) return null;
  const root = doc.documentElement;
  root.dataset.standardPlatform = "android";
  root.style.setProperty("--standard-android-ui-scale", String(ANDROID_UI_SCALE));
  let geometry;
  const apply = () => {
    const insets = projectAndroidInsets(geometry, win.innerWidth, win.innerHeight);
    if (!insets) return;
    for (const side of sides) root.style.setProperty(`--standard-android-safe-${side}`, `${insets[side]}px`);
    if (insets.menuSize !== undefined) root.style.setProperty("--standard-android-menu-size", `${insets.menuSize}px`);
    if (insets.menuGap !== undefined) root.style.setProperty("--standard-android-menu-gap", `${insets.menuGap}px`);
  };
  const receive = event => {
    if (!projectAndroidInsets(event.detail, win.innerWidth, win.innerHeight)) return;
    const value = event.detail;
    geometry = {width: value.width, height: value.height,
      left: value.left, top: value.top, right: value.right, bottom: value.bottom,
      menuSize: value.menuSize, menuGap: value.menuGap};
    apply();
  };
  win.addEventListener("standard:android-insets", receive);
  win.addEventListener("resize", apply);
  win.visualViewport?.addEventListener("resize", apply);
  return () => {
    win.removeEventListener("standard:android-insets", receive);
    win.removeEventListener("resize", apply);
    win.visualViewport?.removeEventListener("resize", apply);
  };
}
