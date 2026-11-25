// Shared rendering policy for every native shell. No platform sniffing,
// save mutation, native APIs or changes to combat/reward rules.
const LOW_PIXELS = 1280 * 720;
const SAVER_PIXELS = 960 * 540;
const MEDIUM_PIXELS = 1600000;

export function graphicsQuality(quality) {
  // Preserve the chosen preset. Turning saver off reapplies the original
  // preferences instead of permanently downgrading the saved High setting.
  return quality.saver ? {...quality, bloom: false, hires: false} : quality;
}

export function renderPixelRatio(render, width, height, upstream) {
  if (![width, height, upstream].every(n => Number.isFinite(n) && n > 0)) return upstream;
  const quality = render.quality;
  let ceiling, budget;
  if (quality.saver) {
    ceiling = .5; budget = SAVER_PIXELS;
  } else if (quality.hires === false) {
    ceiling = .75; budget = LOW_PIXELS;
  } else if (!quality.bloom) {
    ceiling = 1; budget = MEDIUM_PIXELS;
  } else return upstream;
  // Apply after upstream's fixed/native resolution, dynamic scaling and
  // minimum-DPR logic. None may undo a power-saving ceiling. Never increase
  // a deliberately lower pixel-art scale or resolution.
  return Math.min(upstream, ceiling, Math.sqrt(budget / width / height));
}

export function batteryFpsCap(saver, upstream) {
  return saver ? 30 : upstream;
}

const frames = new WeakMap();
export function skipBatteryFrame(app, timestamp, interval) {
  if (!app.saver || !Number.isFinite(timestamp)) {
    frames.delete(app);
    return false;
  }
  const cap = batteryFpsCap(true, app.fpsCap?.());
  const gap = Math.max(1000 / cap, Number.isFinite(interval) && interval > 0 ? interval : 0);
  const previous = frames.get(app);
  // Gate actual update/render work even when resize/effects keep needsDraw
  // true. The engine still measures elapsed time between accepted frames.
  // Keep a phase-aligned deadline rather than rounding every frame up to
  // the next display refresh. Tiny timestamp jitter must not turn 30 into
  // 20–25 FPS, nor let a non-divisible refresh rate drift above the target.
  const tolerance = Math.min(2, gap * .05);
  if (!previous || timestamp < previous.last) {
    frames.set(app, {last:timestamp,next:timestamp+gap,gap});
    return false;
  }
  const due = previous.gap === gap ? previous.next : previous.last + gap;
  if (timestamp < due - tolerance) return true;
  // Discard missed deadlines after a stall; never replay a catch-up burst.
  frames.set(app, {last:timestamp,next:(timestamp-due>=gap?timestamp:due)+gap,gap});
  return false;
}

const fpsRows = new WeakMap();
function updateFpsRow(app, record) {
  const {row, values, fallback, hint, originalHint} = record;
  // The original segmented control rebuilds its buttons after a selection.
  const buttons = [...row.querySelectorAll(".seg .pill")];
  const saver = Boolean(app.saver);
  const saved = String(app.meta?.profile?.settings.fpsLimit);
  const selected = saver ? "30" : values.includes(saved) ? saved : fallback;
  row.dataset.batterySaver = String(saver);
  row.setAttribute("aria-disabled", String(saver));
  buttons.forEach((button,index) => {
    button.disabled = saver;
    button.classList.toggle("on", values[index] === selected);
    button.setAttribute("aria-pressed", String(values[index] === selected));
    if (saver) button.title = "Turn off Battery Saver to change the FPS limit.";
    else button.removeAttribute("title");
  });
  if (hint) hint.textContent = saver ? "Battery Saver is on — FPS is locked to 30." : originalHint;
}

export function fpsSettingsRow(app, row, values) {
  const buttons = [...row.querySelectorAll(".seg .pill")];
  if (buttons.length !== values.length || !values.includes("30"))
    throw Error("Unsupported FPS setting controls.");
  row.classList.add("offline-fps-settings");
  const hint = row.querySelector("span > small");
  const record = {row,values,hint,originalHint:hint?.textContent,
    fallback: values[buttons.findIndex(button => button.classList.contains("on"))] ?? "0"};
  // Native disabled buttons handle ordinary mouse/keyboard/touch input; this
  // capture guard also blocks stale/programmatically dispatched clicks.
  row.addEventListener("click", event => {
    if (app.saver && event.target.closest?.("button")) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  let records = fpsRows.get(app);
  if (!records) fpsRows.set(app, records = new Set());
  for (const previous of records) if (!previous.row.isConnected) records.delete(previous);
  records.add(record);
  updateFpsRow(app, record);
  return row;
}

export function syncGraphicsSettings(app) {
  const records = fpsRows.get(app);
  if (!records) return;
  for (const record of records) {
    if (record.row.isConnected) updateFpsRow(app, record);
    else records.delete(record);
  }
}
