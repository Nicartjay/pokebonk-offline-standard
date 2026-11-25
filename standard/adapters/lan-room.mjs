// Adapt the captured online room IN PLACE. Keep its real screen, map panel,
// animated Pokémon stages, trainer cards, chat, Invite pane and ready bar.
// Never recreate those components or depend on private minified names.
import {parse} from "acorn";
import {nodesOf, maybeName, literal, one} from "../../scripts/source.ts";
const hasClass = (node, cls) => nodesOf(node, "Property", property =>
  maybeName(property.key) === "class" && (literal(property.value) === cls ||
    [...nodesOf(property.value, "Literal"), ...nodesOf(property.value, "TemplateLiteral")]
      .some(value => literal(value) === cls))).length > 0;

function patchRoomReturn(source, tree, roomEntry) {
  const keeper=one(tree.body.filter(node=>node.type==="FunctionDeclaration"&&
    hasClass(node,"btn green cp-return")),"original co-op return shortcut");
  const app=maybeName(keeper.params[0]);
  const timer=one(nodesOf(keeper,"CallExpression",node=>
    maybeName(node.callee.object)==="window"&&maybeName(node.callee.property)==="setInterval"),
  "original room-return observer");
  const tick=timer.arguments[0];
  if(tick?.type!=="ArrowFunctionExpression")throw Error("Unsupported room-return timer callback.");
  const control=one(nodesOf(tick,"CallExpression",node=>literal(node.arguments[0])==="button"&&
    hasClass(node,"btn green cp-return")),"original green room-return button");
  const button=maybeName(one(nodesOf(tick,"AssignmentExpression",node=>node.right===control),
    "room-return button binding").left);
  const clear=one(nodesOf(keeper,"VariableDeclarator",node=>node.init?.type==="ArrowFunctionExpression"&&
    nodesOf(node.init,"CallExpression",call=>maybeName(call.callee.object)===button&&
      maybeName(call.callee.property)==="remove").length===1),"room-return cleanup").id.name;
  const room=maybeName(one(nodesOf(tick,"VariableDeclarator",node=>
    node.init?.type==="MemberExpression"&&maybeName(node.init.object)===app&&
    maybeName(node.init.property)==="coopRoom"),"room-return active room").id);
  const handler=one(control.arguments[1].properties.filter(node=>maybeName(node.key)==="onclick"),
    "room-return click action").value;
  const open=one(nodesOf(handler,"CallExpression",node=>maybeName(node.callee)===roomEntry),
    "original return-to-room navigation");
  if(!app||!button||!room||handler.body.type!=="BlockStatement"||
    source.slice(keeper.start,keeper.end).includes("__offlineReturnRoom"))
    throw Error("Unsupported room-return bindings.");
  const navigation=`(${room}.room?.tier===4&&globalThis.PokeBonkUseExpeditionRoom?`+
    `globalThis.PokeBonkUseExpeditionRoom(${app},${room}):${source.slice(open.start,open.end)})`;
  const action=source.slice(handler.start,handler.body.start+1)+
    `if(${app}.coopRoom!==${room}||!${room}?.open||${room}.retired){${clear}();return;}`+
    source.slice(handler.body.start+1,open.start)+navigation+source.slice(open.end,handler.end);
  const markup=source.slice(control.start,handler.start)+action+source.slice(handler.end,control.end);
  // Preserve the actual original button, translation, icon, animation and
  // responsive CSS. Native rooms have their own lifetime/recovery policy;
  // the website's account AFK/start timers must not evict these local rooms.
  const callback=`()=>{
    const ${room}=${app}.coopRoom;
    if(!${room}?.open||${room}.retired||${app}.run||document.querySelector(".screen.cp.lobby, .exb-team-room")){
      ${clear}();__offlineReturnRoom=null;return;
    }
    if(${button}?.isConnected&&__offlineReturnRoom===${room})return;
    ${clear}();__offlineReturnRoom=${room};${button}=${markup};document.body.append(${button});
  }`;
  const text=source.slice(keeper.start,keeper.body.start+1)+
    "let __offlineReturnRoom=null;"+source.slice(keeper.body.start+1,tick.start)+
    callback+source.slice(tick.end,keeper.end);
  return {entry:keeper.id.name,change:{...keeper,text}};
}
export function patchLanRoom(source) {
  const tree = parse(source, {ecmaVersion: "latest", sourceType: "module"});
  const owner = one(nodesOf(tree, "FunctionDeclaration", node =>
    hasClass(node, "cp-room") && hasClass(node, "cp-slots") && hasClass(node, "cp-bar")),
  "original co-op room screen");
  const [app, room] = owner.params.map(maybeName);
  const roomReturn=patchRoomReturn(source,tree,owner.id.name);
  const changes = [];
  const replace = (node, text) => changes.push({start: node.start, end: node.end, text});
  // Nested upstream callbacks reuse the outer room's minified identifier.
  // A unique lexical alias keeps shared-clock hooks correct in every scope.
  const stableRoom="__offlineCoopRoom";
  if(nodesOf(owner,"Identifier",node=>node.name===stableRoom).length)
    throw Error("Unsupported upstream: co-op room alias collision.");
  replace({start:owner.body.start+1,end:owner.body.start+1},
    `const ${stableRoom}=${room};${roomReturn.entry}(${app});`);
  const capacity=one(nodesOf(owner,"BinaryExpression",node=>node.operator===">="&&
    node.right.type==="CallExpression"&&node.right.callee.type==="Identifier"&&node.right.arguments.length===1&&
    node.right.arguments[0].type==="MemberExpression"&&maybeName(node.right.arguments[0].object)===room&&
    maybeName(node.right.arguments[0].property)==="room"),"original room seat capacity").right.callee.name;
  const selectedCapacity=one(nodesOf(owner,"VariableDeclarator",node=>node.init?.type==="ConditionalExpression"&&
    node.init.consequent.type==="CallExpression"&&maybeName(node.init.consequent.callee)===capacity),
  "original selected room capacity");
  replace(selectedCapacity.init,`globalThis.PokeBonkOfflineUI.coopRoomCapacity(${stableRoom})`);
  for(const call of nodesOf(owner,"CallExpression",node=>maybeName(node.callee)===capacity))
    replace(call,`globalThis.PokeBonkOfflineUI.coopRoomCapacity(${stableRoom})`);
  for(const count of nodesOf(owner,"Property",node=>maybeName(node.key)==="length"&&
    node.value.type==="ConditionalExpression"&&literal(node.value.alternate)===4))
    replace(count.value,`globalThis.PokeBonkOfflineUI.coopRoomCapacity(${stableRoom})`);
  for(const title of nodesOf(owner,"TemplateLiteral",node=>node.quasis.some(quasi=>quasi.value.raw.includes("/4"))))
    replace(title,source.slice(title.start,title.end).replaceAll("/4",`/\${${stableRoom}.room.want??4}`));
  const property = (node, name) => one(nodesOf(node, "Property", p => maybeName(p.key) === name), `room ${name}`);
  const variable = cls => one(nodesOf(owner, "VariableDeclarator", node =>
    node.init?.type === "CallExpression" && hasClass(node.init, cls)), cls + " container").id.name;
  const standing = variable("cp-stand"), friends = variable("cp-fr-list scroll");
  const arrows = nodesOf(owner, "VariableDeclarator").map(node => node.init)
    .filter(node => node?.type === "ArrowFunctionExpression");
  const callsMethod = (node, name) => nodesOf(node, "CallExpression", call =>
    maybeName(call.callee.property) === name).length > 0;
  // Back/Esc and the explicit Leave control share confirmation. Preserve the
  // upstream leave/cleanup routine, and keep Lab's non-leaving navigation intact.
  const leaveRoutine=one(nodesOf(owner,"VariableDeclarator",node=>
    node.init?.type==="ArrowFunctionExpression"&&node.init.async&&callsMethod(node.init,"leave")),
  "original room leave routine");
  const roomScreen=one(nodesOf(owner,"CallExpression",node=>
    node.arguments.some(argument=>literal(argument)==="cp lobby")),"original room navigation");
  replace(roomScreen.arguments[4],`()=>globalThis.PokeBonkOfflineUI.confirmLanLeave(${room},()=>void ${leaveRoutine.id.name}(true))`);
  const leaveButton=one(nodesOf(owner,"CallExpression",node=>
    node.arguments[0]&&literal(node.arguments[0])==="button"&&node.arguments[1]?.type==="ObjectExpression"&&
    node.arguments[1].properties.some(p=>maybeName(p.key)==="class"&&literal(p.value)==="btn small ghost")&&
    node.arguments[1].properties.some(p=>maybeName(p.key)==="onclick"&&
      nodesOf(p.value,"CallExpression",call=>maybeName(call.callee)===leaveRoutine.id.name).length)),
  "original explicit leave control");
  replace(property(leaveButton,"onclick").value,`()=>globalThis.PokeBonkOfflineUI.confirmLanLeave(${room},()=>void ${leaveRoutine.id.name}())`);
  replace({start:owner.body.end-1,end:owner.body.end-1},
    `;globalThis.PokeBonkOfflineUI.bindLanBack(${room},()=>void ${leaveRoutine.id.name}(true));`);
  // Remove all server-owned room services. Preserve the original four-seat
  // layout; a UI preview is never a claim that networking is complete.
  replace(one(arrows.filter(node => callsMethod(node, "friends") && callsMethod(node, "clanMates")),
    "online friends loader"), `()=>globalThis.PokeBonkOfflineUI.lanInviteHelp(${friends},${room})`);
  replace(one(arrows.filter(node => node.body.type === "BlockStatement" &&
    hasClass(node, "cp-fr-head")), "online friends-list renderer"),
    `()=>globalThis.PokeBonkOfflineUI.lanInviteHelp(${friends},${room})`);
  replace(one(arrows.filter(node => callsMethod(node, "coopStanding")), "online team standing"),
    `()=>{${standing}.hidden=true}`);
  replace(one(arrows.filter(node => callsMethod(node, "quick")), "online quick matchmaking"), "async()=>{}");
  // Keep the real Find teammates switch and Duo/Trio/Squad controls.
  for (const call of nodesOf(owner, "CallExpression", n => maybeName(n.callee.property) === "coopSeeking")) {
    replace(call, "Promise.resolve({n:0})");
  }
  // Never invoke the online flow that clears an existing saved solo run.
  replace(one(nodesOf(owner, "ExpressionStatement", node =>
    callsMethod(node, "clearSavedForCoop")), "online destructive solo-save prompt"), "void 0;");
  const pin = one(nodesOf(owner, "SequenceExpression", node => node.expressions.length === 2 &&
    maybeName(node.expressions[0]?.left?.property) === "coopRoom" &&
    node.expressions[1]?.type === "CallExpression"), "online room history URL");
  replace(pin, source.slice(pin.expressions[0].start, pin.expressions[0].end));
  // The original room deliberately keeps its connection while browsing Lab.
  // Its view cleanup must restore the title, not rewrite the website's room
  // URL. The corresponding URL pin was already removed above.
  const historyName=maybeName(pin.expressions[1].callee);
  if(!historyName)throw new Error("Unsupported online room history helper.");
  const cleanup=one(tree.body.filter(node=>node.type==="FunctionDeclaration"&&node.params.length===0&&
    nodesOf(node,"CallExpression",call=>maybeName(call.callee)===historyName&&
      call.arguments.length===1&&literal(call.arguments[0])===null).length===1&&
    nodesOf(node,"MemberExpression",member=>maybeName(member.object)==="document"&&maybeName(member.property)==="title").length),
  "online room screen cleanup");
  const historyReset=one(nodesOf(cleanup,"CallExpression",call=>maybeName(call.callee)===historyName),
    "online room URL reset");
  const cleanupText=source.slice(cleanup.start,historyReset.start)+"void 0"+source.slice(historyReset.end,cleanup.end);
  // A local teammate has no website trainer page and cannot be kicked/voted
  // through an account API. Leaving the private session remains available.
  replace(one(nodesOf(owner, "LogicalExpression", n => n.operator === "&&" &&
    nodesOf(n.left, "MemberExpression", child => maybeName(child.property) === "guest").length === 1 &&
    source.slice(n.right.start, n.right.end).includes("`cp-av-link`")),
    "online trainer-profile link"), "false");
  for (const cls of ["cp-x cp-kick", "cp-vote", "cp-retry"]) {
    const matches = nodesOf(owner, "CallExpression", n => n.arguments.some(arg =>
      arg?.type === "ObjectExpression" && hasClass(arg, cls)));
    if (cls === "cp-vote") {
      // Its class is conditional, not a fixed class property.
      const vote = one(arrows.filter(node => callsMethod(node, "voteOut")), "host-voting control");
      replace(vote, "()=>null");
    } else for (const match of matches) replace(match, "null");
  }
  // Keep the real map picker and mode/difficulty animations. Unsupported
  // shared-daily/weekly rule sets remain visible with an explicit reason.
  one(nodesOf(owner, "CallExpression", n => n.arguments.some(arg =>
    arg?.type === "ObjectExpression" && arg.properties.some(p => maybeName(p.key) === "canOpen"))),
  "original destination picker");
  const dailyNames=new Set(nodesOf(owner,"MemberExpression",node=>maybeName(node.property)==="mutation"&&
    node.object.type==="CallExpression"&&node.object.arguments[0]?.type==="CallExpression"&&
    maybeName(node.object.arguments[0].callee.object)==="Date"&&
    maybeName(node.object.arguments[0].callee.property)==="now").map(node=>maybeName(node.object.callee)));
  for(const call of nodesOf(owner,"CallExpression",node=>dailyNames.has(maybeName(node.callee))&&
    node.arguments.length===1&&node.arguments[0].type==="CallExpression"&&
    maybeName(node.arguments[0].callee.object)==="Date"&&maybeName(node.arguments[0].callee.property)==="now"))
    replace(call.arguments[0],`${stableRoom}.room.rulesAt??Date.now()`);
  const bagRefresh = one(arrows.filter(node =>
    [...nodesOf(node, "Literal"), ...nodesOf(node, "TemplateLiteral")].some(n =>
      literal(n) === "hasta {n} · se gastan al empezar")),
  "reviewed co-op backpack renderer");
  // Resolve the bag renderer by its semantic arguments rather than retaining
  // the current minifier's name in generated code.
  replace(bagRefresh, "()=>{}");
  const modeIconNames=new Set();
  for (const map of nodesOf(owner, "CallExpression", n => maybeName(n.callee.property) === "map" &&
    n.callee.object?.type === "CallExpression")) {
    const callback = map.arguments[0];
    if (callback?.type !== "ArrowFunctionExpression") continue;
    if (callsMethod(callback, "setSettings") && hasClass(callback, "cp-tier")) {
      const disabled=property(callback,"disabled").value;
      const mode=maybeName(callback.params[0]);
      // Original room modes use the reviewed encoded tier mapping.
      const encode=one(nodesOf(callback,"CallExpression",n=>n.callee.type==="Identifier"&&
        n.arguments.length===1&&maybeName(n.arguments[0])===mode&&
        nodesOf(callback,"CallExpression",c=>maybeName(c.callee.property)==="setSettings"&&
          nodesOf(c,"CallExpression",x=>x===n).length).length),"room mode tier encoding").callee.name;
      replace(disabled,`!${stableRoom}.isHost||!!globalThis.PokeBonkOfflineUI.coopModeUnavailable(${encode}(${mode}))`);
      replace(property(callback,"title").value,`globalThis.PokeBonkOfflineUI.coopModeUnavailable(${encode}(${mode}))??globalThis.PokeBonkOfflineUI.coopRoomModeHint(${mode})`);
      const control=one(nodesOf(callback,"CallExpression",node=>literal(node.arguments[0])==="button"&&hasClass(node,"cp-tier")),
        "original co-op mode button");
      if(control.arguments[2]?.type!=="CallExpression"||!maybeName(control.arguments[2].callee))
        throw Error("Unsupported original co-op mode icon.");
      modeIconNames.add(maybeName(control.arguments[2].callee));
    }
  }
  for(const call of nodesOf(owner,"CallExpression",node=>modeIconNames.has(maybeName(node.callee)))){
    const [mode,size]=call.arguments;
    replace(call,`globalThis.PokeBonkOfflineUI.coopRoomModeIcon(${stableRoom},${source.slice(mode.start,mode.end)},()=>${source.slice(call.start,call.end)},${size?source.slice(size.start,size.end):24})`);
  }
  // Pairing uses a private invitation, never the website's four-letter URL.
  const ticket = one(nodesOf(owner, "CallExpression", n => n.arguments.some(arg =>
    arg?.type === "ObjectExpression" && hasClass(arg, "cp-ticket-code"))), "original room ticket");
  const code = one(nodesOf(ticket, "CallExpression", n => n.arguments.some(arg =>
    arg?.type === "ObjectExpression" && arg.properties.some(p =>
      maybeName(p.key) === "code" && maybeName(p.value.property) === "code"))), "online code tiles");
  replace(code, `globalThis.PokeBonkOfflineUI.lanInvitation(${room})`);
  const copy = one(nodesOf(owner, "CallExpression", n => maybeName(n.callee.property) === "writeText"), "copy room invitation");
  const linkBuilder = maybeName(copy.arguments[0]?.callee);
  if (!linkBuilder) throw new Error("Unsupported original room-invitation builder.");
  for (const call of nodesOf(owner, "CallExpression", n => maybeName(n.callee) === linkBuilder)) {
    replace(call, `${room}.invitation??""`);
  }
  const copyButton = one(nodesOf(owner, "VariableDeclarator", n =>
    n.init?.type === "CallExpression" && callsMethod(n.init, "writeText")), "copy invitation button").init;
  replace(copyButton,`globalThis.PokeBonkOfflineUI.lanCopyInvitation(${room})`);
  // Do not offer URL sharing until native, private invitation sharing exists.
  const share = one(nodesOf(owner, "VariableDeclarator", n => n.init?.type === "ConditionalExpression" &&
    callsMethod(n.init, "share")), "website share control");
  replace(share.init, "null");
  const report = one(nodesOf(owner, "CallExpression", n => n.arguments.some(arg =>
    arg?.type === "ObjectExpression" && hasClass(arg, "btn small ghost cp-report"))), "room bug button");
  replace(property(report, "onclick").value, "()=>globalThis.PokeBonkOfflineUI.reportBug()");
  // The durable native two-to-four-player start barrier owns launch, not the former
  // online `start` event. LocalRoom supplies game-engine callbacks separately.
  const startHandler = one(nodesOf(owner, "Property", p =>
    maybeName(p.key) === "start" && callsMethod(p.value, "startRun")), "online start-event handler");
  replace(startHandler.value, "()=>{}");
  // No synthetic launch/chat actions in the local UI-only preview. The same
  // upstream controls can be enabled later by a real native session.
  for (const cls of ["field cp-chat-in", "btn blue cp-chat-send", "pill"]) {
    const control = one(nodesOf(owner, "CallExpression", n => n.arguments.some(arg =>
      arg?.type === "ObjectExpression" && hasClass(arg, cls))), cls + " preview control");
    const options = control.arguments[1];
    replace({start: options.end - 1, end: options.end - 1}, `,disabled:${room}.preview`);
  }
  const startButton = one(nodesOf(owner, "CallExpression", n =>
    n.arguments.some(arg => arg?.type === "ObjectExpression" && hasClass(arg, "btn big red"))),
  "original room start button");
  const disabled = property(startButton, "disabled").value;
  replace(disabled, `${room}.preview||(${source.slice(disabled.start, disabled.end)})`);
  const subtitle = one(nodesOf(owner, "TemplateLiteral", n => literal(n) === "Cooperativo · BETA"),
    "original room subtitle");
  replace(subtitle, `globalThis.PokeBonkOfflineUI.lanRoomSubtitle(${room})`);
  for (const text of nodesOf(owner, "TemplateElement")) {
    const value = text.value.raw;
    const updated = value.replace("Código de la sala", "Room code").replace("Copiar enlace", "Copy room code")
      .replace("Sala ", "Room ")
      .replace("Clasifica por la zona a la que llega el equipo, y las bajas desempatan.","Your team’s stage and KOs are saved in your local run records.")
      .replace("Clasifica por los jefes vencidos y el tiempo. Va aparte de la clasificación del evento en solitario.","Bosses defeated and time are saved locally, separately from solo runs. No online ranking or prizes.");
    if (updated !== value) replace(text, updated);
  }
  const rootClass = one(nodesOf(owner, "TemplateLiteral", n => literal(n) === "cp lobby"), "original room screen class");
  replace(rootClass, `${room}.preview?"cp lobby offline-lan-room offline-lan-room-preview":"cp lobby offline-lan-room"`);
  // Parent replacement wins over children intentionally removed with it.
  const edits = changes.filter(change => !changes.some(parent =>
    parent !== change && parent.start <= change.start && parent.end >= change.end &&
    (parent.start < change.start || parent.end > change.end)));
  edits.sort((a, b) => b.start - a.start);
  for (let index = 1; index < edits.length; index++) {
    if (edits[index].end > edits[index - 1].start) throw new Error("Overlapping original room adaptation.");
  }
  let text = source.slice(owner.start, owner.end);
  for (const edit of edits) text = text.slice(0, edit.start - owner.start) + edit.text + text.slice(edit.end - owner.start);
  return {change: {...owner, text}, cleanupChange:{...cleanup,text:cleanupText},
    returnChange:roomReturn.change,returnEntry:roomReturn.entry,entry:owner.id.name};
}

