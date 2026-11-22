import {existsSync} from "node:fs";
import {readdir, appendFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import path from "node:path";

const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT;
if (!sdk || /[\r\n]/.test(sdk)) throw new Error("Set ANDROID_HOME to an installed Android SDK.");
const tools = path.join(sdk, "cmdline-tools");
const versions = existsSync(tools) ? (await readdir(tools)).filter(n => n !== "latest").sort().reverse() : [];
const managers = [path.join(tools, "latest/bin/sdkmanager"), ...versions.map(v => path.join(tools, v, "bin/sdkmanager")),
  path.join(tools, "bin/sdkmanager"), path.join(sdk, "tools/bin/sdkmanager")];
const manager = managers.find(existsSync);
if (!manager) throw new Error("Android SDK command-line tools were not found. Install them in ANDROID_HOME/cmdline-tools.");
const env = {...process.env, ANDROID_HOME: sdk, ANDROID_SDK_ROOT: sdk};
// Hosted runners have the SDK but do not always put sdkmanager on PATH.
execFileSync(manager, [`--sdk_root=${sdk}`, "--licenses"],
  {env, input: "y\n".repeat(100), stdio: ["pipe", "ignore", "pipe"]});
execFileSync(manager, [`--sdk_root=${sdk}`, "platforms;android-36", "build-tools;36.0.0"], {env, stdio: "inherit"});
if (process.env.GITHUB_ENV) await appendFile(process.env.GITHUB_ENV, `ANDROID_HOME=${sdk}\nANDROID_SDK_ROOT=${sdk}\n`);
console.log("Android SDK 36/build-tools 36.0.0 are available.");
