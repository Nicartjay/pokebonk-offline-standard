// Trusted native code ONLY. Never imported by the game or its preload.
import https from "node:https";
import {createHash} from "node:crypto";
import {mkdir, open, rename, rm} from "node:fs/promises";
import path from "node:path";
import {MAX_MANIFEST_BYTES} from "./manifest.mjs";
const HOSTS = new Set(["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"]);
export function allowedNetworkURL(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname) || url.username || url.password ||
      (url.port && url.port !== "443") || url.hash) throw new Error("Blocked update destination.");
  return url;
}
export async function request(url, redirects = 0) {
  const target = allowedNetworkURL(url);
  if (redirects > 5) throw new Error("Too many update redirects.");
  const response = await new Promise((resolve, reject) => {
    const req = https.get(target, {headers: {"User-Agent": "Pokebonk-Offline-Standard", Accept: "application/octet-stream"}, timeout: 20000}, resolve);
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Update connection timed out.")));
  });
  // Also bound a stalled response after headers have arrived.
  response.setTimeout(20000, () => response.destroy(new Error("Update transfer timed out.")));
  if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
    response.resume();
    if (!response.headers.location) throw new Error("Missing update redirect.");
    return request(new URL(response.headers.location, target).href, redirects + 1);
  }
  if (response.statusCode !== 200) { response.resume(); throw new Error(`Update service unavailable (${response.statusCode}).`); }
  return response;
}
export async function fetchManifest(url, get = request) {
  const response = await get(url);
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > MAX_MANIFEST_BYTES) throw new Error("Manifest is too large.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally { response.destroy?.(); }
}
export async function downloadArtifact(artifact, directory, get = request) {
  if (!/^[A-Za-z0-9_.-]+$/.test(artifact.name)) throw new Error("Unsafe download filename.");
  await mkdir(directory, {recursive: true, mode: 0o700});
  const target = path.join(directory, artifact.name), temporary = `${target}.part`;
  await rm(temporary, {force: true});
  const output = await open(temporary, "wx", 0o600);
  const digest = createHash("sha256");
  let bytes = 0, response;
  try {
    response = await get(artifact.url);
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > artifact.bytes) throw new Error("Download exceeds signed size.");
      digest.update(chunk);
      await output.writeFile(chunk);
    }
    if (bytes !== artifact.bytes || digest.digest("hex") !== artifact.sha256) throw new Error("Update size or SHA-256 mismatch.");
    await output.sync();
    await output.close();
    await rename(temporary, target);
    return target;
  } catch (error) { await output.close().catch(() => {}); await rm(temporary, {force: true}); throw error; }
  finally { response?.destroy?.(); }
}
