// Source-server design fixture ONLY. No requests, native bridge or real saves.
// The preview server exports its own copy of the game's modal helpers in memory.
import {previewModal as modal, previewEl as el, previewButton as button} from "./ui.js";
import {createCloudSaveUI} from "./cloud-ui.js";

export function installCloudSavePreview(app, config) {
  let state = "off", automatic = false;
  const local = {name:"Preview Trainer",usable:18,stardust:12450,savedLabel:"Just now · this Mac"};
  const remote = {name:"Preview Trainer",usable:20,stardust:10900,savedLabel:"10 min ago · Android"};
  const value = () => ({state,connected:!["off","connecting"].includes(state),automatic,
    sessionOnly:document.documentElement.dataset.standardPlatform==="darwin",
    accountLabel:"Sample account · Preview Trainer",lastSyncedLabel:"2 min ago",
    local,cloud:state==="conflict"?remote:{...local,savedLabel:"2 min ago · this Mac"}});
  const ui = createCloudSaveUI({modal,el,button,config,preview:true,action(command){
    if(command==="review-local")return ui.confirm("keep-local");
    if(command==="review-cloud")return ui.confirm("use-cloud");
    if(command==="confirm-disconnect")return ui.confirm("disconnect");
    if(command==="auto-on"||command==="auto-off"){automatic=command==="auto-on";return;}
    if(command==="connect")state="connecting";
    else if(command==="cancel"||command==="disconnect")state="off";
    else if(command==="sync"||command==="confirm-local"||command==="confirm-cloud")state="synced";
    else if(command==="backups"){
      const {panel,close}=modal("Cloud backups");
      panel.classList.add("offline-player-card","offline-cloud-card");
      const body=el("div",null,"offline-player-body offline-cloud-body");
      body.append(el("h3","Restore a previous save"),el("p","Sample history only. A real restore will validate the selected version, ask for confirmation and keep a local recovery copy."));
      for(const [when,label]of [["2 min ago","18 usable Pokémon · 12,450 Stardust"],
        ["Yesterday","17 usable Pokémon · 11,800 Stardust"]]){
        const row=el("section",null,"offline-cloud-account");row.style.marginBottom="10px";
        const text=el("div");text.append(el("strong",when),el("span",label));
        row.append(text,button("Review",()=>{close();ui.confirm("use-cloud");},"btn ghost small"));
        body.append(row);
      }
      body.append(el("small","DESIGN PREVIEW · no cloud data exists","offline-cloud-preview-label"));panel.append(body);return;
    }
    ui.open(value());
  }});
  const previous=document.getElementById("offline-cloud-preview-controls");
  previous?.remove();
  const controls=el("div");controls.id="offline-cloud-preview-controls";
  Object.assign(controls.style,{position:"fixed",bottom:"24px",right:"12px",zIndex:"50001",
    display:"flex",flexWrap:"wrap",gap:"6px"});
  for(const [label,next]of [["Player & saves","profile"],["Cloud off","off"],
    ["Connected","synced"],["Conflict","conflict"]]){
    controls.append(button(label,()=>{
      if(next==="profile"){
        ui.close();globalThis.PokeBonkOfflineUI.profile(app);
        const body=document.querySelector(".offline-player-body");
        if(body&&!body.querySelector(".offline-cloud-entry")){
          body.querySelector("p").textContent="Your trainer, backups and optional cloud saves. No account is required to play.";
          body.insertBefore(ui.entry(value()),body.querySelector(".offline-player-updates"));
        }
        return;
      }
      document.querySelectorAll(".offline-player-card:not(.offline-cloud-card)").forEach(node=>node.closest(".offline-modal")?.remove());
      state=next;ui.open(value());
    },"btn small ghost"));
  }
  document.body.append(controls);
  globalThis.PokeBonkOfflineUI.profile(app);
  const body=document.querySelector(".offline-player-body");
  body.querySelector("p").textContent="Your trainer, backups and optional cloud saves. No account is required to play.";
  const existing=body.querySelector(".offline-cloud-entry");
  if(existing)existing.replaceWith(ui.entry(value()));
  else body.insertBefore(ui.entry(value()),body.querySelector(".offline-player-updates"));
}
