import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {nodesOf, ast, maybeName} from "../../scripts/source.ts";
const guard = await readFile("standard/runtime/guard.js", "utf8");
function context() {
  const listeners = new Map(), storage = new Map();
  const document = {documentElement: {dataset: {}}, querySelector() {}, querySelectorAll() { return []; },
    addEventListener() {}};
  const ctx = vm.createContext({document, localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k)},
    matchMedia: () => ({matches: false}), PokeBonkStandardAndroid: {}, fetch() {}, open() {}, URL,
    XMLHttpRequest: class {open() {}}, navigator: {}, MutationObserver: class {observe() {}},
    addEventListener(name, callback) { const list = listeners.get(name) ?? []; list.push(callback); listeners.set(name, list); }});
  ctx.window = ctx;
  vm.runInContext(guard, ctx);
  return {ctx, document, storage, event: detail => { for (const cb of listeners.get("standard:system-theme") ?? []) cb({detail}); }};
}
test("Android one-way system theme metadata is boolean-only and never overrides an explicit game preference", async () => {
  const f = context();
  f.event({dark: true}); assert.equal(f.ctx.PokeBonkSystemTheme.isDark(false), true);
  f.event({dark: "false"}); assert.equal(f.ctx.PokeBonkSystemTheme.isDark(false), true);
  f.event({dark: false}); assert.equal(f.ctx.PokeBonkSystemTheme.isDark(true), false);
  f.storage.set("pokebonk.theme", "dark"); f.document.documentElement.dataset.theme = "dark";
  f.event({dark: false}); assert.equal(f.document.documentElement.dataset.theme, "dark");
  f.storage.set("pokebonk.theme", "light"); f.document.documentElement.dataset.theme = "light";
  f.event({dark: true}); assert.equal(f.document.documentElement.dataset.theme, "light");
  delete f.ctx.PokeBonkStandardAndroid;
  f.event({dark: false}); assert.equal(f.ctx.PokeBonkSystemTheme.isDark(false), true, "Desktop must retain its own matchMedia.");
  const java = await readFile("standard/android/app/src/main/java/dev/nicartjay/pokebonk/offline/standard/MainActivity.java", "utf8");
  assert.match(java, /onConfigurationChanged[\s\S]*?publishSystemTheme/);
  assert.match(java, /onResume\(\)[\s\S]*?publishSystemTheme/);
  assert.match(java, /setAlgorithmicDarkeningAllowed\(false\)/);
  assert.match(java, /setForceDark\(WebSettings.FORCE_DARK_OFF\)/);
  assert.deepEqual([...java.matchAll(/@JavascriptInterface public String (\w+)/g)].map(m => m[1]), ["loadState", "saveState"]);
  assert.match(await readFile("standard/android/app/src/main/res/values-night/styles.xml", "utf8"), /Theme\.Material\.NoActionBar/);
});
test("the adapted game's original auto/light/dark resolver uses native system metadata", async () => {
  const info = JSON.parse(await readFile("build/standard-game/offline-build.json", "utf8"));
  const source = await readFile("build/standard-game/assets/" + info.modules.main, "utf8");
  const resolver = nodesOf(ast(source), "VariableDeclarator", n => n.init?.type === "ArrowFunctionExpression" &&
    nodesOf(n.init, "CallExpression", n => maybeName(n.callee.property) === "isDark").length)[0];
  const query = nodesOf(resolver, "CallExpression", n => n.callee.type === "Identifier")[0].callee.name;
  const f = context();
  vm.runInContext(`const ${query}=()=>({matches:false});globalThis.resolve=${source.slice(resolver.init.start,resolver.init.end)};`, f.ctx);
  f.event({dark: true});
  assert.equal(f.ctx.resolve("auto"), "dark");
  assert.equal(f.ctx.resolve("light"), "light");
  f.event({dark: false});
  assert.equal(f.ctx.resolve("auto"), "light");
  assert.equal(f.ctx.resolve("dark"), "dark");
});
