import path from "node:path";
import {ast,configContext,literal,maybeName,nodesOf} from "../../scripts/source.ts";

function removableLookBorder(modules){
  const matches=[];
  for(const {name,source}of modules.filter(({name})=>/^assets\/dom-.*\.js$/.test(name))){
    for(const fn of nodesOf(ast(source),"FunctionDeclaration")){
      const paths=nodesOf(fn,"TemplateLiteral",node=>{
        const expression=node.expressions[0];
        return node.expressions.length===1&&node.quasis[0].value.cooked==="ui/frames/"&&
          node.quasis[1].value.cooked===".png"&&expression.type==="LogicalExpression"&&expression.operator==="??"&&
          expression.left.type==="MemberExpression"&&maybeName(expression.left.property)==="frame"&&
          expression.right.type==="BinaryExpression"&&expression.right.operator==="+"&&literal(expression.right.left)==="look-"&&
          expression.right.right.type==="MemberExpression"&&maybeName(expression.right.right.property)==="style"&&
          expression.left.object.type==="Identifier"&&expression.right.right.object.type==="Identifier"&&
          maybeName(expression.left.object)===maybeName(expression.right.right.object);
      });
      if(paths.length!==1)continue;
      const assignment=nodesOf(fn,"AssignmentExpression",node=>
        node.operator==="="&&node.left.type==="MemberExpression"&&maybeName(node.left.property)==="src"&&
        node.right.start<=paths[0].start&&node.right.end>=paths[0].end);
      if(assignment.length!==1)continue;
      const image=maybeName(assignment[0].left.object);
      if(!image)continue;
      const member=(node,key)=>node?.type==="MemberExpression"&&maybeName(node.object)===image&&maybeName(node.property)===key;
      const handlers=nodesOf(fn,"AssignmentExpression",node=>member(node.left,"onerror")&&node.operator==="="&&
        node.right.type==="ArrowFunctionExpression"&&node.right.params.length===0&&node.right.body.type==="BlockStatement"&&
        node.right.body.body.length===1&&node.right.body.body[0].type==="ExpressionStatement");
      if(handlers.length!==1)continue;
      const sequence=handlers[0].right.body.body[0].expression;
      if(sequence.type!=="SequenceExpression"||sequence.expressions.length!==2)continue;
      const [clear,remove]=sequence.expressions;
      if(clear.type!=="AssignmentExpression"||clear.operator!=="="||!member(clear.left,"onerror")||literal(clear.right)!==null||
        remove.type!=="CallExpression"||!member(remove.callee,"remove")||remove.arguments.length)continue;
      const returned=fn.body.body.at(-1);
      if(returned?.type!=="ReturnStatement"||returned.argument?.type!=="SequenceExpression"||
        maybeName(returned.argument.expressions.at(-1))!==image)continue;
      matches.push(name+":original optional portrait-border error handler");
    }
  }
  if(matches.length!==1)throw Error("Unsupported optional appearance-border renderer.");
  return matches[0];
}

export function bagItemImageReferences(game,metadata={}){
  // Bag IDs also feed rotating daily/weekly task rewards and the Shop. New
  // custom items need not exist in the older PokeAPI items.json metadata.
  const catalogs=Object.values(game).filter(rows=>Array.isArray(rows)&&rows.length&&
    rows.some(row=>row?.id==="rare-candy")&&rows.some(row=>row?.id==="master-ball")&&
    rows.every(row=>typeof row?.id==="string"&&typeof row.name==="string"&&typeof row.desc==="string"));
  if(catalogs.length!==1||catalogs[0].length>64)throw Error("Unsupported Bag/task-reward artwork catalog.");
  const seen=new Set();
  return catalogs[0].map(row=>{
    if(!/^[a-z0-9-]{1,80}$/.test(row.id)||seen.has(row.id))throw Error("Unsupported Bag item identity.");
    seen.add(row.id);
    // Match the original DOM item factory: metadata icon first, then this
    // exact item filename. A similarly named PokeAPI item is not a substitute.
    const icon=metadata[row.id]?.icon||`items/${row.id}.png`;
    if(typeof icon!=="string"||!/^items\/[a-z0-9-]+\.png$/.test(icon))
      throw Error("Unsupported Bag item artwork path.");
    return {id:row.id,name:"assets/"+icon};
  });
}

