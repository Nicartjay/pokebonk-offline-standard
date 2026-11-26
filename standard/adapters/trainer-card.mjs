// Keep the original card editor but do not enable public profiles or clan
// services. Purchases go through the original price and unlock checks, with
// the same durable transaction as other local cosmetics.
import {ast, edits, literal, maybeName, nodesOf, one} from "../../scripts/source.ts";

const prop = (object, key) => object?.properties?.find(node => maybeName(node.key) === key)?.value;
const callsBackend = (node, method) => node.type === "CallExpression" &&
  maybeName(node.callee.property) === method && maybeName(node.callee.object?.property) === "backend";

// The original nameplate tries an optional mood portrait, then swaps to the
// normal portrait on error. The global graphics tracker sees the failed first
// request even when that fallback works. Choose from the bundled inventory
// before setting src; keep the global tracker and the original error fallback.
export function trainerCardMoodInventory(names) {
  const variants = new Set();
  for (const name of names) {
    const match = /^assets\/portraits-mood\/([a-z][a-z0-9-]{0,31})\/([1-9]\d{0,4})\.png$/.exec(name);
    if (match) variants.add(`${match[1]}/${match[2]}`);
  }
  return Buffer.from(`const variants=new Set(${JSON.stringify([...variants].sort())});\n` +
    `export function hasMoodPortrait(mood,id){return variants.has(mood+"/"+id)}\n`);
}

export function patchTrainerCardMoodPortraits(source) {
  const tree = ast(source);
  const path = one(nodesOf(tree, "TemplateLiteral", node =>
    node.expressions.length === 2 &&
    node.quasis.map(part => part.value.cooked).join("|") === "portraits-mood/|/|.png"),
  "trainer-card mood portrait path");
  const [mood, id] = path.expressions.map(maybeName);
  if (!mood || !id) throw Error("Unsupported trainer-card mood portrait arguments.");
  const choice = one(nodesOf(tree, "ConditionalExpression", node => maybeName(node.test) === mood &&
    node.consequent.type === "CallExpression" && node.consequent.arguments[0] === path &&
    node.alternate.type === "CallExpression" && maybeName(node.alternate.arguments[0]) === id),
  "trainer-card original normal portrait fallback");
  const image = one(nodesOf(tree, "CallExpression", node => node.arguments[0] === choice &&
    node.arguments.length === 2 && node.arguments[1].type === "ConditionalExpression" &&
    maybeName(node.arguments[1].test) === mood && node.arguments[1].consequent.type === "CallExpression" &&
    maybeName(node.arguments[1].consequent.callee) === maybeName(choice.alternate.callee) &&
    maybeName(node.arguments[1].consequent.arguments[0]) === id),
  "trainer-card portrait factory with on-error fallback");
  const exists = `(${mood}&&__standardHasMoodPortrait(${mood},${id}))`;
  if (source.includes("__standardHasMoodPortrait")) throw Error("Trainer-card mood patch already present.");
  return 'import {hasMoodPortrait as __standardHasMoodPortrait} from "../offline/trainer-card-mood.js";\n' +
    edits(source, [{...choice.test, text: exists}, {...image.arguments[1].test, text: exists}]);
}

export function cardPurchaseExport(source) {
  const tree = ast(source);
  const purchase = one(tree.body.filter(node => node.type === "FunctionDeclaration" &&
    node.params.length === 3 && nodesOf(node, "TemplateLiteral", item => literal(item) === "card:").length === 2 &&
    nodesOf(node, "AssignmentExpression", item => item.operator === "-=" &&
      maybeName(item.left.property) === "stardust" && maybeName(item.right.property) === "price").length === 1),
  "original card purchase and balance check");
  return maybeName(one(nodesOf(tree, "ExportSpecifier", specifier =>
    maybeName(specifier.local) === purchase.id.name), "card purchase export").exported);
}

export function patchTrainerCard(source) {
  const tree = ast(source);
  const method = one(nodesOf(tree, "ExportSpecifier", node => maybeName(node.exported) === "customizeCard"),
    "trainer-card editor export");
  const editor = one(tree.body.filter(node => node.type === "FunctionDeclaration" &&
    node.id.name === maybeName(method.local)), "trainer-card editor");
  const rail = one(nodesOf(editor, "ArrayExpression", node =>
    node.elements.some(item => literal(prop(item, "id")) === "cf") &&
    node.elements.some(item => literal(prop(item, "id")) === "bf")), "trainer-card frame tabs");
  const clanTab = one(rail.elements.filter(item => literal(prop(item, "id")) === "cf"), "clan-only frame tab");
  if (clanTab !== rail.elements.at(-1)) throw Error("Unreviewed trainer-card tab order.");
  const prev = rail.elements.at(-2);
  const publicProfile = one(nodesOf(editor, "CallExpression", node => callsBackend(node, "player")),
    "public trainer lookup");
  const publicBranch = one(nodesOf(editor, "LogicalExpression", node => node.operator === "&&" &&
    node.right.start <= publicProfile.start && node.right.end >= publicProfile.end &&
    node.right.type === "CallExpression"), "remote-only trainer lookup branch");
  const clanPurchase = one(nodesOf(editor, "CallExpression", node => callsBackend(node, "clanCardFrame")),
    "clan frame service");
  const clanSection = one(nodesOf(editor, "VariableDeclarator", node =>
    node.init?.type === "ArrowFunctionExpression" && node.init.params.length === 0 &&
    nodesOf(node.init, "CallExpression", value => value === clanPurchase).length === 1 &&
    nodesOf(node.init, "MemberExpression", value => maybeName(value.property) === "clanFrame").length > 1),
  "clan-only editor section");
  const clear = one(nodesOf(editor, "UnaryExpression", node => node.operator === "delete" &&
    maybeName(node.argument.property) === "card"), "clear equipped card settings");
  const copy = new Map([
    ["Tu imagen en la clasificación y tu ficha", "Your local trainer card"],
    ["Tu retrato en la clasificación, la ficha y el menú: un entrenador o uno de tus Pokémon.",
      "Choose a trainer or one of your Pokémon for your card and menu."],
    ["Sale bajo tu nombre en la clasificación y en tu ficha.", "Shown below your name on the homepage and your card."],
    ["Los marcos se ganan con los premios de temporada, los logros, los eventos, los clanes y el Cuaderno de investigación; los de la Colección Estelar se compran en la Tienda.",
      "Earn frames from achievements, events, research, and the Mailbox. Star Collection frames are available in the Shop."],
  ]);
  const localCopy = [...copy].map(([before, after]) => ({
    ...one(nodesOf(editor, "TemplateLiteral", node => literal(node) === before), "trainer-card copy"),
    text: JSON.stringify(after),
  }));
  const clanTags = nodesOf(editor, "Property", node => maybeName(node.key) === "tag" &&
    !(node.start >= clanSection.start && node.end <= clanSection.end) &&
    maybeName(node.value?.expression?.object?.property) === "clan");
  if (clanTags.length !== 2) throw Error("Unreviewed trainer-card name tag previews.");
  return edits(source, [
    {start: prev.end, end: clanTab.end, text: ""},
    {...publicBranch, text: "void 0"},
    {...clanSection.init, text: "()=>[]"},
    {...clear, text: `${source.slice(clear.argument.start, clear.argument.end)}={}`},
    ...localCopy,
    ...clanTags.map(({value}) => ({...value, text: '"[OFF]"'})),
  ]);
}
