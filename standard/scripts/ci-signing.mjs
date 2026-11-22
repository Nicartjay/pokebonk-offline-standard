// CI's Android keystore lives outside the checkout and is never an artifact.
import {mkdir, writeFile, rm} from "node:fs/promises";
import path from "node:path";
const file = path.resolve(process.env.STANDARD_ANDROID_KEYSTORE ?? "");
const root = path.resolve(process.env.RUNNER_TEMP ?? "");
if (!process.env.RUNNER_TEMP || file !== path.join(root, "pokebonk-signing", "standard-android.p12")) throw new Error("Unexpected CI keystore location.");
if (process.argv[2] === "clean") {
  await rm(path.dirname(file), {recursive: true, force: true});
} else if (process.argv[2] === "restore") {
  const encoded = process.env.STANDARD_ANDROID_KEYSTORE_BASE64;
  if (!encoded || encoded.length > 48 * 1024 || !/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) throw new Error("Configure the stable Android signing secrets in release-signing first.");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 1000) throw new Error("Invalid signing keystore.");
  await mkdir(path.dirname(file), {recursive: true, mode: 0o700});
  await writeFile(file, bytes, {mode: 0o600, flag: "wx"});
} else throw new Error("Choose restore or clean.");
