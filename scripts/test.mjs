import {readdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
const files = (await readdir("standard/test")).filter(name => /\.test\.(?:mjs|js|ts)$/.test(name)).sort();
if (!files.length) throw new Error("No tests found.");
execFileSync(process.execPath, ["--test", ...files.map(name => `standard/test/${name}`)], {stdio: "inherit"});
