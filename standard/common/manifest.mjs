import {createPublicKey, verify} from "node:crypto";
import {isObject} from "./state.mjs";
// Each distribution is signed, not just the default download for each OS.
// The Android staging step copies this same contract into native-only config.
export const DISTRIBUTIONS = Object.freeze(Object.fromEntries([
  ["darwin-arm64", "darwin-arm64", "dmg", "darwin-arm64.dmg"],
  ["darwin-arm64-zip", "darwin-arm64", "zip", "darwin-arm64.zip"],
  ["darwin-x64", "darwin-x64", "dmg", "darwin-x64.dmg"],
  ["darwin-x64-zip", "darwin-x64", "zip", "darwin-x64.zip"],
  ["win32-x64", "win32-x64", "nsis", "win32-x64-setup.exe"],
  ["win32-x64-zip", "win32-x64", "zip", "win32-x64.zip"],
  ["win32-x64-portable", "win32-x64", "portable", "win32-x64-portable.exe"],
  ["linux-x64", "linux-x64", "AppImage", "linux-x64.AppImage"],
  ["linux-x64-deb", "linux-x64", "deb", "linux-x64.deb"],
  ["android-universal", "android-universal", "apk", "android-universal.apk"],
].map(([id, platform, kind, suffix]) => [id, Object.freeze({platform, kind, suffix})])));
export const PLATFORMS = Object.freeze([...new Set(Object.values(DISTRIBUTIONS).map(d => d.platform))]);
export const MAX_MANIFEST_BYTES = 256 * 1024;
const semver = /^\d+\.\d+\.\d+$/;
const hash = /^[a-f0-9]{64}$/;
function requireValue(value, message) { if (!value) throw new Error(message); }
export function compareVersions(a, b) {
  requireValue(semver.test(a) && semver.test(b), "Invalid application version.");
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; }
  return 0;
}
export function artifactURL(config, version, name) {
  requireValue(semver.test(version) && /^[A-Za-z0-9_.-]+$/.test(name), "Unsafe release name.");
  return `https://github.com/${config.repository}/releases/download/standard-v${version}/${name}`;
}
export function artifactName(version, distribution) {
  requireValue(semver.test(version) && Object.hasOwn(DISTRIBUTIONS, distribution), "Unknown release distribution/version.");
  return `pokebonk-offline-${version}-${DISTRIBUTIONS[distribution].suffix}`;
}
export function validateArtifact(a, distribution, config, version) {
  const spec = DISTRIBUTIONS[distribution];
  requireValue(spec && isObject(a) && a.platform === spec.platform && a.kind === spec.kind &&
    a.name === artifactName(version, distribution) && a.url === artifactURL(config, version, a.name) &&
    Number.isSafeInteger(a.bytes) && a.bytes > 0 && a.bytes <= 1024 * 1024 * 1024 &&
    typeof a.sha256 === "string" && hash.test(a.sha256), "Wrong-platform or invalid update artifact.");
  if (spec.platform === "android-universal") {
    requireValue(a.applicationId === config.applicationId && Number.isInteger(a.versionCode) &&
      a.versionCode > 0 && a.versionCode <= 2100000000 &&
      a.signingCertificateSha256 === config.androidCertificateSha256 &&
      hash.test(a.signingCertificateSha256), "Incompatible Android identity.");
  }
  return a;
}
export function validateManifest(m, config) {
  requireValue(isObject(m) && m.manifestVersion === 1 && m.edition === "standard" &&
    m.applicationId === config.applicationId && m.repository === config.repository, "Wrong update edition or publisher.");
  requireValue(typeof m.version === "string" && semver.test(m.version), "Invalid update version.");
  requireValue(isObject(m.upstream) && semver.test(m.upstream.version) && /^[\w-]{4,80}$/.test(m.upstream.build), "Invalid upstream build.");
  requireValue(isObject(m.save) && Number.isSafeInteger(m.save.schema) &&
    Number.isSafeInteger(m.save.minReader) && Number.isSafeInteger(m.save.maxReader) &&
    m.save.minReader > 0 && m.save.maxReader >= m.save.minReader &&
    m.save.schema >= m.save.minReader && m.save.schema <= m.save.maxReader &&
    Array.isArray(m.save.compatibleRunBuilds) && m.save.compatibleRunBuilds.every(b => typeof b === "string" && /^[\w-]{4,80}$/.test(b)), "Invalid save compatibility.");
  requireValue(isObject(m.source) && /^[a-f0-9]{40}$/.test(m.source.commit) &&
    hash.test(m.source.pristineDigest) && hash.test(m.source.gameDigest), "Invalid release provenance.");
  requireValue(typeof m.notes === "string" && m.notes.length <= 20000 && Number.isFinite(Date.parse(m.publishedAt)), "Invalid release notes/date.");
  requireValue(isObject(m.artifacts) && Object.keys(m.artifacts).length === Object.keys(DISTRIBUTIONS).length, "Incomplete distribution set.");
  for (const distribution of Object.keys(DISTRIBUTIONS)) validateArtifact(m.artifacts[distribution], distribution, config, m.version);
  return m;
}
function decode(value) {
  requireValue(typeof value === "string" && value.length > 0 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), "Invalid manifest encoding.");
  return Buffer.from(value, "base64");
}
// The exact UTF-8 payload bytes are signed. No JSON canonicalization ambiguity;
// DER signatures interoperate with Android's SHA256withECDSA.
export function verifyManifest(bytes, config) {
  requireValue(Buffer.byteLength(bytes) <= MAX_MANIFEST_BYTES, "Manifest is too large.");
  const signed = JSON.parse(Buffer.from(bytes).toString("utf8"));
  requireValue(signed.algorithm === "ECDSA-P256-SHA256-DER" && signed.keyId === config.updateKeyId, "Unknown update signing key.");
  requireValue(typeof config.updatePublicKey === "string", "Configure the release public key before checking updates.");
  const key = createPublicKey(config.updatePublicKey);
  requireValue(key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1", "Expected an ECDSA P-256 public key.");
  const payload = decode(signed.payload), signature = decode(signed.signature);
  requireValue(payload.length <= MAX_MANIFEST_BYTES && verify("sha256", payload, key, signature), "Invalid update signature.");
  return validateManifest(JSON.parse(payload.toString("utf8")), config);
}
export function selectArtifact(manifest, platform, config, distribution = platform) {
  validateManifest(manifest, config);
  requireValue(PLATFORMS.includes(platform), "Unsupported update platform.");
  const artifact = manifest.artifacts[distribution];
  requireValue(Object.hasOwn(DISTRIBUTIONS, distribution), "Unsupported update distribution.");
  requireValue(artifact.platform === platform, "Wrong-platform download.");
  return artifact;
}
export function checkSaveCompatibility(manifest, saved) {
  if (!saved) return;
  requireValue(saved.schemaVersion >= manifest.save.minReader && saved.schemaVersion <= manifest.save.maxReader,
    "This update cannot read your save schema. Keep the previous app and export a backup before updating.");
  requireValue(!(saved.state.suspended || saved.state.activeRun) || manifest.save.compatibleRunBuilds.includes(saved.upstream.build),
    "Finish the unfinished run in this version before updating. Its snapshot will not be discarded.");
}
