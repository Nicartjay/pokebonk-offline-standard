// Build-time only. Match reviewed client bindings by syntax/semantics, not the
// latest minifier's private names. Unknown/ambiguous structures fail closed.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {parse} from "acorn";
import {nodesOf, maybeName, literal, one} from "../../scripts/source.ts";
import {parseSnapshotManifest} from "../../scripts/upstream-snapshot.ts";

const parseModule = source => parse(source, {ecmaVersion: "latest", sourceType: "module"});
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const builtins = new Set(["globalThis", "window", "document", "localStorage", "console", "undefined",
  "Math", "String", "Number", "Boolean", "Object", "Array", "JSON", "Promise", "Date", "Error", "Set", "Map",
  "structuredClone", "setTimeout", "clearTimeout", "confirm", "Node", "URL", "performance"]);

function patternNames(node, names) {
  if (!node) return;
  if (node.type === "Identifier") names.add(node.name);
  else if (node.type === "RestElement") patternNames(node.argument, names);
  else if (node.type === "AssignmentPattern") patternNames(node.left, names);
  else if (node.type === "ArrayPattern") node.elements.forEach(value => patternNames(value, names));
  else if (node.type === "ObjectPattern") node.properties.forEach(value => patternNames(value.value ?? value.argument, names));
}
function boundNames(tree) {
  const names = new Set();
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "VariableDeclarator") patternNames(node.id, names);
    if (/Function/.test(node.type ?? "")) {
      if (node.id) patternNames(node.id, names);
      node.params?.forEach(param => patternNames(param, names));
    }
    if ((node.type === "ClassDeclaration" || node.type === "ClassExpression") && node.id) patternNames(node.id, names);
    if (node.type === "CatchClause") patternNames(node.param, names);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
    }
  }
  visit(tree);
  return names;
}
function propertyName(parent, key) {
  return parent?.type === "MemberExpression" && key === "property" && !parent.computed ||
    ["Property", "MethodDefinition"].includes(parent?.type) && key === "key" && !parent.computed;
}
function normalized(node, parent, key) {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(child => normalized(child, parent, key));
  const output = {};
  for (const [name, value] of Object.entries(node)) {
    if (["start", "end", "raw"].includes(name)) continue;
    if (node.type === "Identifier" && name === "name") output[name] = propertyName(parent, key) ? value : "_";
    else if (typeof value === "string" && value.includes("-mw")) output[name] = value.replace(/-[\w-]+-mw[\w]+\.(?:js|css)/g, "-BUILD.js");
    else output[name] = normalized(value, node, name);
  }
  return output;
}
function moduleInfo(name, source) {
  const tree = parseModule(source), declarations = new Map(), exports = new Map(), imports = new Map();
  for (const node of tree.body) {
    if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") declarations.set(node.id.name, node);
    if (node.type === "VariableDeclaration") for (const declaration of node.declarations) {
      if (declaration.id.type === "Identifier" && declaration.init) declarations.set(declaration.id.name, declaration.init);
    }
    if (node.type === "ImportDeclaration") for (const specifier of node.specifiers) {
      if (specifier.type === "ImportSpecifier") imports.set(specifier.local.name, {module: literal(node.source), exported: maybeName(specifier.imported)});
    }
    if (node.type === "ExportNamedDeclaration") for (const specifier of node.specifiers) {
      exports.set(maybeName(specifier.exported), maybeName(specifier.local));
    }
  }
  const shapes = new Map();
  for (const [binding, node] of declarations) {
    const shape = sha(JSON.stringify(normalized(node)));
    const group = shapes.get(shape) ?? []; group.push(binding); shapes.set(shape, group);
  }
  return {name, source, tree, declarations, exports, imports, shapes};
}
function kind(name, source) {
  const prefix = name.split("/").at(-1).split("-")[0];
  return prefix === "main" ? source.includes("async signedIn(") && source.includes("fpsCap()") &&
    source.includes("requestAnimationFrame(this.loop)") ? "main" : "bootstrap" : prefix;
}
export function reviewedBindings(input) {
  const root = new URL("../../vendor/pokebonk-standard-0.10.20/", import.meta.url);
  const manifest = parseSnapshotManifest(JSON.parse(readFileSync(new URL("snapshot.json", root), "utf8")));
  if (manifest.digest !== "22a345dabfc541a31e9a4c0b886db81b70caa30c6603989a205a7714ac46fa60") throw new Error("Canonical adapter reference changed.");
  const previous = new Map(), current = new Map();
  for (const entry of manifest.files.filter(entry => entry.name.endsWith(".js"))) {
    const bytes = readFileSync(new URL("game/" + entry.name, root));
    if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw new Error("Canonical adapter source hash mismatch.");
    const source = bytes.toString(), key = kind(entry.name, source);
    if (["menus", "main", "dom", "assets", "buildshare", "cosmetics", "moves"].includes(key)) {
      previous.set(key, moduleInfo(entry.name, source));
    }
  }
  for (const [name, bytes] of input) {
    if (!name.endsWith(".js")) continue;
    const source = bytes.toString(), key = kind(name, source);
    if (previous.has(key)) current.set(key, moduleInfo(name, source));
  }
  const memo = new Map(), resolving = new Set();
  // 0.10.26 initializes App inside its module rather than exporting its class.
  // Audio also gained private-method renaming. Match its single instance by
  // the reviewed decoded-track lifecycle instead of its whole class hash.
  const audioOwners = [previous.get("dom"), current.get("dom")].map(module =>
    one([...module.declarations].filter(([, node]) => node.type === "NewExpression" &&
      node.callee?.type === "ClassExpression" && ["init","preloadTrack","playTrack","stopTrack","setVolumes"].every(key =>
        node.callee.body.body.some(method => maybeName(method.key) === key))), "decoded music lifecycle instance")[0]);
  memo.set("dom:" + audioOwners[0], audioOwners[1]);
  for (const [key, old] of previous) {
    const next = current.get(key);
    if (!next) throw new Error(`Missing reviewed module: ${key}`);
    for (const [shape, names] of old.shapes) {
      const matches = next.shapes.get(shape);
      if (names.length === 1 && matches?.length === 1) memo.set(key + ":" + names[0], matches[0]);
    }
  }
  // A simple module-state setter has the same syntax as other setters. Its
  // actual role is unambiguous in the reviewed main-menu entry contract.
  for (const [key, maps] of [["menus", [previous.get("menus"), current.get("menus")]]]) {
    const setters = maps.map(module => {
      const main = one(module.tree.body.filter(node => node.type === "FunctionDeclaration" &&
        module.source.slice(node.start, node.end).includes("`mm-tiles`")), "main-menu binding owner");
      return one(nodesOf(main, "CallExpression", node => node.callee.type === "Identifier" &&
        node.arguments.length === 1 && node.arguments[0].type === "Literal" && node.arguments[0].value === null), "menu-state setter").callee.name;
    });
    memo.set(key + ":" + setters[0], setters[1]);
    const starters = maps.map(module => {
      const main = one(module.tree.body.filter(node => node.type === "FunctionDeclaration" &&
        module.source.slice(node.start, node.end).includes("`mm-tiles`")), "regional starter gate owner");
      return one(nodesOf(main, "CallExpression", node => node.callee.type === "MemberExpression" &&
        maybeName(node.callee.property) === "every" && node.callee.object.type === "Identifier"), "regional starter array").callee.object.name;
    });
    memo.set(key + ":" + starters[0], starters[1]);
  }
  function resolve(key, name) {
    const id = key + ":" + name;
    if (memo.has(id)) return memo.get(id);
    if (resolving.has(id)) throw new Error(`Cyclic unresolved client binding: ${id}`);
    resolving.add(id);
    try {
      const old = previous.get(key), next = current.get(key), imported = old.imports.get(name);
      let target;
      if (imported) {
        const dependency = imported.module.slice(2).split("-")[0], oldDependency = previous.get(dependency);
        if (!oldDependency) throw new Error(`Unreviewed template dependency: ${id}`);
        const local = resolve(dependency, oldDependency.exports.get(imported.exported));
        const exported = one([...current.get(dependency).exports].filter(([, value]) => value === local), `export of ${id}`)[0];
        target = one([...next.imports].filter(([, value]) => value.module === "./" +
          current.get(dependency).name.split("/").at(-1) && value.exported === exported), `import of ${id}`)[0];
      } else {
        const node = old.declarations.get(name);
        if (!node) throw new Error(`Unknown canonical template binding: ${id}`);
        const shape = sha(JSON.stringify(normalized(node))), local = boundNames(node);
        let candidates = next.shapes.get(shape) ?? [];
        // Disambiguate data maps by their already-verified array dependency,
        // rather than assuming their short exported alias stayed unchanged.
        const dependencies = nodesOf(node, "Identifier", n => !local.has(n.name) && memo.has(key + ":" + n.name));
        candidates = candidates.filter(candidate => {
          const actual = next.declarations.get(candidate), references = nodesOf(actual, "Identifier");
          const original = nodesOf(node, "Identifier");
          return dependencies.every(dependency => {
            const index = original.indexOf(dependency);
            return references[index]?.name === memo.get(key + ":" + dependency.name);
          });
        });
        target = one(candidates, `semantic binding ${id}`);
      }
      memo.set(id, target);
      return target;
    } finally { resolving.delete(id); }
  }
  const exported = (key, canonical) => {
    const binding = previous.get(key).exports.get(canonical);
    if (!binding) throw new Error(`Missing canonical backend export ${key}.${canonical}`);
    const local = resolve(key, binding);
    return one([...current.get(key).exports].filter(([, value]) => value === local), `backend export ${key}.${canonical}`)[0];
  };
  return {resolve, exported};
}

