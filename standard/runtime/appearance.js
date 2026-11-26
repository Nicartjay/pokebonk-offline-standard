// Original animated-avatar composition from PokéBonk 0.10.35, kept local.
// This renderer accepts reviewed artwork IDs only. Ownership and selection
// still use the original cosmetic checks; rendering never grants a reward.
const ANIMATED_TRAINER_ASSETS = Object.freeze({
  visionary: "assets/ui/avatars/visionary-fg.png",
});

function renderAnimatedTrainerAvatar(id) {
  const foreground = Object.hasOwn(ANIMATED_TRAINER_ASSETS,id) ? ANIMATED_TRAINER_ASSETS[id] : null;
  if (!foreground) throw new Error("Unsupported animated trainer avatar.");
  const root = document.createElement("span");
  root.className = `aav aav-${id}`;
  root.setAttribute("aria-hidden","true");
  const layer = className => {
    const node = document.createElement("i");
    node.className = className;
    return node;
  };
  const image = document.createElement("img");
  image.className = "aav-fg";
  image.src = foreground;
  image.alt = "";
  image.draggable = false;
  image.decoding = "async";
  root.append(layer("aav-bg"),layer("aav-rays"),image,layer("aav-glow"),
    ...[1,2,3,4].map(index=>layer(`aav-sp s${index}`)));
  return root;
}

export {ANIMATED_TRAINER_ASSETS,renderAnimatedTrainerAvatar};
