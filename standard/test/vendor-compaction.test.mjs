import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,lstat,rm,symlink} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {compactVendor} from "../scripts/compact-vendor.mjs";
import {writeSnapshot,readSnapshot} from "../../scripts/upstream-snapshot.ts";

async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),"pokebonk-vendor-compact-"));
  for(const build of ["old","current"])await writeSnapshot(path.join(root,build),new Map([
    ["index.html",Buffer.from(`<meta name="pokebonk-build" content="${build}">`)],
    ["assets/shared.png",Buffer.from("identical captured artwork")],
    ["assets/main.js",Buffer.from(`export default "${build}";`)],
  ]),build,"0.10.31");
  return {root,file:build=>path.join(root,build,"game/assets/shared.png")};
}
test("dry-run verifies snapshots but does not replace files or change permissions",async()=>{
  const f=await fixture();
  try{
    const before=await lstat(f.file("old"));
    const result=await compactVendor({root:f.root,preferredSnapshot:"current"});
    const after=await lstat(f.file("old"));
    assert.equal(result.mode,"dry-run");assert.equal(result.duplicatePaths,1);
    assert.equal(result.linkedFiles,0);assert.equal(result.reclaimedGameFileBytes,0);
    assert.equal(after.ino,before.ino);assert.equal(after.mode,before.mode);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test("compaction preserves every byte/digest, prefers current files and is idempotent",async()=>{
  const f=await fixture();
  try{
    const originals=await Promise.all(["old","current"].map(name=>readSnapshot(path.join(f.root,name))));
    const current=await lstat(f.file("current"));
    const result=await compactVendor({root:f.root,preferredSnapshot:"current",apply:true});
    assert.equal(result.linkedFiles,1);assert.ok(result.reclaimedGameFileBytes>0);
    const old=await lstat(f.file("old")),now=await lstat(f.file("current"));
    assert.equal(old.ino,current.ino);assert.equal(now.ino,current.ino);
    assert.equal(now.mode&0o222,0);
    for(const [index,name]of ["old","current"].entries())
      assert.deepEqual(await readSnapshot(path.join(f.root,name)),originals[index]);
    const again=await compactVendor({root:f.root,preferredSnapshot:"current",apply:true});
    assert.equal(again.linkedFiles,0);assert.equal(again.reclaimedGameFileBytes,0);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test("corruption aborts the entire preflight before any duplicate is replaced",async()=>{
  const f=await fixture();
  try{
    const before=await lstat(f.file("current"));
    const file=path.join(f.root,"old/game/assets/main.js"),bytes=await readFile(file);
    await writeFile(file,Buffer.alloc(bytes.length,120));
    await assert.rejects(compactVendor({root:f.root,preferredSnapshot:"current",apply:true}),/integrity mismatch/);
    assert.equal((await lstat(f.file("current"))).ino,before.ino);
    assert.notEqual((await lstat(f.file("old"))).ino,before.ino);
    await assert.rejects(lstat(path.join(f.root,".vendor-compaction.lock")),error=>error.code==="ENOENT");
  }finally{await rm(f.root,{recursive:true,force:true});}
});
test("symlink assets cannot redirect compaction outside their snapshot", {skip:process.platform==="win32"},async()=>{
  const f=await fixture();
  try{
    await rm(f.file("old"));await symlink(f.file("current"),f.file("old"));
    await assert.rejects(compactVendor({root:f.root,apply:true}),/Invalid snapshot file/);
    assert.equal((await lstat(f.file("current"))).nlink,1);
  }finally{await rm(f.root,{recursive:true,force:true});}
});
