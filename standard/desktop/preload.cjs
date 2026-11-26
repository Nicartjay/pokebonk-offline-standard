// Sandboxed preload: no paths, URLs, commands, Electron objects or raw IPC.
const {contextBridge, ipcRenderer} = require("electron");
contextBridge.exposeInMainWorld("PokeBonkStandard", Object.freeze({
  loadState: () => ipcRenderer.invoke("standard:load-state"),
  saveState: state => ipcRenderer.invoke("standard:save-state", state),
}));
let lan = {phase:"idle",members:[],interfaces:[],linked:false};
contextBridge.exposeInMainWorld("PokeBonkLAN", Object.freeze({
  state: () => structuredClone(lan),
  send: (channel,data) => {
    if(channel==="voice-volume"){
      if(Number.isInteger(data)&&data>=0&&data<=100)ipcRenderer.send("standard:lan-game",channel,data);
      return;
    }
    if(!["ctl","snap","prepared","failed","leave","refresh","cancel-find","room-ready","room-start","room-pick","room-chat","room-settings","room-seats","room-loadout","room-return"].includes(channel))return;
    const text=JSON.stringify(data??null);
    if(text.length<=48000)ipcRenderer.send("standard:lan-game",channel,data);
  },
}));
ipcRenderer.on("standard:lan-event",(_event,value)=>{
  if(!value||JSON.stringify(value).length>48000)return;
  if(value.type==="state")lan=value.value;
  if(value.type==="voice")lan.voice=value.value;
  const suffix={state:"state",voice:"voice",frame:"frame","peer-closed":"peer-closed",notice:"notice"}[value.type];
  if(suffix)document.dispatchEvent(new CustomEvent("standard:lan-"+suffix,{detail:JSON.stringify(["state","voice"].includes(value.type)?value.value:value)}));
});
// PTT is driven by trusted input in the isolated preload, never a callable
// renderer microphone API. A short broker watchdog expires missing releases.
const voiceHeld=new Set();let voiceHoldTimer,voiceHoldElement,hudGesture,hudClickUntil=0;
function finishHudVoice(cancel=false){
  const gesture=hudGesture;if(!gesture)return;hudGesture=null;
  clearTimeout(gesture.timer);clearInterval(gesture.pulse);hudClickUntil=Date.now()+800;
  if(gesture.holding||performance.now()-gesture.downAt>=280){
    ipcRenderer.send("standard:voice-gesture","hold-end");ipcRenderer.send("standard:voice-hold",false);
  }else if(!cancel)ipcRenderer.send("standard:voice-action","toggle");
}
function beginHudVoice(source,node,immediate=false){
  if(hudGesture||!lan.voice?.enabled||node.getAttribute("aria-disabled")==="true")return;
  const gesture={source,node,holding:false,downAt:performance.now()};hudGesture=gesture;
  const hold=()=>{
    if(hudGesture!==gesture||!node.isConnected||!document.hasFocus())return;
    gesture.holding=true;ipcRenderer.send("standard:voice-gesture","hold-start");
    const pulse=()=>{
      if(hudGesture!==gesture)return;
      if(!node.isConnected||!document.hasFocus()||!lan.voice?.enabled){finishHudVoice(true);return;}
      ipcRenderer.send("standard:voice-hold",true);
    };
    pulse();gesture.pulse=setInterval(pulse,200);
  };
  if(immediate)hold();else gesture.timer=setTimeout(hold,280);
}
function releaseVoice(){
  finishHudVoice(true);
  voiceHeld.clear();voiceHoldElement=null;clearInterval(voiceHoldTimer);voiceHoldTimer=null;
  ipcRenderer.send("standard:voice-hold",false);
}
function pressVoice(source,element){
  if(!lan.voice?.enabled||lan.voice.mode!=="ptt"||lan.voice.microphone!=="ready")return;
  voiceHeld.add(source);if(element)voiceHoldElement=element;
  ipcRenderer.send("standard:voice-hold",true);
  voiceHoldTimer??=setInterval(()=>{
    if(!voiceHeld.size||!document.hasFocus()||!lan.voice?.enabled||lan.voice.mode!=="ptt"||
        voiceHoldElement&&!voiceHoldElement.isConnected){releaseVoice();return;}
    ipcRenderer.send("standard:voice-hold",true);
  },250);
}
document.addEventListener("pointerdown",event=>{
  const mic=event.target.closest?.(".offline-voice-hud a.offline-voice-button");
  if(event.isTrusted&&event.button===0&&mic&&mic.getAttribute("aria-disabled")!=="true"){
    event.preventDefault();event.stopImmediatePropagation();
    beginHudVoice("pointer:"+event.pointerId,mic);
    try{mic.setPointerCapture(event.pointerId);}catch{}return;
  }
  const hold=event.target.closest?.("button.offline-voice-hold");
  if(!event.isTrusted||event.button!==0||!hold||hold.disabled||!hold.closest(".offline-voice-controls"))return;
  event.preventDefault();event.stopImmediatePropagation();
  pressVoice("pointer",hold);try{hold.setPointerCapture(event.pointerId);}catch{}
},true);
for(const name of ["pointerup","pointercancel","lostpointercapture"])window.addEventListener(name,event=>{
  if(event.isTrusted&&hudGesture?.source==="pointer:"+event.pointerId){
    const bounds=hudGesture.node.getBoundingClientRect();
    const outside=event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom;
    finishHudVoice(name!=="pointerup"||outside);return;
  }
  if(!event.isTrusted||!voiceHeld.has("pointer"))return;
  voiceHeld.delete("pointer");if(!voiceHeld.size)releaseVoice();
},true);
window.addEventListener("keydown",event=>{
  if(!event.isTrusted||event.repeat||/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)||
      document.activeElement?.isContentEditable||!lan.voice?.enabled)return;
  const mic=document.querySelector(".offline-voice-hud a.offline-voice-button");
  if(mic&&(event.code==="Backquote"||["Space","Enter"].includes(event.code)&&document.activeElement===mic)){
    event.preventDefault();event.stopImmediatePropagation();
    beginHudVoice("key:"+event.code,mic,event.code==="Backquote");return;
  }
  if(event.code!=="Backquote"||lan.voice.mode!=="ptt"||lan.voice.microphone!=="ready")return;
  event.preventDefault();event.stopImmediatePropagation();pressVoice("key");
},true);
window.addEventListener("keyup",event=>{
  if(event.isTrusted&&hudGesture?.source==="key:"+event.code){
    event.preventDefault();event.stopImmediatePropagation();finishHudVoice();return;
  }
  if(!event.isTrusted||event.code!=="Backquote"||!voiceHeld.has("key"))return;
  event.preventDefault();event.stopImmediatePropagation();voiceHeld.delete("key");if(!voiceHeld.size)releaseVoice();
},true);
window.addEventListener("blur",releaseVoice);

