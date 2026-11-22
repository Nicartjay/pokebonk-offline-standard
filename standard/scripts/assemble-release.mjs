import {readFile, writeFile, stat} from "node:fs/promises";
import {createPrivateKey, createPublicKey, sign} from "node:crypto";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {PLATFORMS, DISTRIBUTIONS, artifactURL, validateArtifact, verifyManifest, validateManifest} from "../common/manifest.mjs";
import {verifyPayload} from "./verify.mjs";
import {fileHash} from "./release-files.mjs";
import {isMain} from "../../scripts/is-main.mjs";
export function releaseFiles(config, artifacts) {
  return [...Object.values(artifacts).map(a => a.name), ...PLATFORMS.map(p => `${p}.json`),
    "standard-update.json", "standard-provenance.json", `pokebonk-offline-${config.version}-source.zip`];
}
export async function collectArtifacts(directory, config, gameDigest) {
  const artifacts = {};
  for (const platform of PLATFORMS) {
    const part = JSON.parse(await readFile(path.join(directory, `${platform}.json`), "utf8"));
    if (part.edition !== "standard" || part.platform !== platform || part.version !== config.version || part.gameDigest !== gameDigest) throw new Error(`Different game payload/version in ${platform}.`);
    const expected = Object.keys(DISTRIBUTIONS).filter(id => DISTRIBUTIONS[id].platform === platform);
    if (!part.artifacts || Object.keys(part.artifacts).length !== expected.length) throw new Error(`Incomplete receipt: ${platform}.`);
    for (const id of expected) {
      const artifact = part.artifacts[id];
      if (!artifact || typeof artifact.name !== "string" || !/^[A-Za-z0-9_.-]+$/.test(artifact.name)) throw new Error("Invalid release artifact part.");
      const checked = validateArtifact({...artifact, url: artifactURL(config, config.version, artifact.name)}, id, config, config.version);
      const file = path.join(directory, artifact.name), info = await stat(file);
      if (!info.isFile() || info.size !== artifact.bytes || await fileHash(file) !== artifact.sha256) throw new Error(`Release hash/size mismatch: ${artifact.name}`);
      artifacts[id] = checked;
    }
  }
  return artifacts;
}
export async function assemble(directory = "standard/release", credentialsFile = "../pokebonk-standard-signing/credentials.json") {
  const config = JSON.parse(await readFile("standard/config.json", "utf8"));
  const {inventory, metadata} = await verifyPayload();
  // Code signing an update is separate from publishing it, but it must still
  // identify reproducible committed source. No dirty working-tree "releases".
  const head = execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim();
  if (execFileSync("git", ["status", "--porcelain"], {encoding: "utf8"}).trim() || metadata.sourceCommit !== head) throw new Error("Commit/review the complete Standard source before signing release metadata. Local app builds are allowed; publication is not.");
  const artifacts = await collectArtifacts(directory, config, inventory.gameDigest);
  const manifest = validateManifest({manifestVersion: 1, edition: "standard", applicationId: config.applicationId,
    repository: config.repository, version: config.version, upstream: config.upstream,
    save: {schema: config.saveSchema, minReader: config.saveSchema, maxReader: config.saveSchema, compatibleRunBuilds: config.compatibleRunBuilds},
    source: {commit: head, pristineDigest: metadata.pristineDigest, gameDigest: inventory.gameDigest},
    notes: await readFile("standard/release-notes.md", "utf8"), publishedAt: new Date().toISOString(), artifacts}, config);
  let pem = process.env.STANDARD_UPDATE_PRIVATE_KEY;
  if (!pem) {
    const credentials = JSON.parse(await readFile(credentialsFile, "utf8"));
    pem = await readFile(credentials.privateKeyFile);
  }
  const key = createPrivateKey(pem);
  if (createPublicKey(key).export({type: "spki", format: "pem"}) !== config.updatePublicKey) throw new Error("Release key does not match embedded Standard public key.");
  const payload = Buffer.from(JSON.stringify(manifest));
  const signed = JSON.stringify({algorithm: "ECDSA-P256-SHA256-DER", keyId: config.updateKeyId,
    payload: payload.toString("base64"), signature: sign("sha256", payload, key).toString("base64")}, null, 2) + "\n";
  verifyManifest(signed, config);
  await writeFile(path.join(directory, "standard-update.json"), signed);
  await writeFile(path.join(directory, "standard-provenance.json"), JSON.stringify(manifest, null, 2) + "\n");
  // Full corresponding source, including reviewed pristine snapshot and scripts.
  execFileSync("git", ["archive", "--format=zip", `--output=${path.resolve(directory, `pokebonk-offline-${config.version}-source.zip`)}`, head]);
  const sums = [];
  for (const name of releaseFiles(config, artifacts).sort()) sums.push(`${await fileHash(path.join(directory, name))}  ${name}`);
  await writeFile(path.join(directory, "SHA256SUMS.txt"), sums.join("\n") + "\n");
  console.log("Assembled signed Standard update metadata and corresponding source. Nothing was uploaded or published.");
  return manifest;
}
if (isMain(import.meta.url)) await assemble(process.argv[2], process.argv[3]);
