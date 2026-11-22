// One-time, LOCAL, read-only import of the already acquired original archive.
// Never imports a patched JS module from the Python-served edition.
import {readFile, realpath, access, writeFile} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {writeSnapshot} from "../../scripts/upstream-snapshot.ts";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const archive = await realpath(process.argv[2] ?? "../pokebonk-assets");
const offline = await realpath(process.argv[3] ?? "../pokebonk-offline");
const destination = "vendor/pokebonk-standard-0.10.20";
try { await access(destination); throw new Error("Baseline already exists; it is immutable. Use a new candidate directory."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const original = JSON.parse(await readFile(path.join(archive, "_metadata/manifest.json"), "utf8"));
if (original.site !== "https://pokebonk.com/") throw new Error("Not the captured public asset archive.");
const files = new Map();
for (const entry of Object.values(original.assets)) {
  if (entry.status !== "downloaded") continue;
  const file = await realpath(path.join(archive, entry.local_path));
  if (!file.startsWith(archive + path.sep)) throw new Error("Archive path escape.");
  const bytes = await readFile(file);
  if (sha(bytes) !== entry.sha256 || bytes.length !== entry.bytes) throw new Error(`Original asset changed: ${entry.remote_path}`);
  let name = entry.remote_path.replace(/^\//, "");
  if (name.startsWith("cdn-cgi/")) continue;
  if (name === "legal") name = "legal.html";
  files.set(name, bytes);
}
const supplements = JSON.parse(await readFile(path.join(offline, "reports/supplemental-assets.json"), "utf8"));
for (const item of supplements.assets) {
  if (!["present", "downloaded"].includes(item.status) || files.has(item.path)) continue;
  if (!/^assets\/(?:env\/common\/atlas\.(?:png|json)|items\/tm-[a-z]+\.png|ui\/maps\/[\w-]+\.webp)$/.test(item.path)) throw new Error("Unreviewed supplemental path.");
  const bytes = await readFile(path.join(offline, item.path));
  if (sha(bytes) !== item.sha256 || bytes.length !== item.bytes) throw new Error("Supplemental asset integrity mismatch.");
  files.set(item.path, bytes);
}
const html = files.get("index.html")?.toString();
if (!html?.includes('content="mwqb4pwz"')) throw new Error("This importer only accepts the captured 0.10.20 baseline.");
const snapshot = await writeSnapshot(destination, files, "mwqb4pwz", "0.10.20",
  supplements.assets.filter(item => item.status === "unavailable").map(item => item.path));
await writeFile("standard/accepted.json", JSON.stringify({
  snapshot: destination, version: "0.10.20", build: "mwqb4pwz", digest: snapshot.digest,
  adapter: "mwqb4pwz", review: "Captured baseline with original client progression, local-only modes and verified supplemental assets.",
}, null, 2) + "\n");
console.log(`Imported ${files.size} verified pristine assets. Archive and previous offline edition unchanged.`);
