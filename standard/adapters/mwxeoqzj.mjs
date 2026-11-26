// 0.10.36 splits checkpoint helpers and the backend factory into a services
// module and already includes the original animated Visionary avatar.
import {patchSnapshot as patchOffline} from "./mwqb4pwz.mjs";
import {reviewedBindings} from "./reviewed-bindings.mjs";
import {patchTrainerCardMoodPortraits, trainerCardMoodInventory} from "./trainer-card.mjs";

export function patchSnapshot(input, {artworkNames = input.keys()} = {}) {
  if (!input.get("index.html")?.toString().includes('name="pokebonk-build" content="mwxeoqzj"')) {
    throw new Error("The 0.10.36 adapter accepts only its explicitly reviewed build.");
  }
  const result = patchOffline(input, {bindings: reviewedBindings(input), splitServices: true, trainerCard: true});
  const menus = "assets/" + result.modules.menus;
  result.files.set(menus, Buffer.from(patchTrainerCardMoodPortraits(result.files.get(menus).toString())));
  result.files.set("offline/trainer-card-mood.js", trainerCardMoodInventory(artworkNames));
  return result;
}
