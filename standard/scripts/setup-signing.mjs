import {mkdir, readFile, writeFile, chmod, access} from "node:fs/promises";
import path from "node:path";
import {generateKeyPairSync, createPublicKey, createHash, randomBytes} from "node:crypto";
import {execFileSync} from "node:child_process";
const directory = path.resolve(process.argv[2] ?? "../pokebonk-standard-signing");
const repo = path.resolve(".");
if (directory === repo || directory.startsWith(repo + path.sep)) throw new Error("Keep Standard private keys OUTSIDE the Git checkout.");
const config = JSON.parse(await readFile("standard/config.json", "utf8"));
const credentialsFile = path.join(directory, "credentials.json");
let credentials;
try { credentials = JSON.parse(await readFile(credentialsFile, "utf8")); }
catch (error) {
  if (error.code !== "ENOENT") throw error;
  if (config.updatePublicKey || config.androidCertificateSha256) throw new Error("Signing identities already exist. Restore the original external keys; do not generate replacements.");
  await mkdir(directory, {recursive: true, mode: 0o700});
  const privateKeyFile = path.join(directory, "standard-release-p256.pem");
  const keystoreFile = path.join(directory, "standard-android.p12");
  for (const file of [privateKeyFile, keystoreFile]) {
    try { await access(file); throw new Error("Partial signing setup found. Restore/review it before retrying; nothing was replaced."); }
    catch (missing) { if (missing.code !== "ENOENT") throw missing; }
  }
  const keys = generateKeyPairSync("ec", {namedCurve: "prime256v1",
    privateKeyEncoding: {type: "pkcs8", format: "pem"}, publicKeyEncoding: {type: "spki", format: "pem"}});
  await writeFile(privateKeyFile, keys.privateKey, {mode: 0o600, flag: "wx"});
  const password = randomBytes(32).toString("base64url");
  credentials = {privateKeyFile, keystoreFile, storePassword: password, keyPassword: password, keyAlias: "pokebonk-standard"};
  // Write recovery information before keytool, without logging secret arguments.
  await writeFile(credentialsFile, JSON.stringify(credentials, null, 2) + "\n", {mode: 0o600, flag: "wx"});
  const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin/keytool") : "keytool";
  execFileSync(keytool, ["-genkeypair", "-keystore", keystoreFile, "-storetype", "PKCS12", "-alias", credentials.keyAlias,
    "-storepass:env", "STANDARD_KEY_PASSWORD", "-keypass:env", "STANDARD_KEY_PASSWORD", "-keyalg", "RSA", "-keysize", "3072",
    "-validity", "20000", "-dname", "CN=Nicartjay Pokebonk Offline Standard", "-noprompt"],
    {env: {...process.env, STANDARD_KEY_PASSWORD: password}, stdio: ["ignore", "ignore", "pipe"]});
  await chmod(keystoreFile, 0o600);
}
const key = createPublicKey(await readFile(credentials.privateKeyFile));
if (key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("Not a P-256 release key.");
const publicKey = key.export({type: "spki", format: "pem"});
const keytool = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, "bin/keytool") : "keytool";
const certificate = execFileSync(keytool, ["-exportcert", "-keystore", credentials.keystoreFile, "-alias", credentials.keyAlias,
  "-storepass:env", "STANDARD_KEY_PASSWORD"], {env: {...process.env, STANDARD_KEY_PASSWORD: credentials.storePassword}, stdio: ["ignore", "pipe", "pipe"]});
const fingerprint = createHash("sha256").update(certificate).digest("hex");
if ((config.updatePublicKey && config.updatePublicKey !== publicKey) ||
    (config.androidCertificateSha256 && config.androidCertificateSha256 !== fingerprint)) throw new Error("Original signing identity mismatch. No configuration was changed.");
await writeFile("standard/config.json", JSON.stringify({...config, updatePublicKey: publicKey, androidCertificateSha256: fingerprint}, null, 2) + "\n");
console.log(`Standard public identities initialized/verified. Private keys remain outside Git at ${directory}. Back up this directory securely on another device. No key values were printed.`);
