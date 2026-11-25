// Reviewed structural contracts, independent of hashed files/private names.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {parse} from "acorn";
import {nodesOf, maybeName, literal, one, edits} from "../../scripts/source.ts";
export function structuralHash(node, parent, key) {
  function normalize(value, owner, field) {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(child => normalize(child, owner, field));
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (["start", "end", "raw"].includes(k)) continue;
      if (value.type === "Identifier" && k === "name") {
        const property = owner?.type === "MemberExpression" && field === "property" && !owner.computed ||
          ["Property", "MethodDefinition"].includes(owner?.type) && field === "key" && !owner.computed;
        out[k] = property ? v : "_";
      } else out[k] = normalize(v, value, k);
    }
    return out;
  }
  return createHash("sha256").update(JSON.stringify(normalize(node, parent, key))).digest("hex");
}
const has = (node, text) => [...nodesOf(node, "Literal"), ...nodesOf(node, "TemplateLiteral")].some(n => literal(n) === text);
const prop = (node, key) => node?.properties?.find(n => maybeName(n.key) === key)?.value;
const cls = (node, value) => node.type === "CallExpression" &&
  String(literal(prop(node.arguments[1], "class")) ?? "").split(/\s+/).includes(value);
export function expeditionContract(files) {
  const [name, bytes] = one([...files].filter(([name, bytes]) => name.endsWith(".js") &&
    bytes.toString().includes("demand:") && bytes.toString().includes("trophy-valley") &&
    bytes.toString().includes("mat-crystal")), "Expedition item/rule catalog");
  const source = bytes.toString(), tree = parse(source, {ecmaVersion: "latest", sourceType: "module"});
  const declarations = tree.body.flatMap(n => n.type === "VariableDeclaration" ? n.declarations :
    n.type === "FunctionDeclaration" ? [n] : []);
  const build = files.get("index.html")?.toString().match(/name="pokebonk-build" content="([\w-]+)"/)?.[1];
  const contract = JSON.parse(readFileSync(new URL(build === "mwv6wzyo" ?
    "./expedition-contract-mwv6wzyo.json" : "./expedition-contract.json", import.meta.url)));
  const exports = nodesOf(tree, "ExportSpecifier");
  const roles = Object.entries(contract.roles).map(([role, digest]) => {
    const node = one(declarations.filter(n => {
      if (structuralHash(n.type === "VariableDeclarator" ? n.init : n) !== digest) return false;
      if (role !== "catalog") return true;
      const aggregate = declarations.find(d => maybeName(d.id) === maybeName(n.init?.arguments?.[0]?.callee?.object))?.init;
      return aggregate?.type === "ArrayExpression" && aggregate.elements.length >= 10 &&
        aggregate.elements.every(e => e.type === "SpreadElement");
    }), `Expedition ${role} structure`);
    const exported = one(exports.filter(n => maybeName(n.local) === maybeName(node.id)), `Expedition ${role} export`);
    return `${maybeName(exported.exported)} as ${role}`;
  });
  return {file: name, bytes: Buffer.from(`export {${roles.join(",")}} from "../${name}";\n`)};
}
export function patchExpeditionPages(source,{team=false}={}) {
  const tree = parse(source, {ecmaVersion: "latest", sourceType: "module"});
  const owner = one(tree.body.filter(n => n.type === "FunctionDeclaration" && nodesOf(n, "CallExpression", n => cls(n, "exb-frame")).length === 1),
    "Expedition hub");
  const app = maybeName(owner.params[0]), changes = [];
  const tabList = one(nodesOf(tree, "ArrayExpression", n => ["home", "gear", "shop", "forge", "contracts", "board"]
    .every(id => n.elements.some(e => literal(prop(e, "id")) === id))), "Expedition hub tabs");
  const groups = [
    {id: "home", name: "Expedition", icon: "exp-flag", color: "#2fbf5b", tabs: ["home"], views: []},
    {id: "gear", name: "Equipment", icon: "exp-bag", color: "#2e9bf0", tabs: ["prep", "codex"], views: ["Preparation", "Codex"]},
    {id: "shop", name: "Bill’s Shop", icon: "exp-coin", color: "#f5a524", tabs: ["market"], views: []},
    {id: "contracts", name: "Missions & Pass", icon: "exp-seal", color: "#8b5cf6", tabs: ["contracts", "pass"], views: ["Contracts", "Expedition Pass"]},
    {id: "board", name: "My Extractions", icon: "record", color: "#e8457a", tabs: ["board"], views: []},
  ];
  changes.push({...tabList, text: JSON.stringify(groups)});
  const gate = one(owner.body.body.filter(n => n.type === "IfStatement" &&
    source.slice(n.test.start, n.test.end).includes("backend.kind")), "Expedition server-only gate");
  changes.push({...gate, text: `if(!${app}.backend.expState){${app}.notice("This build has no local Expedition rules.");return;}`});
  const requested = maybeName(owner.params[1].left);
  changes.push({start: owner.body.start + 1, end: owner.body.start + 1,
    text: `if(!["home","prep","codex","market","contracts","pass","board"].includes(${requested}))${requested}="home";`});
  // Remove actual online surfaces/handlers, not just CSS-hide their buttons.
  const party = one(nodesOf(owner, "CallExpression", n => cls(n, "exb-party")), "Expedition party controls");
  if(!team)changes.push({...party,text:"null"});
  changes.push({...one(nodesOf(owner, "CallExpression", n => cls(n, "exb-season")), "Expedition season card"), text: "null"});
  const teamPreference = one(nodesOf(party, "ConditionalExpression", n =>
    literal(n.consequent) === "" && literal(n.alternate) === "on"), "Expedition team preference");
  const teamFlag = one(nodesOf(owner, "VariableDeclarator", n =>
    maybeName(n.id) === maybeName(teamPreference.test) && n.init?.type === "CallExpression" &&
    n.init.arguments.length === 0), "Expedition team flag");
  if(!team)changes.push({...teamFlag.init,text:"false"});
  if(team)changes.push({start:owner.body.start+1,end:owner.body.start+1,
    text:`globalThis.PokeBonkOfflineUI.syncExpeditionRoom();`});
  if(team){
    const back=one(nodesOf(owner,"VariableDeclarator",node=>node.init?.type==="ArrowFunctionExpression"&&
      node.init.body.type==="BlockStatement"&&node.init.end-node.init.start<160&&
      nodesOf(node.init,"CallExpression",call=>call.arguments.length===1&&literal(call.arguments[0])===null).length===2),
    "Expedition hub back/escape action");
    changes.push({...back.init,text:`()=>globalThis.PokeBonkOfflineUI.expeditionBack(${app},()=>${source.slice(back.init.body.start,back.init.body.end)})`});
  }
  // The season card's class includes attributes, so it still matches above.
  const scav = one(nodesOf(owner, "VariableDeclarator", n => n.init?.type === "ArrowFunctionExpression" &&
    has(n.init, "Elige tu Pokémon prestado")), "scavenger selector");
  const scavCaller = one(nodesOf(owner, "VariableDeclarator", n => n.init?.type === "ArrowFunctionExpression" &&
    has(n.init, "ex-card exb-scav")), "borrowed Pokémon lobby");
  changes.push({...scavCaller.init, text: "()=>null"});
  // Never leave an invisible path to the borrowed/team selector.
  changes.push({...scav.init, text: "()=>{}"});
  const board = one(nodesOf(owner, "VariableDeclarator", n => n.init?.type === "ArrowFunctionExpression" &&
    nodesOf(n.init, "CallExpression", n => cls(n, "exb-prizes")).length === 1), "online Expedition board");
  changes.push({...board.init, text: `()=>globalThis.PokeBonkOfflineUI.expeditionHistory(${app})`});
  const onlineLoaders = nodesOf(owner, "VariableDeclarator", n => n.init?.type === "ArrowFunctionExpression" &&
    nodesOf(n.init, "CallExpression", call => ["expPrices", "expBoard"].includes(maybeName(call.callee.property))).length > 0);
  for (const loader of onlineLoaders) if (!(board.init.start <= loader.start && board.init.end >= loader.end)) changes.push({...loader.init, text: "()=>{}"});
  // Hide links into the excluded refuge/workshop and team lobby.
  for (const call of nodesOf(owner, "CallExpression", n => n.callee.type === "Identifier" && n.arguments.length &&
    has(n.arguments[1], "exb-refuge"))) changes.push({...call, text: "null"});
  const replacements = new Map([
    ["Temporada {n}", team?"Offline · solo & co-op":"Offline · solo"],
    ["Gratis para todos. Ganas XP jugando expediciones, extrayendo con botín y cobrando encargos. Se reinicia con cada temporada; los cosméticos son tuyos para siempre.",
      "Earn XP in local expeditions, extractions and contracts. This offline pass never expires; earned cosmetics stay yours."],
    ["No tienes cartas de ruta: salen del botín o se fabrican en el Taller.", "Route cards drop as Expedition loot."],
  ]);
  for (const n of [...nodesOf(owner, "Literal"), ...nodesOf(owner, "TemplateLiteral")]) {
    if (replacements.has(literal(n))) changes.push({...n, text: JSON.stringify(replacements.get(literal(n)))});
  }
  // The shared pass renderer is outside the hub function.
  for (const node of tree.body.filter(n => n.type === "FunctionDeclaration" && has(n, "exp5-road"))) {
    for (const n of [...nodesOf(node, "Literal"), ...nodesOf(node, "TemplateLiteral")]) {
      if (replacements.has(literal(n))) changes.push({...n, text: JSON.stringify(replacements.get(literal(n)))});
    }
  }
  // Some removed UI contains other targets. Only apply the outermost edit.
  const filtered = changes.filter(n => !changes.some(p => p !== n && p.start <= n.start && p.end >= n.end &&
    (p.start < n.start || p.end > n.end)));
  return {entry: owner.id.name, changes: filtered};
}
export function patchSystemTheme(source) {
  const tree = parse(source, {ecmaVersion: "latest", sourceType: "module"});
  const apply = one(tree.body.filter(n => n.type === "FunctionDeclaration" &&
    nodesOf(n, "AssignmentExpression", n => maybeName(n.left?.property) === "themePref").length === 1),
  "theme preference application");
  const resolver = one(nodesOf(tree, "VariableDeclarator", n => n.init?.type === "ArrowFunctionExpression" &&
    has(n.init, "auto") && has(n.init, "dark") && has(n.init, "light") &&
    nodesOf(n.init, "MemberExpression", n => maybeName(n.property) === "matches").length === 1), "automatic theme resolver");
  const media = one(nodesOf(resolver, "ChainExpression"), "system-theme media query");
  return edits(source, [{...media, text: `globalThis.PokeBonkSystemTheme.isDark(${source.slice(media.start, media.end)})`},
    {start: source.length, end: source.length,
      text: `\naddEventListener("standard:system-theme",()=>${apply.id.name}());\n`}]);
}
