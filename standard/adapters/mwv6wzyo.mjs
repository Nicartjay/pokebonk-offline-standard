// Reviewed 0.10.31 source integration. The pristine digest is pinned separately
// by prepare; unknown lifecycle/catalog/template structures still fail closed.
import {patchSnapshot as patchOffline} from "./mwqb4pwz.mjs";
import {reviewedBindings} from "./reviewed-bindings.mjs";

export function patchSnapshot(input) {
  if (!input.get("index.html")?.toString().includes('name="pokebonk-build" content="mwv6wzyo"')) {
    throw new Error("The 0.10.31 adapter accepts only its explicitly reviewed build.");
  }
  return patchOffline(input, {bindings: reviewedBindings(input)});
}
