// Wait for the game's actual decoded menu track, not an unrelated preload
// request. A suspended AudioContext is a gesture lock, not an unloaded track.
export async function waitForStartupMusic(app, audio, track, {
  document: doc = globalThis.document, timeoutMs = 12000, intervalMs = 60,
} = {}) {
  const loading = doc.querySelector(".loading");
  const label = loading?.querySelector(".bar b");
  const status = doc.createElement("p");
  status.className = "offline-music-status";
  status.setAttribute("role", "status");
  status.textContent = "Loading bundled background music…";
  loading?.append(status);
  if (label) label.textContent = "Preparing menu music…";
  const settings = app.meta.profile.settings;
  let result = "ready", timer, poll;
  try {
    if (settings.master === 0 || settings.music === 0) return "muted";
    audio.init();
    // init() may create fresh buses. Re-apply the player's real volumes before
    // starting a source, so loading never overrides a mute/volume preference.
    app.applySettings();
    audio.playTrack(track);
    await new Promise(resolve => {
      let done = false;
      const finish = value => { if (!done) { done = true; result = value; resolve(); } };
      const start = performance.now();
      poll = setInterval(() => {
        if (audio.track?.name === track && audio.track.src?.buffer) finish("ready");
        else if (audio.trackGaveUp?.has(track)) finish("unavailable");
        else if (performance.now() - start > 4000) {
          status.textContent = "Still preparing audio. The game will continue automatically if it takes too long.";
        }
      }, intervalMs);
      timer = setTimeout(() => finish("unavailable"), timeoutMs);
      if (audio.track?.name === track && audio.track.src?.buffer) finish("ready");
    });
    if (result !== "ready") {
      // Stop a late pending source from unexpectedly playing after a silent
      // continuation. The normal next trusted input may request music again.
      audio.stopTrack();
      audio.trackWant = null;
      app.notice("Music was not ready in time. Continuing automatically without startup music.");
    } else if (!audio.running) {
      app.notice("Music is loaded. Tap or press a key to enable sound.");
    }
    return result;
  } catch (error) {
    audio.stopTrack?.();
    audio.trackWant = null;
    app.notice("Audio is unavailable; the game can still be played offline.");
    console.warn("Bundled startup audio:", error);
    return "unavailable";
  } finally {
    clearTimeout(timer); clearInterval(poll);
    status.remove();
  }
}
