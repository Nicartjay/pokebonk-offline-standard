const sides = ["left", "top", "right", "bottom"];

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

export function installAndroidSafeArea({window: win = globalThis.window, document: doc = globalThis.document} = {}) {
  // Positive native-shell detection only; desktop and browser layouts are
  // unchanged. This adds no renderer-callable native capabilities.
  if (!win.PokeBonkStandardAndroid || win.PokeBonkStandard) return null;
  const root = doc.documentElement;
  root.dataset.standardPlatform = "android";
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
