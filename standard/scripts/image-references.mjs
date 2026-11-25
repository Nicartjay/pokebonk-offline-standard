import path from "node:path";
import {ast,nodesOf,maybeName,literal} from "../../scripts/source.ts";
import {COOP_MAPS} from "../common/coop-rules.mjs";
import {treasureImageReferences} from "./cosmetic-images.mjs";
import {collectCatalogImageReferences} from "./catalog-image-references.mjs";
const image=/\.(?:png|jpe?g|webp|svg|ico)$/i;
const roots=["ui/icons","items","ui/types","ui/pings","gear","ui/frames","ui/banners"];
const strings=node=>node?.type==="ConditionalExpression"?[...strings(node.consequent),...strings(node.alternate)]:
  node?.type==="LogicalExpression"?[...strings(node.left),...strings(node.right)]:
  typeof literal(node)==="string"?[literal(node)]:[];
function iconStrings(argument,call,tree,parent){
  if(argument?.type==="ConditionalExpression")
    return [...iconStrings(argument.consequent,call,tree,parent),...iconStrings(argument.alternate,call,tree,parent)];
  if(argument?.type==="LogicalExpression")
    return [...iconStrings(argument.left,call,tree,parent),...iconStrings(argument.right,call,tree,parent)];
  // The original boss/elite status renderer constructs "st-" + entry.id
  // inside a for-of over a finite catalog. These are not literal icon calls.
  let member;
  if(argument?.type==="BinaryExpression"&&argument.operator==="+"&&literal(argument.left)==="st-")
    member=argument.right;
  else if(argument?.type==="TemplateLiteral"&&argument.expressions.length===1&&
    argument.quasis[0].value.cooked==="st-"&&argument.quasis[1].value.cooked==="")member=argument.expressions[0];
  else return strings(argument);
  const fail=()=>{throw Error("Unsupported catalog-driven status icon reference in "+parent);};
  if(member?.type!=="MemberExpression"||member.object.type!=="Identifier"||
    !maybeName(member.property)||member.computed&&typeof literal(member.property)!=="string")return fail();
  const loops=nodesOf(tree,"ForOfStatement",node=>node.body.start<=call.start&&node.body.end>=call.end&&
    node.left.type==="VariableDeclaration"&&node.left.declarations.length===1&&
    maybeName(node.left.declarations[0].id)===member.object.name);
  if(loops.length!==1||loops[0].right.type!=="Identifier")return fail();
  const catalog=tree.body.flatMap(node=>node.type==="VariableDeclaration"?node.declarations:[])
    .filter(node=>maybeName(node.id)===loops[0].right.name);
  if(catalog.length!==1||catalog[0].init?.type!=="ArrayExpression"||!catalog[0].init.elements.length)return fail();
  const ids=[],field=maybeName(member.property);
  for(const row of catalog[0].init.elements){
    if(row?.type!=="ObjectExpression")return fail();
    const values=row.properties.filter(node=>node.type==="Property"&&!node.computed&&maybeName(node.key)===field);
    const id=values.length===1?literal(values[0].value):null;
    if(typeof id!=="string"||!/^[a-z0-9-]{1,64}$/.test(id)||ids.includes("st-"+id))return fail();
    ids.push("st-"+id);
  }
  return ids;
}
function assetPath(value,parent){
  if(typeof value!=="string"||/^(?:data:|blob:|https?:|\/\/|#)/i.test(value))return null;
  const raw=value.split(/[?#]/)[0];if(!image.test(raw))return null;
  let name;
  if(/^\/?assets\//.test(raw))name=raw.replace(/^\//,"");
  else if(/^(?:ui|items|pmd(?:-forms|-shiny)?|portraits(?:-forms|-shiny)?|front|gear|env|icons)\//.test(raw))name="assets/"+raw;
  else if(raw.startsWith("."))name=path.posix.normalize(path.posix.join(path.posix.dirname(parent),raw));
  else return null;
  return name.startsWith("assets/")&&!name.split("/").some(part=>part.startsWith("."))?name:null;
}
// Finite reference contracts, not filename guesses over the whole website.
export function collectImageReferences(files,names=new Set(files.keys())){
  const required=new Map(),optional=new Map(),modules=new Map(),factories=new Map(),exports=new Map(),dynamic=new Set(),codeWords=new Set(),catalogs=[],metadataOnly=[];
  let computedCatalogFamilies={};
  const add=(name,why)=>{if(!required.has(name))required.set(name,new Set());required.get(name).add(why);};
  const icon=(id,why)=>{
    if(!/^[a-z0-9-]{1,80}$/.test(id))return;
    const existing=roots.flatMap(root=>["png","jpg","webp","svg"].map(ext=>"assets/"+root+"/"+id+"."+ext)).filter(name=>names.has(name));
    for(const name of existing.length?existing:["assets/ui/icons/"+id+".png"])add(name,why);
  };
  for(const [name,bytes]of files){
    // Provenance inventories include historical failed capture guesses, not
    // playable asset references. The same game contract applies before and
    // after prepare writes these reports into the output directory.
    if(["offline-build.json","asset-manifest.json"].includes(name))continue;
    if(name.endsWith(".js")||name.endsWith(".mjs")){
      const tree=ast(bytes.toString());modules.set(name,tree);
      const functions=[...nodesOf(tree,"FunctionDeclaration").map(node=>({node,name:node.id?.name,params:node.params})),
        ...nodesOf(tree,"VariableDeclarator",node=>["ArrowFunctionExpression","FunctionExpression"].includes(node.init?.type))
          .map(node=>({node:node.init,name:maybeName(node.id),params:node.init.params}))];
      for(const node of [...nodesOf(tree,"Literal"),...nodesOf(tree,"TemplateLiteral")]){
        const value=literal(node),target=assetPath(value,name);if(target)add(target,name+":literal");
        if(typeof value==="string")codeWords.add(value);
        if(node.type!=="TemplateLiteral"||node.expressions.length!==1)continue;
        const head=node.quasis[0].value.cooked,tail=node.quasis[1].value.cooked;
        if(/^(?:assets\/)?ui\/icons\/$/.test(head)&&tail===".png"){
          const owner=functions.filter(fn=>fn.node.start<=node.start&&fn.node.end>=node.end)
            .sort((a,b)=>(a.node.end-a.node.start)-(b.node.end-b.node.start))[0];
          const index=owner?.params.findIndex(param=>maybeName(param.type==="AssignmentPattern"?param.left:param)===maybeName(node.expressions[0]));
          if(owner?.name&&index>=0)factories.set(name+"|"+owner.name,{index});
        }
        if(/^(?:assets\/)?(?:ui|pmd|portraits|front|gear|env)\//.test(head)&&/\.(?:png|jpg|webp|svg)$/.test(tail))
          dynamic.add(head+"{catalog value}"+tail);
      }
      for(const node of nodesOf(tree,"Property",node=>["icon","ico"].includes(maybeName(node.key)))){
        const id=literal(node.value);
        if(typeof id==="string"&&!id.includes("/"))icon(id,name+":icon catalog");
      }
      exports.set(name,new Map(tree.body.filter(node=>node.type==="ExportNamedDeclaration"&&!node.source)
        .flatMap(node=>node.specifiers.map(item=>[maybeName(item.exported),maybeName(item.local)]))));
    }else if(name.endsWith(".css")){
      for(const match of bytes.toString().matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/g)){
        const target=assetPath(match[1],name);if(target)add(target,name+":CSS");
      }
    }else if(name.endsWith(".json")&&!name.startsWith("data/i18n/")){
      catalogs.push([name,JSON.parse(bytes)]);
    }
  }
  for(const [name,catalog]of catalogs){
    const walk=value=>{
      if(typeof value==="string"){const target=assetPath(value,name);if(target)add(target,name+":catalog");}
      else if(value&&typeof value==="object")Object.values(value).forEach(walk);
    };
    if(name!=="data/items.json"){walk(catalog);continue;}
    for(const [id,value]of Object.entries(catalog)){
      // Reviewed mwsewi0r: these two entries are unused PokeAPI metadata,
      // absent from every executable module/active item catalog; their
      // upstream PNG URLs also return 404. A code reference makes them
      // required again instead of silently masking an actual game item.
      if(["antidote","paralyze-heal"].includes(id)&&!codeWords.has(id)&&!names.has("assets/"+value.icon)){
        const {icon:_unused,...rest}=value;walk(rest);
        metadataOnly.push({name:"assets/"+value.icon,reason:"Unused item metadata; original website returns 404."});
      }else walk(value);
    }
  }
  // Carry the icon factory through Vite's public export/import aliases.
  for(let round=0;round<modules.size;round++){
    let changed=false;
    for(const [name,tree]of modules)for(const declaration of tree.body.filter(node=>node.type==="ImportDeclaration")){
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(name),literal(declaration.source)));
      for(const item of declaration.specifiers){
        if(item.type!=="ImportSpecifier")continue;
        const factory=factories.get(dependency+"|"+exports.get(dependency)?.get(maybeName(item.imported)));
        const key=name+"|"+item.local.name;
        if(factory&&!factories.has(key)){factories.set(key,factory);changed=true;}
      }
    }
    if(!changed)break;
  }
  for(const [name,tree]of modules)for(const call of nodesOf(tree,"CallExpression")){
    const factory=factories.get(name+"|"+maybeName(call.callee));if(!factory)continue;
    for(const value of iconStrings(call.arguments[factory.index],call,tree,name)){
      // The proven factory emits ui/icons paths. A similarly named cosmetic
      // frame/banner must not satisfy a missing boss-status PNG.
      if(/^st-[a-z0-9-]+$/.test(value))add("assets/ui/icons/"+value+".png",name+":status icon factory");
      else icon(value,name+":icon factory");
    }
  }
  for(const {name,why}of treasureImageReferences(modules))add(name,why);
  if(files.has("data/pokemon.json")&&files.has("data/sprites.json")){
    const computed=collectCatalogImageReferences(files);
    computedCatalogFamilies=computed.families;
    for(const [name,reasons]of computed.required)for(const why of reasons)add(name,why);
    for(const [name,reasons]of computed.optional)optional.set(name,reasons);
  }
  const parse=name=>files.has(name)?JSON.parse(files.get(name)):null;
  const sprites=parse("data/sprites.json"),forms=parse("data/formsprites.json");
  const dimensions=new Map();
  if(sprites)for(const [id,value]of Object.entries(sprites)){
    if(value.fallback)add("assets/"+value.fallback,"sprite fallback catalog");
    else{
      const sheet="assets/pmd/"+id+".png";add(sheet,"sprite catalog");add("assets/portraits/"+id+".png","portrait catalog");
      dimensions.set(sheet,{w:value.w,h:value.h});
    }
    add("assets/icons/"+id+".png","Pokémon icon catalog");
  }
  if(forms){
    for(const [id,value]of Object.entries(forms.sheets)){
      const sheet="assets/pmd-forms/"+id+".png";add(sheet,"form sprite catalog");
      dimensions.set(sheet,{w:value.w,h:value.h});
    }
    for(const key of Object.values(forms.portraits))add("assets/portraits-forms/"+key+".png","form portrait catalog");
  }
  // The accepted game has Kanto/Johto shiny sheets; later generations use the
  // full regular/fallback catalog, not invented shiny-resource filenames.
  if(sprites)for(let id=1;id<=251;id++){
    add("assets/pmd-shiny/"+id+".png","Kanto/Johto shiny contract");
    add("assets/portraits-shiny/"+id+".png","Kanto/Johto shiny portrait contract");
  }
  for(const biome of [...COOP_MAPS,"newisland"])add("assets/ui/maps/"+biome+".webp","co-op map contract");
  // Another real use of the same path always wins over its optional border use.
  for(const name of required.keys())optional.delete(name);
  return {required,optional,dimensions,dynamicFamilies:[...dynamic].sort(),iconFactories:factories.size,metadataOnly,computedCatalogFamilies,
    missing:[...required.keys()].filter(name=>!names.has(name)).sort()};
}
