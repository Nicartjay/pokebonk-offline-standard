// Host/Join presentation. The native shell owns connections and pairing.
import {LanLobby} from "./lan-lobby.js";
import {createScopeDropdown} from "./dropdown.js";
import {coopModeUnavailable,coopSettings} from "../common/coop-rules.mjs";
import {BIOME_NAMES} from "./modes.js";
import {COOP_CONNECTION_MODES, coopConnectionMode, coopModeMessage,coopRouteMessage,coopRoomCodeLength,isCoopRoomCode} from "../common/coop-mode.mjs";
export function ownedLanSpecies(profile,chosen=0){
  const league=profile?.league??[];
  return league.includes(chosen)?chosen:league.includes(profile?.lastSpecies)?profile.lastSpecies:league[0]??0;
}
export function installLanUI(api, config, {el, button, modal}) {
  api.coopModeUnavailable=coopModeUnavailable;
  api.coopRoomCapacity=room=>[2,3,4].includes(room?.room?.want)?room.room.want:4;
  api.coopRoomModeHint=mode=>({
    classic:"Classic zones, shared bosses and your chosen difficulty. Progress is saved locally.",
    survival:"Survive the growing horde together. Your team’s best runs stay on this device.",
    relay:"Each trainer rotates their own Relay team. Shared waves and bosses; local progression.",
    mutation:"The same Daily Mutation, map and difficulty for the whole room. Local rewards only.",
    rush:"Fight the same five weekly bosses together against the clock. No online ranking or prizes.",
    expedition:"Explore Wild Valley or Safari together. Each trainer risks their own equipment and keeps their own extracted loot.",
  })[mode]??"Choose a co-op mode.";
  api.coopRoomModeIcon=(room,mode,fallback,size=24)=>{
    if(mode!=="mutation")return fallback();
    const daily=globalThis.PokeBonkNativeApp?.backend?.modes?.dailyMutation?.(room.room.rulesAt);
    if(!daily)return fallback();
    const image=el("img",null,"uiicon cp-mode-ic");
    image.src="assets/ui/icons/"+daily.mutation.icon+".png";image.alt="";
    image.style.width=size+"px";image.style.height=size+"px";return image;
  };
  let current, lobby, roomPicker, leavePrompt, roomBack, networkPicker, networkValue, form = {tab: "host", invitation: "", address: "", species: 0, connectionMode:"lan"};
  const state = () => api.lan?.state() ?? {phase: "unavailable", interfaces: [], members: []};
  const internetReady=()=>state().capabilities?.internetReady===true;
  const available=()=>Boolean(api.lan)&&(form.connectionMode==="lan"||internetReady());
  const modeMessage=()=>coopModeMessage(form.connectionMode,{internetReady:internetReady(),relayReady:state().capabilities?.relayReady===true});
  api.lanRoomSubtitle=room=>room.preview?"PREVIEW · NOT CONNECTED":room.connectionMode==="stun-only"?"Co-op · STUN only":
    room.connectionMode==="turn-fallback"?"Co-op · STUN + TURN fallback":"Local co-op · LAN";
  const active = s => ["hosting", "lobby", "preparing", "playing"].includes(s.phase);
  const showRoom = s => {
    roomPicker?.close();
    current?.close();
    if (!lobby || lobby.me !== s.me || !lobby.open) {
      lobby?.retire();
      lobby = new LanLobby(s, (channel, data) => api.lan?.send?.(channel, data));
    }
    else lobby.update(s, false);
    if(s.settings?.tier===4&&globalThis.PokeBonkUseExpeditionRoom)
      globalThis.PokeBonkUseExpeditionRoom(globalThis.PokeBonkNativeApp,lobby);
    else globalThis.PokeBonkOpenLocalRoom(globalThis.PokeBonkNativeApp, lobby);
  };
  let expeditionSync=false,expeditionStateKey;
  api.syncExpeditionRoom=()=>{
    if(expeditionSync)return;
    const app=globalThis.PokeBonkNativeApp,s=state();
    if(s.settings?.tier!==4||!active(s)||app?.run?.state==="play")return;
    expeditionSync=true;
    try{
      const key=JSON.stringify(s);
      if(!lobby||lobby.me!==s.me||!lobby.open){lobby?.retire();lobby=new LanLobby(s,(channel,data)=>api.lan?.send?.(channel,data));}
      else if(expeditionStateKey!==key)lobby.update(s,false);
      expeditionStateKey=key;app.coopRoom=lobby;
    }finally{expeditionSync=false;}
  };
  api.expeditionStartReason=room=>{
    if(room.preview)return "Design preview only. No devices are connected.";
    if(room.phase==="preparing")return "Committing each trainer’s loadout before entering…";
    if(room.room.state==="playing")return "The current Expedition is still running. Wait for your team to return.";
    if(room.room.members.some(member=>!member.loadout))return "Waiting for every trainer’s equipment summary…";
    return null;
  };
  api.expeditionBack=(app,back)=>{
    const room=app?.coopRoom;
    if(room?.open&&room.room?.tier===4){
      api.confirmLanLeave(room,()=>void Promise.resolve(room.leave()).then(back));return;
    }
    back();
  };
  api.expeditionInvite=room=>{
    const pane=el("div",null,"xt-invite");api.lanInviteHelp(pane,room);return pane;
  };
  api.expeditionRoomTools=room=>{
    const tools=el("div",null,"offline-exp-team-tools");
    tools.append(modeField({locked:true,value:room.connectionMode??"lan",transport:room.transport}));
    const seek=button(room.room.pub===2?"Find teammates: On":"Find teammates: Off",()=>{
      void room.openSeats(room.room.pub!==2,room.room.want??4).catch(error=>globalThis.PokeBonkNativeApp.notice(error.message));
    },"pill"+(room.room.pub===2?" on":""));
    seek.disabled=!room.isHost||room.preview||room.room.state==="playing";
    seek.setAttribute("aria-pressed",String(room.room.pub===2));tools.append(seek);
    const seats=el("div",null,"seg");seats.setAttribute("aria-label","Expedition team size");
    for(const [capacity,label]of [[2,"Duo"],[3,"Trio"],[4,"Squad"]]){
      const pick=button(label,()=>void room.openSeats(room.room.pub===2,capacity).catch(error=>
        globalThis.PokeBonkNativeApp.notice(error.message)),"pill"+(room.room.want===capacity?" on":""));
      pick.disabled=!room.isHost||room.preview||capacity<room.room.members.length||room.room.state==="playing";seats.append(pick);
    }
    tools.append(seats);return tools;
  };
  api.confirmLanLeave = (room, leave) => {
    if (!room?.open || room.retired) { leave(); return; }
    if (leavePrompt?.overlay.isConnected) return;
    const prompt = modal("Leave this room?", () => { leavePrompt = null; });
    leavePrompt = prompt;
    prompt.panel.classList.add("offline-player-card", "offline-lan-leave");
    const body = el("div", null, "offline-player-body");
    const art = el("img", null, "offline-lan-dialog-icon");
    art.src = "assets/ui/icons/friends.png"; art.alt = "";
    const heading = el("h3", room.isHost ? "Your team is waiting." : "Stay with your team?");
    const description = el("p", room.isHost ?
      "You’re the host. Leaving will close the room for everyone." :
      "You’ll disconnect from this room. You can join again while it’s still open.", "muted");
    const actions = el("div", null, "lan-actions offline-lan-leave-actions");
    const stay = button("Stay in room", () => prompt.close(), "btn blue");
    const confirm = button("Leave room", () => {
      if (!prompt.overlay.isConnected) return;
      confirm.disabled = true;
      prompt.close();
      leave();
    }, "btn red");
    actions.append(stay, confirm);
    body.append(art, heading, description, actions,
      el("small", "Esc or Close keeps you in the room.", "muted"));
    prompt.panel.append(body);
    stay.focus();
  };
  api.bindLanBack = (room,leave) => {roomBack={room,leave};};
  api.lanBack = () => {
    if(!document.querySelector(".offline-lan-room")||!roomBack?.room.open||roomBack.room.retired||globalThis.PokeBonkNativeApp?.run)return false;
    if(leavePrompt?.overlay.isConnected)leavePrompt.close();
    else api.confirmLanLeave(roomBack.room,roomBack.leave);
    return true;
  };
  // Native Host/Join still receive an owned default. The visible picker
  // lives in the original room, where players can change their Pokémon.
  const defaultPick = app => {
    const input=el("input");
    input.type="hidden";input.dataset.lanField="species";
    input.value=String(ownedLanSpecies(app?.meta?.profile,form.species));
    return input;
  };
  api.lanInvitation = room => {
    const fields=el("div",null,"offline-lan-fields");
    const length=coopRoomCodeLength(room.connectionMode??"lan");
    const code = isCoopRoomCode(room.code,room.connectionMode??"lan") ? room.code : "-".repeat(length);
    const ticket = el("div", null, "offline-lan-code");
    ticket.style.setProperty("--offline-code-length",String(length));
    ticket.setAttribute("role", "group"); ticket.setAttribute("aria-label", "Room code " + code);
    for (const character of code) ticket.append(el("span", character));
    fields.append(modeField({locked:true,value:room.connectionMode??"lan",transport:room.transport}),
      el("span", "Share this room code", "offline-lan-code-label"), ticket,
      el("small", room.preview ? "Preview code · no real room is hosted." :
        "Your friend enters these "+length+" characters in Join room.", "muted"));
    return fields;
  };
  api.lanInviteHelp = (container, room) => {
    container.replaceChildren();
    const help = el("div", null, "cp-empty offline-lan-invite-help");
    const image = el("img"); image.src = "assets/ui/icons/friends.png"; image.alt = ""; image.className = "uiicon";
    if (room.preview) {
      help.append(image, el("b", "Four-player room preview"),
        el("span", "Inspect the room controls using sample data."),
        el("span",room.room.pub===2?"Sample setting: random matching and Pick Rooms can discover this room.":
          "Sample setting: code-only; hidden from random matching and Pick Rooms."),
        el("span", "No room is hosted. Start, invites and chat are disabled in this design preview."),
        el("small", "Changes here do not alter your real progress."));
      container.append(help); return;
    }
    const lan=!room.connectionMode||room.connectionMode==="lan";
    help.append(image, el("b",lan?"Invite on your local network":"Invite over the Internet"),
      el("span",lan?"Connect both devices to the same private Wi-Fi or local hotspot.":
        "Use the same app build and connection mode on every device."),
      el("span",room.room.pub===2?"Share the room code, or let friends find this room in Pick Rooms.":
        "Code-only room. Share the room code; random matching and Pick Rooms cannot find it."),
      el("small", "Classic · Survival · Relay · Daily Mutation · Boss Rush"),
      el("small",lan?"Local matchmaking · no Internet required":
        room.connectionMode==="stun-only"?"Direct/STUN only · no TURN relay":"Direct first · TURN only if authorized and needed"));
    container.append(help);
  };
  const action = (text, verb, cls = "btn blue") => {
    const link = el("a", text, cls);
    link.href = "/__native__/lan/" + verb;
    link.dataset.standardLanAction = verb;
    link.setAttribute("role", "button");
    return link;
  };
  const findMessage = () => {
    const search=state().discovery??{};
    if(form.connectionMode!=="lan"&&!internetReady())return "Internet matchmaking is not configured yet. LAN remains available.";
    const where=form.connectionMode==="lan"?"this network":"Internet rooms";
    if(search.status==="searching")return `Searching ${where}…`+(search.rooms?` ${search.rooms} open room${search.rooms===1?"":"s"} found.`:"");
    if(search.status==="joining")return "Open room found. Connecting…";
    if(search.status==="empty")return "No compatible rooms found. Create a room or refresh Pick Rooms.";
    if(search.status==="error")return search.message??"Couldn’t find a room. Try Pick Rooms or enter a room code.";
    return form.connectionMode==="lan"?"Open rooms on this network · 2–4 trainers":"Compatible Internet rooms · 2–4 trainers";
  };
  api.cancelLanSearch = () => api.lan?.send?.("cancel-find");
  api.lanCancelSearch = () => {
    const link=action("Cancel search","cancel-find","btn small ghost offline-lan-cancel-find");
    link.hidden=true;return link;
  };
  api.lanFindLabel = () => {
    const label=el("span","Find a random match");label.dataset.lanFindLabel="true";return label;
  };
  api.lanFindStatus = () => {
    const label=el("small",findMessage(),"cp-seek-n");
    label.dataset.lanFindStatus="true";label.setAttribute("role","status");return label;
  };
  api.lanCopyInvitation = room => {
    const link=action("Copy room code","copy","btn small blue");
    if(!isCoopRoomCode(room.code,room.connectionMode??"lan")){link.removeAttribute("href");link.setAttribute("aria-disabled","true");}
    return link;
  };
  api.lanJoinField = () => {
    // Reuse the captured online widget's exact tile/input classes and focus
    // styling. Mode-specific characters feed one hidden, native-readable value.
    const length=coopRoomCodeLength(form.connectionMode);
    const group=el("div",null,"cp-tiles in offline-lan-join");
    group.dataset.lanCodeLength=String(length);
    group.style.setProperty("--offline-code-length",String(length));
    group.style.setProperty("--offline-code-width",(length*46+(length-1)*6+6)+"px");
    group.setAttribute("role","group");group.setAttribute("aria-label",length+"-character room code");
    const normalize=text=>String(text??"").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,length);
    const hidden=el("input");hidden.type="hidden";hidden.dataset.lanField="invitation";
    const initial=normalize(form.invitation);
    const boxes=Array.from({length},(_,index)=>{
      const input=el("input");input.type="text";input.maxLength=1;input.value=initial[index]??"";
      input.autocomplete="off";input.spellcheck=false;input.inputMode="text";input.lang="en";
      input.setAttribute("autocapitalize","characters");input.setAttribute("autocorrect","off");
      input.setAttribute("enterkeyhint",index===length-1?"go":"next");
      input.setAttribute("aria-label","Room code character "+(index+1)+" of "+length);
      return input;
    });
    const commit=()=>{hidden.value=boxes.map(input=>input.value).join("");form.invitation=hidden.value;};
    const focus=index=>{boxes[index].focus();boxes[index].select();};
    const put=(text,index)=>{
      const characters=normalize(text);
      for(const character of characters){if(index===boxes.length)break;boxes[index++].value=character;}
      commit();if(characters)focus(Math.min(boxes.length-1,index));
    };
    boxes.forEach((input,index)=>{
      let composing=false;
      const edit=event=>{
        if(composing||event?.isComposing)return;
        const text=input.value;input.value="";
        if(text)put(text,index);else commit();
      };
      input.addEventListener("focus",()=>input.select());
      input.addEventListener("compositionstart",()=>{composing=true;});
      input.addEventListener("compositionend",()=>{composing=false;edit();});
      input.addEventListener("input",edit);
      input.addEventListener("keydown",event=>{
        if(event.key==="Backspace"&&!input.value&&index>0){
          event.preventDefault();boxes[index-1].value="";commit();focus(index-1);
        }else if(event.key==="ArrowLeft"&&index>0){
          event.preventDefault();focus(index-1);
        }else if(event.key==="ArrowRight"&&index<boxes.length-1){
          event.preventDefault();focus(index+1);
        }else if(event.key==="Enter"&&hidden.value.length===boxes.length){
          // Keep native commands gesture-validated. Focus Join instead of
          // issuing a synthetic click that the trusted shells must reject.
          event.preventDefault();
          group.closest(".offline-lan-home,.offline-lan-card")?.querySelector('[data-standard-lan-action="join"]')?.focus();
        }
      });
      input.addEventListener("paste",event=>{
        const text=event.clipboardData?.getData("text")??"";
        if(!text)return;
        event.preventDefault();for(const box of boxes)box.value="";put(text,0);
      });
    });
    commit();group.append(hidden,...boxes);return group;
  };
  const pickerFields = app => {
    const fields=el("div");fields.hidden=true;
    const mode=el("input");mode.type="hidden";mode.dataset.lanField="connection-mode";mode.value=form.connectionMode;
    const destination=el("input");destination.type="hidden";destination.dataset.lanField="destination";destination.value=form.destination??"";
    fields.append(defaultPick(app),mode,destination);
    return fields;
  };
  const renderRoomPicker = () => {
    if(!roomPicker?.overlay.isConnected)return;
    const s=state();
    if(s.roomListing&&["ready","empty"].includes(s.roomListing.status))roomPicker.lastListing=s.roomListing;
    const listing=s.roomListing??(s.phase==="error"?roomPicker.lastListing??{status:"error",rooms:[]}:{status:"loading",rooms:[]});
    if(active(s)){roomPicker.close();return;}
    const body=roomPicker.body;
    const loading=listing.status==="loading",joining=s.phase==="connecting";
    roomPicker.refresh.setAttribute("aria-disabled",String(loading||joining));
    if(loading||joining)roomPicker.refresh.removeAttribute("href");
    else roomPicker.refresh.href="/__native__/lan/browse";
    body.replaceChildren();
    if(joining||loading){
      const pending=el("div",null,"offline-lan-room-empty");
      const spinner=el("span",null,"offline-lan-room-spinner");spinner.setAttribute("aria-hidden","true");
      pending.setAttribute("role","status");
      pending.append(spinner,el("b",joining?"Connecting to the room…":"Looking for available rooms…"),
        el("p",joining?"Wait for the direct peer connection to finish.":"Only compatible rooms for this connection mode are shown.","muted"));
      body.append(pending);return;
    }
    const rooms=(Array.isArray(listing.rooms)?listing.rooms:[]).slice(0,32).filter(room=>
      room&&isCoopRoomCode(room.code,form.connectionMode)&&typeof room.name==="string"&&room.name.length<=24&&
      Number.isInteger(room.players)&&room.players>=1&&room.players<4);
    if(s.error)body.append(el("p",s.error,"err lan-notice"));
    if(listing.message)body.append(el("p",listing.message,"lan-notice"));
    const caption=el("div",null,"offline-lan-room-summary");
    const mode=COOP_CONNECTION_MODES.find(entry=>entry.value===form.connectionMode)?.title??"LAN";
    caption.append(el("b",rooms.length+" available room"+(rooms.length===1?"":"s")),el("span",mode,"offline-lan-room-mode"));
    body.append(caption);
    if(!rooms.length){
      const empty=el("div",null,"offline-lan-room-empty");
      const art=el("img",null,"offline-lan-dialog-icon");art.src="assets/ui/icons/friends.png";art.alt="";
      empty.setAttribute("role","status");
      empty.append(art,el("b",listing.status==="error"?"Couldn’t load rooms":"No rooms available yet"),
        el("p",listing.status==="error"?"Check your connection and press Refresh. You can keep playing offline.":
          form.connectionMode==="lan"?"Ask a friend to host on your Wi-Fi or hotspot, then refresh.":
            "Ask a friend to host with the same app build and connection mode, then refresh.","muted"));
      body.append(empty);return;
    }
    const list=el("div",null,"offline-lan-room-list");list.setAttribute("role","list");
    for(const room of rooms){
      const row=el("div",null,"offline-lan-room-row");row.setAttribute("role","listitem");
      const selection=coopSettings(room.settings);
      const daily=selection.tier===6?globalThis.PokeBonkNativeApp?.backend?.modes.dailyMutation?.(room.rulesAt):null;
      const biome=daily?.biome??selection.biome;
      const art=el("img",null,"offline-lan-room-art");
      art.src=selection.tier===4?"assets/ui/exp/hero-"+biome+".jpg":"assets/ui/maps/"+biome+".webp";art.alt="";
      const details=el("div",null,"offline-lan-room-details");
      const heading=el("div",null,"offline-lan-room-heading");
      heading.append(el("b",room.name||"Trainer"),el("span",room.players+"/"+(room.capacity??4)+" trainers","offline-lan-room-count"));
      const mode=({3:"Survival",4:"Expedition",5:"Relay",6:daily?.mutation.name??"Daily Mutation",7:"Boss Rush"})[selection.tier]??"Classic";
      details.append(heading,el("small",mode+" · "+BIOME_NAMES[biome]+(selection.tier<3?" · "+["Normal","Hard","Nightmare"][selection.tier]:""),"muted"),el("code",room.code,"offline-lan-room-id"));
      const join=action("Join","join","btn blue offline-lan-room-join");
      join.href="/__native__/lan/join/"+room.code;join.dataset.lanRoomCode=room.code;
      join.setAttribute("aria-label","Join "+(room.name||"Trainer")+" · "+room.code);
      row.append(art,details,join);list.append(row);
    }
    body.append(list,el("small","Open rooms only · same app build · no connection until you choose Join.","muted"));
  };
  api.lanPickRooms = () => {
    if(roomPicker?.overlay.isConnected)return;
    const picker=modal("Pick Rooms",()=>{
      roomPicker=null;
      const s=state();
      if(!active(s)&&s.phase!=="connecting")api.cancelLanSearch();
    });
    roomPicker=picker;
    picker.panel.classList.add("offline-player-card","offline-lan-card","offline-lan-rooms");
    const top=el("div",null,"offline-lan-room-toolbar");
    top.append(el("p",form.connectionMode==="lan"?"Choose a room on your local network.":"Choose a compatible Internet room.","muted"));
    picker.refresh=action("Refresh","browse","btn small ghost");
    top.append(picker.refresh);
    picker.body=el("div",null,"offline-lan-room-body");
    picker.panel.append(pickerFields(globalThis.PokeBonkNativeApp),top,picker.body);
    renderRoomPicker();
  };
  api.lanPickRoomsButton = () => {
    const link=action("Pick Rooms","browse","btn blue offline-lan-pick-rooms");
    link.addEventListener("click",event=>{
      if(event.isTrusted&&link.getAttribute("aria-disabled")!=="true")api.lanPickRooms();
    });
    return link;
  };
  api.lanHomeTools = (app,{destination=""}={}) => {
    form.destination=destination;
    const group=el("div",null,"offline-lan-fields");
    group.append(defaultPick(app));
    const selected=el("input");selected.type="hidden";selected.dataset.lanField="destination";selected.value=destination;group.append(selected);
    group.append(modeField(),networkField("Host on this network"));
    return group;
  };
  api.expeditionHomeTools=(app,map)=>api.lanHomeTools(app,{destination:map});
  const networkOptions = () => {
    const list=(state().interfaces??[]).map(network=>({value:network.address,title:network.label,
      subtitle:network.address,icon:"globe",group:"Local networks"}));
    return list.length?list:[{value:"",title:"No private network",subtitle:"Connect to Wi-Fi or a hotspot",icon:"globe",disabled:true}];
  };
  function modeField({locked=false,value=form.connectionMode,transport}={}) {
    if(locked){
      const mode=COOP_CONNECTION_MODES.find(option=>option.value===coopConnectionMode(value));
      const label=el("b",mode.title,"offline-lan-connection");
      label.dataset.lanConnection="true";
      label.setAttribute("aria-label","Connection: "+mode.title);
      label.title=coopRouteMessage(transport??(value==="lan"?"lan":"waiting"));
      return label;
    }
    const wrap=el("div",null,"lan-field offline-lan-mode");
    wrap.append(el("span","Connection"));
    const input=el("input");input.type="hidden";input.dataset.lanField="connection-mode";
    input.value=coopConnectionMode(value);
    const picker=createScopeDropdown({label:"Co-op connection mode",value:input.value,
      options:COOP_CONNECTION_MODES.map(option=>({...option,
        ...(option.value==="turn-fallback"&&internetReady()&&state().capabilities?.relayReady!==true?{subtitle:"Direct first · relay currently disabled"}:{})})),
      onChange:next=>{
        const previousLength=coopRoomCodeLength(form.connectionMode);
        form.connectionMode=coopConnectionMode(next);input.value=form.connectionMode;
        if(coopRoomCodeLength(form.connectionMode)!==previousLength)form.invitation="";
        api.lan?.send?.("cancel-find");
        syncModeControls();
      }});
    wrap.append(input,picker.el);
    return wrap;
  }
  function syncModeControls() {
    const s=state(),lan=form.connectionMode==="lan";
    const length=coopRoomCodeLength(form.connectionMode);
    for(const group of document.querySelectorAll?.(".offline-lan-join")??[])
      if(group.dataset.lanCodeLength!==String(length))group.replaceWith(api.lanJoinField());
    const busy=active(s)||s.phase==="connecting"||["searching","joining"].includes(s.discovery?.status);
    const unfinished=globalThis.PokeBonkNativeApp?.backend?.state;
    for(const root of document.querySelectorAll?.(".offline-lan-home,.offline-lan-card")??[]){
      for(const link of root.querySelectorAll("[data-standard-lan-action]")){
        const action=link.dataset.standardLanAction;
        if(!["host","join","find","browse"].includes(action))continue;
        const disabled=!available()||busy||action==="browse"&&s.roomListing?.status==="loading"||Boolean(unfinished?.activeRun||unfinished?.suspended);
        link.setAttribute("aria-disabled",String(disabled));
        const code=action==="join"&&isCoopRoomCode(link.dataset.lanRoomCode,form.connectionMode)?"/"+link.dataset.lanRoomCode:"";
        if(disabled)link.removeAttribute("href");else link.setAttribute("href","/__native__/lan/"+action+code);
      }
      for(const node of root.querySelectorAll(".offline-lan-mode button"))node.disabled=active(s)||s.phase==="connecting";
      for(const node of root.querySelectorAll(".offline-lan-interface"))node.hidden=!lan;
      const note=root.querySelector("[data-lan-status]");
      if(note)note.textContent=s.error??(s.phase==="connecting"?(lan?"Connecting to the local host…":"Connecting peer links before joining…"):modeMessage());
      const find=root.querySelector("[data-lan-find-status]");
      if(find)find.textContent=findMessage();
      const finder=root.querySelector(".cp-find p");if(finder)finder.textContent=lan?"Automatically join a compatible open room on your Wi-Fi or hotspot.":"Find an open Internet room with a matching build and connection mode.";
      const tag=root.querySelector(".cp-find .cp-beta");if(tag)tag.textContent=lan?"LAN":form.connectionMode==="stun-only"?"STUN":"STUN + TURN";
      const hostLocal="Choose the map, mode and difficulty. Share a code, or turn on Find teammates.";
      const hostOnline=hostLocal;
      for(const text of root.querySelectorAll("h1,h2,h3,b,p,small")){
        if([hostLocal,hostOnline].includes(text.textContent))text.textContent=lan?hostLocal:hostOnline;
        if(["Join a local room","Join an Internet room"].includes(text.textContent))text.textContent=lan?"Join a local room":"Join an Internet room";
        if(text.tagName==="H1"&&["Local co-op","Co-op"].includes(text.textContent))text.textContent="Co-op";
        if(["Offline · 2–4 trainers","LAN · 2–4 trainers","Internet · 2–4 trainers"].includes(text.textContent))
          text.textContent=lan?"LAN · 2–4 trainers":"Internet · 2–4 trainers";
      }
      for(const heading of root.querySelectorAll(".cp-pane-head b,.cp-pane-head h2")){
        if(["On your local network","On the Internet"].includes(heading.textContent))heading.textContent=lan?"On your local network":"On the Internet";
        if(["Play together locally","Play together online"].includes(heading.textContent))heading.textContent=lan?"Play together locally":"Play together online";
      }
      const help=root.querySelector(".offline-lan-help");
      if(help){
        help.querySelector("h2").textContent=lan?"One network. One adventure.":"One team. Across networks.";
        help.querySelector("[data-lan-help=intro]").textContent=lan?"Connect every device to the same private Wi-Fi or local hotspot. Internet is not required.":
          "Internet co-op uses the room service to find compatible players. Gameplay uses peer data channels.";
        help.querySelector("[data-lan-help=host]").textContent=lan?"Choose your local network, create a room and share its 4-character code.":
          "Choose the same connection mode on every device, then create a room and share its 6-character code.";
        help.querySelector("[data-lan-help=join]").textContent="Enter the "+length+"-character room code, choose a room in Pick Rooms, or use Find a random match.";
        help.querySelector("[data-lan-help=network]").textContent=lan?
          "The host selects the map and mode. Keep the host open; isolated Wi-Fi or VPNs may block direct connections.":
          "The host selects the map and mode. Keep the host open. STUN-only can fail on restrictive networks; it never uses TURN.";
        help.querySelector("[data-lan-help=permissions]").textContent=lan?
          "Allow Local Network access or the app’s private-network firewall prompt if your system asks. Do not open ports on your router.":
          "No online game account is required. TURN fallback remains subject to service availability and budget controls.";
      }
    }
  }
  function networkField(title) {
    const wrap=el("div",null,"lan-field offline-lan-interface");wrap.append(el("span",title));
    wrap.hidden=form.connectionMode!=="lan";
    networkValue=el("input");networkValue.type="hidden";networkValue.dataset.lanField="address";
    networkPicker=createScopeDropdown({label:"Local network",value:form.address,options:networkOptions(),
      onChange:value=>{form.address=value;networkValue.value=value;}});
    networkValue.value=networkPicker.value;form.address=networkPicker.value;
    wrap.append(networkValue,networkPicker.el);return wrap;
  }
  api.lanConnectionHelp = app => {
    const pane=el("section",null,"panel cp-pane cp-center offline-lan-help");
    const header=el("header",null,"cp-pane-head");header.append(el("b","Play together locally"),el("small","2–4 trainers"));
    const body=el("div",null,"cp-pane-body scroll"),art=el("img",null,"offline-lan-map");
    art.src="assets/ui/maps/forest.webp";art.alt="Viridian Forest";
    const helpText=(key,text,cls)=>{const p=el("p",text,cls);p.dataset.lanHelp=key;return p;};
    body.append(art,el("h2","One network. One adventure."),
      helpText("intro","Connect every device to the same private Wi-Fi or local hotspot. Internet is not required."),
      el("b","1 · Host"),helpText("host","Choose your local network, create a room and share its 4-character code."),
      el("b","2 · Join"),helpText("join","Enter the 4-character room code, choose a room in Pick Rooms, or use Find a random match."),
      el("b","3 · Choose & ready up"),el("p","Change your Pokémon in the room. Wait for direct peer connections, choose Ready, then let the host start. Each trainer keeps their own earned progress."),
      helpText("network","Keep the host open. Turn on Find teammates for random matching and Pick Rooms; otherwise share the room code.","lan-notice"),
      helpText("permissions","Allow Local Network access or the app’s private-network firewall prompt if your system asks. Do not open ports on your router.","muted"));
    const status=el("p",state().error??modeMessage(),"lan-notice");status.dataset.lanStatus="true";status.setAttribute("role","status");
    if(!api.lan)status.textContent="This browser has no native LAN bridge. Open the new local app to Host or Join.";
    if(app.backend.state?.activeRun||app.backend.state?.suspended)body.append(el("p","Your unfinished run is preserved. Finish it or explicitly end it in Player & saves before hosting or joining.","lan-notice"));
    body.append(status);pane.append(header,body);return pane;
  };
  function render() {
    if (!current?.overlay.isConnected) return;
    const s = state(), app = globalThis.PokeBonkNativeApp;
    if (active(s) && globalThis.PokeBonkOpenLocalRoom) { showRoom(s); return; }
    const body = current.body;
    if (document.activeElement?.closest?.(".offline-lan-card")) {
      const node = document.activeElement;
      if (node.dataset.lanField === "invitation") form.invitation = node.value;
    }
    body.replaceChildren();
    const intro = el("div", null, "lan-intro");
    intro.append(el("span",form.connectionMode==="lan"?"LOCAL CO-OP":"INTERNET CO-OP","lan-kicker"),
      el("h3",form.connectionMode==="lan"?"Adventure together. No internet needed.":"Adventure together. Across networks."),
      el("p", "2–4 players · five co-op modes.", "muted"));
    body.append(intro);
    const unavailable = s.phase === "unavailable";
    const busySave = app?.backend?.state?.activeRun || app?.backend?.state?.suspended;
    if (unavailable) body.append(
      el("p", "LAN connections are not available in this build yet. You can preview the four-player room without starting or replacing a run.", "lan-notice"),
      button("Preview four-player room", () => api.localCoopPreview(app), "btn blue"));
    if (busySave && !app?.backend?.state?.activeRun?.ticket?.lan) {
      body.append(el("p", "Your unfinished run is preserved. Complete it—or explicitly end it in Player & saves—before joining a co-op game.", "lan-notice"));
    }
    if (!active(s)) {
      const tabs = el("nav", null, "lan-tabs");
      tabs.setAttribute("role", "tablist");
      for (const [key, text] of [["host", "Host a game"], ["join", "Join a game"]]) {
        const tab = button(text, () => { form.tab = key; render(); }, "btn" + (form.tab === key ? " blue" : " ghost"));
        tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(form.tab === key)); tabs.append(tab);
      }
      body.append(tabs);
      const field = (label, node, name) => {
        if(!node.querySelector?.('[data-lan-field="'+name+'"]'))node.dataset.lanField = name;
        node.setAttribute("aria-label", label);
        const wrapper = el("label", null, "lan-field"); wrapper.append(el("span", label), node); body.append(wrapper);
      };
      body.append(defaultPick(app),modeField());
      if (form.tab === "host") {
        body.append(networkField("Host on this network"));
        body.append(el("p", "This device hosts the lobby. Keep the host app open and in the foreground while playing.", "lan-help"));
      } else {
        field("Room code", api.lanJoinField(), "invitation");
        body.append(el("p", "Ask the host for the "+coopRoomCodeLength(form.connectionMode)+"-character code. Use the same app build and connection mode.", "lan-help"));
      }
      const go = action(form.tab === "host" ? "Create local lobby" : "Connect to host", form.tab);
      if (unavailable || busySave || !available() || form.connectionMode==="lan"&&form.tab === "host" && !s.interfaces?.length) {
        go.removeAttribute("href"); go.setAttribute("aria-disabled", "true");
      }
      body.append(go,api.lanPickRoomsButton());
    }
    if (s.error) body.append(el("p", s.error, "err lan-notice"));
    if(form.connectionMode!=="lan")body.append(el("p",modeMessage(),"lan-notice"));
    body.append(el("p","Local profiles · no game accounts or leaderboards. LAN never uses STUN/TURN.","lan-footer"));
  }
  api.localCoop = () => {
    const s = state();
    if (active(s) && globalThis.PokeBonkOpenLocalRoom) { showRoom(s); return; }
    if(globalThis.PokeBonkOpenLanHome){current?.close();globalThis.PokeBonkOpenLanHome(globalThis.PokeBonkNativeApp);syncModeControls();api.lan?.send?.("refresh");return;}
    if (current?.overlay.isConnected) return;
    current = modal("Local co-op");
    current.panel.classList.add("offline-player-card", "offline-lan-card");
    current.panel.querySelector(".offline-card-head button").textContent = "Hide";
    current.body = el("div", null, "offline-player-body lan-body");
    current.panel.append(current.body); render();syncModeControls();
  };
  api.localCoopPreview = (app = globalThis.PokeBonkNativeApp) => {
    const profile = app?.meta?.profile;
    const species = profile?.league?.includes(profile.lastSpecies) ? profile.lastSpecies : profile?.league?.[0];
    if (!species || !globalThis.PokeBonkOpenLocalRoom) {
      app?.notice("Choose your first Pokémon before opening the room preview."); return;
    }
    if (app.run) { app.notice("Return to the homepage to preview the room."); return; }
    current?.close();
    const sample = {preview: true, phase: "lobby", role: "host", me: "preview-self",
      code:form.connectionMode==="lan"?"BONK":"BONK23",connectionMode:form.connectionMode,linked: false,rulesAt:Date.now(),
      members: [{id: "preview-self", slot: 0, name: profile.name, species, ready: false}]};
    lobby = new LanLobby(sample, (channel, data) => {
      if (channel === "room-pick" && profile.league.includes(data)) {
        sample.members[0].species = data; lobby.update(sample);
      }
      // Deliberately no native bridge and no game/save operations.
    });
    globalThis.PokeBonkOpenLocalRoom(app, lobby);
  };
  document.addEventListener("standard:lan-state", () => {
    if (!lobby?.preview) lobby?.update(state());
    const s=state(),home=document.querySelector(".offline-lan-home");
    if(!globalThis.PokeBonkNativeApp?.run&&s.settings?.tier===4&&document.querySelector(".screen.cp.lobby")){
      showRoom(s);return;
    }
    renderRoomPicker();
    for(const label of document.querySelectorAll?.(".offline-lan-room [data-lan-connection]")??[])
      label.title=coopRouteMessage(s.transport??(s.connectionMode==="lan"?"lan":"waiting"));
    if(home){
      if(active(s)&&!globalThis.PokeBonkNativeApp?.run){showRoom(s);return;}
      home.classList.toggle("lan-busy",s.phase==="connecting");
      const note=home.querySelector("[data-lan-status]");
      if(note)note.textContent=s.error??(s.phase==="connecting"?"Connecting to the local host…": "No room joined yet.");
      const search=s.discovery??{},finding=["searching","joining"].includes(search.status);
      const status=home.querySelector("[data-lan-find-status]");
      if(status)status.textContent=findMessage();
      const find=home.querySelector('[data-standard-lan-action="find"]');
      if(find){
        find.setAttribute("aria-busy",String(finding));find.setAttribute("aria-disabled",String(finding));
        if(finding)find.removeAttribute("href");else find.setAttribute("href","/__native__/lan/find");
        find.classList.toggle("lan-searching",finding);
        const label=find.querySelector("[data-lan-find-label]");if(label)label.textContent=finding?"Searching…":"Find a random match";
      }
      const cancel=home.querySelector(".offline-lan-cancel-find");
      if(cancel)cancel.hidden=!finding;
      for(const link of home.querySelectorAll('[data-standard-lan-action="host"],[data-standard-lan-action="join"]')){
        link.setAttribute("aria-disabled",String(finding));
        if(finding)link.removeAttribute("href");else link.setAttribute("href","/__native__/lan/"+link.dataset.standardLanAction);
      }
      if(networkPicker?.el.isConnected){
        networkPicker.setOptions(networkOptions(),form.address);
        networkValue.value=networkPicker.value;form.address=networkPicker.value;
      }
    }
    render();syncModeControls();
  });
  document.addEventListener("standard:lan-launch", () => current?.close());
}