// Evaluate only the accepted DATA modules in the existing code-generation-
// disabled VM: no DOM, native APIs, process, network or user save is available.
// This resolves generated cosmetic/reward lists as well as literal strings.
export function collectCatalogImageReferences(files){
  const modules=[...files].filter(([name])=>name.endsWith(".js")).map(([name,bytes])=>({name,source:bytes.toString()}));
  const single=(values,role)=>{
    if(values.length!==1)throw Error("Unsupported artwork data role: "+role);
    return values[0];
  };
  const assets=single(modules.filter(({source})=>source.includes("slot-move")&&source.includes("data/pokemon.json")),"game catalogs");
  const cosmetics=single(modules.filter(({name,source})=>/^assets\/cosmetics-/.test(name)&&source.includes("grandFrame")),"cosmetic catalogs");
  const expedition=single(modules.filter(({source})=>source.includes("ui/exp/refuge/")&&source.includes("levels")),"Expedition catalogs");
  const dependencies=new Map([["./"+path.posix.basename(assets.name),assets.source]]);
  const game=configContext(assets.source).values;
  const looks=configContext(cosmetics.source,dependencies).values;
  const exp=configContext(expedition.source,dependencies).values;
  const required=new Map(),optional=new Map(),families=new Map();
  let borderRenderer;
  const add=(name,family,target=required)=>{
    if(!/^assets\/[a-zA-Z0-9/_-]+\.(?:png|jpg|webp)$/.test(name))throw Error("Unsupported catalog image path: "+name);
    if(!target.has(name))target.set(name,new Set());
    target.get(name).add(family);
    if(!families.has(family))families.set(family,new Set());
    families.get(family).add(name);
  };
  const paths={frame:"ui/frames/",bg:"ui/banners/",tr:"ui/avatars/",sym:"ui/clan/sym/",deco:"ui/clan/deco/"};
  const appearance=files.get("offline/appearance.js");
  const animatedTrainers=appearance?configContext(appearance.toString()).values.ANIMATED_TRAINER_ASSETS:{};
  if(!animatedTrainers||typeof animatedTrainers!=="object"||Array.isArray(animatedTrainers)||
    Object.entries(animatedTrainers).some(([id,name])=>
      id!=="visionary"||name!=="assets/ui/avatars/visionary-fg.png"))
    throw Error("Review the animated trainer artwork registry.");
  const trainerImage=id=>Object.hasOwn(animatedTrainers,id)?animatedTrainers[id]:`assets/ui/avatars/${id}.png`;
  const walkCosmetics=value=>{
    if(typeof value==="string"){
      const match=/^(frame|bg|tr|sym|deco):([a-z0-9-]+)$/.exec(value);
      if(match)add(match[1]==="tr"?trainerImage(match[2]):
        "assets/"+paths[match[1]]+match[2]+(match[1]==="bg"?".jpg":".png"),"computed cosmetic and reward IDs");
      return;
    }
    if(Array.isArray(value)){
      for(const row of value){
        if(row&&typeof row==="object"&&Number.isInteger(row.member)&&Number.isInteger(row.n)&&typeof row.style==="string"){
          if(!row.frame&&row.n>=9){
            // These are generated Vanguard/Mythic Pokémon looks, not selectable
            // frame rewards. Only the proven, removable decorative PNG attempt
            // is optional; the base sprites/materials remain required elsewhere.
            if(![9,10].includes(row.n))throw Error("Review the new appearance tier's border contract.");
            borderRenderer??=removableLookBorder(modules);
            add("assets/ui/frames/look-"+row.style+".png","optional generated-look portrait borders",optional);
            optional.get("assets/ui/frames/look-"+row.style+".png").add(borderRenderer);
          }else add("assets/ui/frames/"+(row.frame??"look-"+row.style)+".png","computed required look frames");
        }
        walkCosmetics(row);
      }
    }else if(value&&typeof value==="object")for(const child of Object.values(value))walkCosmetics(child);
  };
  walkCosmetics(looks);
  walkCosmetics(game);
  const arrays=value=>Object.values(value).filter(Array.isArray);
  const bagItems=bagItemImageReferences(game,files.has("data/items.json")?JSON.parse(files.get("data/items.json")):{});
  for(const item of bagItems)add(item.name,"Bag and rotating-task reward items");
  const avatars=single(arrays(looks).filter(rows=>rows.length&&rows.some(row=>row?.free===true)&&
    rows.every(row=>typeof row?.id==="string"&&typeof row.name==="string"&&typeof row.how==="string")),"trainer portraits");
  for(const row of avatars)add(trainerImage(row.id),"trainer portrait catalog");
  const seasons=single([...arrays(looks),...arrays(game)].filter(rows=>rows.length&&rows.every(row=>
    Number.isInteger(row?.member)&&typeof row.bg==="string"&&typeof row.frame==="string"&&row.prices)),"seasonal appearance bundles");
  for(const row of seasons){
    // bg/frame are translated display names; the original factory uses st-ID.
    if(!/^[a-z0-9-]+$/.test(row.id))throw Error("Unsupported seasonal artwork ID.");
    add(`assets/ui/banners/st-${row.id}.jpg`,"seasonal banner backgrounds");
    add(`assets/ui/banners/st-${row.id}-glow.png`,"seasonal banner glow layers");
    add(`assets/ui/frames/st-${row.id}.png`,"seasonal portrait frames");
  }
  const ranks=single(arrays(game).filter(rows=>rows.length&&rows.every(row=>
    typeof row?.id==="string"&&typeof row.name==="string"&&"from" in row&&"max" in row)),"rank artwork");
  for(const row of ranks)add(`assets/ui/ranks/${row.id}.png`,"rank artwork");
  const relics=single(arrays(game).filter(rows=>rows.length>10&&rows.every(row=>
    typeof row?.key==="string"&&/^[curel]-[a-z0-9-]+$/.test(row.key)&&Number.isInteger(row.rarity))),"relic artwork");
  for(const row of relics)add(`assets/ui/relics/${row.key}.png`,"relic artwork");
  const expItems=new Map();
  for(const rows of arrays(exp))for(const row of rows){
    if(row&&typeof row.key==="string"&&typeof row.kind==="string"&&typeof row.icon==="string"&&"w" in row)
      expItems.set(row.key,row);
  }
  if(!expItems.size)throw Error("Unsupported Expedition item artwork.");
  for(const row of expItems.values())
    add(`assets/${row.legend||row.own?"gear":"items"}/${row.icon}.png`,"Expedition item artwork");
  const factions=single(arrays(exp).filter(rows=>rows.length&&rows.every(row=>
    typeof row?.key==="string"&&typeof row.name==="string"&&typeof row.role==="string"&&typeof row.desc==="string"&&typeof row.color==="string")),"Expedition faction artwork");
  for(const row of factions)add(`assets/ui/exp/faction-${row.key}.png`,"Expedition factions");
  const refuge=single(arrays(exp).filter(rows=>rows.length&&rows.every(row=>
    typeof row?.key==="string"&&typeof row.name==="string"&&typeof row.desc==="string"&&Array.isArray(row.levels))),"Refuge artwork");
  for(const row of refuge){
    if(row.levels.length!==3)throw Error("Review Expedition Refuge image levels.");
    for(let level=1;level<=3;level++)add(`assets/ui/exp/refuge/${row.key}-${level}.png`,"Refuge levels (bundled, currently excluded UI)");
  }
  const pass=single(arrays(exp).filter(rows=>rows.length>5&&rows.every(row=>
    typeof row?.kind==="string"&&!row.key)&&rows.some(row=>row.kind==="cosmetic")&&rows.some(row=>row.kind==="coins")),"Expedition pass artwork");
  for(const row of pass)add(`assets/ui/exp/pass-${row.kind}.png`,"Expedition pass rewards");
  return {required,optional,bagItems,families:Object.fromEntries([...families].map(([name,paths])=>[name,paths.size]))};
}
