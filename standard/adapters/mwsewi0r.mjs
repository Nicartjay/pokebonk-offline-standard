// Reviewed 0.10.26 candidate. App now self-initializes in the lifecycle module;
// retain structural role matching and the same offline/progression policy.
import {patchSnapshot as patchOffline} from "./mwqb4pwz.mjs";
import {reviewedBindings} from "./reviewed-bindings.mjs";

export function patchSnapshot(input) {
  if (!input.get("index.html")?.toString().includes('name="pokebonk-build" content="mwsewi0r"')) {
    throw new Error("The 0.10.26 adapter accepts only its explicitly reviewed build.");
  }
  return patchOffline(input, {bindings: reviewedBindings(input)});
}
