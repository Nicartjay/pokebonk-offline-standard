import {nodesOf, one, maybeName, literal} from "../../scripts/source.ts";

// Keep the original health/status renderers and their DOM child indices intact.
// Only reflow their existing widgets AFTER all visible rows have been updated.
export function coopBossHudEdits(source, tree) {
  const hud = one([...nodesOf(tree, "ClassExpression"), ...nodesOf(tree, "ClassDeclaration")]
    .filter(node => ["miniBars", "hud", "fitTop", "hpText"].every(key =>
      node.body.body.some(method => maybeName(method.key) === key))), "co-op boss HUD");
  const method = key => one(hud.body.body.filter(node => maybeName(node.key) === key), "boss HUD " + key);
  const minis = method("miniBars"), run = maybeName(minis.value.params[0]);
  const isThisField = (node, key) => node?.type === "MemberExpression" &&
    node.object.type === "ThisExpression" && maybeName(node.property) === key;
  const rows = one(nodesOf(minis, "CallExpression", node =>
    node.callee.type === "MemberExpression" && maybeName(node.callee.property) === "forEach" &&
    isThisField(node.callee.object, "minis")), "original boss row update");
  const call = one(nodesOf(method("hud"), "CallExpression", node =>
    isThisField(node.callee, "miniBars")), "original boss HUD update order");
  const below = one(nodesOf(minis, "CallExpression", node =>
    node.callee.type === "MemberExpression" && maybeName(node.callee.property) === "toggle" &&
    literal(node.arguments[0]) === "below"), "original boss stack placement");
  const reservations = new Set(nodesOf(minis, "CallExpression", node =>
    node.callee.type === "MemberExpression" && maybeName(node.callee.property) === "setProperty")
    .map(node => literal(node.arguments[0])));
  if (!run || minis.value.params.length !== 3 || minis.value.async || minis.value.generator ||
      minis.value.body.body.at(-1)?.expression !== rows ||
      call.arguments.length !== 3 || below.arguments.length !== 2 ||
      !["--bbb", "--bbh", "--djt"].every(key => reservations.has(key)) ||
      source.slice(minis.start, minis.end).includes("syncCoopBossHud")) {
    throw Error("Unsupported upstream: original boss HUD update/placement contract.");
  }
  return [{start: minis.value.body.end - 1, end: minis.value.body.end - 1,
    text: `;globalThis.PokeBonkOfflineUI.syncCoopBossHud(this,${run});`}];
}
