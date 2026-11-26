import {envelope, validateEnvelope, importEnvelope} from "../common/state.mjs";
import config from "./config.js";
const desktop = globalThis.PokeBonkStandard;
const android = globalThis.PokeBonkStandardAndroid;
let nativeEpoch;
function androidResult(text) {
  const result = JSON.parse(text);
  if (!result.ok) throw new Error(result.error || "Native storage failed.");
  return result.value;
}
if (!desktop && !android) throw new Error("Native offline storage is unavailable. No browser-only or unlocked save will be used.");
globalThis.PokeBonkStandardTransport = Object.freeze({
  async load() {
    let saved = desktop ? await desktop.loadState() : androidResult(android.loadState());
    if(saved?.nativeStorage===1){
      if(typeof saved.epoch!=="string"||!/^[\w-]{16,80}$/.test(saved.epoch))throw new Error("Invalid native save generation.");
      nativeEpoch=saved.epoch;saved=saved.save;
    }
    return saved === null ? null : validateEnvelope(saved, config).state;
  },
  async save(state) {
    const saved = envelope(state, config);
    if(nativeEpoch)saved.nativeEpoch=nativeEpoch;
    if (desktop) await desktop.saveState(saved);
    else androidResult(android.saveState(JSON.stringify(saved)));
  },
  export: state => envelope(state, config),
  import: value => importEnvelope(value, config).state,
});
