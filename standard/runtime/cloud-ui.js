// Presentation only. Native hosts own sign-in, private networking and restores.
import {cloudFeedbackView,unavailableCloudFeedback} from "../common/cloud-feedback.mjs";
export function createCloudSaveUI({modal,el,button,action,config,preview=false,openControl,commandControl}){
  let current,latest=unavailableCloudFeedback();const entries=new Map();
  const number=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():"—";
  const note=(text,cls="")=>el("p",text,"offline-cloud-note "+cls);
  const pill=(text,on=false)=>el("span",text,"offline-cloud-pill"+(on?" on":""));
  const btn=(label,command,style="btn blue",selection)=>commandControl?
    commandControl(label,command,style,selection):button(label,()=>action(command,selection),style);
  function icon(){
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 32 32");svg.setAttribute("class","offline-cloud-icon");svg.setAttribute("aria-hidden","true");
    const path=document.createElementNS(svg.namespaceURI,"path");
    path.setAttribute("d","M9 24H8a6 6 0 0 1-1-12 9 9 0 0 1 17-1 6.5 6.5 0 0 1 0 13h-1M16 27V15m-4 4 4-4 4 4");
    for(const [key,value]of Object.entries({fill:"none",stroke:"currentColor","stroke-width":"2.2","stroke-linecap":"round","stroke-linejoin":"round"}))path.setAttribute(key,value);
    svg.append(path);return svg;
  }
  function mount(title,state){
    current?.close();const dialog=modal(title,()=>{if(current===dialog)current=null;});current=dialog;
    dialog.panel.classList.add("offline-player-card","offline-cloud-card");dialog.panel.dataset.cloudState=state;
    const body=el("div",null,"offline-player-body offline-cloud-body");dialog.panel.append(body);return {...dialog,body};
  }
  function footer(body){
    body.append(note("Graphics, audio, touch controls and other device settings stay on this device."));
    if(preview)body.append(el("small","DESIGN PREVIEW · sample data · no account or cloud service connected","offline-cloud-preview-label"));
  }
  function summary(title,save,kind){
    const card=el("section",null,"offline-cloud-save "+kind),rows=el("dl");
    card.append(el("h4",title),el("strong",save?.name??"No cloud backup yet"));
    for(const [label,value]of [["Usable Pokémon",number(save?.usable)],["Stardust",number(save?.stardust)],["Saved",save?.savedLabel??"—"]]){
      const row=el("div");row.append(el("dt",label),el("dd",value));rows.append(row);
    }
    card.append(rows);return card;
  }
  function compare(body,value){
    const saves=el("div",null,"offline-cloud-compare");
    saves.append(summary("THIS DEVICE",value.local,"local"),summary("CLOUD SAVE",value.cloud,"remote"));body.append(saves);
  }
  const reasons={
    unfinished_run:"Finish your active or suspended run on this device first. Unfinished runs stay device-local.",
    pending_expedition_returns:"Complete outstanding Expedition item returns on this device before syncing.",
    cloud_save_too_large:"This save exceeds the cloud size limit. Local saves and JSON export still work.",
    room_active:"Return to the homepage and leave your co-op room before syncing.",no_local_save:"Choose your starters and create your local save first.",
    secure_storage_unavailable:"Protected OS credential storage is unavailable. No account token was saved in plaintext. Local play still works.",
    sign_in_required:"Reconnect your account before syncing. Your local progress and cloud backups are unchanged.",
    unauthorized:"Your sign-in expired or was revoked. Reconnect the same account to continue.",
    login_expired:"Sign-in timed out. Connect again when ready; no local progress changed.",
    browser_return_unavailable:"The temporary local sign-in callback could not start. Try connecting again. Local play still works.",
    local_changed:"This device saved new progress during the review. Nothing was replaced—review the saves again.",
    account_capacity:"The private service has reached its configured account limit. Local play is unaffected.",
    rate_limited:"The service is receiving too many requests. Wait a moment and try again.",
  };
  function open(input=latest){
    if(globalThis.PokeBonkNativeApp?.run)return false;
    const value=cloudFeedbackView(input);if(!value)return false;latest=value;
    if(["confirm-upload","confirm-restore"].includes(value.state))return confirm(value.state==="confirm-upload"?"keep-local":"use-cloud");
    const {body,close}=mount("Cloud saves",value.state),state=value.state;
    const titles={off:"Your progress. Your devices.",unavailable:"Cloud service setup required",connecting:"Finish signing in",
      connected:"Account connected",checking:"Checking your cloud save…",syncing:"Syncing completed progress…",synced:"Your progress is backed up",
      conflict:"Two different saves",review:"Choose your completed progress",backups:"Your cloud save history",blocked:"Finish here before syncing",
      offline:"Saved here. Sync later.",error:"Couldn’t sync right now"};
    const descriptions={off:"Entirely optional. Connect once to carry progress between macOS, Windows, Linux and Android.",
      unavailable:"This build has no configured private cloud endpoint. Local saving works normally. Sign-in and storage must be configured before syncing.",
      connecting:value.reason==="retrying_sign_in"?"Your sign-in is still in progress. A temporary connection problem is being retried—keep this attempt open.":
        "Use your browser to sign in with Google. Never enter your password inside the game.",
      connected:"Use the same account on your other devices. Connecting alone does not upload or restore a save.",
      checking:"Checking the cloud revision without replacing either save.",syncing:"Local saves stay on. Sync failures never prevent offline play.",
      synced:"Continue on another platform with the same connected account.",
      conflict:"Both devices have progress the other one doesn’t. Nothing has been replaced.",
      review:"Review both copies. Replacing either branch requires your confirmation.",
      backups:"Review a previous completed save. A restore keeps a local recovery copy first.",
      blocked:reasons[value.reason]??"Complete the local save safely before syncing. No progress has been replaced.",
      offline:"Your local save is safe. Try again online when you’re back at the homepage.",
      error:reasons[value.reason]??"The cloud response could not be reached or verified. Your local progress is unchanged."};
    const hero=el("div",null,"offline-cloud-hero"),symbol=el("span",null,"offline-cloud-symbol"),words=el("div");symbol.append(icon());
    words.append(el("h3",titles[state]),el("p",descriptions[state]));hero.append(symbol,words);
    const status=el("div",null,"offline-cloud-status"),label=state==="off"?"OFF":state==="unavailable"?"SETUP REQUIRED":
      state==="conflict"||state==="review"?"NEEDS YOUR CHOICE":state==="blocked"?"LOCAL SAVE PRESERVED":state==="offline"?"WAITING FOR INTERNET":
      ["connecting","checking","syncing"].includes(state)?"IN PROGRESS":state==="error"?"RETRY LATER":"CONNECTED";
    status.append(pill(label,state==="synced"),el("span","Optional · local saves always stay on","offline-cloud-status-text"));body.append(hero,status);
    if(value.sessionOnly)body.append(note("This Mac stays signed in only while the app is open. No cloud login token is saved to disk or Keychain. Connect again after fully quitting; local game progress stays saved.","offline-cloud-warning offline-cloud-session-note"));
    if(["error","offline"].includes(state)&&value.reason)body.append(note("Reference: "+value.reason+". No password, token or save is included in this reference."));
    if(state==="off"||state==="unavailable"){
      const benefits=el("div",null,"offline-cloud-benefits");
      for(const [title,text]of [["Play on any platform","One account for desktop, phone and tablet."],["Local saves first","Cloud outages never stop the game."],["Choose conflicts safely","Never add balances or inventories together."]]){
        const row=el("div"),textBox=el("div");textBox.append(el("strong",title),el("span",text));row.append(el("i","✓"),textBox);benefits.append(row);
      }
      const consent=el("div",null,"offline-cloud-consent");consent.append(el("strong","You’re in control"),el("span",
        state==="off"?"Google identifies your account only—no Google Drive access. Connect starts sign-in; automatic syncing stays off until you enable it.":
        "No account is connected and no save has been uploaded. Until setup is complete, use Export / Import save backup to move progress."));
      const actions=el("div",null,"offline-cloud-actions");
      if(state==="off")actions.append(button("Keep playing offline",close,"btn ghost"),btn("Connect account","connect"));
      else actions.append(button("Back to Player & saves",()=>{close();action("profile");},"btn blue"),button("Keep playing offline",close,"btn ghost"));
      body.append(benefits,consent);
      if(state==="off")body.append(note("Completed progress is stored in this project’s private Cloudflare service. The operator can access backups; this is not end-to-end encrypted. Up to 10 versions are kept, with a 512 KB cloud-save limit."));
      body.append(actions);
    }else if(state==="connecting"){
      if(value.loginCode)body.append(note("Compare device code "+value.loginCode+" with the code in your browser before approving.","offline-cloud-warning"));
      const actions=el("div",null,"offline-cloud-actions");actions.append(btn("Cancel sign-in","cancel","btn ghost"));body.append(actions);
    }else if(state==="conflict"||state==="review"){
      compare(body,value);body.append(note("A newer timestamp doesn’t always mean more progress. Choose one whole save—never combine Stardust, inventory or reward claims.","offline-cloud-warning"));
      const actions=el("div",null,"offline-cloud-actions offline-cloud-conflict-actions");
      actions.append(btn("Use this device","review-local"));
      if(value.cloud)actions.append(btn("Use cloud save","review-cloud","btn green"));
      actions.append(button("Decide later",close,"btn ghost"));body.append(actions);
    }else if(state==="backups"){
      const list=el("div",null,"offline-cloud-history");
      if(!value.backups?.length)list.append(note("There are no cloud backups yet."));
      for(const item of value.backups??[]){
        const row=el("section",null,"offline-cloud-account"),words=el("div");
        words.append(el("strong",new Date(item.createdAt).toLocaleString()),el("span",`${item.summary?.name??"Trainer"} · ${number(item.summary?.usable)} Pokémon · ${number(item.summary?.stardust)} Stardust`));
        row.append(words,btn("Review backup","review-backup","btn ghost small",item.revision));list.append(row);
      }
      body.append(list,button("Close history",close,"btn ghost"));
    }else if(value.connected){
      const account=el("div",null,"offline-cloud-account"),words=el("div");
      words.append(el("strong",value.accountLabel??"Connected account"),el("span","Last synced: "+(value.lastSyncedLabel??"Not yet")));
      account.append(words,button("Disconnect",()=>confirm("disconnect"),"btn ghost small"));body.append(account);
      const automatic=el("div",null,"offline-cloud-auto"),text=el("span");
      text.append(el("strong","Automatically sync completed progress"),el("small","Only online at the homepage, after local progress is safely written."));
      const toggle=btn(value.automatic?"On":"Off",value.automatic?"auto-off":"auto-on","pill offline-cloud-auto-control");
      toggle.setAttribute("role","switch");toggle.setAttribute("aria-checked",String(value.automatic));toggle.setAttribute("aria-label","Automatically sync completed progress");
      automatic.append(text,toggle);body.append(automatic);if(value.local||value.cloud)compare(body,value);
      const actions=el("div",null,"offline-cloud-actions");actions.append(btn("Sync now","sync"),btn("Restore a backup","backups","btn ghost"));body.append(actions);
      if(reasons[value.reason])body.append(note(reasons[value.reason],"offline-cloud-warning"));
      body.append(note("Only completed progression syncs. Active runs, co-op connections and unsettled Expedition item returns stay on their original device."));
    }else{
      const actions=el("div",null,"offline-cloud-actions");actions.append(btn("Connect account","connect"),button("Keep playing offline",close,"btn ghost"));body.append(actions);
    }
    footer(body);return true;
  }
  function confirm(kind){
    const restore=kind==="use-cloud",disconnect=kind==="disconnect";
    const {body,close}=mount(disconnect?"Disconnect cloud saves?":restore?"Restore cloud progress?":"Replace the cloud save?","confirmation");
    body.classList.add("offline-cloud-confirm");
    body.append(el("h3",disconnect?"Your local progress stays here.":restore?"This replaces progress on this device.":"This makes this device the cloud copy."),
      el("p",disconnect?"Automatic syncing stops on this device. Your local save and existing cloud backups are kept.":
      restore?"Compatibility is checked and an immutable recovery copy is created before replacement. Device settings are kept. A changed local or cloud save cancels this confirmation.":
      "The previous cloud version stays in backup history. If another device changes the cloud head before this finishes, you must review the saves again."));
    if(!disconnect)compare(body,latest);
    const actions=el("div",null,"offline-cloud-actions");actions.append(button("Cancel",close,"btn ghost"),
      btn(disconnect?"Disconnect":restore?"Restore cloud save":"Use this device",disconnect?"disconnect":restore?"confirm-cloud":"confirm-local","btn "+(restore?"green":"blue")));
    body.append(actions);footer(body);return true;
  }
  function renderEntry(card,value){
    const {status,description,control}=entries.get(card);
    status.textContent=value.state==="unavailable"?"SETUP REQUIRED":value.state==="conflict"?"NEEDS YOUR CHOICE":value.connected?"CONNECTED":"OPTIONAL";
    description.textContent=value.state==="unavailable"?"Optional cross-platform sync · service setup is required. Local backups work now.":
      value.connected?"One account across Mac, Windows, Linux and Android. Local saves stay on.":"Off by default. Carry completed progress between all your devices.";
    control.textContent=value.state==="unavailable"?"Cloud save setup":value.connected?"Manage cloud saves":"Set up cloud saves";
  }
  function entry(value=latest,controlFactory=openControl){
    value=cloudFeedbackView(value)??unavailableCloudFeedback();latest=value;
    for(const [card]of entries)if(!card.isConnected)entries.delete(card);
    const card=el("section",null,"offline-cloud-entry"),info=el("div"),title=el("h3","Cloud saves"),status=pill(""),description=el("p");
    const control=controlFactory?controlFactory():button("Cloud saves",()=>open(latest),"btn blue");
    title.append(status);info.append(title,description);card.append(info,control);entries.set(card,{status,description,control});renderEntry(card,value);return card;
  }
  function update(value,{show=false}={}){
    const safe=cloudFeedbackView(value);if(!safe)return false;latest=safe;
    for(const [card]of entries){if(card.isConnected)renderEntry(card,safe);else entries.delete(card);}
    if(show||current?.overlay.isConnected)return open(safe);return true;
  }
  return {open,confirm,entry,update,close:()=>{if(!current?.overlay.isConnected)return false;current.close();return true;}};
}
