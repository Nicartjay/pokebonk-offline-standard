import {ast,nodesOf,one,maybeName} from "../../scripts/source.ts";

export function voiceAudioEdits(source) {
  const audio=one(nodesOf(ast(source),"ClassExpression",node=>
    ["setVolumes","playTrack","preloadTrack","build"].every(key=>
      node.body.body.some(method=>maybeName(method.key)===key))),"game audio mixer");
  const build=one(audio.body.body.filter(method=>maybeName(method.key)==="build"),"audio graph construction");
  return ["musicBus","sfxBus","cryBus"].map(bus=>{
    const call=one(nodesOf(build,"CallExpression",node=>{
      const {callee}=node,input=callee.object;
      return maybeName(callee.property)==="connect"&&input?.type==="MemberExpression"&&
        input.object.type==="ThisExpression"&&maybeName(input.property)===bus;
    }),`${bus} audio output`);
    const destination=one(call.arguments,`${bus} destination`);
    return {start:destination.start,end:destination.end,
      text:`globalThis.PokeBonkOfflineUI.voiceAudioOutput(this.ctx,${JSON.stringify(bus)},${source.slice(destination.start,destination.end)})`};
  });
}
