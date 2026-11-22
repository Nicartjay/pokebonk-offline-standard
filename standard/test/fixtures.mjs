import {readFileSync} from "node:fs";
import {generateKeyPairSync, sign} from "node:crypto";
import {envelope} from "../common/state.mjs";
import {artifactURL, artifactName, DISTRIBUTIONS} from "../common/manifest.mjs";
export const productionConfig = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const keys = generateKeyPairSync("ec", {namedCurve: "prime256v1"});
export const config = {...productionConfig, version: "0.1.0",
  updatePublicKey: keys.publicKey.export({format: "pem", type: "spki"}), androidCertificateSha256: "a".repeat(64)};
export function state() {
  return {version: 1, playerId: "offline-test-player", updatedAt: 123,
    profile: {name: "Player", starter: 4, starterJ: 0, settings: {}, league: [4], unlocked: [4], seen: [4],
      stardust: 0, totalStardust: 0, bonk: 0},
    stash: {}, activeRun: null, suspended: null, finished: {}, spins: {}};
}
export const save = () => envelope(state(), config);
export function manifest(version = "0.2.0") {
  return {manifestVersion: 1, edition: "standard", applicationId: config.applicationId,
    repository: config.repository, version, upstream: {...config.upstream},
    save: {schema: 1, minReader: 1, maxReader: 1, compatibleRunBuilds: [config.upstream.build]},
    source: {commit: "b".repeat(40), pristineDigest: "c".repeat(64), gameDigest: "d".repeat(64)},
    publishedAt: "2026-11-21T12:00:00.000Z", notes: "Test release. No game services online.",
    artifacts: Object.fromEntries(Object.entries(DISTRIBUTIONS).map(([id, {platform, kind}]) => {
      const name = artifactName(version, id);
      return [id, {name, platform, kind, url: artifactURL(config, version, name), bytes: 10, sha256: "e".repeat(64),
        ...(kind === "apk" ? {applicationId: config.applicationId, versionCode: 2, signingCertificateSha256: config.androidCertificateSha256} : {})}];
    }))};
}
export function signed(m = manifest(), key = keys.privateKey) {
  const payload = Buffer.from(JSON.stringify(m));
  return Buffer.from(JSON.stringify({algorithm: "ECDSA-P256-SHA256-DER", keyId: config.updateKeyId,
    payload: payload.toString("base64"), signature: sign("sha256", payload, key).toString("base64")}));
}
