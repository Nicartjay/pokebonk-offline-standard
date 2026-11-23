// Preserve the bundled event/mutation DOM, art, reward road and animations.
// Remove server-only entry points by structural role, never private names.
import {parse} from "acorn";
import {nodesOf, maybeName, literal, one, edits} from "../../scripts/source.ts";

const has = (node, text) => nodesOf(node, "Literal").concat(nodesOf(node, "TemplateLiteral"))
  .some(value => literal(value) === text);
const property = (node, key) => node?.properties?.find(item => maybeName(item.key) === key)?.value;
const classCall = (owner, cls) => one(nodesOf(owner, "CallExpression",
  node => literal(property(node.arguments[1], "class")) === cls), `offline ${cls} element`);
const parameter = node => maybeName(node.type === "AssignmentPattern" ? node.left : node);
const backendCall = (node, method) => nodesOf(node, "CallExpression",
  call => call.callee.type === "MemberExpression" && maybeName(call.callee.property) === method &&
    maybeName(call.callee.object?.property) === "backend").length > 0;
function stopFetch(owner, method) {
  return one(nodesOf(owner, "VariableDeclarator", node =>
    node.init?.type === "ArrowFunctionExpression" && backendCall(node.init, method)),
  `offline ${method} loader`).init;
}
function apply(source, owner, replacements, prefix = "") {
  const relative = replacements.map(change => ({start: change.node.start - owner.start,
    end: change.node.end - owner.start, text: change.text}));
  if (prefix) relative.push({start: owner.body.start + 1 - owner.start, end: owner.body.start + 1 - owner.start, text: prefix});
  return edits(source.slice(owner.start, owner.end), relative);
}
const copy = new Map([
  ["Evento de temporada · Isla Nueva", "OFFLINE EVENT · NEW ISLAND"],
  ["Evento de temporada", "OFFLINE EVENT · ALWAYS AVAILABLE"],
  ["Cada semana, cinco clones nuevos y su propia clasificación.", "Five clones rotate weekly on this device. Your personal best stays in your save."],
  ["Cada partida suma {points}: muchas en el modo del evento y unas pocas en los demás. Los premios son exclusivos del evento.",
    "Earn {points} in local runs, especially in this event. Claim earned rewards here; there is no deadline."],
  ["{map} · el mismo mapa y la misma semilla para todos, sin Mochila",
    "{map} · daily local seed · no Backpack"],
  ["Cuenta tu mejor partida del día: lo más lejos que llegues y, si empatas, las bajas.",
    "Your daily best, milestones and rewards are saved on this device."],
]);
function localCopy(owner) {
  return nodesOf(owner, "Literal").concat(nodesOf(owner, "TemplateLiteral"))
    .filter(node => copy.has(literal(node))).map(node => ({node, text: JSON.stringify(copy.get(literal(node)))}));
}
export function patchTowerPage(source, owner) {
  const [app, , requested] = owner.params.map(parameter);
  const tabs = one(nodesOf(owner, "ArrayExpression", node =>
    ["play", "track", "quests", "prizes"].every(id =>
      node.elements.some(item => item?.type === "ArrayExpression" && literal(item.elements[0]) === id))),
  "offline event tabs");
  const allowed = tabs.elements.filter(item => item?.type === "ArrayExpression" &&
    ["play", "track", "quests"].includes(literal(item.elements[0])));
  const labels = {play: "Challenge", track: "Challenge Pass", quests: "Missions"};
  const tabText = "[" + allowed.map(item => `[${source.slice(item.elements[0].start, item.elements[0].end)},` +
    `${JSON.stringify(labels[literal(item.elements[0])])},${source.slice(item.elements[2].start, item.elements[2].end)}]`).join(",") + "]";
  const countdown = one(nodesOf(owner, "VariableDeclarator", node =>
    node.init?.type === "ConditionalExpression" && has(node.init, "Termina en {time}")), "offline event deadline").init;
  return apply(source, owner, [
    {node: tabs, text: tabText}, {node: countdown, text: '"Offline · no deadline"'},
    {node: stopFetch(owner, "eventView"), text: "()=>{}"},
    ...localCopy(owner),
  ], `if(!["play","track","quests"].includes(${requested}))${requested}="play";`);
}
export function patchMutationPage(source, owner) {
  return apply(source, owner, [
    {node: classCall(owner, "mu-board"), text: "null"},
    {node: stopFetch(owner, "mutationView"), text: "()=>{}"},
    ...localCopy(owner),
  ]);
}
export function patchBossRush(source) {
  const tree = parse(source, {ecmaVersion: "latest", sourceType: "module"});
  const exported = one(nodesOf(tree, "ExportSpecifier",
    node => maybeName(node.exported) === "showBossRush"), "boss-rush page export");
  const owner = one(tree.body.filter(node => node.type === "FunctionDeclaration" &&
    maybeName(node.id) === maybeName(exported.local)), "boss-rush page entry");
  const [app, requested] = owner.params.map(parameter);
  const tabList = one(nodesOf(tree, "VariableDeclarator", node =>
    node.init?.type === "ArrayExpression" && ["home", "pass", "quests", "board", "prizes"].every(id =>
      node.init.elements.some(item => literal(property(item, "id")) === id))), "boss-rush tab catalog").init;
  const tabs = tabList.elements.filter(item => ["home", "pass", "quests"].includes(literal(property(item, "id"))));
  const selection = one(nodesOf(owner, "ExpressionStatement", node =>
    node.expression.type === "LogicalExpression" &&
    maybeName(node.expression.left) === requested &&
    node.expression.right.type === "AssignmentExpression" &&
    maybeName(node.expression.right.right) === requested), "boss-rush requested tab");
  const selected = maybeName(selection.expression.right.left);
  if (!app || !requested || !selected) throw new Error("Unsupported boss-rush tab selection.");
  const countdown = one(nodesOf(owner, "VariableDeclarator", node =>
    node.init?.type === "ConditionalExpression" && has(node.init, "Termina en {time}")), "boss-rush deadline").init;
  const page = apply(source, owner, [
    {node: selection, text: `${selected}=["home","pass","quests"].includes(${requested})?${requested}:"home";`},
    {node: countdown, text: '"Offline · no deadline"'},
    {node: stopFetch(owner, "eventView"), text: "()=>{}"},
    {node: classCall(owner, "br-ranks"), text: 'globalThis.PokeBonkOfflineUI.eventStats(globalThis.PokeBonkNativeApp,"rush26")'},
    ...localCopy(owner),
  ]);
  return [
    {node: tabList, text: "[" + tabs.map(node => source.slice(node.start, node.end)).join(",") + "]"},
    {node: owner, text: page},
  ];
}
