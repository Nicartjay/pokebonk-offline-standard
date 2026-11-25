import {ast,nodesOf,maybeName,literal,one} from "../../scripts/source.ts";

// Inspect data literals only. Never evaluate downloaded upstream JavaScript.
export function playableRentalSpecies(source) {
  const tree=ast(source),declarations=new Map(tree.body.flatMap(node=>
    node.type==="VariableDeclaration"?node.declarations.filter(node=>node.id.type==="Identifier").map(node=>[node.id.name,node.init]):[]));
  const member=node=>node?.type==="ObjectExpression"&&
    ["id","kit","passive","rank"].every(key=>node.properties.some(property=>maybeName(property.key)===key));
  const roots=nodesOf(tree,"CallExpression",node=>node.callee.type==="MemberExpression"&&
    maybeName(node.callee.property)==="push"&&declarations.get(maybeName(node.callee.object))?.type==="ArrayExpression"&&
    declarations.get(maybeName(node.callee.object)).elements.length>0&&
    declarations.get(maybeName(node.callee.object)).elements.every(member));
  const push=one(roots,"rental playable-catalog append"),root=maybeName(push.callee.object);
  const arrays=[declarations.get(root),...push.arguments.map(argument=>{
    if(argument.type!=="SpreadElement"||!declarations.has(maybeName(argument.argument)))
      throw Error("Unsupported rental playable-catalog spread.");
    return declarations.get(maybeName(argument.argument));
  })];
  const ids=arrays.flatMap(array=>{
    if(array?.type!=="ArrayExpression"||!array.elements.every(member))
      throw Error("Unsupported rental playable-catalog group.");
    return array.elements.map(node=>literal(node.properties.find(property=>maybeName(property.key)==="id").value));
  });
  if(ids.length<1||ids.length>2048||ids.some(id=>!Number.isSafeInteger(id)||id<1||id>100000)||
    new Set(ids).size!==ids.length)throw Error("Invalid rental playable-catalog identifiers.");
  return ids.sort((a,b)=>a-b);
}
