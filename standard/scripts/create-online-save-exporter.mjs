// Generates a self-contained, inspectable console script; never signs in,
// fetches private data, prepares a game payload or changes installed saves.
import assert from "node:assert/strict";
import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {pathToFileURL} from "node:url";
import {parse} from "acorn";
import {convertOnlineArchive,exportOnlineSave} from "../tools/online-save-export.mjs";

const config=JSON.parse(await readFile("standard/config.json","utf8"));
const metadata=JSON.parse(await readFile("build/standard-game/offline-build.json","utf8"));
assert.equal(config.version,"1.3.1");
assert.equal(config.saveSchema,1);
assert.equal(config.upstream.build,"mwv6wzyo");
assert.equal(metadata.appVersion,config.version);
assert.deepEqual(metadata.upstream,config.upstream);
// These reviewed modules have data-only initialization. Any attempted request
// during catalog extraction fails; all storage/window objects are inert stubs.
Object.assign(globalThis,{window:globalThis,location:new URL("https://invalid.local/"),
  fetch(){throw Error("Network is forbidden while generating the exporter.");},
  addEventListener(){},removeEventListener(){},
  localStorage:{getItem(){return null;},setItem(){},removeItem(){}},
  matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}})});
const expedition=await import(pathToFileURL(path.resolve("build/standard-game",metadata.modules.backendExpedition)));
assert.ok(expedition.catalog instanceof Map && expedition.catalog.size>20);
const species=JSON.parse(await readFile("build/standard-game/data/pokemon.json","utf8")).map(value=>value.id);
assert.ok(species.includes(1)&&species.includes(251));
const review={appVersion:config.version,schema:config.saveSchema,targetGame:config.upstream,
  // Public source review: services-CHeu6GVE-mwwhf156.js uses pb.session and
  // GET https://api.pokebonk.com/profile; assets-DaWVLJCO exports client 8.
  sources:[{version:"0.10.35",build:"mwwhf156",client:8}],
  species,expeditionItems:[...expedition.catalog.keys()].sort()};
function inline(source,allowedImport){
  const tree=parse(source,{ecmaVersion:"latest",sourceType:"module"}),changes=[];
  for(const node of tree.body){
    if(node.type==="ImportDeclaration"){
      assert.equal(node.source.value,allowedImport);
      changes.push({start:node.start,end:node.end,text:""});
    }else if(node.type==="ExportNamedDeclaration"){
      assert.ok(node.declaration);
      changes.push({start:node.start,end:node.declaration.start,text:""});
    }
  }
  for(const change of changes.sort((a,b)=>b.start-a.start)){
    source=source.slice(0,change.start)+change.text+source.slice(change.end);
  }
  return source;
}
const coop=inline(await readFile("standard/common/coop-rules.mjs","utf8"),undefined);
const state=inline(await readFile("standard/common/state.mjs","utf8"),"./coop-rules.mjs");
const output=`// PokéBonk: export YOUR signed-in online progress for Offline ${config.version}.
// Run only on https://pokebonk.com/ at the homepage, after online syncing finishes.
// READ-ONLY GETs to the official game/API. No login token is downloaded or logged.
// No remote scripts, storage writes, rewards claims, uploads, or online save edits.
// The original profile is preserved; unsupported data produces an ARCHIVE ONLY.
// Regenerate with: node standard/scripts/create-online-save-exporter.mjs
(async () => {
"use strict";
${coop}
${state}
const convertOnlineArchive=${convertOnlineArchive.toString()};
await (${exportOnlineSave.toString()})(${JSON.stringify(review)}, {validateEnvelope,MAX_STATE_BYTES,convertOnlineArchive});
})().catch(() => {});
`;
// Print only our controlled errors, never fetch/response/header objects.
const safeOutput=output.replace("})().catch(() => {});",
  '})().catch(error => console.error("PokéBonk save export stopped:", error instanceof Error ? error.message : "Export failed. No save was changed."));');
parse(safeOutput,{ecmaVersion:"latest",sourceType:"script"});
const destination="standard/tools/export-online-save.js";
await writeFile(destination,safeOutput);
await writeFile("standard/tools/online-save-review.json",JSON.stringify(review,null,2)+"\n");
console.log(`Created ${destination}; target Offline ${config.version}; exact native save validator; ${review.expeditionItems.length} reviewed Expedition item types. No account accessed.`);
