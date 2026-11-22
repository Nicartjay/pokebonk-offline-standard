import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {createHash} from "node:crypto";
import {ast, nodesOf} from "../../scripts/source.ts";
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
  assert.match(main, /function renamedBackendFactory\(data\).*PokeBonkOfflineBackend/);
  assert.match(menus, /function renamedMainMenu\(e\)/);
  assert.match(menus, /OFFLINE · LOCAL SAVES/);
  assert.match(menus, /season-modal offline-appearance/);
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
  const source = await readFile(`build/standard-game/assets/${info.modules.main}`, "utf8");
  const names = ["Av", "Nv", "kv", "Mv", "Xv", "jv", "Iv"];
  const functions = nodesOf(ast(source), "FunctionDeclaration", n => names.includes(n.id.name));
  assert.equal(functions.length, names.length);
  const writes = [];
  const context = vm.createContext({structuredClone,
    localStorage: {setItem() { throw new Error("quota exceeded"); }, getItem() { return null; }},
    Z: {del() {}}, Ov: user => user,
    Zv: async text => createHash("sha256").update(text).digest("hex"),
    PokeBonkNativeApp: {backend: {async uploadSave(...args) { writes.push(args); }}}});
  vm.runInContext(`const __STANDARD_MANUAL__=new Map();${functions.map(n => source.slice(n.start, n.end)).join("\n")}
    globalThis.helpers={${names.join(",")}}`, context);
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
