import yauzl from "yauzl";
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {DISTRIBUTIONS} from "../common/manifest.mjs";
import {verifyPayload} from "./verify.mjs";

// Read ZIP entries as bounded streams. Never extract untrusted archive paths.
export async function auditAPKEntries(file, expectedFiles, expectedNativeConfig) {
  const zip = await new Promise((resolve, reject) => yauzl.open(file,
    {lazyEntries: true, autoClose: true, validateEntrySizes: true, strictFileNames: true}, (error, value) => error ? reject(error) : resolve(value)));
  await new Promise((resolve, reject) => {
    let done = false, count = 0, total = 0, nativeConfig = false;
    const names = new Set(), matched = new Set(), prefix = "assets/www/";
    const fail = error => { if (!done) { done = true; zip.close(); reject(error); } };
    zip.once("error", fail);
    zip.on("entry", entry => {
      void (async () => {
        if (++count > 20000 || names.has(entry.fileName)) throw new Error("Duplicate or oversized APK inventory.");
        names.add(entry.fileName);
        total += entry.uncompressedSize;
        if (!Number.isSafeInteger(total) || total > 1024 * 1024 * 1024) throw new Error("APK uncompressed budget exceeded.");
        if (entry.fileName.endsWith("/")) { zip.readEntry(); return; }
        const relative = entry.fileName.startsWith(prefix) ? entry.fileName.slice(prefix.length) : null;
        const expected = relative === null ? null : expectedFiles.get(relative);
        const isConfig = entry.fileName === "assets/standard-config.json";
        if (relative !== null && !expected) throw new Error(`Unexpected bundled APK game asset: ${relative}`);
        if (relative === null && !isConfig) { zip.readEntry(); return; }
        const limit = isConfig ? 64 * 1024 : expected.bytes;
        if (entry.uncompressedSize > limit || (!isConfig && entry.uncompressedSize !== expected.bytes)) throw new Error("APK asset size mismatch.");
        const stream = await new Promise((r, j) => zip.openReadStream(entry, (error, value) => error ? j(error) : r(value)));
        const hash = createHash("sha256"), chunks = [];
        let bytes = 0;
        for await (const chunk of stream) {
          bytes += chunk.length;
          if (bytes > limit) throw new Error("APK entry exceeds verified size.");
          hash.update(chunk);
          if (isConfig) chunks.push(chunk);
        }
        if (isConfig) {
          if (!isDeepStrictEqual(JSON.parse(Buffer.concat(chunks).toString("utf8")), expectedNativeConfig)) throw new Error("APK native configuration differs from reviewed source.");
          nativeConfig = true;
        } else {
          if (bytes !== expected.bytes || hash.digest("hex") !== expected.sha256) throw new Error(`APK game asset hash mismatch: ${relative}`);
          matched.add(relative);
        }
        zip.readEntry();
      })().catch(fail);
    });
    zip.once("end", () => {
      if (done) return;
      if (!nativeConfig || matched.size !== expectedFiles.size) { fail(new Error("Incomplete APK native config/game payload.")); return; }
      done = true; resolve();
    });
    zip.readEntry();
  });
}
export async function verifyAPKPayload(file, config, directory = "build/standard-game") {
  const verified = await verifyPayload(directory);
  const inventoryBytes = await readFile(path.join(directory, "asset-manifest.json"));
  const expected = new Map(verified.inventory.files.map(entry => [entry.name, entry]));
  expected.set("asset-manifest.json", {bytes: inventoryBytes.length, sha256: createHash("sha256").update(inventoryBytes).digest("hex")});
  await auditAPKEntries(file, expected, {...config, updateDistributions: DISTRIBUTIONS});
  return verified;
}
