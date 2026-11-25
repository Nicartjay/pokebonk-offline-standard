// Local disk compaction only. Keep every immutable snapshot path and byte:
// identical game files on the same volume share one read-only hard link.
import {createHash,randomUUID} from "node:crypto";
import {chmod,link,lstat,mkdir,open,readFile,readdir,realpath,rename,rm,writeFile} from "node:fs/promises";
import path from "node:path";
import {readSnapshotManifest} from "../../scripts/upstream-snapshot.ts";
import {isMain} from "../../scripts/is-main.mjs";

const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const inode=info=>`${info.dev}:${info.ino}`;
const allocated=info=>Number(info.blocks)*512;
async function unchanged(row){
  const info=await lstat(row.file,{bigint:true});
  if(!info.isFile()||await realpath(row.file)!==row.file||
    info.dev!==row.info.dev||info.ino!==row.info.ino||
    info.size!==row.info.size||info.mtimeNs!==row.info.mtimeNs)
    throw Error("Snapshot changed during compaction: "+row.file);
  return info;
}
export async function compactVendor({root="vendor",preferredSnapshot,apply=false}={}){
  root=await realpath(root);
  const lockPath=path.join(root,".vendor-compaction.lock");
  let lock;
  try{
    if(apply){
      lock=await open(lockPath,"wx");
      await lock.writeFile(JSON.stringify({pid:process.pid})+"\n");
    }
    const directories=(await readdir(root,{withFileTypes:true})).filter(entry=>
      !entry.name.startsWith(".")&&entry.isDirectory()).map(entry=>entry.name)
      .sort((a,b)=>(a===preferredSnapshot?-1:b===preferredSnapshot?1:a.localeCompare(b)));
    if(!directories.length)throw Error("No vendor snapshots found.");
    if(preferredSnapshot&&!directories.includes(preferredSnapshot))throw Error("Preferred snapshot is missing.");
    const groups=new Map(),inodesBefore=new Map(),hashes=new Map(),snapshots=[];
    let files=0,logicalBytes=0;
    // Complete every integrity check BEFORE replacing even one duplicate.
    for(const name of directories){
      const snapshot=path.join(root,name),game=path.join(snapshot,"game");
      if(await realpath(game)!==game)throw Error("Snapshot game directory must not be a symlink.");
      const manifest=await readSnapshotManifest(snapshot);
      for(const entry of manifest.files){
        const file=path.join(game,entry.name),info=await lstat(file,{bigint:true});
        if(!info.isFile()||await realpath(file)!==file||Number(info.size)!==entry.bytes)
          throw Error("Invalid snapshot file: "+file);
        const identity=inode(info),hashKey=`${identity}:${info.size}:${info.mtimeNs}`;
        let actual=hashes.get(hashKey);
        if(actual===undefined){actual=hash(await readFile(file));hashes.set(hashKey,actual);}
        if(actual!==entry.sha256)throw Error("Snapshot integrity mismatch: "+file);
        const row={file,info,entry};
        await unchanged(row);
        const key=`${info.dev}:${entry.bytes}:${entry.sha256}:${info.mode&0o111n}`;
        if(!groups.has(key))groups.set(key,[]);
        groups.get(key).push(row);
        inodesBefore.set(identity,allocated(info));
        files++;logicalBytes+=entry.bytes;
      }
      const html=await readFile(path.join(game,"index.html"),"utf8");
      if(html.match(/name="pokebonk-build" content="([\w-]+)"/)?.[1]!==manifest.upstreamBuild)
        throw Error("Snapshot HTML build mismatch: "+snapshot);
      snapshots.push({name,digest:manifest.digest,files:manifest.files.length});
    }
    let linkedFiles=0,duplicatePaths=0;
    const uniqueAllocations=new Map();
    for(const rows of groups.values()){
      const first=rows[0];uniqueAllocations.set(inode(first.info),allocated(first.info));
      for(const row of rows.slice(1)){
        if(inode(row.info)===inode(first.info))continue;
        duplicatePaths++;
        if(!apply)continue;
        await unchanged(first);await unchanged(row);
        const temporary=path.join(path.dirname(row.file),".vendor-link-"+randomUUID());
        try{
          await link(first.file,temporary);
          // Atomic replacement: until rename succeeds the old copy is intact.
          await rename(temporary,row.file);
          linkedFiles++;
        }finally{await rm(temporary,{force:true});}
      }
    }
    if(apply){
      // Protect shared inodes against accidental in-place cross-version edits.
      for(const rows of groups.values())if(rows.length>1)
        await chmod(rows[0].file,Number(rows[0].info.mode&0o777n&~0o222n));
      // Hash each shared physical file, and verify EVERY original path still
      // resolves to its verified group. Metadata/manifests are never rewritten.
      for(const rows of groups.values()){
        const first=rows[0],info=await lstat(first.file,{bigint:true});
        if(hash(await readFile(first.file))!==first.entry.sha256)
          throw Error("Post-compaction integrity mismatch: "+first.file);
        for(const row of rows){
          const current=await lstat(row.file,{bigint:true});
          if(!current.isFile()||await realpath(row.file)!==row.file||
            inode(current)!==inode(info)||Number(current.size)!==row.entry.bytes)
            throw Error("Post-compaction path mismatch: "+row.file);
        }
      }
      for(const snapshot of snapshots)
        if((await readSnapshotManifest(path.join(root,snapshot.name))).digest!==snapshot.digest)
          throw Error("Snapshot manifest changed during compaction.");
    }
    const before=[...inodesBefore.values()].reduce((a,b)=>a+b,0);
    const after=[...uniqueAllocations.values()].reduce((a,b)=>a+b,0);
    return {mode:apply?"applied":"dry-run",snapshots,files,logicalBytes,duplicatePaths,linkedFiles,
      allocatedGameFileBytesBefore:before,allocatedGameFileBytesAfter:apply?after:before,
      reclaimableGameFileBytes:before-after,reclaimedGameFileBytes:apply?before-after:0,
      integrity:apply?"All game hashes, original paths and manifest digests verified":"All existing game hashes verified; no files changed",
      note:"Hard links save local checkout space; fresh checkouts/captures may need compaction again. Shared files are read-only."};
  }finally{
    if(lock){await lock.close();await rm(lockPath,{force:true});}
  }
}
if(isMain(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=="--apply"))throw Error("Usage: node standard/scripts/compact-vendor.mjs [--apply]");
  const accepted=JSON.parse(await readFile("standard/accepted.json","utf8"));
  const report=await compactVendor({preferredSnapshot:path.basename(accepted.snapshot),apply:args.includes("--apply")});
  const directory="evidence/vendor-compaction";
  await mkdir(directory,{recursive:true});
  await writeFile(path.join(directory,report.mode+".json"),JSON.stringify(report,null,2)+"\n");
  console.log(JSON.stringify(report,null,2));
}
