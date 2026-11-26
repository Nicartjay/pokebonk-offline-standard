// Game-local mix only. Each gain is inserted after the game's own volume bus
// and before its original destination. Master volume, cry filters, music
// fades, saved settings and the broker's voice playback remain independent.
const VOICE_PERCENT = Object.freeze({musicBus:10,sfxBus:50,cryBus:40});
export const VOICE_MUSIC_PERCENT = VOICE_PERCENT.musicBus;

export class VoiceAudioDucker {
  constructor() { this.active=false;this.context=null;this.gains=new Map(); }
  level(bus) { return this.active ? VOICE_PERCENT[bus]/100 : 1; }
  output(context,bus,destination) {
    if(!Object.hasOwn(VOICE_PERCENT,bus))return destination;
    if(context!==this.context){
      this.context=context;
      this.gains.clear();
    }
    const gain=context.createGain();
    gain.gain.value=this.level(bus);
    gain.connect(destination);
    this.gains.set(bus,gain.gain);
    return gain;
  }
  setActive(active) {
    active=active===true;
    if(this.active===active)return;
    this.active=active;
    const context=this.context;
    if(!context||context.state==="closed")return;
    const now=context.currentTime;
    for(const [bus,param] of this.gains){
      if(typeof param.cancelAndHoldAtTime==="function")param.cancelAndHoldAtTime(now);
      else{
        const level=param.value;
        param.cancelScheduledValues(now);
        param.setValueAtTime(level,now);
      }
      param.setTargetAtTime(this.level(bus),now,.08);
    }
  }
}
