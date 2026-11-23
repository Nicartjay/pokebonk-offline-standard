// Build-time bridges to reviewed upstream rules. Resolve roles from syntax,
// never from a minifier's private names or a guessed export alias.
import {parse} from "acorn";
import {nodesOf, maybeName, literal, one} from "../../scripts/source.ts";

const tree = source => parse(source, {ecmaVersion: "latest", sourceType: "module"});
export function localContracts(files, {menus, config, cosmetics}) {
  const source = name => files.get("assets/" + name).toString();
  const menuTree = tree(source(menus)), configTree = tree(source(config)), cosmeticsTree = tree(source(cosmetics));
  const daily = one(nodesOf(menuTree, "VariableDeclarator", node => {
    const fn = node.init, body = fn?.body, arg = body?.arguments?.[0];
    return fn?.type === "ArrowFunctionExpression" && fn.params.length === 1 &&
      body?.type === "CallExpression" && body.callee.type === "Identifier" &&
      body.arguments.length === 1 && arg?.type === "CallExpression" &&
      maybeName(arg.callee.property) === "now" &&
      maybeName(arg.callee.object?.property) === "meta" &&
      maybeName(arg.callee.object?.object) === maybeName(fn.params[0]);
  }), "local daily-mutation clock");
  const imported = one(menuTree.body.filter(node => node.type === "ImportDeclaration")
    .flatMap(node => node.specifiers.map(specifier => ({node, specifier})))
    .filter(({specifier}) => maybeName(specifier.local) === maybeName(daily.init.body.callee)),
  "daily-mutation import");
  if (literal(imported.node.source) !== "./" + cosmetics ||
      imported.specifier.type !== "ImportSpecifier") throw new Error("Unreviewed daily-mutation dependency.");
  const metric = one(configTree.body.filter(node => node.type === "FunctionDeclaration" &&
    nodesOf(node, "ReturnStatement", statement => statement.argument?.type === "ObjectExpression" &&
      ["bonus", "kills", "time", "bad", "trial"].every(key =>
        statement.argument.properties.some(property => maybeName(property.key) === key))).length === 1),
  "local record metrics");
  const exportedMetric = one(nodesOf(configTree, "ExportSpecifier",
    node => maybeName(node.local) === metric.id.name), "record-metrics export");
  const events = one(nodesOf(cosmeticsTree, "VariableDeclarator", node =>
    node.init?.type === "ArrayExpression" && node.init.elements.some(element =>
      element?.type === "ObjectExpression" &&
      element.properties.some(property => maybeName(property.key) === "id" && literal(property.value) === "rush26") &&
      ["pointsFor", "countersFor", "track", "quests"].every(key =>
        element.properties.some(property => maybeName(property.key) === key)))),
  "earned event catalog");
  const exportedEvents = one(nodesOf(cosmeticsTree, "ExportSpecifier",
    node => maybeName(node.local) === maybeName(events.id)), "earned event catalog export");
  return Buffer.from(
    `export {${maybeName(imported.specifier.imported)} as dailyMutation} from "../assets/${cosmetics}";\n` +
    `export {${maybeName(exportedMetric.exported)} as recordMetrics} from "../assets/${config}";\n` +
    `export {${maybeName(exportedEvents.exported)} as eventDefinitions} from "../assets/${cosmetics}";\n`);
}
