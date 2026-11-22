import {readFile, appendFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
const pkg = JSON.parse(await readFile("package.json", "utf8"));
if (process.env.GITHUB_REPOSITORY !== config.repository) throw new Error("Release builds must run in the configured publisher repository.");
if (pkg.version !== config.version || pkg.productName !== config.productName || config.productName !== "PokéBonk Offline") throw new Error("Version/name mismatch.");
const git = args => execFileSync("git", args, {encoding: "utf8"}).trim();
const commit = git(["rev-parse", "HEAD"]), tag = process.env.REQUESTED_TAG ?? "";
if (tag) {
  if (tag !== `standard-v${config.version}` || git(["rev-parse", `refs/tags/${tag}^{commit}`]) !== commit) throw new Error("Tag must identify this exact configured application version/commit.");
} else if (process.env.GITHUB_REF !== "refs/heads/main") {
  throw new Error("Untagged test builds must be dispatched on main.");
}
// Never inject release keys into source from an unreviewed side branch.
execFileSync("git", ["merge-base", "--is-ancestor", commit, "origin/main"], {stdio: "inherit"});
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `commit=${commit}\nversion=${config.version}\ntag=${tag}\n`);
console.log(`Building ${config.productName} ${config.version}, ${commit}${tag ? ` (${tag})` : " (test artifacts only)"}.`);
