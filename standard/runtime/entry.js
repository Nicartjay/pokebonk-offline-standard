import "./transport.js";
import {OfflineBackend} from "./backend.js";
import {installOfflineUI} from "./ui.js";
import {boot} from "./bindings.js";
import {installAndroidSafeArea, installAndroidStarterLayout} from "./android-ui.js";
import config from "./config.js";
globalThis.PokeBonkOfflineBackend = OfflineBackend;
installAndroidSafeArea();
installAndroidStarterLayout();
installOfflineUI(config);
const checkpoint = () => {
  const app = globalThis.PokeBonkNativeApp;
  const result = app?.run?.autosave?.(true);
  if (result?.catch) result.catch(error => app.notice(`Checkpoint not saved: ${error.message}`));
};
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
