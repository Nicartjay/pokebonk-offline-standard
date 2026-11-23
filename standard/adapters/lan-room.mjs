// Adapt the captured online room IN PLACE. Keep its real screen, map panel,
// animated Pokémon stages, trainer cards, chat, Invite pane and ready bar.
// Never recreate those components or depend on private minified names.
import {parse} from "acorn";
import {nodesOf, maybeName, literal, one} from "../../scripts/source.ts";
const hasClass = (node, cls) => nodesOf(node, "Property", property =>
  maybeName(property.key) === "class" && (literal(property.value) === cls ||
    [...nodesOf(property.value, "Literal"), ...nodesOf(property.value, "TemplateLiteral")]
      .some(value => literal(value) === cls))).length > 0;
export function patchLanRoom(source) {
  const tree = parse(source, {ecmaVersion: "latest", sourceType: "module"});
  const owner = one(nodesOf(tree, "FunctionDeclaration", node =>
    hasClass(node, "cp-room") && hasClass(node, "cp-slots") && hasClass(node, "cp-bar")),
  "original co-op room screen");
  const [app, room] = owner.params.map(maybeName);
  const changes = [];
  const replace = (node, text) => changes.push({start: node.start, end: node.end, text});
  const property = (node, name) => one(nodesOf(node, "Property", p => maybeName(p.key) === name), `room ${name}`);
  const variable = cls => one(nodesOf(owner, "VariableDeclarator", node =>
    node.init?.type === "CallExpression" && hasClass(node.init, cls)), cls + " container").id.name;
  const seats = variable("cp-seats"), standing = variable("cp-stand"), friends = variable("cp-fr-list scroll");
  const arrows = nodesOf(owner, "VariableDeclarator").map(node => node.init)
    .filter(node => node?.type === "ArrowFunctionExpression");
  const callsMethod = (node, name) => nodesOf(node, "CallExpression", call =>
    maybeName(call.callee.property) === name).length > 0;
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
  replace(one(arrows.filter(node => nodesOf(node, "AssignmentExpression", a =>
    a.left?.object?.name === seats && maybeName(a.left.property) === "hidden").length === 1),
  "public-seat controls"), `()=>{${seats}.hidden=true}`);
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
  // Keep the original selector and its animations, restricted to the initial
  // supported LAN rules. Do not advertise unsupported modes or consume bags.
  const picker = one(nodesOf(owner, "CallExpression", n => n.arguments.some(arg =>
    arg?.type === "ObjectExpression" && arg.properties.some(p => maybeName(p.key) === "canOpen"))),
  "original destination picker");
  replace(property(picker, "canOpen").value, "()=>false");
  replace(property(picker, "hint").value, '()=>"Forest · fixed for this LAN test"');
  const bagRefresh = one(arrows.filter(node =>
    [...nodesOf(node, "Literal"), ...nodesOf(node, "TemplateLiteral")].some(n =>
      literal(n) === "hasta {n} · se gastan al empezar")),
  "reviewed co-op backpack renderer");
  // Resolve the bag renderer by its semantic arguments rather than retaining
  // the current minifier's name in generated code.
  replace(bagRefresh, "()=>{}");
  for (const map of nodesOf(owner, "CallExpression", n => maybeName(n.callee.property) === "map" &&
    n.callee.object?.type === "CallExpression")) {
    const callback = map.arguments[0];
    if (callback?.type !== "ArrowFunctionExpression") continue;
    if (callsMethod(callback, "setSettings") && hasClass(callback, "cp-tier")) {
      replace(map.callee.object, source.slice(map.callee.object.start, map.callee.object.end) +
        '.filter(mode=>mode==="classic")');
    }
  }
  for (const node of nodesOf(owner, "CallExpression", n => n.arguments.some(arg =>
    arg?.type === "ObjectExpression" && hasClass(arg, "cp-tier")))) {
    replace(property(node, "disabled").value, "true");
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
  // The durable native two-party start barrier owns launch, not the former
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
  replace(subtitle, `${room}.preview?"PREVIEW · NOT CONNECTED":"Local co-op · LAN"`);
  for (const text of nodesOf(owner, "TemplateElement")) {
    const value = text.value.raw;
    const updated = value.replace("Código de la sala", "Local invitation").replace("Copiar enlace", "Copy invitation")
      .replace("Sala ", "Room ");
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
  return {change: {...owner, text}, cleanupChange:{...cleanup,text:cleanupText}, entry: owner.id.name};
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
  replace({start:findText.end-1,end:findText.end-1},`,globalThis.PokeBonkOfflineUI.lanCancelSearch()`);
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
  for(const n of nodesOf(owner,'CallExpression',n=>n.arguments.some(a=>literal(a)==='Supervivencia en equipo'))){
    // Remove just the Survival how-to row, not its ancestor pane.
    const row=one(nodesOf(owner,'CallExpression',r=>r.arguments[0]&&literal(r.arguments[0])==='maldicion'&&r.start<n.start&&r.end>n.end),'unsupported Survival guide row');replace(row,'null');
  }
  const translations=new Map([
    ['Eliges el mapa y la dificultad, e invitas a tus amigos o a tu clan','Classic · Forest · Normal. Devices on this private network can find your open room.'],
    ['Buscar partida','Find a match'],
    ['Te juntamos con otros entrenadores que también buscan equipo','Automatically join a compatible open room on your Wi-Fi or hotspot.'],
    ['Te lo pasa quien ha creado la sala','Paste the complete invitation shared by the host.'],['Únete con un código','Join a local room'],
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
