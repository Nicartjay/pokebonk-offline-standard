// Reuse the original widgets, HP preference, status effects, phases and ordering.
// No combat changes, extra enemy slots, save mutation or method monkey-patches.
const layouts = new WeakMap();
const visible = node => !node.hidden && node.style.display !== "none";

function property(node, name, value) {
  if (node.style.getPropertyValue(name) === value) return;
  if (value) node.style.setProperty(name, value);
  else node.style.removeProperty(name);
}
function reserve(hud, run, bottom) {
  hud.barsLow = bottom > 0 ? `${Math.round(bottom + 6)}px` : "";
  hud.dojoLow = run.dojo && bottom > 0 ? `${Math.round(bottom + 8)}px` : "";
  property(hud.hudEl, "--bbb", hud.barsLow);
  property(hud.hudEl, "--djt", hud.dojoLow);
}
function restoreStack(hud, run) {
  // The upstream pre-update measurement saw the former grid. Restore the
  // original below-main spacing and reservations immediately, not a frame late.
  const height = Math.ceil(hud.els.boss.offsetHeight * hud.hs);
  if (height > 0) {
    hud.miniBelowH = height;
    property(hud.minisEl, "--bbh", `${height}px`);
  }
  const top = hud.hudEl.getBoundingClientRect().top;
  let bottom = 0;
  for (const node of [hud.els.boss, hud.minisEl])
    if (node.offsetHeight > 0) bottom = Math.max(bottom, node.getBoundingClientRect().bottom - top);
  reserve(hud, run, bottom);
}

export function syncCoopBossHud(hud, run, now = performance.now()) {
  const main = hud.els.boss, minis = hud.minisEl, host = hud.hudEl;
  let count = +visible(main);
  for (const row of hud.minis) if (visible(row.el)) count++;
  const compact = Boolean(run.coop) && count > 1;
  let layout = layouts.get(hud);
  if (!layout) {
    if (!compact) return; // Do not touch solo/single-boss DOM or positioning.
    const rack = host.ownerDocument.createElement("div");
    rack.className = "offline-boss-rack";
    const heading = host.ownerDocument.createElement("b");
    heading.className = "offline-boss-rack-title";
    rack.append(heading);
    host.insertBefore(rack, main);
    rack.append(main, minis);
    layout = {rack, heading, compact: false, key: "", measuredAt: -Infinity, bottom: 0, count: 0};
    layouts.set(hud, layout);
  }
  if (layout.compact !== compact) {
    layout.compact = compact;
    layout.rack.classList.toggle("is-compact", compact);
    layout.measuredAt = -Infinity;
    hud.barsLowT = hud.miniBelowT = hud.dojoLowT = 0;
    if (!compact) restoreStack(hud, run);
  }
  if (!compact) return;
  if (count !== layout.count) {
    layout.count = count;
    layout.heading.textContent = "BOSSES · " + count;
  }
  // fitTop already tracks the available central space and HUD scale. Cache
  // layout reads at the upstream 250ms cadence; count/fit/scale changes bypass
  // that cache, and changing warning/status heights is picked up within 250ms.
  const key = `${count}|${+visible(main)}|${hud.hs}|${hud.fitKey}`;
  if (layout.key !== key || now - layout.measuredAt >= 250) {
    layout.key = key;
    layout.measuredAt = now;
    const bounds = layout.rack.getBoundingClientRect();
    layout.bottom = bounds.height > 0 ? Math.max(0, bounds.bottom - host.getBoundingClientRect().top) : 0;
  }
  // .minibars is display:contents in the grid, so its own box has no height.
  // Always reserve the whole rack, including warnings and the second row.
  reserve(hud, run, layout.bottom);
}
