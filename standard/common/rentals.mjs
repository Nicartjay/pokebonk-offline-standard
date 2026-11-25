// Data validation only; no networking, profile mutations or progression grants.
const object=value=>value&&typeof value==="object"&&!Array.isArray(value);
const text=(value,max=128)=>typeof value==="string"&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const integer=(value,max=1e12)=>Number.isSafeInteger(value)&&value>=0&&value<=max;
const keys=value=>Array.isArray(value)&&value.length<=512&&value.every(item=>text(item,80)&&/^[a-z0-9][a-z0-9_-]*$/i.test(item));
const numbers=value=>Array.isArray(value)&&value.length<=512&&value.every(item=>integer(item,100000));
// Negative skin IDs are the original game's shiny-skin markers.
const skins=value=>Array.isArray(value)&&value.length<=512&&value.every(item=>Number.isSafeInteger(item)&&Math.abs(item)<=100000);
export function validateRentalSnapshot(value) {
  if(!object(value)||value.schemaVersion!==1||value.scope!=="public-rental-snapshot"||
    !text(value.capturedAt,40)||!Number.isFinite(Date.parse(value.capturedAt))||
    !object(value.source)||!object(value.target)||!object(value.entries)||
    !Array.isArray(value.species)||value.species.length>2048||
    new Set(value.species).size!==value.species.length||!value.species.every(id=>integer(id,100000)&&id>0))
    throw Error("Invalid offline rental snapshot.");
  for(const identity of [value.source,value.target])
    if(!/^\d+\.\d+\.\d+$/.test(identity.version)||!/^[\w-]+$/.test(identity.build))throw Error("Invalid rental game identity.");
  if(!/^[a-f0-9]{64}$/.test(value.target.digest)||
    !Array.isArray(value.target.species)||new Set(value.target.species).size!==value.target.species.length||
    !value.target.species.every(id=>value.species.includes(id))||
    Object.keys(value.entries).length!==value.species.length||
    !Object.keys(value.entries).every(key=>value.species.includes(Number(key))))throw Error("Incomplete offline rental snapshot.");
  let total=0;
  for(const species of value.species){
    const rows=value.entries[species];
    if(!Array.isArray(rows)||rows.length>128)throw Error("Missing rental species listing.");
    const seen=new Set();
    for(const row of rows){
      const build=row?.build,plan=build?.plan;
      if(!object(row)||!/^rental-[a-f0-9]{24}$/.test(row.id)||!text(row.name,80)||!row.name||
        !text(row.avatar,80)||!text(row.frame,80)||!skins(row.skins)||!integer(row.species,100000)||
        !integer(row.rank)||!integer(row.kills)||!Number.isFinite(row.time)||row.time<0||
        !integer(row.users)||!integer(row.rents)||!keys(row.items)||typeof row.compatible!=="boolean"||
        !Array.isArray(row.unavailable)||row.unavailable.length>1024||!row.unavailable.every(item=>text(item))||
        !object(build)||build.member!==species||!object(plan)||!keys(build.off)||!keys(build.types)||
        !numbers(plan.moves)||!numbers(plan.favs)||!keys(plan.vits)||!keys(plan.fus)||!keys(plan.items)||
        plan.arch!==undefined&&!keys(plan.arch)||
        plan.relics!==undefined&&!keys(plan.relics)||
        plan.note!==undefined&&!text(plan.note,1000)||
        plan.links!==undefined&&(!Array.isArray(plan.links)||plan.links.length>64||
          !plan.links.every(pair=>numbers(pair)&&pair.length===2))||
        plan.from!==undefined&&!/^rental-[a-f0-9]{24}$/.test(plan.from)||
        row.creator!==undefined&&(!object(row.creator)||!/^rental-[a-f0-9]{24}$/.test(row.creator.id)||!text(row.creator.name,80)))
        throw Error("Invalid offline rental build.");
      const key=row.id+"|"+JSON.stringify(build);
      if(seen.has(key))throw Error("Duplicate offline rental build.");seen.add(key);total++;
      if(row.compatible!==(row.unavailable.length===0))throw Error("Invalid rental compatibility label.");
    }
  }
  if(total!==value.totalEntries)throw Error("Offline rental count mismatch.");
  return value;
}
