import {createReadStream} from "node:fs";
import {stat, mkdir, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {DISTRIBUTIONS, artifactName, releasePlatform} from "../common/manifest.mjs";

export const receiptName = platform => `${releasePlatform(platform)}.json`;
export async function fileHash(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function describeArtifact(directory, distribution, config, extra = {}) {
  const spec = DISTRIBUTIONS[distribution], name = artifactName(config.version, distribution);
  const file = path.join(directory, name), info = await stat(file);
  if (!info.isFile() || !info.size) throw new Error(`Missing release artifact: ${name}`);
  return {name, platform: spec.platform, kind: spec.kind, bytes: info.size, sha256: await fileHash(file), ...extra};
}
export async function writeReceipt(directory, platform, config, gameDigest, artifacts) {
  const expected = Object.keys(DISTRIBUTIONS).filter(id => DISTRIBUTIONS[id].platform === platform);
  if (expected.length !== Object.keys(artifacts).length || expected.some(id => !Object.hasOwn(artifacts, id))) {
    throw new Error(`Incomplete distributions for ${platform}.`);
  }
  await mkdir(directory, {recursive: true});
  await writeFile(path.join(directory, receiptName(platform)), JSON.stringify({
    edition: config.edition, platform, version: config.version, gameDigest, artifacts,
  }, null, 2) + "\n");
}
