// Durable, per-device ownership receipts for the original Expedition engine.
// These are game items, not accounts, native paths or transport credentials.
const clone=value=>structuredClone(value);
const fail=message=>{
  const error=Error(message+" Your Expedition save is preserved.");error.code="expedition_packet_invalid";throw error;
};
const uint=(n,max=2147483647)=>Number.isSafeInteger(n)&&n>=0&&n<=max;
export const lootKey=loot=>`${loot.k}${loot.i}.${loot.j??0}`;
export function expeditionOwnRefs(rules,ticket,result){
  const entry=ticket.exp,raw=result?.exp;
  if(!entry||!raw||!Array.isArray(raw.loot)||raw.loot.length>8000||
    !Number.isFinite(result.time)||result.time<0||result.time>7200)fail("Invalid Expedition item source.");
  const worn=[...rules.slots.map(slot=>entry.gear[slot]),entry.pocket].filter(Boolean);
  const find=rules.lootFind(worn,entry.card),bonus=rules.lootLevel(worn,entry.card);
  const refs=new Map([...Object.values(entry.gear),...entry.bag,...entry.pocket?[entry.pocket]:[]].map(item=>["e"+item.id,clone(item)]));
  const keys=new Set(),claims=new Map();
  for(const [index,loot]of raw.loot.entries()){
    if(!loot||!["mob","elite","alpha","boss","crate","vault","room","convoy","comet","trophy"].includes(loot.k)||
      !uint(loot.i,9999999)||!uint(loot.j??0,32)||!uint(loot.t,3)||loot.t<1||
      !uint(loot.m,Math.floor(result.time/60))||keys.has(lootKey(loot)))fail("Invalid or repeated Expedition loot claim.");
    keys.add(lootKey(loot));claims.set(lootKey(loot),"l"+index);
    refs.set("l"+index,rules.generateLoot(ticket.seed,loot,find,bonus,entry.card));
  }
  return {refs,claims};
}
function checkedItem(rules,value,expected){
  const item=rules.normalizeItem(value);
  if(!item)fail("Invalid teammate item.");
  if(expected){
    const shape=item=>Object.fromEntries(Object.entries(item).filter(([key])=>!["id","q","d","n","lk"].includes(key)).sort(([a],[b])=>a.localeCompare(b)));
    if(JSON.stringify(shape(item))!==JSON.stringify(shape(expected))||
      (item.q??1)>(expected.q??1)||(item.d??100)>(expected.d??100))fail("A teammate item does not match its committed source.");
  }
  return item;
}
export function beginTeamLedger(state,ticket,members,now){
  const book=state.expeditionTeams??={version:1,parties:{}};
  if(book.version!==1||!book.parties)fail("Unsupported Expedition receipt format.");
  if(book.parties[ticket.party])fail("This Expedition party already has an item ledger.");
  // Retain unresolved returns. Old, closed-room receipts with no outgoing
  // delivery can be compacted; native pairing never accepts an old party ID.
  const old=Object.entries(book.parties).filter(([,g])=>g.settled&&!g.pending.length).sort((a,b)=>a[1].at-b[1].at);
  while(Object.keys(book.parties).length>=80&&old.length)delete book.parties[old.shift()[0]];
  if(Object.keys(book.parties).length>=100)fail("Too many pending Expedition returns. Keep/export this backup.");
  book.parties[ticket.party]={version:1,at:now,me:ticket.lan.me,members:members.map(member=>member.id),ticket:clone(ticket),
    gifts:{},packs:{},incomingGifts:[],incomingPacks:[],seen:[],pending:[],received:{},restored:{},settled:false};
}
export function teamLedger(state,party){
  const group=state.expeditionTeams?.parties?.[party];
  if(!group||group.version!==1)fail("Missing Expedition ownership receipts.");
  return group;
}
// Called within OfflineBackend.change. Outbound ownership is durable BEFORE
// sending; inbound ownership is durable BEFORE the original onGift/onPack.
export function noteTeamPacket(state,rules,{party,peer,direction,data,result},now){
  const group=teamLedger(state,party);
  if(!group.members.includes(peer)||peer===group.me||group.settled||
    state.activeRun?.ticket.party!==party)fail("This Expedition transfer is not current.");
  if(!["in","out"].includes(direction)||!["xg","xpk"].includes(data?.t))fail("Invalid Expedition transfer.");
  const outgoing=direction==="out",own=outgoing?expeditionOwnRefs(rules,group.ticket,result):null;
  const event=direction+":"+peer+":"+data.t+":"+(data.t==="xg"?data.key:data.id);
  if(group.seen.includes(event))return false;
  if(group.seen.length>=240)fail("Expedition transfer receipt limit reached.");
  if(data.t==="xg"){
    if(typeof data.key!=="string"||!/^[a-z]{3,8}\d{1,7}\.\d{1,2}$/.test(data.key))fail("Invalid gift source.");
    if(outgoing){
      const ref=own.claims.get(data.key),item=checkedItem(rules,data.it,own.refs.get(ref));
      if(!ref||group.gifts[data.key])fail("That loot has already been given away.");
      if(Object.keys(group.gifts).length>=24)fail("Expedition gift limit reached.");
      group.gifts[data.key]={to:peer,ref,item};
    }else{
      if(group.incomingGifts.length>=24)fail("Too many incoming Expedition gifts.");
      group.incomingGifts.push({from:peer,key:data.key,item:checkedItem(rules,data.it)});
    }
  }else{
    if(typeof data.id!=="string"||!/^[a-z0-9]{4,12}$/.test(data.id)||!Array.isArray(data.l)||data.l.length>16)
      fail("Invalid teammate backpack.");
    for(const row of data.l){
      if(typeof row?.k!=="string"||!/^(?:e\d{1,7}|[a-z]{3,8}\d{1,7}\.\d{1,2})$/.test(row.k))fail("Invalid backpack item.");
      if(outgoing){
        const ref=row.k[0]==="e"?row.k:own.claims.get(row.k),expected=own.refs.get(ref);
        if(!expected)fail("Backpack item has no owned source.");
        if(Object.values(group.gifts).some(gift=>gift.ref===ref))fail("Gifted loot cannot also be rescued.");
        const item=checkedItem(rules,row.it,expected);
        if(group.packs[row.k]&&JSON.stringify(group.packs[row.k])!==JSON.stringify(item))fail("A backpack item changed.");
        group.packs[row.k]=item;
      }else{
        if(group.incomingPacks.length>=24)break;
        group.incomingPacks.push({from:peer,key:row.k,item:checkedItem(rules,row.it)});
      }
    }
  }
  group.at=now;group.seen.push(event);
  if(result)state.activeRun.lastResult=JSON.parse(JSON.stringify(result));
  return true;
}
export function teamRefs(group,raw){
  if(!group)return new Map();
  const refs=new Map();
  for(const [kind,rows,declared]of [["g",group.incomingGifts,raw.take??[]],["r",group.incomingPacks,raw.rescue??[]]]){
    if(!Array.isArray(declared)||declared.length>rows.length)fail("The transfer list does not match its durable receipts.");
    rows.slice(0,declared.length).forEach((row,index)=>{
      if(declared[index]?.from!==row.from||declared[index]?.key!==row.key)fail("Wrong teammate receipt order.");
      refs.set(kind+index,clone(row.item));
    });
  }
  if(!Array.isArray(raw.give??[])||(raw.give??[]).length!==Object.keys(group.gifts).length)fail("Missing outgoing gift receipts.");
  for(const row of raw.give??[])if(!Object.values(group.gifts).some(gift=>gift.to===row.to&&gift.ref===row.ref))fail("Uncommitted outgoing gift.");
  return refs;
}
export function queueRescue(group,ref,item){
  const row=group.incomingPacks[Number(ref.slice(1))];
  if(!row)fail("No receipt for this rescued item.");
  const id="rescue:"+group.me+":"+row.from+":"+row.key;
  if(!group.pending.some(value=>value.id===id))group.pending.push({id,to:row.from,key:row.key,item:clone(item)});
}
export function applyTeamReturn(state,rules,party,peer,data){
  const group=teamLedger(state,party),expected=group.packs[data.key];
  if(!group.members.includes(peer)||peer===group.me||!expected||typeof data.id!=="string"||
    data.id!=="rescue:"+peer+":"+group.me+":"+data.key)fail("No committed source for this backpack return.");
  const item=checkedItem(rules,data.item,expected);
  if(group.received[data.key])return true; // Multiple rescuers never multiply the same original item.
  group.received[data.key]={id:data.id,item};
  applyWaitingReturns(state,rules,group);
  return true;
}
export function applyWaitingReturns(state,rules,group){
  if(!group.settled)return;
  const e=state.profile.exp;
  for(const [key,receipt]of Object.entries(group.received)){
    if(receipt.applied)continue;
    if(!group.restored[key]){
      const item=clone(receipt.item),entry=/^e(\d+)$/.exec(key);
      if(entry){
        const id=Number(entry[1]);
        const existing=[...e.stash,...e.over,...e.bag,...Object.values(e.gear),...e.pocket?[e.pocket]:[]].some(value=>value.id===id);
        if(existing&&rules.isGear(item))fail("A returned item identity is already in use.");
        if(existing){if(!uint(e.next,9999997)||e.next<1)fail("Item identity limit.");item.id=e.next++;}
        else item.id=id;
      }else{if(!uint(e.next,9999997)||e.next<1)fail("Item identity limit.");item.id=e.next++;}
      item.n=1;(e.stash.length<e.slots?e.stash:e.over).push(item);
      if(!e.codex.includes(item.b))e.codex.push(item.b);
      group.restored[key]=true;
    }
    receipt.applied=true;
  }
}
