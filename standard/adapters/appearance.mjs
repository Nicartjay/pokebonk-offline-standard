// Narrow 0.10.35 visual backport, not a game/account-service replacement.
// Keep the original renderer for Pokémon skins, avatars and every frame kind.
import {parse} from "acorn";
import {nodesOf,literal,maybeName,one,edits} from "../../scripts/source.ts";

const property=(node,key)=>node?.properties?.find(value=>maybeName(value.key)===key)?.value;
export function patchAnimatedTrainerAvatar(source) {
  const tree=parse(source,{ecmaVersion:"latest",sourceType:"module"});
  const avatar=one(tree.body.filter(node=>node.type==="FunctionDeclaration"&&node.params.length===5&&
    nodesOf(node,"Property",value=>literal(value.key)==="--s").length===1&&
    nodesOf(node,"TemplateLiteral",value=>value.quasis[0]?.value.cooked==="av").length===1),
  "original framed avatar renderer");
  const branch=one(nodesOf(avatar,"ConditionalExpression",node=>
    node.test.type==="BinaryExpression"&&node.test.operator==="==="&&literal(node.test.right)==="tr"&&
    node.consequent.type==="CallExpression"&&literal(node.consequent.arguments[0])==="img"&&
    literal(property(node.consequent.arguments[1],"class"))==="pix"),
  "original static trainer portrait branch");
  const src=property(branch.consequent.arguments[1],"src");
  const template=src?.type==="CallExpression"&&src.arguments[0];
  if(template?.type!=="TemplateLiteral"||template.quasis.length!==2||
    template.quasis[0].value.cooked!=="ui/avatars/"||template.quasis[1].value.cooked!==".png"||
    template.expressions[0]?.type!=="Identifier")
    throw Error("Unsupported original trainer portrait artwork path.");
  if(source.includes("__standardAnimatedTrainerAvatar"))throw Error("Animated avatar patch was already applied.");
  const id=template.expressions[0].name;
  const rewritten=edits(source,[{...branch.consequent,
    text:`(${id}==="visionary"?__standardAnimatedTrainerAvatar(${id}):${source.slice(branch.consequent.start,branch.consequent.end)})`}]);
  return 'import {renderAnimatedTrainerAvatar as __standardAnimatedTrainerAvatar} from "../offline/appearance.js";\n'+rewritten;
}

export function patchImportedIdentityCosmetics(source) {
  const tree=parse(source,{ecmaVersion:"latest",sourceType:"module"});
  const avatars=one(nodesOf(tree,"ArrayExpression",node=>
    ["professor","safariranger","rocketlooter"].every(id=>node.elements.some(value=>
      value?.type==="ObjectExpression"&&literal(property(value,"id"))===id))),
  "original selectable trainer-avatar catalog");
  if(avatars.elements.some(value=>value?.type==="ObjectExpression"&&literal(property(value,"id"))==="visionary"))
    throw Error("The accepted game already defines Visionary; review the visual backport.");
  const titles=one(nodesOf(tree,"ArrayExpression",node=>
    ["title:s1","title:s2","frame:s2"].every(id=>node.elements.some(value=>
      value?.type==="ObjectExpression"&&literal(property(value,"id"))===id))),
  "original permanent gift-cosmetic catalog");
  if(titles.elements.some(value=>value?.type==="ObjectExpression"&&literal(property(value,"id"))==="title:idea"))
    throw Error("The accepted game already defines the idea title; review the visual backport.");
  // No free/research/shop-grant condition: the original ownership predicate
  // requires profile.cosmetics to contain tr:visionary. Existing imports retain it.
  return edits(source,[
    {start:avatars.end-1,end:avatars.end-1,
      text:',{id:"visionary",name:"Bright Mind",how:"Imported cosmetic earned on your own online account."}'},
    {start:titles.end-1,end:titles.end-1,
      text:',{id:"title:idea",kind:"title",name:"PokéBonk Visionary",how:"Imported cosmetic earned on your own online account."}'},
  ]);
}