export function bindTemplate(source, resolve, {method = false} = {}) {
  const prefix = method ? "class __StandardTemplate__{" : "";
  const wrapped = prefix + source + (method ? "}" : ""), tree = parseModule(wrapped);
  const scopes = new WeakMap(), changes = new Map();
  const root = {parent: null, bindings: new Set(), function: true};
  function collect(node, outer) {
    if (!node || typeof node !== "object") return;
    let scope = outer;
    if (/Function/.test(node.type ?? "")) {
      if (node.type === "FunctionDeclaration") patternNames(node.id, outer.bindings);
      scope = {parent: outer, bindings: new Set(), function: true};
      patternNames(node.id, scope.bindings);
      node.params?.forEach(param => patternNames(param, scope.bindings));
    } else if (["BlockStatement", "CatchClause", "ForStatement", "ForOfStatement", "ForInStatement"].includes(node.type)) {
      scope = {parent: outer, bindings: new Set(), function: false};
      if (node.type === "CatchClause") patternNames(node.param, scope.bindings);
    } else if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      if (node.type === "ClassDeclaration") patternNames(node.id, outer.bindings);
      scope = {parent: outer, bindings: new Set(), function: false};
      patternNames(node.id, scope.bindings);
    }
    scopes.set(node, scope);
    if (node.type === "VariableDeclaration") {
      let target = scope;
      if (node.kind === "var") while (target.parent && !target.function) target = target.parent;
      node.declarations.forEach(declaration => patternNames(declaration.id, target.bindings));
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => collect(child, scope));
      else if (value && typeof value === "object") collect(value, scope);
    }
  }
  collect(tree, root);
  const isBound = (name, scope) => Boolean(scope && (scope.bindings.has(name) || isBound(name, scope.parent)));
  function visit(node, parent, key) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier" && !isBound(node.name, scopes.get(node)) && !builtins.has(node.name) && !propertyName(parent, key)) {
      const value = resolve(node.name);
      if (!value) throw new Error(`Unresolved template reference: ${node.name}`);
      if (value !== node.name) changes.set(node.start, {start: node.start, end: node.end,
        text: parent?.type === "Property" && parent.shorthand ? `${node.name}:${value}` : value});
    }
    for (const [name, value] of Object.entries(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, node, name));
      else if (value && typeof value === "object") visit(value, node, name);
    }
  }
  visit(tree);
  let output = wrapped;
  for (const change of [...changes.values()].sort((a, b) => b.start - a.start)) output = output.slice(0, change.start) + change.text + output.slice(change.end);
  parseModule(output);
  return method ? output.slice(prefix.length, -1) : output;
}
