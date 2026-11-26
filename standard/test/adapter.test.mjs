import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {createHash} from "node:crypto";
import {ast, nodesOf, one, maybeName} from "../../scripts/source.ts";
import {patchSnapshot} from "../adapters/mwqb4pwz.mjs";
const root = "vendor/pokebonk-standard-0.10.20";
async function sourceFiles() {
  const manifest = JSON.parse(await readFile(root + "/snapshot.json", "utf8"));
  return new Map(await Promise.all(manifest.files.filter(f => f.name === "index.html" || f.name.endsWith(".js"))
    .map(async f => [f.name, await readFile(root + "/game/" + f.name)])));
}
test("App/backend and main-menu targets survive private identifier renaming", async () => {
  const files = await sourceFiles();
  const mainName = [...files].find(([name, b]) => name.endsWith(".js") && b.toString().includes(" as App}"))[0];
  const menusName = [...files.keys()].find(name => name.includes("/menus-"));
  files.set(mainName, Buffer.from(files.get(mainName).toString().replace(/\bmy\b/g, "renamedBackendFactory").replace(/\bBE\b/g, "RenamedApplication").replace(/\bfE\b/g, "RenamedResults")));
  files.set(menusName, Buffer.from(files.get(menusName).toString().replace(/\bLw\b/g, "renamedMainMenu")));
  const result = patchSnapshot(files);
  const main = result.files.get(mainName).toString(), menus = result.files.get(menusName).toString();
  assert.match(main, /function renamedBackendFactory\(data\)\{\s*const backend=new globalThis\.PokeBonkOfflineBackend/);
  assert.match(menus, /function renamedMainMenu\(e\)/);
  assert.ok(!menus.includes("OFFLINE · LOCAL SAVES"), "The removed status label must not return.");
  for (const marker of ["recordsPanel(e)", "creatorCredit()", "tr-playable", "offline-report-entry"]) {
    assert.ok(menus.includes(marker), `The adapted homepage is missing ${marker}.`);
  }
  assert.match(menus, /season-modal offline-appearance/);
  const home = one(nodesOf(ast(menus), "FunctionDeclaration", node => node.id.name === "renamedMainMenu"), "adapted homepage");
  const firstVisits = nodesOf(home, "CallExpression", node => node.callee.type === "MemberExpression" &&
    maybeName(node.callee.property) === "firstVisit");
  assert.equal(firstVisits.length, 1, "Only the completed homepage may schedule the first-use Guide.");
  assert.ok(firstVisits[0].start > menus.indexOf('UC(e,"mm offline-menu"'));
  assert.doesNotMatch(main, /https:\/\/api\.pokebonk\.com/);
});
test("unsupported upstream structural contracts fail rather than emitting partially patched game", async () => {
  const files = await sourceFiles();
  const menus = [...files.keys()].find(name => name.includes("/menus-"));
  files.set(menus, Buffer.from(files.get(menus).toString().replaceAll("mm-tiles", "new-ui-shape")));
  assert.throws(() => patchSnapshot(files), /structural role/);
});
test("native snapshot writers/recovery work even when Web Storage quota is exhausted", async () => {
  const info = JSON.parse(await readFile("build/standard-game/offline-build.json", "utf8"));
  const source = await readFile(`build/standard-game/assets/${info.modules.checkpointModule ?? info.modules.main}`, "utf8");
  const declarations = nodesOf(ast(source), "FunctionDeclaration");
  const find = (predicate, label) => one(declarations.filter(node => predicate(source.slice(node.start, node.end))), label);
  const functions = {
    Av: find(text => text.includes("const __text=JSON.stringify") && text.includes("backend.uploadSave"), "manual native writer"),
    Nv: find(text => text.includes("__STANDARD_MANUAL__.set") && text.includes("return __hash") &&
      !text.includes("backend.uploadSave") && !text.includes("localStorage"), "native snapshot recovery"),
    kv: find(text => text.includes("save:JSON.parse(entry.text)"), "parsed native cache reader"),
    Mv: find(text => text.includes("?.text??null") && text.includes("__STANDARD_MANUAL__"), "native snapshot text reader"),
    Xv: find(text => text.includes("return entry?await") && text.includes("__STANDARD_MANUAL__"), "native snapshot hash reader"),
    jv: find(text => text.includes("__STANDARD_MANUAL__.delete") && text.includes(".del("), "native cache clearing"),
    Iv: find(text => text.includes("backend.uploadSave") && text.includes("return __hash") &&
      !text.includes("const __text=JSON.stringify"), "automatic native checkpoint writer"),
  };
  const cacheKey = one(nodesOf(functions.Av, "CallExpression", n => n.callee.type === "MemberExpression" &&
    maybeName(n.callee.property) === "setItem"), "manual browser cache key").arguments[0].callee.name;
  const digest = one(nodesOf(functions.Av, "AwaitExpression", n => n.argument.type === "CallExpression" &&
    n.argument.callee.type === "Identifier"), "native snapshot hash").argument.callee.name;
  const cache = one(nodesOf(functions.jv, "CallExpression", n => n.callee.type === "MemberExpression" &&
    maybeName(n.callee.property) === "del"), "browser cache deletion").callee.object.name;
  const writes = [];
  const context = vm.createContext({structuredClone,
    localStorage: {setItem() { throw new Error("quota exceeded"); }, getItem() { return null; }},
    [cache]: {del() {}}, [cacheKey]: user => user,
    [digest]: async text => createHash("sha256").update(text).digest("hex"),
    PokeBonkNativeApp: {backend: {async uploadSave(...args) { writes.push(args); }}}});
  vm.runInContext(`const __STANDARD_MANUAL__=new Map();${Object.values(functions).map(n => source.slice(n.start, n.end)).join("\n")}
    globalThis.helpers={${Object.entries(functions).map(([name, node]) => `${name}:${node.id.name}`).join(",")}}`, context);
  const h = context.helpers, ticket = {id: "offline-run", seed: 1}, snapshot = {v: 1, large: "x".repeat(6 * 1024 * 1024)};
  const hash = await h.Av("player", ticket, snapshot);
  assert.equal(writes.length, 1);
  assert.equal(h.kv("player").save.large.length, snapshot.large.length);
  assert.equal(await h.Xv("player"), hash);
  const text = h.Mv("player"); h.jv("player"); assert.equal(h.kv("player"), null);
  await h.Nv("player", ticket, text);
  assert.equal(h.kv("player").save.large.length, snapshot.large.length);
  await h.Iv("player", ticket, text); assert.equal(writes.length, 2);
});
