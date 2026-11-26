import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {patchTrainerCardMoodPortraits, trainerCardMoodInventory} from "../adapters/trainer-card.mjs";

const renderer = "function nameplate(id,mood){return image(" +
  "mood?asset(`portraits-mood/${mood}/${id}.png`):normal(id),mood?normal(id):void 0)}";

test("Showcase requests bundled mood artwork or selects the normal portrait directly", () => {
  const inventory = trainerCardMoodInventory([
    "assets/portraits-mood/happy/95.png",
    "assets/portraits/95.png",
    "assets/portraits/208.png",
  ]).toString();
  const hasMoodPortrait = vm.runInNewContext(inventory.replace("export function", "function") + "\nhasMoodPortrait");
  const nameplate = vm.runInNewContext(patchTrainerCardMoodPortraits(renderer).split("\n").slice(1).join("\n") +
    "\nnameplate", {
    __standardHasMoodPortrait: hasMoodPortrait,
    normal: id => `portraits/${id}.png`,
    asset: path => path,
    image: (src, fallback) => ({src, fallback}),
  });
  assert.deepEqual(nameplate(95, "happy"), {
    src: "portraits-mood/happy/95.png", fallback: "portraits/95.png",
  });
  assert.deepEqual(nameplate(208, "determined"), {src: "portraits/208.png", fallback: undefined});
  assert.deepEqual(nameplate(95, null), {src: "portraits/95.png", fallback: undefined});
});

test("a changed upstream nameplate fallback requires review", () => {
  assert.throws(() => patchTrainerCardMoodPortraits(renderer.replace("mood?normal(id):void 0", "void 0")),
    /portrait factory with on-error fallback/);
});
