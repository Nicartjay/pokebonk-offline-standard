import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {localContracts} from "../adapters/local-contracts.mjs";
import {OFFLINE_EVENTS} from "../runtime/modes.js";
import {EVENT_POLICY} from "../runtime/event-rewards.js";

const config = JSON.parse(await readFile("standard/config.json", "utf8"));
const accepted = JSON.parse(await readFile("standard/accepted.json", "utf8"));
const metadata = JSON.parse(await readFile("build/standard-game/offline-build.json", "utf8"));
test("the OFFLINE badge/history use the app version and preserve independent upstream identities", async () => {
  const history = JSON.parse(await readFile("standard/history.json", "utf8"));
  const gameConfig = JSON.parse((await readFile("build/standard-game/offline/config.js", "utf8"))
    .replace(/^export default /, "").replace(/;\s*$/, ""));
  assert.equal(gameConfig.version, config.version);
  assert.equal(history[0].version, config.version);
  assert.deepEqual(history[0].upstream, config.upstream);
  assert.deepEqual(gameConfig.history, history);
  assert.equal(new Set(history.map(entry => entry.version)).size, history.length);
  assert.ok(history.every(entry => /^\d{4}-\d{2}-\d{2}$/.test(entry.date) &&
    /^\d+\.\d+\.\d+$/.test(entry.upstream.version) && entry.upstream.build && entry.changes.length));
  for (const key of ["channelUrl", "updatePublicKey", "updateKeyId", "repository", "androidCertificateSha256"]) {
    assert.equal(Object.hasOwn(gameConfig, key), false, `${key} must not become a renderer updater interface.`);
  }
  assert.equal(gameConfig.pokemonNames["4"], "Charmander");
});
test("all advertised offline challenges and their artwork are in the shared payload", async () => {
  const inventory = JSON.parse(await readFile("build/standard-game/asset-manifest.json", "utf8"));
  const names = new Set(inventory.files.map(file => file.name));
  assert.deepEqual(metadata.modes, ["standard", "endless", "relay", "training", "mutation", "bossrush", "tower", "expedition"]);
  assert.equal(metadata.expeditionPolicy, "local-expedition-v1");
  assert.ok(names.has(metadata.modules.backendExpedition));
  assert.equal(metadata.eventRewards, EVENT_POLICY);
  for (const event of OFFLINE_EVENTS) {
    assert.ok(metadata.modes.includes(event.mode));
    for (const file of [event.tile, event.header, `assets/ui/icons/${event.icon}.png`]) assert.ok(names.has(file), file);
  }
  const contract = JSON.parse(await readFile(`standard/resource-contracts/${metadata.upstream.build}-events.json`, "utf8"));
  assert.equal(contract.reviewedBuild, metadata.upstream.build);
  for (const file of contract.required) {
    assert.ok(names.has(file), `Missing dynamically resolved event model: ${file}`);
    const bytes = await readFile("build/standard-game/" + file);
    if (file.endsWith(".glb")) {
      assert.equal(bytes.toString("ascii", 0, 4), "glTF");
      assert.equal(bytes.readUInt32LE(8), bytes.length);
    } else {
      assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
      assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0);
    }
  }
});
test("archived 0.10.23-complete preserves every earlier pristine byte and only adds reviewed models/reward artwork", async () => {
  const old = JSON.parse(await readFile("vendor/pokebonk-standard-0.10.23/snapshot.json", "utf8"));
  const current = JSON.parse(await readFile("vendor/pokebonk-standard-0.10.23-local-complete/snapshot.json", "utf8"));
  assert.equal(current.digest, "0ee2d25545fac35c9fa1cc626544695f26796b58bb76e2de7636c69b553273bd");
  const currentFiles = new Map(current.files.map(file => [file.name, file]));
  for (const file of old.files) assert.deepEqual(currentFiles.get(file.name), file);
  const previous = new Set(old.files.map(file => file.name));
  assert.deepEqual(current.files.filter(file => !previous.has(file.name)).map(file => file.name), [
    "assets/items/clover-sweet.png",
    "assets/models/rush_console.glb", "assets/models/rush_crates.glb", "assets/models/rush_lamp.glb",
    "assets/models/rush_lighthouse.glb", "assets/models/rush_pillar.glb", "assets/models/rush_statue.glb",
  ]);
  const events = JSON.parse(await readFile("vendor/pokebonk-standard-0.10.23-events/snapshot.json", "utf8"));
  for (const file of events.files) assert.deepEqual(currentFiles.get(file.name), file);
  assert.equal(current.files.length, events.files.length + 1);
  assert.equal(currentFiles.get("assets/items/clover-sweet.png").sha256,
    "c9d44bf0fb0b32620b7f8879cf8a51b936d224a145f8ba30d9b4800e33bfda6c");
});
test("the current payload retains the eleven 0.10.26 form appearances and the corrected Korean Abra name", async () => {
  assert.equal(metadata.upstream.version, accepted.version);
  assert.equal(metadata.upstream.build, accepted.build);
  const forms = JSON.parse(await readFile("build/standard-game/data/formsprites.json", "utf8"));
  for (const key of ["mega-26y", "mega-36", "mega-71", "mega-121", "mega-127", "mega-130",
    "gmax-94", "gmax-99", "gmax-131", "gmax-133", "gmax-143"]) {
    const id = forms.ids[key], sheet = forms.sheets[id];
    assert.ok(id && sheet, `Missing new form ${key}.`);
    const png = await readFile(`build/standard-game/assets/pmd-forms/${id}.png`);
    assert.equal(png.readUInt32BE(16), sheet.w);
    assert.equal(png.readUInt32BE(20), sheet.h);
  }
  const ko = JSON.parse(await readFile("build/standard-game/data/i18n/ko.json", "utf8"));
  assert.equal(ko.pokemon["63"], "케이시");
  const source = await readFile("build/standard-game/assets/" + metadata.modules.main, "utf8");
  assert.match(source, /this\.cleanSince/);
  assert.match(source, /%6e4<6e3/, "The upstream H-key reminder must still repeat once per minute.");
});
test("new local-rule bridges resolve structural roles, not guessed private names", async () => {
  const modules = metadata.modules, files = new Map();
  for (const role of ["menus", "config", "cosmetics"]) {
    files.set("assets/" + modules[role], await readFile(accepted.snapshot + "/game/assets/" + modules[role]));
  }
  const bridge = localContracts(files, modules).toString();
  assert.match(bridge, /as dailyMutation/);
  assert.match(bridge, /as recordMetrics/);
  const configFile = "assets/" + modules.config;
  files.set(configFile, Buffer.from(files.get(configFile).toString().replace("trial:!(r&&e.ot.direct)", "futureTrial:!(r&&e.ot.direct)")));
  assert.throws(() => localContracts(files, modules), /record metrics/);
});
