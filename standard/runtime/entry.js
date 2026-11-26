import "./transport.js";
import "./lan.js";
import {OfflineBackend} from "./backend.js";
import {installOfflineUI} from "./ui.js";
import {boot} from "./bindings.js";
import {installAndroidSafeArea, installAndroidStarterLayout} from "./android-ui.js";
import {installAndroidTextOutlines} from "./android-text.js";
import config from "./config.js";
globalThis.PokeBonkOfflineBackend = OfflineBackend;
installAndroidSafeArea();
installAndroidTextOutlines();
installAndroidStarterLayout();
installOfflineUI(config);
const checkpoint = () => {
  const app = globalThis.PokeBonkNativeApp;
  // Expedition deliberately has no engine-resume serializer. Persist its
  // inventory checkpoint so an interrupted raid can be explicitly settled as
  // a loss (safe pocket/insurance), never silently reset or duplicated.
  const result = app?.run?.coop ? app.backend.checkpoint(null,app.meta.ticket,app.run.result(false)) :
    app?.run?.expedition ? app.backend.checkpointExpedition(app.meta.ticket, app.run.result(false)) :
    app?.run?.autosave?.(true);
  if (result?.catch) result.catch(error => app.notice(`Checkpoint not saved: ${error.message}`));
};
addEventListener("standard:checkpoint", checkpoint);
// The upstream serializer owns snapshots. Mirror its complete checkpoint to
// native disk (not just Web Storage), including when Android backgrounds us.
setInterval(checkpoint, 15000);
addEventListener("visibilitychange", () => {
  if (document.hidden) {
    const run = globalThis.PokeBonkNativeApp?.run;
    if (run?.state === "play") run.pause();
    checkpoint();
  }
});
try { await import(boot); document.title = config.productName; }
catch (error) { console.error(error); globalThis.PokeBonkOfflineUI.startupError(error); }
