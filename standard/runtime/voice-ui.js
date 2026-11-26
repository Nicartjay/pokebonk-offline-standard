import {emptyVoiceState,voiceStatus,voiceAvailable,validVoiceVolume,DEFAULT_VOICE_VOLUME,voiceVolumePreference} from "../common/voice-state.mjs";
import {VoiceAudioDucker,VOICE_MUSIC_PERCENT} from "./voice-audio.js";
const NS = "http://www.w3.org/2000/svg";
const paths = {
  headset:["M4 13v-1a8 8 0 0 1 16 0v1","M4 12H3v7h4v-7H4m16 0h1v7h-4v-7h3","M17 20c0 2-3 2-5 2"],
  mic:["M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5","M6 10v2a6 6 0 0 0 12 0v-2","M12 18v4m-4 0h8"],
  muted:["M9 7V5a3 3 0 0 1 6 0v7m-6-1v1a3 3 0 0 0 5 2","M6 10v2a6 6 0 0 0 10 4m2-4v-2","M12 18v4m-4 0h8","M2 2l20 20"],
  ptt:["M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0V5","M6 10v2a6 6 0 0 0 12 0v-2","M12 18v4m-4 0h8","M3 4h3m-3 3h3"],
};
function icon(kind) {
  const svg = document.createElementNS(NS,"svg");
  for (const [key,value] of Object.entries({viewBox:"0 0 24 24",width:"20",height:"20",fill:"none",
    stroke:"currentColor","stroke-width":"2","stroke-linecap":"round","stroke-linejoin":"round","aria-hidden":"true"}))
    svg.setAttribute(key,value);
  for (const d of paths[kind]) {const path=document.createElementNS(NS,"path");path.setAttribute("d",d);svg.append(path);}
  return svg;
}
export function installVoiceUI(api, {el}) {
  if (!globalThis.window?.addEventListener) return;
  const controls = new Set();
  const positions = new WeakMap();
  const volumeControls=new Set(),mix=new VoiceAudioDucker();
  const volumeKey="pokebonk.offline.standard.voice.mic-volume";
  let micVolume=DEFAULT_VOICE_VOLUME;
  try{micVolume=voiceVolumePreference(window.localStorage?.getItem(volumeKey));}catch{}
  let hud;
  let snapshot=api.lan?.state?.() ?? {phase:"idle",members:[]};
  const current = () => snapshot;
  const value = () => current().voice ?? emptyVoiceState();
  function volumeRow(settings=false) {
    const row=el("label",null,"offline-voice-volume"+(settings?" st-row range":""));
    const caption=el("span","Mic volume");
    if(settings)caption.append(el("small",`This device only · BGM drops to ${VOICE_MUSIC_PERCENT}% while voice chat is on`));
    const range=el("input",null,"st-range"),amount=el("b",null,"st-val");
    range.type="range";range.min="0";range.max="100";range.step="5";
    range.setAttribute("aria-label","Microphone volume");
    const render=()=>{
      range.value=String(micVolume);amount.textContent=micVolume+"%";
      range.style.setProperty("--p",micVolume+"%");
      range.setAttribute("aria-valuetext",micVolume+" percent");
    };
    range.addEventListener("input",()=>{
      const next=Number(range.value);if(!validVoiceVolume(next))return;
      micVolume=next;
      try{window.localStorage?.setItem(volumeKey,String(next));}catch{}
      api.lan?.send?.("voice-volume",next);
      for(const control of volumeControls){if(!control.row.isConnected){volumeControls.delete(control);continue;}control.render();}
    });
    row.append(caption,range,amount);
    volumeControls.add({row,render});render();return row;
  }
  api.voiceVolumeRow=()=>volumeRow(true);
  api.voiceAudioOutput=(context,bus,destination)=>mix.output(context,bus,destination);
  // This bounded preference command cannot enable capture or choose devices.
  api.lan?.send?.("voice-volume",micVolume);
  function native(action, label, kind, className) {
    const link = el("a",null,className);
    link.setAttribute("role","button");
    link.setAttribute("aria-label",label);
    link.append(icon(kind),el("span",label));
    link.dataset.standardVoiceAction = action;
    link.href = "/__native__/voice/" + action;
    return link;
  }
  function setAction(link, action, disabled = false) {
    link.dataset.standardVoiceAction = action;
    link.setAttribute("aria-disabled",String(disabled));
    if (disabled) {link.removeAttribute("href");link.tabIndex=-1;}
    else {link.setAttribute("href","/__native__/voice/"+action);link.tabIndex=0;}
  }
  function positionHUD(node) {
    const android=document.documentElement.dataset.standardPlatform==="android";
    const auto=android?document.querySelector(".tc-aim"):null;
    const autoBounds=auto?.getBoundingClientRect();
    const width=node.offsetWidth||(android?44:155);
    const leftHUD=document.querySelector("#hud .hud-bl")?.getBoundingClientRect();
    const rightHUD=document.querySelector("#hud .hud-br")?.getBoundingClientRect();
    const key=[innerWidth,innerHeight,width,autoBounds?.left,autoBounds?.bottom,autoBounds?.width,
      leftHUD?.right,rightHUD?.left,rightHUD?.width].join("|");
    if(positions.get(node)===key)return;
    positions.set(node,key);
    if(android){
      const left=autoBounds?.width?autoBounds.left+(autoBounds.width-width)/2:innerWidth-width-12;
      node.style.left=Math.max(12,Math.min(innerWidth-width-12,left))+"px";
      node.style.top=(autoBounds?.height?autoBounds.bottom+8:122)+"px";
      node.style.bottom="auto";
    }else{
      const start=leftHUD?.width?leftHUD.right+12:12;
      const end=rightHUD?.width?rightHUD.left-12:innerWidth-12;
      const preferred=(innerWidth-width)/2;
      const left=end-start>=width?Math.max(start,Math.min(end-width,preferred)):preferred;
      node.style.left=(left+width/2)+"px";
      // Large custom HUD scales may leave no gap: reserve a row above those
      // panels instead of obscuring an ability or item.
      const top=Math.min(...[leftHUD,rightHUD].filter(bounds=>bounds?.width&&bounds?.height).map(bounds=>bounds.top));
      node.style.bottom=(end-start<width&&Number.isFinite(top)?Math.max(12,innerHeight-top+8):12)+"px";
    }
  }
  function create(room, mini = false, inGame = false) {
    const root = el("section",null,"offline-voice-controls" + (mini ? " offline-voice-mini" : inGame ? "" : " offline-voice-card") +
      (inGame ? " offline-voice-hud" : ""));
    root.setAttribute("aria-label","Optional direct voice chat");
    if(inGame){
      const mic=native("toggle","Mic muted","muted","btn offline-voice-button");
      mic.dataset.standardVoiceGesture="tap-hold";
      mic.append(el("kbd","`"));
      let downAt=0,lastHold=0;
      // Visual/default-navigation handling only. Actual PTT is classified by
      // the isolated desktop preload / Android MotionEvent handler.
      mic.addEventListener("pointerdown",event=>{
        if(!event.isTrusted)return;downAt=performance.now();lastHold=0;
        event.stopPropagation();
      });
      mic.addEventListener("pointerup",event=>{
        if(event.isTrusted&&downAt&&performance.now()-downAt>=280)lastHold=performance.now();
        downAt=0;
      });
      mic.addEventListener("pointercancel",()=>{downAt=0;lastHold=performance.now();});
      mic.addEventListener("click",event=>{
        if(lastHold&&performance.now()-lastHold<800){event.preventDefault();event.stopImmediatePropagation();}
      });
      root.append(mic);
      const control={root,room,inGame:true,mic};
      controls.add(control);render(control);return root;
    }
    const top = el("div",null,"offline-voice-top");
    const toggle = native("enable","Voice off","headset","btn small ghost offline-voice-toggle");
    toggle.title = "Enable or disable your voice chat";
    const badge = el("small","NO TURN","offline-voice-direct");
    top.append(toggle,badge);
    const modes = el("div",null,"seg offline-voice-modes");
    modes.setAttribute("aria-label","Your microphone mode");
    const picks = [["mute","Mute","muted"],["ptt","PTT","ptt"],["open-mic","Mic on","mic"]].map(([action,label,kind]) => {
      const pick = native(action,label,kind,"pill");
      pick.title = action === "mute" ? "Mute your microphone; keep listening" :
        action === "ptt" ? "Push to talk; hold the button or the ` key" : "Open microphone while the app is in the foreground";
      modes.append(pick); return pick;
    });
    const hold = el("button",null,"btn red small offline-voice-hold");
    hold.type = "button";
    hold.append(icon("ptt"),el("span","Hold to talk"),el("kbd","`"));
    hold.title = "Hold to talk · desktop shortcut: ` (backquote)";
    hold.setAttribute("aria-label","Hold to talk");
    hold.addEventListener("click",event => {event.preventDefault();event.stopPropagation();});
    // The native host owns PTT presses/releases on both platforms. Android
    // hit-tests an actual MotionEvent; no callable capture/hold bridge exists.
    hold.addEventListener("pointerdown",event => {
      if (!event.isTrusted || hold.disabled || !globalThis.PokeBonkLANAndroid || globalThis.PokeBonkLAN) return;
      event.preventDefault();event.stopPropagation();
    });
    const status = el("small",null,"offline-voice-status");
    status.setAttribute("role","status"); status.setAttribute("aria-live","polite");
    root.append(top);
    if (!mini) root.append(modes,volumeRow(),hold,status);
    const control = {root,room,mini,inGame,toggle,badge,modes,picks,hold,status};
    controls.add(control); render(control); return root;
  }
  function render(control) {
    if(control.inGame){
      const {root,mic}=control,view=value(),enabled=voiceAvailable(current())&&view.enabled;
      const live=view.transmitting===true,on=view.mode==="open"||live;
      const kind=live?"ptt":on?"mic":"muted";
      if(mic.dataset.micIcon!==kind){mic.firstChild.replaceWith(icon(kind));mic.dataset.micIcon=kind;}
      const label=live?"Talking…":on?"Mic on":"Mic muted";
      mic.querySelector("span").textContent=label;
      mic.title=label+" · Tap to toggle mic · Hold to talk, release to mute · Keyboard: hold `";
      mic.setAttribute("aria-label",label+". Tap to toggle microphone. Hold to talk; release to mute.");
      mic.setAttribute("aria-pressed",String(on));
      mic.setAttribute("aria-busy",String(view.microphone==="requesting"));
      mic.classList.toggle("talking",live);
      mic.classList.toggle("mic-open",on);
      mic.classList.toggle("red",on);
      setAction(mic,"toggle",!enabled);
      root.hidden=!enabled;
      if(enabled)positionHUD(root);
      return;
    }
    const {root,room,mini,inGame,toggle,badge,modes,picks,hold,status} = control;
    const state=current(), view=value();
    const preview=room?.preview === true;
    const allowed=preview ? room.voiceAvailable === true : voiceAvailable(state);
    const enabled=allowed && view.enabled;
    root.classList.toggle("voice-on",enabled);
    root.classList.toggle("voice-live",view.transmitting === true);
    toggle.lastChild.textContent=enabled ? "Voice on" : "Voice off";
    toggle.setAttribute("aria-label",enabled?"Disable voice chat":"Enable voice chat");
    toggle.setAttribute("aria-pressed",String(enabled));
    setAction(toggle,enabled?"disable":"enable",!allowed);
    toggle.title=allowed ? (enabled?"Disable your voice chat":"Enable optional direct voice chat") : voiceStatus(view,false);
    badge.textContent=(state.connectionMode ?? room?.connectionMode) === "lan" ? "LAN AUDIO" : "NO TURN";
    if (mini) return;
    modes.hidden=!enabled;
    for (const pick of picks) {
      const action=pick.dataset.standardVoiceAction;
      const selected=action === "mute" ? view.mode === "muted" : action === "ptt" ? view.mode === "ptt" : view.mode === "open";
      pick.classList.toggle("on",selected);
      pick.setAttribute("aria-pressed",String(selected));
      setAction(pick,action,!enabled || view.microphone === "requesting" && action !== "mute");
    }
    hold.hidden=!enabled || view.mode !== "ptt";
    hold.disabled=view.microphone !== "ready";
    hold.classList.toggle("talking",view.transmitting === true);
    hold.querySelector("span").textContent=view.transmitting ? "Talking…" : "Hold to talk";
    hold.setAttribute("aria-pressed",String(view.transmitting === true));
    status.textContent=voiceStatus(view,allowed);
  }
  function sync() {
    const state=current(), run=globalThis.PokeBonkNativeApp?.run;
    // Voice chat can be enabled for listening only. Keep the mix independent
    // of microphone modes, permission prompts and push-to-talk gestures.
    const voiceEnabled=voiceAvailable(state)&&value().enabled;
    mix.setActive(voiceEnabled);
    if (run?.coop && voiceEnabled) {
      if (!hud?.isConnected) {hud=create(null,false,true);document.body.append(hud);}
    } else {hud?.remove();hud=null;}
    for (const control of controls) {
      if (!control.root.isConnected) {controls.delete(control);continue;}
      render(control);
    }
  }
  api.voiceRoomToggle=room=>create(room,true);
  api.voiceControls=room=>create(room);
  window.addEventListener("keydown",event=>{
    if(!globalThis.PokeBonkLANAndroid||globalThis.PokeBonkLAN||!event.isTrusted||event.code!=="Backquote"||
        /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)||document.activeElement?.isContentEditable)return;
    const view=value();
    if(view.enabled&&(document.querySelector(".offline-voice-hud a.offline-voice-button")||
        view.mode==="ptt"&&view.microphone==="ready")){event.preventDefault();event.stopImmediatePropagation();}
  },true);
  document.addEventListener("standard:lan-voice",event=>{
    try{
      const view=typeof event.detail==="string"?JSON.parse(event.detail):event.detail;
      if(view?.version===1)snapshot={...snapshot,voice:view};
    }catch{}sync();
  });
  document.addEventListener("standard:lan-state",event=>{
    try{
      const room=typeof event.detail==="string"?JSON.parse(event.detail):event.detail;
      snapshot=room?.phase?room:api.lan?.state?.()??snapshot;
    }catch{}sync();
  });
  document.addEventListener("standard:lan-launch",()=>setTimeout(sync,100));
  // A cached presentation check only; never poll synchronous native interfaces
  // or enumerate Wi-Fi adapters during a run.
  setInterval(sync,1000);
}
