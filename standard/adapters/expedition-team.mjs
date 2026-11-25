// Reuse the captured Expedition party panel, slots, map radios, chat and ready
// controls. Replace only its official account/room transport with our facade.
import {ast,nodesOf,maybeName,literal,one,edits} from "../../scripts/source.ts";
const has=(node,text)=>[...nodesOf(node,"Literal"),...nodesOf(node,"TemplateLiteral")].some(value=>literal(value)===text);
const method=(node,key)=>nodesOf(node,"CallExpression",call=>maybeName(call.callee.property)===key);
const prop=(node,key)=>node?.properties?.find(value=>maybeName(value.key)===key);
const cls=(node,name)=>has(prop(node.arguments?.[1],"class")?.value,name);
export function patchExpeditionTeam(source){
  const tree=ast(source),functions=tree.body.filter(node=>node.type==="FunctionDeclaration");
  const entry=one(functions.filter(node=>has(node,"xt-entry")),"Expedition native entry");
  const panel=one(functions.filter(node=>has(node,"xt-slots")&&has(node,"xt-two")),"original Expedition team panel");
  const bind=one(functions.filter(node=>method(node,"broadcast").some(call=>has(call,"xl"))&&
    nodesOf(node,"AssignmentExpression",item=>maybeName(item.left.property)==="coopRoom").length),
    "Expedition room event binding");
  const update=one(functions.filter(node=>method(node,"broadcast").some(call=>has(call,"xl"))&&method(node,"setReady").length),
    "Expedition loadout publisher");
  const [app,room]=bind.params.map(maybeName),entryApp=maybeName(entry.params[0]);
  const mapCall=one(nodesOf(entry,"CallExpression",node=>maybeName(node.callee.property)==="map"&&node.arguments.length===0),
    "Expedition selected map").callee;
  const teamContext=maybeName(mapCall.object);
  const panelApp=one(nodesOf(panel,"VariableDeclarator",node=>node.init?.type==="Identifier"),"Expedition panel app").id.name;
  const panelRoom=one(nodesOf(panel,"VariableDeclarator",node=>node.init?.type==="CallExpression"&&
    node.init.arguments.length===1&&maybeName(node.init.arguments[0])===panelApp),"Expedition panel room").id.name;
  const summaryMap=maybeName(one(method(update,"set"),"Expedition loadout map").callee.object);
  const changes=[],replace=(node,text)=>changes.push({...node,text});
  const mount=one(functions.filter(node=>has(node,"ex-card exb-team")),"Expedition party-panel mount");
  const mountClass=one(nodesOf(mount,"Property",node=>maybeName(node.key)==="class"&&literal(node.value)==="ex-card exb-team"),"Expedition team native-action root");
  replace(mountClass.value,'"ex-card exb-team offline-lan-room offline-expedition-room"');
  const native=(call,verb)=>{
    const opts=call.arguments[1];
    replace(call.arguments[0],'"a"');
    replace(prop(opts,"onclick").value,"()=>{}");
    if(prop(opts,"disabled"))replace(prop(opts,"disabled").value,"false");
    replace({start:opts.end-1,end:opts.end-1},`,href:"/__native__/lan/${verb}","data-standard-lan-action":"${verb}",role:"button"`);
  };
  // Discard the actual official room constructor, not just its visible entry.
  const official=one(nodesOf(tree,"VariableDeclarator",node=>node.init?.type==="ClassExpression"&&
    ["create","join","quick","setPick","setReady","freshIce"].every(key=>
      node.init.body.body.some(item=>maybeName(item.key)===key))),"official Expedition room client");
  replace(official.init,'class {constructor(){throw Error("Use the native offline co-op room.")}}');
  for(const key of ["create","join","quick"]){
    for(const call of nodesOf(entry,"CallExpression",node=>maybeName(node.callee.object)===maybeName(official.id)&&maybeName(node.callee.property)===key))
      replace(call,"Promise.resolve(null)");
  }
  const code=one(nodesOf(entry,"CallExpression",node=>cls(node,"field xt-code-in")),"Expedition code input");
  const codeName=one(nodesOf(entry,"VariableDeclarator",node=>node.init===code),"Expedition code binding").id.name;
  replace(code,"globalThis.PokeBonkOfflineUI.lanJoinField()");
  for(const statement of nodesOf(entry,"ExpressionStatement",node=>method(node,"addEventListener").some(call=>
    maybeName(call.callee.object)===codeName)))replace(statement,"void 0;");
  const acts=one(nodesOf(entry,"CallExpression",node=>cls(node,"xt-acts")),"Expedition create/join actions");
  const create=one(nodesOf(acts,"CallExpression",node=>cls(node,"btn primary")),"Expedition create button");
  const join=one(nodesOf(acts,"CallExpression",node=>literal(node.arguments[0])==="button"&&
    literal(prop(node.arguments[1],"class")?.value)==="btn"),"Expedition join button");
  native(create,"host");native(join,"join");
  const search=one(nodesOf(entry,"CallExpression",node=>cls(node,"xt-search")),"Expedition finder");
  const find=one(nodesOf(search,"CallExpression",node=>prop(node.arguments[1],"onclick")),"Expedition random search");
  native(find,"find");
  replace(find.arguments.at(-1),"globalThis.PokeBonkOfflineUI.lanFindLabel()");
  replace(one(nodesOf(entry,"CallExpression",node=>cls(node,"xt-sizes")),"old public queue sizes"),"null");
  const root=one(nodesOf(entry,"CallExpression",node=>cls(node,"xt-entry")),"Expedition entry root");
  replace(prop(root.arguments[1],"class").value,'"xt-entry offline-lan-home offline-exp-team-entry"');
  replace({start:acts.start,end:acts.start},`globalThis.PokeBonkOfflineUI.expeditionHomeTools(${entryApp},${teamContext}.map()),`);
  replace({start:search.end,end:search.end},`,globalThis.PokeBonkOfflineUI.lanPickRoomsButton(),globalThis.PokeBonkOfflineUI.lanFindStatus(),globalThis.PokeBonkOfflineUI.lanCancelSearch()`);
  // Server friends/clans are replaced by the same private-code help used by
  // the normal room. No account list, live market or official API is queried.
  const friends=one(functions.filter(node=>method(node,"friends").length&&method(node,"clanMates").length),"Expedition friends loader");
  replace(friends,`function ${friends.id.name}(){}`);
  const invites=one(functions.filter(node=>has(node,"xt-invite")),"Expedition invitation pane");
  replace(invites,`function ${invites.id.name}(${invites.params.map(maybeName).join(",")}){
    return globalThis.PokeBonkOfflineUI.expeditionInvite(${maybeName(invites.params[1])})
  }`);
  const start=one(nodesOf(bind,"Property",node=>maybeName(node.key)==="start"&&method(node,"startRun").length),"Expedition native start barrier");
  replace(start.value,"()=>{}");
  // Feed the actual captured summary renderer from sanitized native state.
  replace({start:panel.body.start+1,end:panel.body.start+1},
    `globalThis.PokeBonkOfflineUI.syncExpeditionRoom();`);
  // Insert after the unique room getter declaration, before the panel uses it.
  const roomDecl=one(nodesOf(panel,"VariableDeclaration",node=>node.declarations.some(item=>maybeName(item.id)===panelRoom)),
    "Expedition room context declaration");
  replace({start:roomDecl.end,end:roomDecl.end},
    `;if(${panelRoom})for(const member of ${panelRoom}.room.members)if(member.loadout)${summaryMap}.set(member.id,member.loadout);`);
  const copy=one(nodesOf(panel,"CallExpression",node=>method(node,"writeText").length&&literal(node.arguments[0])==="button"),
    "Expedition copy-code button");
  replace(copy,`globalThis.PokeBonkOfflineUI.lanCopyInvitation(${panelRoom})`);
  const leave=one(nodesOf(panel,"CallExpression",node=>literal(node.arguments[0])==="button"&&
    prop(node.arguments[1],"onclick")&&method(prop(node.arguments[1],"onclick").value,"leave").length),"Expedition Leave button");
  const leaveHandler=prop(leave.arguments[1],"onclick").value;
  replace(leaveHandler,`()=>globalThis.PokeBonkOfflineUI.confirmLanLeave(${panelRoom},()=>(${source.slice(leaveHandler.start,leaveHandler.end)})())`);
  const head=one(nodesOf(panel,"CallExpression",node=>cls(node,"xt-head")),"Expedition room header");
  const headName=one(nodesOf(panel,"VariableDeclarator",node=>node.init===head),"Expedition header binding").id.name;
  const appendedHead=one(nodesOf(panel,"CallExpression",node=>maybeName(node.callee.property)==="append"&&
    maybeName(node.arguments[0])===headName),"Expedition original panel children").arguments[0];
  replace({start:appendedHead.end,end:appendedHead.end},`,globalThis.PokeBonkOfflineUI.expeditionRoomTools(${panelRoom})`);
  const slots=one(nodesOf(panel,"ArrayExpression",node=>node.elements.length===4&&node.elements.every((item,index)=>literal(item)===index)),
    "Expedition original team seats");
  replace(slots,`Array.from({length:${panelRoom}.room.want??4},(_,index)=>index)`);
  const why=one(functions.filter(node=>has(node,"Hacen falta al menos {n} entrenadores")),"Expedition start requirements");
  replace({start:why.body.start+1,end:why.body.start+1},`const offlineReason=globalThis.PokeBonkOfflineUI.expeditionStartReason(${maybeName(why.params[0])});if(offlineReason)return offlineReason;`);
  // Export only the reviewed UI binding into the offline namespace.
  const flag=one(bind.body.body.flatMap(node=>node.expression?.type==="SequenceExpression"?
    node.expression.expressions:[node.expression]).filter(node=>node?.type==="AssignmentExpression"&&node.left.type==="Identifier"&&
    (literal(node.right)===true||node.right.type==="UnaryExpression"&&node.right.operator==="!"&&literal(node.right.argument)===0)),
    "Expedition team preference").left.name;
  const suffix=`\nglobalThis.PokeBonkUseExpeditionRoom=(${app},${room})=>{globalThis.PokeBonkTrackRoomReturn?.(${app});${flag}=true;${bind.id.name}(${app},${room});globalThis.PokeBonkOpenExpedition(${app},"home")};\n`;
  const outer=changes.filter(change=>!changes.some(parent=>parent!==change&&parent.start<=change.start&&parent.end>=change.end&&
    (parent.start<change.start||parent.end>change.end)));
  return edits(source,outer)+suffix;
}
