import {readdir, readFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
const files = (await readdir("standard/test")).filter(name => /\.test\.(?:mjs|js|ts)$/.test(name)).sort();
if (!files.length) throw new Error("No tests found.");
const inventory = JSON.parse(await readFile("build/standard-game/asset-manifest.json", "utf8"));
console.log(`Regression payload: ${inventory.gameDigest}`);
execFileSync(process.execPath, ["--test", ...files.map(name => `standard/test/${name}`)], {stdio: "inherit"});
