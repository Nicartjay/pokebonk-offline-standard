// Explicit maintenance only: reviewed source graph + a finite asset contract.
import {readFile, realpath, access, writeFile} from "node:fs/promises";
import path from "node:path";
import {sha} from "./prepare.mjs";
import {ast, configContext, one} from "../../scripts/source.ts";
import {versionForBuild} from "../../scripts/upstream-version.ts";
import {requestUpstream} from "../../scripts/upstream-request.ts";
import {writeSnapshot} from "../../scripts/upstream-snapshot.ts";
const [graphArg, resourcesArg] = process.argv.slice(2);
if (!graphArg || !resourcesArg) throw new Error("Usage: node standard/scripts/capture-candidate.mjs upstream/standard-review reviewed-resource-contract.json");
const graphRoot = await realpath(graphArg), upstreamRoot = await realpath("upstream");
if (!graphRoot.startsWith(upstreamRoot + path.sep)) throw new Error("Review graph must be inside upstream/.");
const graph = JSON.parse(await readFile(path.join(graphRoot, "graph.json"), "utf8"));
if (graph.origin !== "https://pokebonk.com" || !/^[\w-]{4,80}$/.test(graph.build)) throw new Error("Wrong source graph.");
const files = new Map();
for (const entry of graph.files) {
  if (typeof entry.name !== "string" || entry.name.startsWith("/") || entry.name.split("/").some(p => !p || p.startsWith(".") || p.includes("\\"))) throw new Error("Unsafe source graph path.");
  const file = await realpath(path.join(graphRoot, entry.name));
  if (!file.startsWith(graphRoot + path.sep)) throw new Error("Source graph boundary.");
  const bytes = await readFile(file);
  if (bytes.length !== entry.bytes || sha(bytes) !== entry.sha256) throw new Error("Source graph hash mismatch.");
  files.set(entry.name, bytes);
}
const configFile = one([...files].filter(([name, data]) => name.endsWith(".js") && data.toString().includes("data/pokemon.json") && data.toString().includes("slot-move")), "candidate configuration");
const context = configContext(configFile[1].toString());
const version = versionForBuild(ast(configFile[1].toString()), graph.build);
if (!version) throw new Error("No structurally verified candidate version.");
const versions = one(Object.values(context.values).filter(v => v && typeof v === "object" && !Array.isArray(v) && v["models"] && v["pmd"] && v["data/pokemon.json"]), "candidate versioned asset catalog");
const contract = JSON.parse(await readFile(resourcesArg, "utf8"));
if (contract.reviewedBuild !== graph.build || !Array.isArray(contract.required) || !Array.isArray(contract.optional)) throw new Error("Resource contract must be explicitly reviewed for this exact build.");
const names = [...contract.required, ...contract.optional];
if (new Set(names).size !== names.length || names.length > 12000) throw new Error("Duplicate/oversized resource contract.");
const destination = path.join("upstream/standard-candidates", graph.build);
try { await access(destination); throw new Error("Candidate already exists; pristine snapshots are immutable."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const missing = [], optional = new Set(contract.optional);
let cursor = 0, size = [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
await Promise.all(Array.from({length: 6}, async () => {
  while (cursor < names.length) {
    const name = names[cursor++];
    if (typeof name !== "string" || !/^[\w/-][\w./-]*\.(?:png|jpg|webp|glb|ogg|mp3|json|txt|ico)$/.test(name) || name.split("/").some(part => part.startsWith("."))) throw new Error("Unsafe reviewed asset path.");
    if (files.has(name)) continue;
    const resource = name.replace(/^assets\//, "");
    const key = Object.keys(versions).sort((a, b) => b.length - a.length).find(k => resource === k || resource.startsWith(k + "/"));
    const url = new URL("/" + name, "https://pokebonk.com");
    if (key) url.searchParams.set("v", versions[key]);
    const response = await requestUpstream(url, {maxBytes: 32 * 1024 * 1024});
    if (response.status === 404 && optional.has(name)) { missing.push(name); continue; }
    if (!response.ok) throw new Error(`Required candidate asset ${response.status}: ${name}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.subarray(0, 200).toString().toLowerCase().includes("<!doctype html")) throw new Error(`HTML returned for ${name}.`);
    size += bytes.length;
    if (size > 1024 * 1024 * 1024) throw new Error("Candidate asset budget exceeded.");
    files.set(name, bytes);
  }
}));
const snapshot = await writeSnapshot(destination, files, graph.build, version, missing);
await writeFile(path.join(destination, "review-required.json"), JSON.stringify({
  edition: "standard", version, build: graph.build, digest: snapshot.digest, accepted: false,
  next: "Review resources, add/test an explicit structural adapter and save compatibility, then separately approve acceptance. standard/accepted.json was NOT changed.",
}, null, 2) + "\n");
console.log(`Captured pristine candidate ${version}/${graph.build}, ${files.size} files. No game payload or release was updated.`);
