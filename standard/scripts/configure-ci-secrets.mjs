// Explicit one-time transfer into GitHub's encrypted, environment-scoped secrets.
// Secret bytes go through stdin, never arguments, output, source, or artifacts.
import {readFile, realpath} from "node:fs/promises";
import {createPublicKey, createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import path from "node:path";
if (!process.argv.includes("--approve-upload")) throw new Error("No secrets uploaded. Requires --approve-upload.");
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
const file = process.argv.find(arg => arg.endsWith("credentials.json")) ?? "../pokebonk-standard-signing/credentials.json";
const root = await realpath("."), credentials = JSON.parse(await readFile(file, "utf8"));
for (const name of [credentials.privateKeyFile, credentials.keystoreFile]) {
  if ((await realpath(name)).startsWith(root + path.sep)) throw new Error("Signing keys must remain outside Git.");
}
const pem = await readFile(credentials.privateKeyFile, "utf8");
if (createPublicKey(pem).export({type: "spki", format: "pem"}) !== config.updatePublicKey) throw new Error("Wrong release key.");
const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin/keytool") : "keytool";
const certificate = execFileSync(keytool, ["-exportcert", "-keystore", credentials.keystoreFile, "-alias", credentials.keyAlias, "-storepass:env", "STANDARD_KEY_PASSWORD"],
  {env: {...process.env, STANDARD_KEY_PASSWORD: credentials.storePassword}, stdio: ["ignore", "pipe", "pipe"]});
if (createHash("sha256").update(certificate).digest("hex") !== config.androidCertificateSha256) throw new Error("Wrong APK signing identity.");
const repo = JSON.parse(execFileSync("gh", ["repo", "view", config.repository, "--json", "nameWithOwner,viewerPermission"], {encoding: "utf8"}));
if (repo.nameWithOwner !== "Nicartjay/pokebonk-offline-standard" || repo.viewerPermission !== "ADMIN") throw new Error("Verify the owned release repository first.");
const secrets = {
  STANDARD_ANDROID_KEYSTORE_BASE64: (await readFile(credentials.keystoreFile)).toString("base64"),
  STANDARD_ANDROID_STORE_PASSWORD: credentials.storePassword,
  STANDARD_ANDROID_KEY_PASSWORD: credentials.keyPassword,
  STANDARD_ANDROID_KEY_ALIAS: credentials.keyAlias,
  STANDARD_UPDATE_PRIVATE_KEY: pem,
};
for (const [name, value] of Object.entries(secrets)) {
  if (typeof value !== "string" || !value) throw new Error(`Missing ${name}.`);
  execFileSync("gh", ["secret", "set", name, "--repo", config.repository, "--env", "release-signing"],
    {input: value, stdio: ["pipe", "ignore", "pipe"]});
  console.log(`Configured encrypted release-signing secret: ${name}`);
}
console.log("Original local keys were retained unchanged. Back them up separately.");
