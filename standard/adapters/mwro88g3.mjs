// Reviewed PokéBonk 0.10.23. Retain the pristine 0.10.20 reference for semantic
// binding matching; share offline policy and platform fixes, never patched input.
import {patchSnapshot as patchOffline} from "./mwqb4pwz.mjs";
import {reviewedBindings} from "./reviewed-bindings.mjs";

export function patchSnapshot(input) {
  if (!input.get("index.html")?.toString().includes('name="pokebonk-build" content="mwro88g3"')) {
    throw new Error("The 0.10.23 adapter accepts only its explicitly reviewed build.");
  }
  return patchOffline(input, {bindings: reviewedBindings(input)});
}
