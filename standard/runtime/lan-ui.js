// Host/Join presentation. The native shell owns connections and pairing.
import {LanLobby} from "./lan-lobby.js";
import {createScopeDropdown} from "./dropdown.js";
export function ownedLanSpecies(profile,chosen=0){
  const league=profile?.league??[];
  return league.includes(chosen)?chosen:league.includes(profile?.lastSpecies)?profile.lastSpecies:league[0]??0;
}
export function installLanUI(api, config, {el, button, modal}) {
  let current, lobby, networkPicker, networkValue, form = {tab: "host", invitation: "", address: "", species: 0};
  const state = () => api.lan?.state() ?? {phase: "unavailable", interfaces: [], members: []};
  const active = s => ["hosting", "lobby", "preparing", "playing"].includes(s.phase);
  const showRoom = s => {
    current?.close();
    if (!lobby || lobby.me !== s.me || !lobby.open) {
      lobby?.retire();
      lobby = new LanLobby(s, (channel, data) => api.lan?.send?.(channel, data));
    }
    else lobby.update(s, false);
    globalThis.PokeBonkOpenLocalRoom(globalThis.PokeBonkNativeApp, lobby);
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
    const input = el("textarea", null, "field offline-lan-invitation");
    input.value = room.preview ? "Preview only — no room invitation has been created." :
      room.invitation ?? "Ask the host for their invitation.";
    input.readOnly = true;
    input.rows = 3;
    input.setAttribute("aria-label", "Local room invitation");
    input.addEventListener("click", () => input.select());
    return input;
  };
  api.lanInviteHelp = (container, room) => {
    container.replaceChildren();
    const help = el("div", null, "cp-empty offline-lan-invite-help");
    const image = el("img"); image.src = "assets/ui/icons/friends.png"; image.alt = ""; image.className = "uiicon";
    if (room.preview) {
      help.append(image, el("b", "Four-player room preview"),
        el("span", "You can inspect the original room layout and change your preview Pokémon."),
        el("span", "No lobby is hosted. Join, invites, chat and multiplayer gameplay are not available in this local build yet."),
        el("small", "Planned LAN support: 2–4 players"),
        el("small", "Single-player remains playable. This preview does not change your progress."));
      container.append(help); return;
    }
    help.append(image, el("b", "Invite on your local network"),
      el("span", "Connect both devices to the same private Wi-Fi or local hotspot."),
      el("span", room.invitation ? "Copy the invitation above and paste it in Join a game on the other device." :
        "The host shares the invitation. You do not need an online account."),
      el("small", "2–4 players · Classic · Forest · Normal"),
      el("small", "No public matchmaking · no internet required"));
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
    if(search.status==="searching")return "Searching this network…"+(search.rooms?` ${search.rooms} open room${search.rooms===1?"":"s"} found.`:"");
    if(search.status==="joining")return "Open room found. Connecting…";
    if(search.status==="empty")return "No open compatible rooms found. Create one or use an invitation.";
    if(search.status==="error")return search.message??"Discovery is unavailable. Use an invitation instead.";
    return "Open rooms on this network · 2–4 trainers";
  };
  api.cancelLanSearch = () => api.lan?.send?.("cancel-find");
  api.lanCancelSearch = () => {
    const link=action("Cancel search","cancel-find","btn small ghost offline-lan-cancel-find");
    link.hidden=true;return link;
  };
  api.lanFindLabel = () => {
    const label=el("span","Find a match");label.dataset.lanFindLabel="true";return label;
  };
  api.lanFindStatus = () => {
    const label=el("small",findMessage(),"cp-seek-n");
    label.dataset.lanFindStatus="true";label.setAttribute("role","status");return label;
  };
  api.lanCopyInvitation = room => {
    const link=action("Copy invitation","copy","btn small blue");
    if(!room.invitation){link.removeAttribute("href");link.setAttribute("aria-disabled","true");}
    return link;
  };
  api.lanJoinField = () => {
    const input=el("textarea",null,"field offline-lan-join");
    input.rows=3;input.maxLength=160;input.placeholder="address:port#pairing-key";input.value=form.invitation;
    input.dataset.lanField="invitation";input.setAttribute("aria-label","Host invitation");input.spellcheck=false;input.autocomplete="off";
    input.addEventListener("input",()=>{form.invitation=input.value;});return input;
  };
  api.lanHomeTools = app => {
    const group=el("div",null,"offline-lan-fields");
    group.append(defaultPick(app));
    group.append(networkField("Host on this network"));
    return group;
  };
  const networkOptions = () => {
    const list=(state().interfaces??[]).map(network=>({value:network.address,title:network.label,
      subtitle:network.address,icon:"globe",group:"Local networks"}));
    return list.length?list:[{value:"",title:"No private network",subtitle:"Connect to Wi-Fi or a hotspot",icon:"globe",disabled:true}];
  };
  function networkField(title) {
    const wrap=el("div",null,"lan-field");wrap.append(el("span",title));
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
    body.append(art,el("h2","One network. One adventure."),
      el("p","Connect every device to the same private Wi-Fi or local hotspot. Internet is not required."),
      el("b","1 · Host"),el("p","Choose your local network, create a room and copy its invitation."),
      el("b","2 · Join"),el("p","On each other device, paste the full host invitation and press Join room."),
      el("b","3 · Choose & ready up"),el("p","Change your Pokémon in the room. Wait for direct peer connections, choose Ready, then let the host start. Each trainer keeps their own earned progress."),
      el("p","Classic · Viridian Forest · Normal. Keep the host open. Guest/isolated Wi-Fi and VPNs may prevent direct connections.","lan-notice"),
      el("p","Allow Local Network access or the app’s private-network firewall prompt if your system asks. Do not open ports on your router.","muted"));
    const status=el("p",state().error??"No room joined yet.","lan-notice");status.dataset.lanStatus="true";status.setAttribute("role","status");
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
    intro.append(el("span", "LOCAL CO-OP", "lan-kicker"),
      el("h3", "Adventure together. No internet needed."),
      el("p", "Planned: 2–4 players · Classic · Forest · Normal, on one private Wi-Fi or local hotspot.", "muted"));
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
        node.dataset.lanField = name; node.setAttribute("aria-label", label);
        const wrapper = el("label", null, "lan-field"); wrapper.append(el("span", label), node); body.append(wrapper);
      };
      body.append(defaultPick(app));
      if (form.tab === "host") {
        body.append(networkField("Host on this network"));
        body.append(el("p", "This device hosts the lobby. Keep the host app open and in the foreground while playing.", "lan-help"));
      } else {
        const invite = el("input", null, "field");
        invite.value = form.invitation; invite.placeholder = "Paste the invitation shown on the host";
        invite.maxLength = 160; invite.autocomplete = "off"; invite.spellcheck = false;
        invite.addEventListener("input", () => { form.invitation = invite.value; });
        field("Host invitation", invite, "invitation");
        body.append(el("p", "Invitations contain the host’s local address and a temporary pairing key. Share them only with the person you want to play with.", "lan-help"));
      }
      const go = action(form.tab === "host" ? "Create local lobby" : "Connect to host", form.tab);
      if (unavailable || busySave || form.tab === "host" && !s.interfaces?.length) {
        go.removeAttribute("href"); go.setAttribute("aria-disabled", "true");
      }
      body.append(go);
    }
    if (s.error) body.append(el("p", s.error, "err lan-notice"));
    body.append(el("p", "Local profiles only · no accounts, public rooms or leaderboards. Online STUN/TURN is not used in LAN mode.", "lan-footer"));
  }
  api.localCoop = () => {
    const s = state();
    if (active(s) && globalThis.PokeBonkOpenLocalRoom) { showRoom(s); return; }
    if(globalThis.PokeBonkOpenLanHome){current?.close();globalThis.PokeBonkOpenLanHome(globalThis.PokeBonkNativeApp);api.lan?.send?.("refresh");return;}
    if (current?.overlay.isConnected) return;
    current = modal("Local co-op");
    current.panel.classList.add("offline-player-card", "offline-lan-card");
    current.panel.querySelector(".offline-card-head button").textContent = "Hide";
    current.body = el("div", null, "offline-player-body lan-body");
    current.panel.append(current.body); render();
  };
  api.localCoopPreview = (app = globalThis.PokeBonkNativeApp) => {
    const profile = app?.meta?.profile;
    const species = profile?.league?.includes(profile.lastSpecies) ? profile.lastSpecies : profile?.league?.[0];
    if (!species || !globalThis.PokeBonkOpenLocalRoom) {
      app?.notice("Choose your first Pokémon before opening the room preview."); return;
    }
    if (app.run) { app.notice("Return to the homepage to preview the room."); return; }
    current?.close();
    const sample = {preview: true, phase: "lobby", role: "host", me: "preview-self", code: "PREVIEW", linked: false,
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
        const label=find.querySelector("[data-lan-find-label]");if(label)label.textContent=finding?"Searching…":"Find a match";
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
    render();
  });
  document.addEventListener("standard:lan-launch", () => current?.close());
}
