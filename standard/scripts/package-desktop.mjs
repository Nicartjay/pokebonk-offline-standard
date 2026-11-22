import {build, Platform, Arch} from "electron-builder";
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createRequire} from "node:module";
import path from "node:path";
import os from "node:os";
import {DISTRIBUTIONS, artifactName} from "../common/manifest.mjs";
import {desktopConfiguration} from "../packaging/desktop-config.mjs";
import {describeArtifact, writeReceipt} from "./release-files.mjs";
import {verifyPayload} from "./verify.mjs";

const require = createRequire(import.meta.url);
const [platform = process.platform, arch = process.arch] = process.argv.slice(2);
const native = `${platform}-${arch}`;
if (!["darwin-arm64", "darwin-x64", "win32-x64", "linux-x64"].includes(native)) throw new Error("Desktop targets: darwin arm64/x64, win32 x64, linux x64.");
if (process.platform !== platform) throw new Error("Package on the target OS (Intel macOS may also be packaged on Apple Silicon).");
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
if (rootPackage.version !== config.version || rootPackage.productName !== config.productName) throw new Error("Package/config branding or version mismatch.");
const {inventory} = await verifyPayload();
const game = path.resolve("build/standard-game"), resources = path.resolve("standard/resources");
const temp = await mkdtemp(path.join(os.tmpdir(), "pokebonk-offline-package-"));
const output = path.resolve("build/desktop-out", native), release = path.resolve("standard/release");
try {
  const app = path.join(temp, "app");
  await mkdir(path.join(app, "standard"), {recursive: true});
  for (const directory of ["desktop", "common"]) await cp(`standard/${directory}`, path.join(app, "standard", directory), {recursive: true});
  await cp("standard/config.json", path.join(app, "standard/config.json"));
  for (const file of ["LICENSE", "NOTICE.md", "README.md"]) await cp(file, path.join(app, file));
  await writeFile(path.join(app, "package.json"), JSON.stringify({
    name: "pokebonk-offline", productName: config.productName, version: config.version,
    type: "module", main: "standard/desktop/main.mjs", author: "Nicartjay", license: "AGPL-3.0-only",
    homepage: `https://github.com/${config.repository}`,
    desktopName: `${config.applicationId}.desktop`,
    description: "Offline normal-progression adaptation; original game by Charcher; shell tooling by VdustR.",
  }, null, 2));
  const builderPlatform = {darwin: Platform.MAC, win32: Platform.WINDOWS, linux: Platform.LINUX}[platform];
  await build({
    projectDir: process.cwd(),
    targets: builderPlatform.createTarget(undefined, Arch[arch]),
    config: desktopConfiguration(config, {app, output, game, resources, electronVersion: require("electron/package.json").version}),
    publish: "never",
  });
  // Verify the resulting bundle, not just the source package name.
  if (platform === "darwin") {
    const bundle = path.join(output, arch === "arm64" ? "mac-arm64" : "mac", `${config.productName}.app`);
    const plist = path.join(bundle, "Contents/Info.plist");
    for (const [key, value] of Object.entries({CFBundleName: config.productName, CFBundleDisplayName: config.productName,
      CFBundleIdentifier: config.applicationId, CFBundleShortVersionString: config.version})) {
      if (execFileSync("plutil", ["-extract", key, "raw", plist], {encoding: "utf8"}).trim().normalize("NFC") !== value.normalize("NFC")) throw new Error(`Wrong packaged macOS ${key}.`);
    }
    execFileSync("codesign", ["--verify", "--deep", "--strict", bundle], {stdio: "inherit"});
  } else if (platform === "win32") {
    const exe = path.join(output, "win-unpacked", `${config.productName}.exe`);
    const command = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); (Get-Item -LiteralPath '${exe.replaceAll("'", "''")}').VersionInfo.ProductName`;
    if (execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {encoding: "utf8"}).trim() !== config.productName) {
      throw new Error("Wrong Windows executable ProductName.");
    }
  }
  const packagedGame = platform === "darwin"
    ? path.join(output, arch === "arm64" ? "mac-arm64" : "mac", `${config.productName}.app/Contents/Resources/game`)
    : path.join(output, platform === "win32" ? "win-unpacked" : "linux-unpacked", "resources/game");
  const bundled = await verifyPayload(packagedGame);
  if (bundled.inventory.gameDigest !== inventory.gameDigest) throw new Error("The packaged desktop game differs from the accepted shared payload.");
  await mkdir(release, {recursive: true});
  const artifacts = {};
  for (const id of Object.keys(DISTRIBUTIONS).filter(id => DISTRIBUTIONS[id].platform === native)) {
    const name = artifactName(config.version, id);
    await cp(path.join(output, name), path.join(release, name));
    artifacts[id] = await describeArtifact(release, id, config);
  }
  await writeReceipt(release, native, config, inventory.gameDigest, artifacts);
  console.log(`Packaged ${config.productName}: ${Object.values(artifacts).map(a => a.name).join(", ")}`);
} finally { await rm(temp, {recursive: true, force: true}); }
