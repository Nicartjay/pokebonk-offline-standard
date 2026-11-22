import {readFile, realpath, lstat, readdir} from "node:fs/promises";
import path from "node:path";
import {createPublicKey} from "node:crypto";
import {ast, nodesOf, literal} from "../../scripts/source.ts";
import {readSnapshot} from "../../scripts/upstream-snapshot.ts";
import {payloadDigest, sha} from "./prepare.mjs";
import {isMain} from "../../scripts/is-main.mjs";
export async function verifyPayload(directory = "build/standard-game") {
  const root = await realpath(directory);
  const inventory = JSON.parse(await readFile(path.join(root, "asset-manifest.json"), "utf8"));
  const config = JSON.parse(await readFile("standard/config.json", "utf8"));
  const accepted = JSON.parse(await readFile("standard/accepted.json", "utf8"));
  const {manifest} = await readSnapshot(accepted.snapshot, accepted.digest);
  if (inventory.edition !== "standard" || payloadDigest(inventory.files) !== inventory.gameDigest) throw new Error("Game digest mismatch.");
  const names = new Set(inventory.files.map(entry => entry.name));
  if (names.size !== inventory.files.length) throw new Error("Duplicate payload file.");
  for (const entry of inventory.files) {
    if (!/^[\w/-][\w./-]*$/.test(entry.name) || entry.name.split("/").some(part => part.startsWith("."))) throw new Error("Invalid payload path.");
    const file = path.join(root, entry.name);
    if (!(await realpath(file)).startsWith(root + path.sep) || !(await lstat(file)).isFile()) throw new Error("Payload file escaped root.");
    const bytes = await readFile(file);
    if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw new Error(`Payload integrity mismatch: ${entry.name}`);
    if (/\.(?:js|mjs)$/.test(entry.name)) {
      const source = bytes.toString(), tree = ast(source);
      for (const node of [...nodesOf(tree, "Literal"), ...nodesOf(tree, "TemplateLiteral")]) {
        const value = node.type === "TemplateLiteral" ? node.quasis[0]?.value.cooked : literal(node);
        if (typeof value !== "string") continue;
        if (/^(?:https?:\/\/|wss?:|stun:|turns?:|mailto:)/i.test(value) &&
            !value.startsWith("http://www.w3.org/") && !value.startsWith("https://appassets.androidplatform.net/")) throw new Error(`External game destination: ${entry.name}`);
      }
      for (const node of [...nodesOf(tree, "ImportDeclaration"), ...nodesOf(tree, "ImportExpression")]) {
        const target = literal(node.source);
        if (typeof target !== "string") continue;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry.name), target));
        if (!target.startsWith(".") || !names.has(resolved)) throw new Error(`Unbundled module: ${target} in ${entry.name}`);
      }
      if (/__offline\/save|LocalSandboxBackend|node:fs|node:child_process|from ["']electron/.test(source)) throw new Error("Native/Python/unlocked implementation leaked into game payload.");
    }
    if (entry.name.endsWith(".css")) {
      for (const match of bytes.toString().matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)) {
        if (/^(?:https?:|\/\/)/.test(match[1])) throw new Error("Remote CSS asset.");
      }
    }
  }
  const actual = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file); else actual.push(path.relative(root, file).split(path.sep).join("/"));
    }
  }
  await walk(root);
  if (actual.length !== names.size + 1 || actual.some(name => !names.has(name) && name !== "asset-manifest.json")) throw new Error("Unexpected payload files.");
  for (const file of manifest.files) {
    if (!names.has(file.name) && !["version.json", "desktop.json", "manifest.webmanifest"].includes(file.name)) throw new Error(`Missing captured asset: ${file.name}`);
  }
  const metadata = JSON.parse(await readFile(path.join(root, "offline-build.json"), "utf8"));
  if (metadata.edition !== "standard" || metadata.pristineDigest !== manifest.digest ||
      metadata.appVersion !== config.version || metadata.upstream.build !== config.upstream.build ||
      !metadata.localProgression) throw new Error("Wrong payload identity.");
  if (names.has("sw.js") || names.has("manifest.webmanifest")) throw new Error("No website service workers in Standard.");
  const publicKey = createPublicKey(config.updatePublicKey);
  if (publicKey.asymmetricKeyDetails?.namedCurve !== "prime256v1" ||
      !/^[a-f0-9]{64}$/.test(config.androidCertificateSha256) ||
      config.repository !== "Nicartjay/pokebonk-offline-standard" ||
      config.applicationId !== "dev.nicartjay.pokebonk.offline.standard") throw new Error("Standard public release identity is not configured.");
  console.log(`Verified ${names.size} Standard payload files; game ${metadata.upstream.version}/${metadata.upstream.build}; ${inventory.gameDigest}`);
  return {metadata, inventory};
}
if (isMain(import.meta.url)) await verifyPayload(process.argv[2]);
