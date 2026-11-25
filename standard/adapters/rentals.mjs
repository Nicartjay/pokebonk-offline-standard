import {nodesOf,literal,maybeName,one,edits} from "../../scripts/source.ts";
const has=(owner,text)=>[...nodesOf(owner,"Literal"),...nodesOf(owner,"TemplateLiteral")].some(node=>literal(node)===text);
const calls=(owner,key)=>nodesOf(owner,"CallExpression",node=>node.callee.type==="MemberExpression"&&maybeName(node.callee.property)===key);
const prop=(node,key)=>node?.properties?.find(property=>maybeName(property.key)===key)?.value;
function apply(source,owner,changes){
  return edits(source.slice(owner.start,owner.end),changes.map(change=>({
    start:change.start-owner.start,end:change.end-owner.start,text:change.text,
  })));
}
export function patchRentalBuilds(source,owner){
  const app=maybeName(owner.params[0]),changes=[];
  const reward=one(nodesOf(owner,"VariableDeclarator",node=>node.init?.type==="ArrowFunctionExpression"&&has(node.init,"bd-rents-off")),
    "rental reward panel renderer");
  const panel=one(nodesOf(owner,"VariableDeclarator",node=>node.init?.type==="CallExpression"&&has(node.init,"bd-rents")),
    "rental snapshot notice").id.name;
  changes.push({...reward.init,text:`()=>globalThis.PokeBonkOfflineUI.rentalSnapshotInfo(${app},${panel})`});
  const status=one(owner.body.body.filter(node=>node.type==="ExpressionStatement"&&calls(node,"rentStatus").length),
    "online rental reward loader");
  changes.push({...status,text:"void 0;"});
  const board=one(calls(owner,"monBoards"),"rental species index");
  changes.push({...board,text:`${app}.backend.rentalIndex()`});
  // The online privacy switch has no effect on a fixed bundled snapshot.
  const privacy=one(nodesOf(owner,"CallExpression",node=>node.arguments[0]?.type==="CallExpression"&&
    nodesOf(node.arguments[0],"Property",property=>maybeName(property.key)==="class"&&
      [...nodesOf(property.value,"Literal"),...nodesOf(property.value,"TemplateLiteral")]
        .some(part=>String(literal(part)??"").includes("bs-priv"))).length),"online build sharing preference");
  changes.push({...privacy,text:"null"});
  const labels=new Map([
    ["Builds probadas, listas para usar.","Saved community builds, ready to browse offline."],
    ["Elige un Pokémon y verás las builds de los mejores de su clasificación que dejan copiarlas, con su puesto y lo que te falta.",
      "Choose a Pokémon to browse captured rental builds. Copy a plan using your own earned unlocks; unavailable options stay marked."],
    ["N.º 1: {name}","Snapshot: {name}"],["Sin clasificación esta temporada","No saved rental builds"],
    ["1 entrenador","1 saved build"],["{n} entrenadores","{n} saved builds"],
    ["Buscar Pokémon o creador…","Search Pokémon or build creator…"],
  ]);
  for(const node of [...nodesOf(owner,"Literal"),...nodesOf(owner,"TemplateLiteral")])
    if(labels.has(literal(node))&&!changes.some(change=>node.start>=change.start&&node.end<=change.end))
      changes.push({...node,text:JSON.stringify(labels.get(literal(node)))});
  return apply(source,owner,changes);
}

export function patchRentalGallery(source,owner){
  const app=maybeName(owner.params[0]),binding="__offlineRentalApp",changes=[];
  if(nodesOf(owner,"Identifier",node=>node.name===binding).length)throw Error("Rental app binding collision.");
  changes.push({start:owner.body.start+1,end:owner.body.start+1,text:`const ${binding}=${app};`});
  const isTrue=node=>literal(node)===true||node?.type==="UnaryExpression"&&node.operator==="!"&&literal(node.argument)===0;
  const author=one(nodesOf(owner,"ObjectExpression",node=>isTrue(prop(node,"copy"))&&
    prop(node,"items")?.type==="MemberExpression"&&maybeName(prop(node,"items").property)==="items"),
    "rental build copy source");
  const row=maybeName(prop(author,"id")?.object);
  if(!row)throw Error("Unsupported rental row binding.");
  changes.push({...prop(author,"id"),text:`(${row}.creator?.id??${row}.id)`},
    {...prop(author,"name"),text:`(${row}.creator?.name??${row}.name)`});
  const openCall=one(nodesOf(owner,"CallExpression",node=>node.arguments.includes(author)),"rental build details entry");
  const open=one(nodesOf(owner,"ArrowFunctionExpression",node=>node.params.length===0&&
    node.body.type==="BlockStatement"&&node.start<openCall.start&&node.end>openCall.end),
    "rental details callback");
  changes.push({start:open.body.start+1,end:open.body.start+1,
    text:`if(!globalThis.PokeBonkOfflineUI.allowRental(${binding},${row}))return;`});
  const preview=one(nodesOf(owner,"CallExpression",node=>node.callee.type==="Identifier"&&node.arguments.length===1&&
    node.arguments[0].type==="MemberExpression"&&maybeName(node.arguments[0].object)===row&&
    maybeName(node.arguments[0].property)==="build"),"rental plan summary");
  changes.push({...preview,text:`${row}.compatible?${source.slice(preview.start,preview.end)}:globalThis.PokeBonkOfflineUI.rentalCompatibilityNotice(${row})`});
  const profile=one(nodesOf(owner,"CallExpression",node=>literal(node.arguments[0])==="button"&&
    literal(prop(node.arguments[1],"class"))==="bp-origin"),"online rental author profile link");
  changes.push({...profile.arguments[0],text:'"span"'},
    {...prop(profile.arguments[1],"onclick"),text:"null"},
    {...prop(profile.arguments[1],"title"),text:'"Original build author · captured snapshot"'});
  const rank=one(nodesOf(owner,"VariableDeclarator",node=>node.init?.type==="ConditionalExpression"&&
    maybeName(node.init.test?.property)==="allTime"),"captured rental ranking label");
  changes.push({...rank.init,text:`"Captured #"+${row}.rank`});
  for(const node of nodesOf(owner,"ConditionalExpression",node=>node.test.type==="MemberExpression"&&
    maybeName(node.test.object)===row&&maybeName(node.test.property)==="rents"))changes.push({...node,text:"null"});
  for(const node of nodesOf(owner,"LogicalExpression",node=>node.left.type==="BinaryExpression"&&
    maybeName(node.left.left?.object)===row&&maybeName(node.left.left?.property)==="users"))changes.push({...node,text:"null"});
  const labels=new Map([
    ["Buscando builds…","Opening bundled builds…"],
    ["De los mejores de su clasificación","Saved community builds · works offline"],
    ["Aún nadie de la clasificación de {mon} comparte su build.","No rental builds for {mon} were shared when this snapshot was captured."],
    ["No hay conexión con el servidor.","The bundled rental library could not be read."],
  ]);
  for(const node of [...nodesOf(owner,"Literal"),...nodesOf(owner,"TemplateLiteral")])
    if(labels.has(literal(node))&&!changes.some(change=>node.start>=change.start&&node.end<=change.end))
      changes.push({...node,text:JSON.stringify(labels.get(literal(node)))});
  return apply(source,owner,changes);
}
