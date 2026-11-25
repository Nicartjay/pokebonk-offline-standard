// Local Expedition economy. The original engine and reviewed item-generation
// rules remain authoritative; no server, player market or simulated rivals.
import {expeditionOwnRefs,teamRefs,queueRescue} from "./expedition-ledger.js";
export const EXPEDITION_POLICY = "local-expedition-v1";
const clone = value => structuredClone(value);
const dayOf = now => Math.floor(now / 86400000);
const fail = message => { throw new Error(message); };
const integer = (n, max = 2147483647) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const hash = text => { let n = 2166136261; for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; };
const all = e => [...e.stash, ...e.over, ...Object.values(e.gear), ...e.bag, ...(e.pocket ? [e.pocket] : [])];
function nextId(e) {
  if (!integer(e.next, 9999998) || e.next < 1) fail("Expedition item identities need their original app version.");
  return e.next++;
}
function put(e, item) {
  const target = e.stash.length < e.slots ? e.stash : e.over;
  target.push(item);
}
function refill(e) {
  while (e.over.length && e.stash.length < e.slots) e.stash.push(e.over.shift());
}
// Consolidate only ordinary, unlocked stacks in the same container. Retain
// surviving item identities, every unit and all gear/lock/insurance metadata.
// Never combine inventory with the safe pocket or an escrowed run loadout.
function tidy(e, rules) {
  if (!integer(rules.stackLimits?.cap, 100) || !rules.stackLimits.cap)
    fail("This build has no reviewed Expedition stacking rules.");
  const order = ["held", "band", "charm", "gem", "use", "loot", "mat", "gem-socket", "key", "card"];
  const kind = item => rules.isGear(item) ? rules.slotOf(item) : rules.catalog.get(item.b)?.kind;
  const sort = (a, b) => (order.indexOf(kind(a)) - order.indexOf(kind(b))) ||
    b.r - a.r || rules.value(b) - rules.value(a) || b.lv - a.lv ||
    a.b.localeCompare(b.b) || a.id - b.id;
  const compact = items => {
    const result = [], partial = new Map();
    for (const item of items) {
      const cap = Math.min(rules.stackLimits.cap, rules.catalog.get(item.b)?.stack ?? 1);
      if (rules.isGear(item) || item.lk || cap <= 1) { result.push(item); continue; }
      let target = partial.get(item.b);
      if (target) {
        const amount = Math.min(cap - target.q, item.q ?? 1);
        target.q += amount; item.q = (item.q ?? 1) - amount;
        if (item.n) target.n = 1;
        if (target.q >= cap) partial.delete(item.b);
        if (!item.q) continue;
      }
      result.push(item);
      if ((item.q ?? 1) < cap) { item.q ??= 1; partial.set(item.b, item); }
    }
    return result.sort(sort);
  };
  const pc = compact([...e.stash, ...e.over]);
  e.stash = pc.slice(0, e.slots); e.over = pc.slice(e.slots);
  e.bag = compact(e.bag);
}
function wantedList(rules, list) {
  if (!Array.isArray(list) || list.length > 24 || new Set(list).size !== list.length ||
      typeof rules.wantedAllowed !== "function" ||
      list.some(key => typeof key !== "string" || !rules.wantedAllowed(key)))
    fail("Choose up to 24 different supported Expedition loot types.");
  return [...list];
}
function take(e, id) {
  for (const list of [e.stash, e.over, e.bag]) {
    const index = list.findIndex(item => item.id === id);
    if (index >= 0) return list.splice(index, 1)[0];
  }
  for (const [slot, item] of Object.entries(e.gear)) if (item.id === id) {
    delete e.gear[slot]; return item;
  }
  if (e.pocket?.id === id) { const item = e.pocket; e.pocket = null; return item; }
  fail("That Expedition item is no longer available.");
}
function pay(e, price) {
  if (!integer(price) || e.coins < price) fail("Not enough Valley Tokens.");
  e.coins -= price;
}
function grant(e, rules, base, quantity, seed = 1) {
  const def = rules.catalog.get(base);
  if (!def || !integer(quantity, 10000)) fail("Unsupported Expedition reward.");
  while (quantity > 0) {
    const n = Math.min(quantity, def.stack ?? 1);
    const item = rules.normalizeItem({id: nextId(e), b: base, lv: 1, r: 0, s: seed, q: n});
    if (!item) fail("Invalid Expedition reward.");
    put(e, item); quantity -= n;
  }
}
function stock(e, rules, day, rolls = 0) {
  const level = rules.repLevel(e.rep), count = rules.shopSize(e.rep);
  const seed = hash(`local-shop:${day}:${level}:${rolls}`);
  const items = Array.from({length: count}, (_, i) => rules.generateLoot(seed,
    {k: "crate", i, t: Math.min(3, 1 + Math.floor(level / 4)), m: Math.min(20, level * 2)}));
  // There is always an affordable basic supply; the rest uses the game's
  // seeded catalog. Refreshing and purchases are durable transactions.
  items[0] = rules.normalizeItem({id: 0, b: "potion", q: 3, lv: 1, r: 0, s: seed});
  e.shop = {day, rolls, items, sold: []};
}
function daily(e, rules, now) {
  const day = dayOf(now);
  if (e.shop?.day !== day) stock(e, rules, day);
  if (e.con?.day !== day) e.con = {day, list: [
    {k: "extract", n: 1, coins: 100, shards: 2, rep: 40},
    {k: "crates", n: 3, coins: 80, shards: 3, rep: 30},
    {k: "value", n: 250, coins: 120, shards: 4, rep: 50},
  ].map(task => ({...task, got: 0, done: false, paid: false}))};
}
export function expeditionState(profile, rules, now) {
  if (!rules?.generateLoot) fail("This build has no reviewed offline Expedition rules.");
  let e = profile.exp;
  if (e == null) {
    e = profile.exp = {offlineVersion: 1, next: 1, coins: rules.allowance.start, shards: 0, rep: 0,
      slots: rules.storage.base, gear: {}, bag: [], pocket: null, stash: [], over: [], ins: [],
      codex: [], ps: {xp: 0, got: []}, history: [], out: 0, best: 0, aid: -1, rlOff: false};
  }
  // Unknown versions are never silently initialized over imported progress.
  if (e.offlineVersion !== 1) fail("This Expedition save needs its original app version. It has not been changed.");
  daily(e, rules, now);
  return e;
}
export function expeditionActions(profile, rules, actions, now) {
  const e = expeditionState(profile, rules, now);
  if (e.raid) fail("Finish or explicitly end the active Expedition before changing equipment.");
  if (!Array.isArray(actions) || !actions.length || actions.length > 120) fail("Invalid Expedition actions.");
  for (const a of actions) {
    const item = a.id == null ? null : all(e).find(item => item.id === a.id);
    const required = () => item ?? fail("Choose an available Expedition item.");
    switch (a.a) {
      case "equip": {
        const slot = rules.slotOf(required());
        if (!slot || (item.d ?? 100) <= 0) fail("Choose usable equipment.");
        take(e, item.id);
        if (e.gear[slot]) put(e, e.gear[slot]);
        e.gear[slot] = item; break;
      }
      case "unequip":
        if (!rules.slots.includes(a.slot) || !e.gear[a.slot]) fail("That equipment slot is empty.");
        put(e, take(e, e.gear[a.slot].id)); break;
      case "pack":
        required();
        if (e.bag.some(i => i.id === item.id)) fail("That item is already packed.");
        if (e.bag.length >= rules.runLimits.bag) fail("Your Expedition backpack is full.");
        e.bag.push(take(e, item.id)); break;
      case "pocket": {
        if (!rules.pocketable(required())) fail("Equipment and trophies cannot go in the safe pocket.");
        const selected = take(e, item.id);
        if (e.pocket) put(e, e.pocket);
        e.pocket = selected; break;
      }
      case "unpocket":
        if (!e.pocket) fail("The safe pocket is empty.");
        put(e, take(e, e.pocket.id)); break;
      case "unpack": case "store": put(e, take(e, required().id)); break;
      case "lock": required(); item.lk = item.lk ? 0 : 1; break;
      case "locks":
        if (!Array.isArray(a.ids) || a.ids.length > 500 || typeof a.on !== "boolean") fail("Invalid item locks.");
        for (const id of new Set(a.ids)) {
          const target = all(e).find(item => item.id === id);
          if (!target) fail("That item is no longer available.");
          target.lk = +a.on;
        }
        break;
      case "sell": case "salvage": {
        if (!Array.isArray(a.ids) || !a.ids.length || a.ids.length > 500 ||
            new Set(a.ids).size !== a.ids.length) fail("Choose distinct stored items.");
        for (const id of a.ids) {
          const target = [...e.stash, ...e.over].find(i => i.id === id);
          if (!target || target.lk) fail("Only unlocked items in the PC can be sold or recycled.");
          if (a.a === "sell") e.coins += rules.value(target);
          else {
            if (!rules.isGear(target)) fail("Only equipment can be recycled.");
            e.shards += rules.shardValue(target);
            for (const material of rules.salvage(target)) grant(e, rules, material.b, material.q);
            for (const gem of rules.sockets(target)) grant(e, rules, gem, 1);
          }
          take(e, id); e.ins = e.ins.filter(i => i !== id);
          if (e.card === id) delete e.card;
        }
        break;
      }
      case "insure":
        if (!rules.isGear(required()) || ![...Object.values(e.gear), ...e.bag].some(i => i.id === item.id)) fail("Pack or equip the item before insuring it.");
        e.ins = e.ins.includes(item.id) ? e.ins.filter(i => i !== item.id) : [...e.ins, item.id];
        break;
      case "repair": {
        if (!rules.isGear(required()) || (item.d ?? 100) >= 100) fail("That item does not need repair.");
        pay(e, rules.repairCost(item)); item.d = 100; item.rp = (item.rp ?? 0) + 1; break;
      }
      case "expand":
        if (e.slots >= rules.storage.max) fail("The PC is already fully expanded.");
        pay(e, rules.expandCost(e.slots)); e.slots += rules.storage.step; break;
      case "buy": {
        const offer = integer(a.k, e.shop.items.length - 1) && e.shop.items[a.k];
        if (!offer || e.shop.sold.includes(a.k)) fail("That shop item is no longer available.");
        pay(e, rules.buyPrice(offer)); e.shop.sold.push(a.k);
        put(e, {...clone(offer), id: nextId(e)}); break;
      }
      case "reroll":
        pay(e, 60 * (1 + e.shop.rolls)); stock(e, rules, dayOf(now), e.shop.rolls + 1); break;
      case "card":
        if (rules.catalog.get(required().b)?.kind !== "card" || !e.stash.includes(item)) fail("Choose a stored route card.");
        if (e.card === item.id) delete e.card; else e.card = item.id;
        break;
      case "aid":
        if (e.aid === dayOf(now) || e.coins >= rules.allowance.below) fail("Bill's aid is only available once a day when you are short of tokens.");
        e.aid = dayOf(now); e.coins += rules.allowance.aid; grant(e, rules, "potion", 2); break;
      case "claim": {
        const task = integer(a.k, e.con.list.length - 1) && e.con.list[a.k];
        if (!task?.done || task.paid) fail("Complete the contract before claiming it, once.");
        task.paid = true; e.coins += task.coins; e.shards += task.shards; e.rep += task.rep;
        e.ps.xp += rules.passRules.contract; break;
      }
      case "pclaim": {
        const reward = integer(a.k, rules.passRewards.length) && rules.passRewards[a.k - 1];
        if (!reward || a.k > rules.passLevel(e.ps.xp) || e.ps.got.includes(a.k)) fail("Earn the pass reward before claiming it, once.");
        e.ps.got.push(a.k); e.coins += reward.coins ?? 0; e.shards += reward.shards ?? 0;
        for (const id of reward.cosmetics ?? []) if (!profile.cosmetics.includes(id)) profile.cosmetics.push(id);
        for (const [base, n] of [...reward.mats ?? [], ...reward.items ?? []]) grant(e, rules, base, n);
        break;
      }
      case "reload":
        if (typeof a.off !== "boolean") fail("Invalid loadout preference.");
        e.rlOff = a.off; break;
      case "want": {
        if (typeof a.on !== "boolean") fail("Invalid wanted-loot preference.");
        wantedList(rules, [a.b]);
        const selected = new Set(e.wl ?? []);
        if (a.on) selected.add(a.b); else selected.delete(a.b);
        e.wl = wantedList(rules, [...selected]); break;
      }
      case "wants": e.wl = wantedList(rules, a.list); break;
      case "tidy": tidy(e, rules); break;
      case "seen": for (const i of all(e)) delete i.n; break;
      default: fail("That system is not available in the solo offline Expedition.");
    }
    refill(e);
    const ids = new Set(all(e).map(i => i.id));
    e.ins = e.ins.filter(id => ids.has(id));
  }
}
export function beginExpedition(profile, rules, ticket, now) {
  const e = expeditionState(profile, rules, now);
  if (!["wilds", "safari"].includes(ticket.config.biome) || ticket.config.tier !== 0) fail("Choose Wild Valley or Safari Zone.");
  if (e.over.length) fail("Make room for the items waiting in your PC before entering.");
  if (e.raid) fail("An unfinished Expedition is preserved.");
  const insured = [...Object.values(e.gear), ...e.bag].filter(item => rules.isGear(item) && e.ins.includes(item.id));
  const insurance=insured.reduce((total,item)=>total+rules.insuranceCost(item),0);
  if(ticket.lan&&!Object.values(e.gear).some(item=>rules.isGear(item)&&(item.d??100)>0))
    fail("Equip at least one usable piece of gear before entering Expedition co-op.");
  ticket.expEscrow={insurance,ins:clone(e.ins),...(e.card?{card:e.card}:{})};
  pay(e, insurance);
  const card = e.stash.find(i => i.id === e.card);
  if (card) {
    if (rules.catalog.get(card.b)?.kind !== "card") fail("Invalid route card.");
    take(e, card.id);
    ticket.expEscrow.route=clone(card);
  }
  ticket.expeditionPolicy = EXPEDITION_POLICY;
  ticket.exp = {gear: clone(e.gear), bag: clone(e.bag), pocket: clone(e.pocket), echoes: [],
    ...(card ? {card: card.b} : {}), radio: 0};
  ticket.expInsured = insured.map(item => item.id);
  // Commit escrow together with the run ticket. Killing the process, importing
  // or retrying cannot leave a second copy of the same loadout in the profile.
  e.gear = {}; e.bag = []; e.pocket = null; e.ins = [];
  delete e.card; e.raid = ticket.id;
}
export function cancelExpeditionPreparation(profile,ticket){
  const e=profile.exp;
  if(!ticket.exp||!ticket.expEscrow||e?.raid!==ticket.id)fail("Prepared Expedition escrow is missing.");
  // Preparation is reversible only before launch. No new loot has been
  // generated, and equipment edits have been blocked while escrowed.
  if(ticket.lan?.launched)fail("A launched Expedition cannot be canceled.");
  Object.assign(e,{gear:clone(ticket.exp.gear),bag:clone(ticket.exp.bag),pocket:clone(ticket.exp.pocket),
    ins:clone(ticket.expEscrow.ins)});
  e.coins+=ticket.expEscrow.insurance;
  if(ticket.expEscrow.route){put(e,clone(ticket.expEscrow.route));e.card=ticket.expEscrow.card;}
  delete e.raid;
}
export function settleExpedition(profile, rules, ticket, result, now, {abandoned = false,team} = {}) {
  if (ticket.expeditionPolicy !== EXPEDITION_POLICY || !ticket.exp) fail("This Expedition needs its original app version. The run is preserved.");
  const e = expeditionState(profile, rules, now), raw = result.exp;
  if (!raw || typeof raw.out !== "boolean" || !Array.isArray(raw.loot) || raw.loot.length > 8000 ||
      !raw.gear || typeof raw.gear !== "object" || Array.isArray(raw.gear) ||
      !Array.isArray(raw.bag) || raw.bag.length > rules.runLimits.bag ||
      !Number.isFinite(result.time) || result.time < 0 || result.time > 7200 ||
      !team&&(raw.give?.length||raw.take?.length||raw.pack?.length||raw.rescue?.length)||
      raw.echo?.length) fail("Invalid Expedition result. Your run is preserved.");
  const {refs,claims}=expeditionOwnRefs(rules,ticket,result);
  for(const [ref,item]of teamRefs(team,raw))refs.set(ref,item);
  const base=ref=>typeof ref==="string"&&/^(?:[elgr]\d{1,7})(?:~[1-9]\d{0,2})?$/.test(ref)?ref.split("~")[0]:null;
  const decode = ref => {
    const source=base(ref);
    if(!source||!refs.has(source))fail("An Expedition item does not belong to this run.");
    const item=clone(refs.get(source));
    if(ref!==source&&rules.isGear(item))fail("Equipment cannot be split.");
    if (!rules.isGear(item)) {
      const quantity = raw.q?.[ref] ?? item.q ?? 1;
      if (!integer(quantity, item.q ?? 1) || quantity < 1) fail("Invalid remaining item quantity.");
      item.q = quantity;
    }
    return item;
  };
  const gear = Object.entries(raw.gear);
  for (const [slot, ref] of gear) if (!rules.slots.includes(slot) || rules.slotOf(decode(ref)) !== slot) fail("Invalid Expedition equipment slot.");
  if (raw.pocket && !rules.pocketable(decode(raw.pocket))) fail("Invalid safe pocket item.");
  const pouch = raw.pouch ?? [];
  if (!Array.isArray(pouch) || pouch.length > 80) fail("Invalid material pouch.");
  for (const ref of pouch) if (rules.isGear(decode(ref))) fail("Equipment cannot enter the material pouch.");
  const carried = [...gear.map(([, ref]) => ref), ...raw.bag, ...pouch, ...raw.pocket ? [raw.pocket] : []];
  if (new Set(carried).size !== carried.length) fail("The same item occupies more than one slot.");
  const totals=new Map();
  const packed=new Map();
  if(team)for(const [key,item]of Object.entries(team.packs)){
    const ref=key[0]==="e"?key:claims.get(key);
    if(!ref)fail("A dropped backpack source is missing.");
    packed.set(ref,item.q??1);
  }
  for(const ref of carried){
    const item=decode(ref),source=base(ref),total=(totals.get(source)??0)+(item.q??1);
    if(total>(refs.get(source).q??1))fail("Split stacks exceed the owned quantity.");
    totals.set(source,total);
    const gifted=team?Object.values(team.gifts).filter(gift=>gift.ref===source).reduce((sum,gift)=>sum+(gift.item.q??1),0):0;
    if(total+gifted+(packed.get(source)??0)>(refs.get(source).q??1))fail("Gifted loot or dropped quantities cannot also be kept.");
  }
  const kept = new Set(raw.out ? carried : raw.pocket ? [raw.pocket] : []);
  const insured = [];
  if (!raw.out) for (const id of ticket.expInsured ?? []) {
    const ref = "e" + id, item = refs.get(ref);
    if (item && !kept.has(ref)) {
      kept.add(ref); item.d = Math.max(0, (item.d ?? 100) - 25); insured.push(clone(item));
    }
  }
  const got = [], lost = [];
  let value = 0;
  const returned = new Map();
  const identities=new Set();
  for (const ref of kept) {
    const item = decode(ref);
    if(ref[0]==="r"){if(raw.out&&team)queueRescue(team,base(ref),item);continue;}
    if(ref[0]!=="e"||identities.has(item.id)){item.id=nextId(e);item.n=1;}
    identities.add(item.id);
    if(["l","g"].includes(ref[0])&&raw.out)value+=rules.value(item);
    if(team&&ref[0]==="e"&&rules.isGear(item))team.restored[base(ref)]=true;
    got.push(clone(item)); returned.set(ref, item);
    if (!e.codex.includes(item.b)) e.codex.push(item.b);
    put(e, item);
  }
  for (const ref of new Set([...carried, ...[...refs.keys()].filter(ref => ref[0] === "e")])) {
    if (kept.has(ref) || raw.q?.[ref] === 0||ref[0]==="r"||carried.some(part=>base(part)===ref)) continue;
    lost.push(decode(ref));
  }
  if (!e.rlOff) {
    for (const [slot, ref] of gear) if (raw.out && returned.has(ref)) e.gear[slot] = take(e, returned.get(ref).id);
    for (const ref of raw.bag) if (raw.out && returned.has(ref)) e.bag.push(take(e, returned.get(ref).id));
    if (raw.pocket && returned.has(raw.pocket)) e.pocket = take(e, returned.get(raw.pocket).id);
  }
  const rep = raw.out ? Math.max(1, Math.floor(value / 10)) : 0;
  e.rep += rep; if (raw.out) { e.out++; e.best = Math.max(e.best, value); }
  let contracts = 0;
  if (raw.out) for (const task of e.con.list) {
    const amount = {extract: 1, crates: integer(raw.crates, 200) ? raw.crates : 0, value}[task.k] ?? 0;
    const was = task.done; task.got = Math.min(task.n, task.got + amount);
    task.done = task.got >= task.n; if (task.done && !was) contracts++;
  }
  const xp = abandoned ? 0 : Math.min(rules.passRules.runMax, Math.floor(result.time / 60) * rules.passRules.run) +
    (raw.out ? rules.passRules.out + Math.min(rules.passRules.outMax, Math.floor(value / rules.passRules.outValue)) : 0);
  e.ps.xp += xp;
  const summary = {id: ticket.id, date: now, species: result.species, biome: ticket.config.biome,
    time: result.time, kills: result.kills, out: raw.out, got, lost, ins: insured, value, rep, contracts, xp};
  e.last = summary; e.history.unshift(clone(summary)); e.history = e.history.slice(0, 50);
  delete e.raid; refill(e);
  if(team)team.settled=true;
  return summary;
}
