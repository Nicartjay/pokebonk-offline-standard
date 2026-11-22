import {mkdir, readFile, mkdtemp, rm, rename, lstat} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {verifyPayload} from "./verify.mjs";
import {isMain} from "../../scripts/is-main.mjs";

export async function restorePayload(archive, {destination = "build/standard-game", verify = verifyPayload} = {}) {
  if (!archive) throw new Error("Missing shared game archive.");
  const capture = args => execFileSync("tar", args, {encoding: "utf8", maxBuffer: 16 * 1024 * 1024}).replaceAll("\r\n", "\n");
  const names = capture(["-tf", archive]).trim().split("\n");
  if (!names.length || names.length > 20000 || new Set(names).size !== names.length || names.some(name => {
    const clean = name.replace(/\/$/, "");
    return (clean !== "standard-game" && !clean.startsWith("standard-game/")) ||
      !/^[A-Za-z0-9_./-]+$/.test(clean) || clean.split("/").some(p => !p || p.startsWith("."));
  })) throw new Error("Unsafe shared game archive paths.");
  if (capture(["-tvf", archive]).trim().split("\n").some(line => !["-", "d"].includes(line[0]))) {
    throw new Error("Shared game archives cannot contain links or special files.");
  }
  const output = path.resolve(destination), parent = path.dirname(output);
  await mkdir(parent, {recursive: true});
  const staging = await mkdtemp(path.join(parent, ".game-restore-"));
  try {
    execFileSync("tar", ["-xf", archive, "-C", staging], {stdio: "inherit"});
    const candidate = path.join(staging, "standard-game"), verified = await verify(candidate);
    const head = execFileSync("git", ["rev-parse", "HEAD"], {encoding: "utf8"}).trim();
    const config = JSON.parse(await readFile("standard/config.json", "utf8"));
    if (verified.metadata.sourceCommit !== head || verified.metadata.appVersion !== config.version) {
      throw new Error("Shared game payload was prepared from another commit/version.");
    }
    // Never overlay a new release on an old asset tree: obsolete hashed modules
    // would survive an upstream update. Verify a fresh tree, then swap atomically.
    const previous = output + ".previous";
    let exists = false;
    try {
      const info = await lstat(output);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Unexpected game output boundary.");
      exists = true;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    await rm(previous, {recursive: true, force: true});
    if (exists) await rename(output, previous);
    try { await rename(candidate, output); }
    catch (error) { if (exists) await rename(previous, output); throw error; }
    return verified;
  } finally { await rm(staging, {recursive: true, force: true}); }
}
if (isMain(import.meta.url)) await restorePayload(process.env.GAME_ARCHIVE);
