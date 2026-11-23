import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {ast, nodesOf, one, literal} from "../../scripts/source.ts";
import {patchSnapshot} from "../adapters/mwro88g3.mjs";
import {bindTemplate} from "../adapters/reviewed-bindings.mjs";

async function sources() {
  const root = "vendor/pokebonk-standard-0.10.23";
  const manifest = JSON.parse(await readFile(root + "/snapshot.json", "utf8"));
  return new Map(await Promise.all(manifest.files.filter(file => /\.(?:js|html)$/.test(file.name))
    .map(async file => [file.name, await readFile(root + "/game/" + file.name)])));
}
test("template bindings rename free references, not local variables, shadowed callbacks or member names", () => {
  const bound = bindTemplate('function render(node){q("div");return [node].map(q=>q.text)+node.q}',
    name => { assert.equal(name, "q"); return "createUI"; });
  assert.match(bound, /createUI\("div"\)/);
  assert.match(bound, /map\(q=>q\.text\)/);
  assert.match(bound, /node\.q/);
  assert.equal(bindTemplate('draw(settings){return q("div",{q,value:settings.q})}',
    () => "createUI", {method: true}), 'draw(settings){return createUI("div",{q:createUI,value:settings.q})}');
  assert.throws(() => bindTemplate("function run(){unknown()}", name => { throw new Error(`Unsupported ${name}`); }), /Unsupported unknown/);
});
test("the 0.10.23 adapter resolves renamed menu entry points and does not rewrite an unrelated reused private name", async () => {
  const files = await sources();
  const [menus, bytes] = one([...files].filter(([name, bytes]) => name.endsWith(".js") &&
    bytes.toString().includes("ls-grid scroll") && bytes.toString().includes("mm-tiles")), "current menu module");
  const source = bytes.toString(), tree = ast(source);
  const entry = one(tree.body.filter(node => node.type === "FunctionDeclaration" &&
    source.slice(node.start, node.end).includes("`mm-tiles`")), "current front page");
  files.set(menus, Buffer.from(source.replace(new RegExp(`\\b${entry.id.name}\\b`, "g"), "ReviewedMenuEntry")));
  const adapted = patchSnapshot(files), result = adapted.files.get(menus).toString();
  assert.match(result, /function ReviewedMenuEntry\(e\)/);
  assert.match(result, /endless relay/);
  assert.match(result, /pointerenter/);
  const news = one(tree.body.filter(node => node.type === "FunctionDeclaration" &&
    nodesOf(node, "TemplateLiteral", node => literal(node) === "nw-list scroll").length), "unrelated news view");
  const kept = one(ast(result).body.filter(node => node.type === "FunctionDeclaration" &&
    node.id.name === news.id.name), "preserved news-view binding");
  assert.ok(result.slice(kept.start, kept.end).includes("nw-reader"));
  assert.ok(adapted.files.has("offline/upstream-rules.js"));
  assert.match(adapted.files.get("offline/upstream-rules.js").toString(), /as wn/);
  const rawMain = files.get("assets/" + adapted.modules.main).toString();
  const heartbeat = one(nodesOf(ast(rawMain), "MethodDefinition", node =>
    node.value?.params.length === 3 && rawMain.slice(node.start, node.end).includes("`pb.liveBeat`")),
  "current checkpoint API");
  const main = adapted.files.get("assets/" + adapted.modules.main).toString();
  const factory = one(nodesOf(ast(main), "FunctionDeclaration", node =>
    main.slice(node.start, node.end).includes("const backend=new globalThis.PokeBonkOfflineBackend")), "adapted backend factory");
  const calls = [], context = vm.createContext({
    __OFFLINE_RULES__: {}, __OFFLINE_CONFIG__: {}, __OFFLINE_COSMETICS__: {}, __OFFLINE_MODES__: {},
    PokeBonkOfflineBackend: class { checkpoint(...args) { calls.push(args); } },
  });
  vm.runInContext(main.slice(factory.start, factory.end) +
    `;globalThis.backend=${factory.id.name}(()=>({}));`, context);
  const currentMethod = heartbeat.key.name;
  context.backend[currentMethod]("account", "ticket", "result");
  assert.deepEqual(calls, [["account", "ticket", "result"]], "The newly obfuscated checkpoint API must delegate to local storage logic.");
});
test("unsupported current-build menu structures stop adaptation rather than falling back to guessed names", async () => {
  const files = await sources(), html = files.get("index.html");
  files.set("index.html", Buffer.from(html.toString().replace("mwro88g3", "unreviewed")));
  assert.throws(() => patchSnapshot(files), /explicitly reviewed build/);
  files.set("index.html", html);
  const menus = one([...files].filter(([name, bytes]) => name.endsWith(".js") &&
    bytes.toString().includes("ls-grid scroll") && bytes.toString().includes("mm-tiles")), "menu module")[0];
  files.set(menus, Buffer.from(files.get(menus).toString().replaceAll("mm-tiles", "future-layout")));
  assert.throws(() => patchSnapshot(files), /Unsupported upstream/);
});
test("all current form sheets and twelve treasure-wheel backgrounds are bundled, with valid atlas dimensions", async () => {
  const base = "build/standard-game/", forms = JSON.parse(await readFile(base + "data/formsprites.json", "utf8"));
  for (const [id, atlas] of Object.entries(forms.sheets)) {
    const png = await readFile(`${base}assets/pmd-forms/${id}.png`);
    assert.equal(png.readUInt32BE(16), atlas.w, `Wrong width for form ${id}.`);
    assert.equal(png.readUInt32BE(20), atlas.h, `Wrong height for form ${id}.`);
  }
  for (const name of ["fire", "grass", "water", "psychic", "ghost", "electric", "geode", "candy", "frost", "gothic", "circuit", "toxic"]) {
    const png = await readFile(`${base}assets/ui/treasures/bg-${name}.png`);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
  }
  for (const name of ["assets/env/common/hazards.png", "assets/ui/icons/bonk-big.png",
    "assets/ui/exp/noise.png", "assets/ui/exp/thief.png"]) {
    assert.equal((await readFile(base + name)).subarray(1, 4).toString(), "PNG", `Missing current literal asset: ${name}`);
  }
  const inventory = JSON.parse(await readFile(base + "asset-manifest.json", "utf8"));
  assert.ok(!inventory.files.some(file => file.name.startsWith("cdn-cgi/")), "Website-only Cloudflare scripts leaked into the game.");
});
