import {mkdir, readFile, writeFile, rename, rm, access} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {readSnapshot} from "../../scripts/upstream-snapshot.ts";
import {patchSnapshot as patch01020} from "../adapters/mwqb4pwz.mjs";
import {patchSnapshot as patch01023} from "../adapters/mwro88g3.mjs";
import {patchSnapshot as patch01026} from "../adapters/mwsewi0r.mjs";
import {isMain} from "../../scripts/is-main.mjs";
export const sha = bytes => createHash("sha256").update(bytes).digest("hex");
export function payloadDigest(entries) {
  return sha(JSON.stringify(entries.map(({name, bytes, sha256}) => ({name, bytes, sha256})).sort((a, b) => a.name < b.name ? -1 : 1)));
}
export async function prepare() {
  const config = JSON.parse(await readFile("standard/config.json", "utf8"));
  const accepted = JSON.parse(await readFile("standard/accepted.json", "utf8"));
  const adapters = {
    mwqb4pwz: {version: "0.10.20", digest: "22a345dabfc541a31e9a4c0b886db81b70caa30c6603989a205a7714ac46fa60", patch: patch01020},
    mwro88g3: {version: "0.10.23", digest: "0ee2d25545fac35c9fa1cc626544695f26796b58bb76e2de7636c69b553273bd", patch: patch01023},
    mwsewi0r: {version: "0.10.26", digest: "e5136575172172b5c82df2b65aaf8b58b8b5b4768d32f63a3433984af3cdea77", patch: patch01026},
  };
  const reviewed = Object.hasOwn(adapters, accepted.build) ? adapters[accepted.build] : null;
  if (accepted.build !== config.upstream.build || accepted.version !== config.upstream.version ||
      accepted.adapter !== accepted.build || !reviewed || accepted.version !== reviewed.version ||
      accepted.digest !== reviewed.digest) throw new Error("No reviewed Standard adapter for this upstream structure. Preparation stopped.");
  const {manifest, files: pristine} = await readSnapshot(accepted.snapshot, accepted.digest);
  if (manifest.upstreamBuild !== accepted.build || manifest.upstreamVersion !== accepted.version) throw new Error("Accepted snapshot identity mismatch.");
  // Event model names live in room/prop catalogs rather than URL literals.
  // Never prepare the newly enabled modes from the earlier partial capture.
  const eventResources = JSON.parse(await readFile(`standard/resource-contracts/${accepted.build}-events.json`, "utf8"));
  if (eventResources.reviewedBuild !== accepted.build || !Array.isArray(eventResources.required) ||
      eventResources.required.some(name => !pristine.has(name))) throw new Error("Missing reviewed offline event resources; preparation stopped.");
  const {files, modules, changed} = reviewed.patch(pristine);
  for (const name of ["backend.js", "expedition.js", "event-rewards.js", "guard.js", "ui.js", "dropdown.js", "lan.js", "lan-lobby.js", "lan-ui.js", "lan.css", "lan-rtc.js", "lan-session.js", "lan-broker.js", "lan-broker.html", "internet-broker.js", "internet-rtc.js", "stun-first.js", "startup.js", "modes.js", "records.js", "android-ui.js", "transport.js", "offline.css", "home.css", "entry.js"]) {
    files.set("offline/" + name, await readFile("standard/runtime/" + name));
  }
  files.set("common/state.mjs", await readFile("standard/common/state.mjs"));
  files.set("common/update-feedback.mjs", await readFile("standard/common/update-feedback.mjs"));
  files.set("common/lan-policy.mjs", await readFile("standard/common/lan-policy.mjs"));
  files.set("common/coop-mode.mjs", await readFile("standard/common/coop-mode.mjs"));
  files.set("common/internet-coop.mjs", await readFile("standard/common/internet-coop.mjs"));
  // No secrets, URLs or updater API are passed into the game.
  const history = JSON.parse(await readFile("standard/history.json", "utf8"));
  if (!Array.isArray(history) || history[0]?.version !== config.version ||
      history[0]?.upstream?.build !== config.upstream.build ||
      history[0]?.upstream?.version !== config.upstream.version) throw new Error("Offline changelog and game version do not match.");
  const gameConfig = {productName: config.productName, version: config.version, edition: config.edition,
    saveSchema: config.saveSchema, upstream: config.upstream,
    compatibleRunBuilds: config.compatibleRunBuilds, history,
    pokemonNames: Object.fromEntries(JSON.parse(files.get("data/pokemon.json")).map(mon => [mon.id, mon.name]))};
  files.set("offline/config.js", Buffer.from(`export default ${JSON.stringify(gameConfig)};\n`));
  files.set("offline/bindings.js", Buffer.from(`export const boot=${JSON.stringify("../assets/" + modules.boot)};\n`));
  for (const name of ["version.json", "desktop.json", "manifest.webmanifest",
    "cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"]) files.delete(name);
  const css = [...files.keys()].filter(name => /^assets\/(?:main-|fonts-).*\.css$/.test(name));
  files.set("index.html", Buffer.from(`<!doctype html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="pokebonk-build" content="${accepted.build}"><meta name="theme-color" content="#1a1630">
<meta name="color-scheme" content="only light"><meta name="supported-color-schemes" content="light">
<title>${config.productName}</title><link rel="icon" href="/favicon.ico">
${css.map(name => `<link rel="stylesheet" href="/${name}">`).join("\n")}
<link rel="stylesheet" href="/offline/offline.css"><link rel="stylesheet" href="/offline/home.css"><link rel="stylesheet" href="/offline/lan.css"><script src="/offline/guard.js"></script>
<script type="module" src="/offline/entry.js"></script></head><body>
<noscript>JavaScript and WebGL are required.</noscript><canvas id="game"></canvas><div id="ui"></div></body></html>\n`));
  files.set("LICENSE.txt", await readFile("LICENSE"));
  files.set("NOTICE.txt", await readFile("NOTICE.md"));
  files.set("legal.html", Buffer.from(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PokéBonk Offline credits</title></head>
<body><h1>Credits & attribution</h1><p>Original PokéBonk game: Charcher. Native shell tooling adapted from VdustR/pokebonk-offline; offline integration: Nicartjay.</p>
<p>Unofficial fan adaptation. Pokémon and original game assets remain their respective owners' property. The shell license does not grant redistribution rights to game assets.</p>
<p>Shell/build integration is provided under GNU AGPL v3, without warranty. See the <a href="/LICENSE.txt">full license</a> and <a href="/NOTICE.txt">attribution and source provenance</a>. Corresponding source accompanies releases.</p>
<p><a href="/creditos.txt">Original artist credits and licensing notices</a> · <a href="/">Return to game</a></p></body></html>`));
  let sourceCommit = null;
  try { sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim(); } catch {}
  const metadata = {edition: "standard", applicationId: config.applicationId, appVersion: config.version,
    saveSchema: config.saveSchema, upstream: config.upstream, pristineDigest: manifest.digest, sourceCommit,
    modes: ["standard", "endless", "relay", "training", "mutation", "bossrush", "tower", ...(modules.backendExpedition ? ["expedition"] : [])],
    ...(modules.backendExpedition ? {expeditionPolicy: "local-expedition-v1"} : {}),
    ...(modules.backendExpedition ? {coop: {status: config.internetCoop?.enabled?"internet-test":"lan-experimental",
      targetPlayers: {min: 2, max: 4},networkingEnabled: true, policy:"native-coop-v2",
      roomCodes:{lan:4,internet:6},roomPicker:true,lobbyProtocol:2,
      connectionModes:["lan","stun-only","turn-fallback"],relayEnabled:config.internetCoop?.relayEnabled===true}} : {}),
    eventRewards: "local-earned-v1", localProgression: true, rendererNetwork: "local-only",
    modules, changedModules: changed, missingCandidates: manifest.missingCandidates};
  files.set("offline-build.json", Buffer.from(JSON.stringify(metadata, null, 2) + "\n"));
  const entries = [...files].map(([name, bytes]) => ({name, bytes: bytes.length, sha256: sha(bytes)}))
    .sort((a, b) => a.name < b.name ? -1 : 1);
  const gameDigest = payloadDigest(entries);
  files.set("asset-manifest.json", Buffer.from(JSON.stringify({edition: "standard", gameDigest, files: entries}, null, 2) + "\n"));
  const output = path.resolve("build/standard-game"), staging = output + ".preparing";
  await rm(staging, {recursive: true, force: true});
  for (const [name, bytes] of files) {
    const target = path.join(staging, name);
    await mkdir(path.dirname(target), {recursive: true});
    await writeFile(target, bytes);
  }
  // Do not destroy the last accepted payload if adaptation/verification fails.
  const previous = output + ".previous";
  await rm(previous, {recursive: true, force: true});
  let exists = false;
  try { await access(output); exists = true; } catch {}
  if (exists) await rename(output, previous);
  try { await rename(staging, output); } catch (error) { if (exists) await rename(previous, output); throw error; }
  console.log(`Prepared Standard ${config.version}, game ${accepted.version}/${accepted.build}, ${files.size} files, ${gameDigest}`);
  return {metadata, gameDigest, output};
}
if (isMain(import.meta.url)) await prepare();