// One-way, validated window presentation state. The game still receives only
// loadState/saveState as callable native methods, never arbitrary IPC.
let fullscreen = false;
let desktopState = null;
function applyWindowState() {
  const root = document.documentElement;
  if (!root) return;
  root.dataset.standardPlatform = process.platform;
  root.dataset.standardFullscreen = String(fullscreen);
  if (["darwin", "win32"].includes(process.platform) && document.body && !document.getElementById("standard-titlebar")) {
    const titlebar = document.createElement("div");
    titlebar.id = "standard-titlebar";
    titlebar.setAttribute("aria-hidden", "true");
    document.body.append(titlebar);
  }
  document.dispatchEvent(new Event("standard:window-state"));
}
ipcRenderer.on("standard:desktop-state", (_event, value) => {
  if (!value || !Array.isArray(value.displays) || value.displays.length > 64 ||
      !Array.isArray(value.backends) || !Array.isArray(value.resolutions)) return;
  const json = JSON.stringify(value);
  if (json.length > 24000) return;
  desktopState = json;
  if (document.documentElement) document.documentElement.dataset.standardDesktop = json;
  document.dispatchEvent(new Event("standard:desktop-state"));
});
ipcRenderer.on("standard:window-state", (_event, state) => {
  if (state && typeof state.fullscreen === "boolean") {
    fullscreen = state.fullscreen;
    applyWindowState();
  }
});
window.addEventListener("DOMContentLoaded", () => {
  applyWindowState();
  if (desktopState) document.documentElement.dataset.standardDesktop = desktopState;
}, {once: true});

