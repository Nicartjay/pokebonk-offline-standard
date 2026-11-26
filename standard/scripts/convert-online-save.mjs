// Local file-to-file conversion only. No fetch, account login, game launch,
// installed save access, automatic import or overwriting existing files.
import assert from "node:assert/strict";
import {readFile,lstat,open,unlink,mkdir} from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {convertOnlineArchive} from "../tools/online-save-export.mjs";
import {validateEnvelope,MAX_STATE_BYTES} from "../common/state.mjs";

const args=process.argv.slice(2);
if(args.length<1||args.length>2)throw Error("Usage: node standard/scripts/convert-online-save.mjs INPUT.json [NEW-OUTPUT.json]");
const root=fileURLToPath(new URL("../../",import.meta.url));
const review=JSON.parse(await readFile(new URL("../tools/online-save-review.json",import.meta.url),"utf8"));
const config=JSON.parse(await readFile(new URL("../config.json",import.meta.url),"utf8"));
assert.equal(review.appVersion,config.version);
assert.equal(review.schema,config.saveSchema);
assert.deepEqual(review.targetGame,config.upstream);
const input=path.resolve(args[0]),info=await lstat(input);
if(!info.isFile()||info.isSymbolicLink()||info.size>MAX_STATE_BYTES)throw Error("Choose a regular online archive JSON under 32 MiB.");
const bytes=await readFile(input),originalHash=createHash("sha256").update(bytes).digest("hex");
const archive=JSON.parse(bytes.toString("utf8"));
const now=Date.now(),stamp=new Date(now).toISOString().replace(/[:.]/g,"-");
const output=path.resolve(args[1]??path.join(path.dirname(input),`pokebonk-OFFLINE-IMPORT-${stamp}.json`));
if(input===output||!/^pokebonk-OFFLINE-IMPORT-[\w.-]+\.json$/.test(path.basename(output))) {
  throw Error("Use a NEW filename beginning pokebonk-OFFLINE-IMPORT-. The original archive and installed state files cannot be overwritten.");
}
if(output.startsWith(root)){
  const ignored=execFileSync("git",["check-ignore","--",path.relative(root,output)],{cwd:root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
  if(!ignored)throw Error("Personal backups must stay outside Git or in an ignored private directory.");
}
const converted=convertOnlineArchive(archive,review,{validateEnvelope,randomUUID,now});
const text=JSON.stringify(converted,null,2)+"\n";
if(Buffer.byteLength(text)>MAX_STATE_BYTES)throw Error("The converted backup exceeds 32 MiB.");
validateEnvelope(JSON.parse(text),config);
await mkdir(path.dirname(output),{recursive:true,mode:0o700});
const handle=await open(output,"wx",0o600);
try{
  await handle.writeFile(text);
  await handle.sync();
}catch(error){
  await handle.close();
  await unlink(output);
  throw error;
}
await handle.close();
assert.equal(createHash("sha256").update(await readFile(input)).digest("hex"),originalHash,
  "The source archive changed during conversion.");
console.log(`Created private import copy: ${output}`);
console.log(`Validated for Offline ${config.version}. Original archive unchanged. No account contacted, game opened, or installed save replaced.`);
console.log("Export your current offline backup first. Importing this new file replaces local progress; it does not merge currencies or saves.");
