import {nodesOf,maybeName,literal} from "../../scripts/source.ts";

const fields=(row,keys)=>row?.type==="ObjectExpression"&&keys.every(key=>
  row.properties.some(property=>property.type==="Property"&&!property.computed&&maybeName(property.key)===key));
function value(row,key){
  const properties=row.properties.filter(property=>property.type==="Property"&&!property.computed&&maybeName(property.key)===key);
  if(properties.length!==1)throw Error("Unsupported Treasures artwork field: "+key);
  return literal(properties[0].value);
}
const pathTemplate=(node,head,tail)=>node.type==="TemplateLiteral"&&node.expressions.length===1&&
  node.quasis[0].value.cooked===head&&node.quasis[1].value.cooked===tail;

// Resolve finite cosmetic filenames from the original data and image builders,
// not from private variable names, screenshots or a guessed website directory.
export function treasureImagePlan(modules){
  const wheelKeys=["id","starter","items","title1","frame1","grandFrame","grandLook"];
  const lookKeys=["member","n","style","pal","rule"];
  const wheels=[],looks=[];
  for(const [name,tree]of modules){
    for(const declaration of nodesOf(tree,"VariableDeclarator",node=>node.init?.type==="ArrayExpression")){
      if(declaration.init.elements.some(row=>fields(row,wheelKeys)))wheels.push({name,rows:declaration.init.elements});
      if(declaration.init.elements.some(row=>fields(row,lookKeys)))looks.push({name,rows:declaration.init.elements});
    }
  }
  if(!wheels.length)return {references:[],portraitAliases:[]};
  if(wheels.length!==1||looks.length!==1||wheels[0].name!==looks[0].name||
    !wheels[0].rows.length||wheels[0].rows.length>64||
    !wheels[0].rows.every(row=>fields(row,wheelKeys))||
    !looks[0].rows.every(row=>fields(row,lookKeys)))
    throw Error("Unsupported finite Treasures artwork catalogs.");
  const trees=[...modules.values()];
  const glow=trees.flatMap(tree=>nodesOf(tree,"FunctionDeclaration",fn=>
    nodesOf(fn,"TemplateLiteral",node=>pathTemplate(node,"ui/banners/","-glow.png")).length===1&&
    nodesOf(fn,"TemplateLiteral",node=>node.quasis.some(part=>part.value.cooked.includes('class="bf-glow"'))).length>0));
  const frame=trees.flatMap(tree=>nodesOf(tree,"TemplateLiteral",node=>{
    if(!pathTemplate(node,"ui/frames/",".png"))return false;
    const fallback=node.expressions[0];
    return fallback.type==="LogicalExpression"&&fallback.operator==="??"&&
      fallback.right.type==="BinaryExpression"&&fallback.right.operator==="+"&&literal(fallback.right.left)==="look-"&&
      fallback.right.right.type==="MemberExpression"&&maybeName(fallback.right.right.property)==="style";
  }));
  if(glow.length!==1||frame.length!==1)throw Error("Unsupported Treasures glow/portrait image builders.");
  const required=new Set(),starters=new Set(),ids=new Set(),portraitAliases=new Map();
  for(const row of wheels[0].rows){
    const id=value(row,"id"),starter=value(row,"starter");
    if(typeof id!=="string"||!/^[a-z0-9-]{1,64}$/.test(id)||ids.has(id)||
      !Number.isInteger(starter)||starter<1||starter>10000||starters.has(starter))
      throw Error("Unsupported Treasures wheel identity.");
    ids.add(id);starters.add(starter);
    for(const tier of [1,2])required.add(`assets/ui/frames/tr-${id}-${tier}.png`);
    if(row.properties.some(property=>property.type==="Property"&&maybeName(property.key)==="banner")){
      required.add(`assets/ui/banners/tr-${id}.jpg`);
      required.add(`assets/ui/banners/tr-${id}-glow.png`);
    }
    for(const n of [3,4]){
      const matches=looks[0].rows.filter(look=>value(look,"member")===starter&&value(look,"n")===n);
      if(matches.length!==1)throw Error("Unsupported Treasures look-to-wheel mapping.");
      const style=value(matches[0],"style");
      if(typeof style!=="string"||!/^[a-z0-9-]{1,64}$/.test(style))throw Error("Unsupported Treasures look style.");
      const name=`assets/ui/frames/look-${style}.png`;
      required.add(name);
      // If an original grand-look style frame is absent upstream, an operator
      // can explicitly reuse this wheel's matching original grand-prize frame.
      // This is a reviewed offline alias, never a claimed upstream download.
      if(n===4){
        const sourceAsset=`assets/ui/frames/tr-${id}-2.png`;
        if(portraitAliases.has(name)&&portraitAliases.get(name)!==sourceAsset)
          throw Error("Ambiguous Treasures grand-look frame fallback.");
        portraitAliases.set(name,sourceAsset);
      }
    }
  }
  if(looks[0].rows.length!==starters.size*2)throw Error("Unreviewed extra Treasures look definitions.");
  return {references:[...required].sort().map(name=>({name,why:wheels[0].name+":finite Treasures artwork catalog"})),
    portraitAliases:[...portraitAliases].map(([name,sourceAsset])=>({name,sourceAsset}))};
}
export function treasureImageReferences(modules){
  return treasureImagePlan(modules).references;
}
