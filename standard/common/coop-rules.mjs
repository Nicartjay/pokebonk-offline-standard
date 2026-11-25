// Reviewed shared-engine room choices. No network, account or save access.
export const COOP_MAPS = Object.freeze([
  "forest","desert","coast","glacier","canela","cave","encina","iris","plateado","furia",
]);
export const COOP_EXPEDITION_MAPS = Object.freeze(["wilds","safari"]);
export function coopLoadout(value) {
  if(!value||!Array.isArray(value.worn)||value.worn.length>4||
    !Number.isInteger(value.bag)||value.bag<0||value.bag>12||
    ![value.risk,value.ins].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=1000000000)||
    value.worn.some(item=>!item||typeof item.b!=="string"||!/^[a-z0-9-]{1,80}$/.test(item.b)||
      !Number.isInteger(item.r)||item.r<0||item.r>4||!Number.isInteger(item.lv)||item.lv<1||item.lv>30)||
    value.card!==undefined&&(typeof value.card!=="string"||!/^card-[a-z0-9-]{1,60}$/.test(value.card)))
    throw Error("Invalid Expedition loadout summary.");
  return {worn:value.worn.map(({b,r,lv})=>({b,r,lv})),bag:value.bag,risk:value.risk,ins:value.ins,
    ...(value.card!==undefined?{card:value.card}:{})};
}
export function coopDestination(value=""){
  if(value==="")return coopSettings();
  if(!COOP_EXPEDITION_MAPS.includes(value))throw Error("Choose a supported Expedition destination.");
  return coopSettings({biome:value,tier:4});
}
export function coopRoomMatches(settings,destination=""){
  const wanted=coopDestination(destination),actual=coopSettings(settings);
  return destination===""||actual.tier===4&&actual.biome===wanted.biome;
}
export function coopMaps(value) {
  const result={forest:0};
  for(const id of COOP_MAPS)if(Number.isInteger(value?.[id])&&value[id]>=0&&value[id]<=2)result[id]=value[id];
  return result;
}
export function coopSettings(value={biome:"forest",tier:0}) {
  if(!value||![0,1,2,3,4,5,6,7].includes(value.tier)||
    !(value.tier===4?COOP_EXPEDITION_MAPS.includes(value.biome):
      COOP_MAPS.includes(value.biome)||[6,7].includes(value.tier)&&value.biome==="newisland"))
    throw Error("Choose a supported co-op mode and map.");
  return {biome:value.tier===7?"newisland":value.tier===6?"forest":value.biome,tier:value.tier};
}
export function coopConfig(value) {
  const {biome,tier}=coopSettings(value);
  return {biome,tier:tier<3?tier:0,mode:({3:"endless",4:"expedition",5:"relay",6:"mutation",7:"bossrush"})[tier]??"standard"};
}
export function coopRuleTime(value) {
  if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)throw Error("Invalid shared co-op rule clock.");
  return value;
}
export function resolveCoopConfig(match,dailyMutation) {
  if(!coopGameConfig(match))throw Error("Unsupported shared co-op match.");
  if(match.mode!=="mutation")return {mode:match.mode,biome:match.biome,tier:match.tier};
  const daily=dailyMutation?.(coopRuleTime(match.rulesAt));
  if(!daily||!COOP_MAPS.includes(daily.biome)||!Number.isInteger(daily.mutation?.tier)||daily.mutation.tier<0||
    daily.mutation.tier>2||typeof daily.mutation.id!=="string"||daily.mutation.id.length>80)
    throw Error("This game build cannot resolve the shared Daily Mutation.");
  return {mode:"mutation",biome:daily.biome,tier:daily.mutation.tier,mutation:daily.mutation.id,mutationDay:daily.day};
}
export function coopGameConfig(value) {
  return Boolean(value&&
    (value.mode==="expedition"&&COOP_EXPEDITION_MAPS.includes(value.biome)&&value.tier===0||
     value.mode==="bossrush"&&value.biome==="newisland"&&value.tier===0||
     COOP_MAPS.includes(value.biome)&&
       (["standard","mutation"].includes(value.mode)&&Number.isInteger(value.tier)&&value.tier>=0&&value.tier<=2||
        ["endless","relay"].includes(value.mode)&&value.tier===0)));
}
export function coopSeats(value={discoverable:false,capacity:4},count=1) {
  if(!value||typeof value.discoverable!=="boolean"||![2,3,4].includes(value.capacity)||value.capacity<count)
    throw Error("Choose Duo, Trio or Squad without removing a teammate.");
  return {discoverable:value.discoverable,capacity:value.capacity};
}
export function requireCoopUnlocks(value,members) {
  const settings=coopSettings(value),tier=settings.tier<3?settings.tier:0;
  if([4,6,7].includes(settings.tier))return settings; // Expedition/event destinations have their own gates.
  for(const member of members)if((coopMaps(member.maps)[settings.biome]??-1)<tier)
    throw Error(`${member.name??"A teammate"} has not unlocked this map or difficulty.`);
  return settings;
}
export function coopModeUnavailable(tier) {
  return ![0,1,2,3,4,5,6,7].includes(tier)?"This mode is not supported in offline co-op yet.":null;
}