// A fixed native UI command, not an updater/IPC API exposed to game scripts.
// Synthetic .click()/dispatchEvent(), arbitrary URLs and non-player controls
// cannot request it. The main process separately validates sender and idle.
document.addEventListener("click", event => {
  if (!event.isTrusted || event.button !== 0) return;
  const voice=event.target.closest?.("a[data-standard-voice-action]");
  if(voice&&voice.closest(".offline-voice-controls")){
    const action=voice.dataset.standardVoiceAction;
    if(!["enable","disable","mute","ptt","open-mic","toggle"].includes(action)||
        voice.getAttribute("aria-disabled")==="true"||voice.getAttribute("href")!=="/__native__/voice/"+action)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(action==="toggle"&&Date.now()<hudClickUntil)return;
    if(["disable","mute"].includes(action))releaseVoice();
    ipcRenderer.send("standard:voice-action",action);return;
  }
  const cloud=event.target.closest?.("a[data-standard-cloud-action]");
  if(cloud&&cloud.closest(".offline-cloud-card")){
    const action=cloud.dataset.standardCloudAction,selection=cloud.dataset.cloudRevision;
    if(!["connect","cancel","sync","auto-on","auto-off","disconnect","backups","review-local","review-cloud","confirm-local","confirm-cloud","review-backup"].includes(action)||
      (action==="review-backup"?!/^[a-f0-9]{32}$/.test(selection??""):selection!==undefined)||
      cloud.getAttribute("href")!=="/__native__/cloud/"+action+(selection?"/"+selection:""))return;
    event.preventDefault();ipcRenderer.send("standard:cloud-action",action,selection);return;
  }
  const lanLink=event.target.closest?.("a[data-standard-lan-action]");
  if(lanLink&&lanLink.closest(".offline-lan-card,.offline-lan-home,.offline-lan-room")){
    const action=lanLink.dataset.standardLanAction;
    if(!["host","join","leave","copy","find","browse","cancel-find"].includes(action))return;
    const root=lanLink.closest(".offline-lan-card,.offline-lan-home,.offline-lan-room");
    const field=name=>root.querySelector('[data-lan-field="'+name+'"]')?.value??"";
    const mode=field("connection-mode")||"lan",code=lanLink.dataset.lanRoomCode;
    if(code!==undefined&&(action!=="join"||!(mode==="lan"?/^[A-Z0-9]{4}$/:/^[A-Z0-9]{6}$/).test(code)))return;
    if(lanLink.getAttribute("href")!=="/__native__/lan/"+action+(code!==undefined?"/"+code:""))return;
    event.preventDefault();
    ipcRenderer.send("standard:lan-action",action,{species:Number(field("species")),address:field("address"),invitation:code??field("invitation"),connectionMode:mode,destination:field("destination")});
    return;
  }
  if (event.target.closest?.("button.offline-fullscreen")) {
    event.preventDefault();
    event.stopImmediatePropagation();
    ipcRenderer.send("standard:toggle-fullscreen");
    return;
  }
  const desktop = event.target.closest?.("a[data-standard-desktop-action]");
  if (desktop && desktop.closest(".offline-player-card,.offline-desktop-card")) {
    const action = desktop.getAttribute("data-standard-desktop-action");
    const value = desktop.getAttribute("data-standard-desktop-value") ?? "";
    const allowed = action === "settings" || action === "restart" ? value === "" :
      action === "monitor" ? /^-?\d{1,16}$/.test(value) :
      action === "resolution" ? ["fit", "960x540", "1280x720", "1600x900", "1920x1080", "2560x1440"].includes(value) :
      action === "backend" ? ["auto", "metal", "d3d11", "gl", "vulkan"].includes(value) :
      action === "awake" ? ["on", "off"].includes(value) : false;
    if (!allowed || desktop.getAttribute("href") !== "/__native__/desktop/" + action + (value ? "/" + value : "")) return;
    event.preventDefault();
    ipcRenderer.send("standard:desktop-action", action, value);
    return;
  }
  const link = event.target.closest?.("a[data-standard-native-action]");
  if (!link) return;
  const action = link.getAttribute("data-standard-native-action");
  if (["download-update", "install-update"].includes(action)) {
    if (!link.closest(".offline-update-card") || link.getAttribute("href") !== "/__native__/" + action ||
        link.getAttribute("aria-disabled") === "true") return;
    event.preventDefault();
    ipcRenderer.send("standard:update-action", action);
    return;
  }
  const scope = ["check-for-updates","cloud-saves"].includes(action) ? ".offline-player-card" :
    action === "report-bug" ? ".offline-report-card" : null;
  if (!scope || !link.closest(scope) || link.getAttribute("href") !== "/__native__/" + action) return;
  event.preventDefault();
  if (action === "check-for-updates") ipcRenderer.send("standard:check-updates");
  else if (action === "cloud-saves") ipcRenderer.send("standard:cloud-status");
  else if (action === "report-bug") ipcRenderer.send("standard:report-bug");
}, true);