// Reuse the upstream co-op entry's With friends/Create/Join and How to play
// components. Only the cloud finder/board/invitation columns are replaced.
export function patchLanLanding(source) {
  const tree=parse(source,{ecmaVersion:'latest',sourceType:'module'});
  const owner=one(nodesOf(tree,'FunctionDeclaration',n=>hasClass(n,'cp-home')&&hasClass(n,'cp-lineup')),'original co-op landing screen');
  const app=maybeName(owner.params[0]),changes=[];
  const replace=(n,text)=>changes.push({start:n.start,end:n.end,text});
  const ownClass=(n,cls)=>n?.type==='ObjectExpression'&&n.properties.some(p=>maybeName(p.key)==='class'&&literal(p.value)===cls);
  const call=cls=>one(nodesOf(owner,'CallExpression',n=>ownClass(n.arguments[1],cls)),cls+' original entry control');
  for(const [cls,action] of [['btn big green cp-create','host'],['btn blue cp-join-btn','join'],['btn big red cp-search','find']]){
    const n=call(cls),options=n.arguments[1];replace(n.arguments[0],'"a"');
    replace(one(options.properties.filter(p=>maybeName(p.key)==='onclick'),cls+' handler').value,'()=>{}');
    const disabled=options.properties.find(p=>maybeName(p.key)==='disabled');if(disabled)replace(disabled.value,'false');
    replace({start:options.end-1,end:options.end-1},`,href:"/__native__/lan/${action}","data-standard-lan-action":"${action}",role:"button"`);
  }
  const code=one(nodesOf(owner,'CallExpression',n=>n.arguments.some(arg=>arg.type==='ObjectExpression'&&arg.properties.some(p=>maybeName(p.key)==='onCode'))),'original join-code input');
  replace(code,`globalThis.PokeBonkOfflineUI.lanJoinField()`);
  const playBody=one(nodesOf(owner,'CallExpression',n=>ownClass(n.arguments[1],'cp-pane-body')&&hasClass(n,'cp-act')&&hasClass(n,'cp-join')),'original create/join body');
  replace({start:playBody.arguments[1].end,end:playBody.arguments[1].end},`,globalThis.PokeBonkOfflineUI.lanHomeTools(${app})`);
  const root=call('cp-home'),left=call('cp-left'),factory=source.slice(root.callee.start,root.callee.end);
  const finder=call('cp-hero cp-find');
  const finderName=one(nodesOf(owner,'VariableDeclarator',n=>n.init===finder),'original Find a match card').id.name;
  replace(call('cp-find-opts'),'null');
  const findText=call('cp-find-tx');
  replace({start:findText.end-1,end:findText.end-1},`,globalThis.PokeBonkOfflineUI.lanPickRoomsButton(),globalThis.PokeBonkOfflineUI.lanCancelSearch()`);
  const search=call('btn big red cp-search');
  replace(search.arguments.at(-1),'globalThis.PokeBonkOfflineUI.lanFindLabel()');
  replace(call('cp-seek-n'),'globalThis.PokeBonkOfflineUI.lanFindStatus()');
  const screen=one(nodesOf(owner,'CallExpression',n=>n.arguments.includes(root)),'co-op landing navigation');
  const back=source.slice(screen.arguments[4].start,screen.arguments[4].end);
  replace(screen.arguments[4],`()=>{globalThis.PokeBonkOfflineUI.cancelLanSearch();(${back})()}`);
  const badge=one(nodesOf(finder,'CallExpression',n=>ownClass(n.arguments[1],'cp-beta')),'Find a match LAN badge');
  replace(badge.arguments.at(-1),'"LAN"');
  const [play,howto]=left.arguments.slice(2).map(n=>source.slice(n.start,n.end));
  if(!play||!howto)throw Error('Unsupported original co-op entry columns.');
  replace(root,`${factory}("div",{class:"cp-home"},${factory}("div",{class:"cp-left"},${play}),${factory}("div",{class:"offline-lan-middle"},${finderName},${howto}),globalThis.PokeBonkOfflineUI.lanConnectionHelp(${app}))`);
  const board=one(nodesOf(owner,'VariableDeclarator',n=>n.init?.type==='ArrowFunctionExpression'&&nodesOf(n.init,'CallExpression',c=>maybeName(c.callee.property)==='coopBoard').length),'online co-op board loader');
  replace(board.init,'()=>{}');
  for(const n of nodesOf(owner,'CallExpression',n=>maybeName(n.callee.object?.property)==='backend')){
    if(maybeName(n.callee.property)==='coopSeeking')replace(n,'Promise.resolve({n:0})');
    if(maybeName(n.callee.property)==='coopInvites')replace(n,'Promise.resolve([])');
  }
  for(const n of nodesOf(owner,'ExpressionStatement',n=>nodesOf(n,'CallExpression',c=>
    maybeName(c.callee.property)==='coopSeeking').length))replace(n,'void 0;');
  const translations=new Map([
    ['Eliges el mapa y la dificultad, e invitas a tus amigos o a tu clan','Choose the map, mode and difficulty. Share a code, or turn on Find teammates.'],
    ['Buscar partida','Find a random match'],
    ['Te juntamos con otros entrenadores que también buscan equipo','Automatically join a compatible open room on your Wi-Fi or hotspot.'],
    ['Te lo pasa quien ha creado la sala','Enter the room code shared by the host.'],['Únete con un código','Join a local room'],
    ['Con amigos','On your local network'],['Juega con tus amigos · BETA','Offline · 2–4 trainers'],['Cooperativo','Local co-op'],
    ['Crea una sala','Host a room'],['Crear sala','Create room'],['Unirse','Join room'],
  ]);
  for(const n of [...nodesOf(owner,'Literal'),...nodesOf(owner,'TemplateLiteral')])if(translations.has(literal(n)))replace(n,JSON.stringify(translations.get(literal(n))));
  replace(one(nodesOf(owner,'TemplateLiteral',n=>literal(n)==='cp entry'),'original co-op entry class'),'"cp entry offline-lan-home"');
  const edits=changes.filter(n=>!changes.some(p=>p!==n&&p.start<=n.start&&
    (n.start===n.end?p.end>n.end:p.end>=n.end)&&(p.start<n.start||p.end>n.end))).sort((a,b)=>b.start-a.start);
  let text=source.slice(owner.start,owner.end);
  for(const edit of edits)text=text.slice(0,edit.start-owner.start)+edit.text+text.slice(edit.end-owner.start);
  return {change:{...owner,text},entry:owner.id.name};
}
