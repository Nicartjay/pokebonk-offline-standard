import {readFile,realpath,lstat} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {validateRentalSnapshot} from "../common/rentals.mjs";
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
export async function readRentalSnapshot(accepted) {
  const infoBytes=await readFile("standard/rental-snapshot.json"),info=JSON.parse(infoBytes);
  if(info.schemaVersion!==1||info.file!==info.sha256+".json"||!/^[a-f0-9]{64}$/.test(info.sha256)||
    info.target?.build!==accepted.build||info.target.version!==accepted.version||info.target.digest!==accepted.digest)
    throw Error("Refresh and review rental builds for the accepted upstream version before preparing this game.");
  const root=await realpath("standard/resources/rentals"),file=await realpath(path.join(root,info.file));
  if(!file.startsWith(root+path.sep)||!(await lstat(file)).isFile())throw Error("Invalid rental resource boundary.");
  const bytes=await readFile(file);
  if(bytes.length!==info.bytes||sha(bytes)!==info.sha256)throw Error("Bundled rental snapshot integrity mismatch.");
  const data=validateRentalSnapshot(JSON.parse(bytes));
  if(JSON.stringify(data.target)!==JSON.stringify(info.target)||JSON.stringify(data.source)!==JSON.stringify(info.source)||
    data.capturedAt!==info.capturedAt||data.totalEntries!==info.totalEntries||data.species.length!==info.species||
    Object.values(data.entries).flat().filter(row=>row.compatible).length!==info.compatibleEntries)
    throw Error("Rental snapshot metadata mismatch.");
  return {bytes,info,publicInfo:{capturedAt:info.capturedAt,source:info.source,species:info.species,
    totalEntries:info.totalEntries,compatibleEntries:info.compatibleEntries,sha256:info.sha256}};
}
