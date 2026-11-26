// Local-only replacement for the published game's HTTP backend.
// No official account, API, leaderboard, or multiplayer service is contacted.
import {validateState} from "../common/state.mjs";
import {coopMaps,coopGameConfig,coopConfig,resolveCoopConfig,coopRuleTime} from "../common/coop-rules.mjs";
import {isEventMode, localEvents} from "./modes.js";
import {addRecord, ensureRecords, personalRecords} from "./records.js";
import {EVENT_POLICY, applyEventProgress, claimTrack, claimMission} from "./event-rewards.js";
import {expeditionState, expeditionActions, beginExpedition, settleExpedition,cancelExpeditionPreparation} from "./expedition.js";
import {beginTeamLedger,teamLedger,noteTeamPacket,applyTeamReturn,applyWaitingReturns} from "./expedition-ledger.js";
import {RentalLibrary} from "./rentals.js";
import {SEASONAL_MAIL_POLICY,ensureSeasonalMail,seasonalMailbox,readSeasonalMail,claimSeasonalGift,
  seasonalRunMarker,recordSeasonalParticipation} from "../common/seasonal-mail.mjs";
const STATE_KEY = "dev.nicartjay.pokebonk.offline.standard.state.v1";
const PREFS = ["settings", "lastSpecies", "lastBiome", "avatar", "frame", "title", "banner", "skins", "team"];
const copy = value => structuredClone(value);
// Upstream reward summaries contain optional undefined fields. Persist the same
// JSON representation the original server endpoint accepted, not JS-only values.
const jsonCopy = value => JSON.parse(JSON.stringify(value));
const randomId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class OfflineBackend {
  constructor({ data, rules, config, cosmetics, modes, expedition, storage, transport, now, rentals,
    seasonalPolicy = SEASONAL_MAIL_POLICY } = {}) {
    this.kind = "local";
    this.clockSkew = 0;
    this.data = data;
    this.rules = rules;
    this.config = config;
    this.cosmetics = cosmetics;
    this.modes = modes ?? {};
    this.expedition = expedition;
    this.rentals = rentals ?? new RentalLibrary();
    this.seasonalPolicy = seasonalPolicy;
    this.storage = storage ?? globalThis.localStorage;
    this.now = now ?? (() => Date.now());
    this.transport = transport ?? globalThis.PokeBonkStandardTransport;
    if (!this.transport) throw new Error("Open the installed PokéBonk Offline app. A native save bridge is required.");
    this.state = null;
    this.loading = null;
    this.queue = Promise.resolve();
  }

  normalize(profile) {
    const value = this.rules.wn(copy(profile));
    value.settings.showLadder = false;
    value.settings.teamChat = false;
    return value;
  }
  fresh(name = "Player") {
    return {
      version: 1,
      playerId: `offline-${randomId()}`,
      updatedAt: this.now(),
      // New-game allowance only. Loading/importing a profile never tops up,
      // resets or retroactively changes its existing balance.
      profile: this.normalize({ name, starter: 0, starterJ: 0, stardust: 10000, totalStardust: 10000 }),
      stash: {},
      activeRun: null,
      suspended: null,
      finished: {},
      spins: {},
    };
  }
  async init() {
    if (this.loading) return this.loading;
    if (this.state) return;
    if (!this.loading) this.loading = (async () => {
      let disk;
      try { disk = await this.transport.load(); if (disk !== null) validateState(disk); }
      catch (error) { throw new Error(`The native save could not be read and has not been overwritten. ${error.message}`); }
      // Native disk is authoritative. Never recover from an old browser/unlocked
      // key or silently replace an incompatible suspended run.
      this.state = disk ? copy(disk) : this.fresh();
      this.state.profile = this.normalize(this.state.profile);
      this.state.stash ??= {};
      this.state.finished ??= {};
      this.state.spins ??= {};
      this.state.playerId ||= `offline-${randomId()}`;
      ensureRecords(this.state, this.modes.recordMetrics);
      ensureSeasonalMail(this.state, this.now(), this.seasonalPolicy);
      // Always establish the local file save before entering the game.
      await this.persist();
    })();
    return this.loading;
  }
  async persist() {
    this.state.updatedAt = this.now();
    // A successful purchase/reward MUST mean a durable native commit. A browser
    // cache is not a substitute (especially on Android process termination).
    const durable = jsonCopy(this.state);
    validateState(durable);
    await this.transport.save(durable);
    this.state = durable;
    this.saveWarning = null;
    try {
      const mirror = copy(this.state);
      if (JSON.stringify(mirror).length > 3500000) delete mirror.suspended;
      this.storage?.setItem(STATE_KEY, JSON.stringify(mirror));
    } catch {}
  }
  async change(fn) {
    await this.init();
    const operation = this.queue.catch(() => {}).then(async () => {
      const previous = copy(this.state);
      try {
        const result = await fn(this.state.profile);
        await this.persist();
        return result;
      } catch (error) { this.state = previous; throw error; }
    });
    this.queue = operation;
    return operation;
  }
  profile() { return copy(this.state.profile); }
  account() { return { id: this.state.playerId, name: this.state.profile.name, guest: false, local: true }; }
  async restore() { await this.init(); return this.account(); }
  async guest() { return this.restore(); }
  guestSave() { return true; }
  async status() { return { maintenance: { on: false }, registration: { inviteOnly: false }, offline: true }; }
  season() {
    const calendar = typeof this.config?.Wn === "function" ? this.config.Wn(this.now()) : { n: 3 };
    return { ...calendar, live: false, ranked: false, maps: [], name: "Local play" };
  }
  events() { return localEvents(); }
  dailyChallenge() {
    if (typeof this.modes.dailyMutation !== "function") throw new Error("This build has no reviewed Daily Mutation rules.");
    return jsonCopy(this.modes.dailyMutation(this.now()));
  }
  expState() {
    return this.change(profile => {
      expeditionState(profile, this.expedition, this.now());
      return {profile: this.profile(), now: this.now()};
    });
  }
  expAction(account, actions) {
    return this.change(profile => {
      expeditionActions(profile, this.expedition, actions, this.now());
      return this.profile();
    });
  }
  recordsLocal(tab = "kos") { return copy(personalRecords(this.state, tab, this.modes.recordMetrics)); }
  seasonalMailbox() { return copy(seasonalMailbox(this.state, this.seasonalPolicy)); }
  readSeasonalMail() {
    return this.change(() => { readSeasonalMail(this.state, this.now(), this.seasonalPolicy); });
  }
  claimSeasonalGift(account, id) {
    return this.change(() => {
      claimSeasonalGift(this.state, id, this.now(), this.seasonalPolicy);
      return {profile: this.profile(), mailbox: this.seasonalMailbox()};
    });
  }
  rentalBuilds(account, species) { return this.rentals.list(species); }
  rentalIndex() { return this.rentals.index(); }
  claimEventTrack(account, id, index) {
    return this.change(profile => {
      claimTrack(profile, this.modes.eventDefinitions, id, index);
      return this.profile();
    });
  }
  claimEventQuest(account, id, mission) {
    return this.change(profile => {
      claimMission(profile, this.modes.eventDefinitions, id, mission);
      return this.profile();
    });
  }
  async loadProfile() { await this.init(); await this.queue.catch(() => {}); return this.profile(); }
  claimFirstGuide() {
    return this.change(() => {
      if (this.state.onboarding?.trainerGuide === 1) return false;
      this.state.onboarding = {...this.state.onboarding, trainerGuide: 1};
      return true;
    });
  }
  async savePrefs(account, profile) {
    return this.change(saved => {
      for (const key of PREFS) if (profile[key] !== undefined) saved[key] = copy(profile[key]);
      if (typeof this.rules.buyCard === "function") {
        // The reviewed upstream normalizer bounds card keys and look slots.
        // An empty card object explicitly clears the stored customization.
        const appearance = this.normalize({...saved, card: profile.card, looks: profile.looks});
        for (const key of ["card", "looks"]) {
          if (appearance[key] === undefined) delete saved[key];
          else saved[key] = appearance[key];
        }
      }
      saved.settings.showLadder = false;
      saved.settings.teamChat = false;
      return this.profile();
    });
  }
  async chooseStarter(account, id) {
    return this.change(profile => {
      const johto = [152, 155, 158].includes(id);
      if ((!johto && (profile.starter || ![1, 4, 7].includes(id))) ||
          (johto && (!profile.starter || profile.starterJ))) throw new Error("Choose an available starter.");
      profile[johto ? "starterJ" : "starter"] = id;
      for (const key of ["unlocked", "league", "seen"]) if (!profile[key].includes(id)) profile[key].push(id);
      profile.captured[id] = this.now();
      profile.lastSpecies = id;
      return this.profile();
    });
  }
  async actions(account, actions) {
    return this.change(profile => {
      for (const action of actions) {
        let result;
        switch (action.k) {
          case "lab": result = this.rules.Jt(profile, action.id); break;
          case "item": result = this.rules.qt(profile, action.key); break;
          case "shop": result = this.rules.Yt(profile, action.id, this.now()); break;
          case "cosmetic": result = this.rules.Kt(profile, action.id); break;
          case "card":
            if (typeof this.rules.buyCard !== "function") throw new Error("Local trainer cards are not available in this game build.");
            result = this.rules.buyCard(profile, action.key, this.data());
            break;
          case "archive": result = this.rules.Wt(profile, action.key, action.off, key => this.config.Nr.has(key)); break;
          case "move": result = this.rules.Gt(profile, action.member, action.key, action.off); break;
          case "types": result = this.rules.cn(profile, action.member, action.types); break;
          case "labOff": result = this.rules.sn(profile, action.id, action.off); break;
          case "quest": result = this.rules.Qt(profile, action.id); break;
          case "task": result = this.rules.$t(profile, action.period, action.slot, this.now()); break;
          default: throw new Error(`Unsupported local action: ${action.k}`);
        }
        if (typeof result === "string") throw new Error(result);
        if (result === false) throw new Error("That upgrade or reward is not available yet.");
      }
      return this.profile();
    });
  }
  buyLab(a, id) { return this.actions(a, [{ k: "lab", id }]); }
  buyItem(a, key) { return this.actions(a, [{ k: "item", key }]); }
  buyShop(a, id) { return this.actions(a, [{ k: "shop", id }]); }
  buyCosmetic(a, id) { return this.actions(a, [{ k: "cosmetic", id }]); }
  buyCard(a, key) { return this.actions(a, [{ k: "card", key }]); }
  archiveItem(a, key, off) { return this.actions(a, [{ k: "archive", key, off }]); }
  archiveMove(a, member, key, off) { return this.actions(a, [{ k: "move", member, key, off }]); }
  setTypesOff(a, member, types) { return this.actions(a, [{ k: "types", member, types }]); }
  setLabOff(a, id, off) { return this.actions(a, [{ k: "labOff", id, off }]); }
  claimQuest(a, id) { return this.actions(a, [{ k: "quest", id }]); }
  claimTask(a, period, slot) { return this.actions(a, [{ k: "task", period, slot }]); }
  rerollTask(a, period, slot) {
    return this.change(profile => {
      if (!this.rules.an(profile, period, slot, this.now())) throw new Error("This task cannot be rerolled yet.");
      return this.profile();
    });
  }
  async spinTreasure(account, wheelId, expected, key) {
    return this.change(profile => {
      if (this.state.spins[key]) return { profile: this.profile(), spin: copy(this.state.spins[key]) };
      const wheel = this.cosmetics.Yn(wheelId);
      if (!wheel) throw new Error("Unknown treasure wheel.");
      const won = profile.treasures?.[wheelId]?.won ?? [];
      if (won.length !== expected || won.length >= wheel.prizes.length) throw new Error("Please reopen the treasure wheel.");
      const price = this.cosmetics.Wn;
      if ((profile.bonk ?? 0) < price) throw new Error("Not enough Bonkoins.");
      const options = this.cosmetics.Jn(profile, wheel);
      let roll = Math.random(), chosen = options[options.length - 1];
      for (const option of options) { roll -= option.p; if (roll < 0) { chosen = option; break; } }
      const prize = chosen.prize;
      profile.bonk -= price;
      profile.treasures ??= {};
      profile.treasures[wheelId] = { won: [...won, prize.id] };
      for (const cosmetic of prize.cosmetics ?? []) if (!profile.cosmetics.includes(cosmetic)) profile.cosmetics.push(cosmetic);
      if (prize.bag) profile.bag[prize.bag.id] = Math.min(9, (profile.bag[prize.bag.id] ?? 0) + prize.bag.n);
      const spin = { prize: prize.id, odds: chosen.p, refund: 0 };
      this.state.spins[key] = spin;
      for (const id of Object.keys(this.state.spins).slice(0, -40)) delete this.state.spins[id];
      return { profile: this.profile(), spin };
    });
  }
  async startRun(account, config) {
    return this.change(profile => {
      const session = globalThis.PokeBonkLocalCoop?.state();
      if (config.party) {
        const ticket = this.state.activeRun?.ticket;
        if (session?.phase !== "playing" || session.match?.party !== config.party ||
            !ticket?.lan || ticket.lan.launched || ticket.party !== config.party ||
            ticket.config.species !== config.species || config.mode !== ticket.config.mode ||
            config.biome !== ticket.config.biome || config.tier !== ticket.config.tier || config.boosts?.length ||
            ["mode","biome","tier"].some(key=>config[key]!==resolveCoopConfig(session.match,this.modes.dailyMutation)[key]) ||
            ticket.lan.size !== session.members.length) {
          throw new Error("No matching, durably prepared local co-op run.");
        }
        ticket.lan.launched = true;
        if(ticket.config.mode==="expedition")teamLedger(this.state,ticket.party).ticket.lan.launched=true;
        return copy(ticket);
      }
      if (["hosting", "connecting", "lobby", "preparing", "playing"].includes(session?.phase)) {
        throw new Error("Leave the local co-op lobby before starting a single-player run.");
      }
      if (this.state.activeRun || this.state.suspended) throw new Error("An unfinished run is preserved. Continue it, or explicitly end it in Player & saves before starting another.");
      const mode = config.mode ?? "standard";
      if (!["standard", "endless", "relay", "mutation", "bossrush", "tower", "expedition"].includes(mode)) throw new Error("This mode is not part of the local single-player edition.");
      if (!profile.league.includes(config.species)) throw new Error("Choose a Pokémon in your League.");
      if (config.party || config.coop || config.duel || config.competitive || config.scav) throw new Error("Only local single-player runs are supported.");
      let daily;
      config = {...config, mode};
      if (mode === "mutation") {
        daily = this.dailyChallenge();
        if (config.biome !== daily.biome || config.tier !== daily.mutation.tier) {
          throw new Error("The local Daily Mutation changed. Reopen its Pokémon selection.");
        }
        config.mutation = daily.mutation.id;
        config.mutationDay = daily.day;
      }
      if (isEventMode(mode)) {
        const event = this.events().find(event => event.mode === mode);
        config = {...config, biome: event.biome, tier: 0};
      }
      // Event challenges, Relay and Mutation never consume backpack items.
      const boosts = ["standard", "endless"].includes(mode) ?
        [...new Set(config.boosts ?? [])].filter(id => (profile.bag[id] ?? 0) > 0) : [];
      for (const id of boosts) if (--profile.bag[id] <= 0) delete profile.bag[id];
      const values = new Uint32Array(1);
      globalThis.crypto?.getRandomValues?.(values);
      const ticket = {
        id: `offline-${randomId()}`, seed: daily?.seed ?? (values[0] || Math.floor(Math.random() * 2147483647)),
        local: true, ranked: true, clean: true, offline: false, started: this.now(),
        boosts, config: copy(config), ...(daily ? {mutation: daily.mutation.id} : {}),
        ...(isEventMode(mode) ? {eventPolicy: EVENT_POLICY} : {}),
        offlineSeason: seasonalRunMarker(this.seasonalPolicy),
      };
      if (mode === "expedition") beginExpedition(profile, this.expedition, ticket, this.now());
      this.state.activeRun = { ticket, status: "running" };
      this.state.suspended = null;
      return copy(ticket);
    });
  }
  prepareLan(session) {
    return this.change(profile => {
      const native = globalThis.PokeBonkLocalCoop?.state();
      if (!native || JSON.stringify(native) !== JSON.stringify(session) || session.phase !== "preparing" ||
          !Array.isArray(session.members) || session.members.length < 2 || session.members.length > 4 ||
          new Set(session.members.map(member => member.id)).size !== session.members.length ||
          !session.linked || !session.members.every(member => member.ready) ||
          !/^lan-[\w-]{1,80}$/.test(session.match?.party) ||
          !Number.isInteger(session.match.seed) || session.match.seed < 0 || session.match.seed > 0xffffffff ||
          !coopGameConfig(session.match) ||
          ["mode","biome","tier"].some(key=>session.match[key]!==coopConfig(session.settings)[key])) {
        throw new Error("The native local co-op session is not ready.");
      }
      const active = this.state.activeRun;
      if (active?.ticket.lan && !active.ticket.lan.launched && active.ticket.party === session.match.party &&
          active.ticket.seed === session.match.seed && active.ticket.lan.size === session.members.length) return;
      if (active || this.state.suspended) throw new Error("Your unfinished run is preserved. Finish or explicitly end it first.");
      const mine = session.members.find(member => member.id === session.me);
      if (!mine || !profile.league.includes(mine.species)) throw new Error("Choose an owned Pokémon.");
      const runConfig=resolveCoopConfig(session.match,this.modes.dailyMutation);
      if(!["mutation","bossrush","expedition"].includes(runConfig.mode)&&(coopMaps(profile.biomes)[runConfig.biome]??-1)<runConfig.tier)
        throw Error("This co-op map or difficulty has not been earned on this device.");
      const ticket = {
        id: `offline-${randomId()}`, seed: session.match.seed, party: session.match.party,
        local: true, ranked: true, clean: true, offline: false, started: this.now(), boosts: [],
        config: {species: mine.species,...runConfig},
        coopRulesAt:coopRuleTime(session.match.rulesAt??this.now()),
        ...(runConfig.mode==="mutation"?{mutation:runConfig.mutation}:{}),
        ...(runConfig.mode==="bossrush"?{eventPolicy:EVENT_POLICY}:{}),
        lan: {version: 2, party: session.match.party, me: session.me, size: session.members.length, launched: false},
        offlineSeason: seasonalRunMarker(this.seasonalPolicy),
      };
      if(runConfig.mode==="expedition"){
        beginExpedition(profile,this.expedition,ticket,this.now());
        beginTeamLedger(this.state,ticket,session.members,this.now());
      }
      this.state.activeRun = {ticket, status: "running"};
    });
  }
  cancelPreparedLan(party) {
    return this.change(profile => {
      const ticket = this.state.activeRun?.ticket;
      if (ticket?.party === party && ticket.lan?.launched === false){
        if(ticket.config.mode==="expedition"){
          cancelExpeditionPreparation(profile,ticket);
          delete this.state.expeditionTeams.parties[party];
        }
        this.state.activeRun = null;
      }
    });
  }
  recordExpeditionPacket(value){
    return this.change(()=>noteTeamPacket(this.state,this.expedition,value,this.now()));
  }
  expeditionReturns(party){return copy(teamLedger(this.state,party).pending);}
  receiveExpeditionReturn(party,peer,data){
    return this.change(()=>applyTeamReturn(this.state,this.expedition,party,peer,data));
  }
  acknowledgeExpeditionReturn(party,peer,id){
    return this.change(()=>{
      const group=teamLedger(this.state,party);
      group.pending=group.pending.filter(receipt=>receipt.to!==peer||receipt.id!==id);
    });
  }
  async finishRun(account, ticket, result) {
    const room=globalThis.PokeBonkNativeApp?.coopRoom;
    if(ticket.config?.mode==="expedition"&&ticket.lan)await room?.expeditionIO?.flush();
    let newlySettled=false;
    const settled=await this.change(profile => {
      if (this.state.finished[ticket.id]) {
        const info = copy(this.state.finished[ticket.id]);
        return {profile: this.profile(), ...info, local: true, ranked: !info.offlineChallenge};
      }
      if (!ticket.id?.startsWith("offline-")) throw new Error("This is not a local game.");
      if (this.state.activeRun?.ticket.id !== ticket.id) throw new Error("This run is not the active local run.");
      ticket = this.state.activeRun.ticket;
      if (ticket.lan) {
        if (!ticket.lan.launched || result.coop?.party !== ticket.party || result.coop?.size !== ticket.lan.size) {
          throw new Error("The co-op result does not match its local run ticket.");
        }
      } else if (result.coop) throw new Error("A single-player ticket cannot settle a co-op result.");
      const runConfig = ticket.config ?? {}, hasConfig = Number.isInteger(runConfig.species);
      const mode = runConfig.mode ?? (!hasConfig ? result.mode : undefined) ?? "standard";
      // Some compatible legacy schema-1 tickets retained only id/seed. They
      // predate offline events: accept only an owned Pokémon in an original
      // progression mode, rather than breaking settlement or inventing an
      // event/mutation ruleset that was never recorded.
      if (!hasConfig && (!["standard", "endless", "relay"].includes(mode) || !profile.league.includes(result.species))) {
        throw new Error("This unfinished run needs its original app version; its configuration is preserved.");
      }
      if ((result.mode ?? "standard") !== mode || hasConfig && result.species !== runConfig.species ||
          runConfig.biome && result.biome !== runConfig.biome) throw new Error("The result does not match the active local run.");
      if (mode === "mutation" && result.mutation !== runConfig.mutation) throw new Error("The Daily Mutation rules do not match this ticket.");
      const normalized = {
        ...result,
        progress: { counters: {}, research: {}, seen: [], league: [], shinies: [], classics: [], forms: [], ...result.progress },
      };
      if (isEventMode(mode) && ticket.eventPolicy != null && ticket.eventPolicy !== EVENT_POLICY) {
        throw new Error("This unfinished event run needs its original app version. It is preserved.");
      }
      const legacyEvent = isEventMode(mode) && ticket.eventPolicy !== EVENT_POLICY;
      const previousEvents = copy(profile.events ?? {});
      const team=mode==="expedition"&&ticket.lan?teamLedger(this.state,ticket.party):undefined;
      const expeditionInfo = mode === "expedition" ? settleExpedition(profile, this.expedition, ticket, normalized, this.now(),{team}) : null;
      if(team)applyWaitingReturns(this.state,this.expedition,team);
      const info = legacyEvent ? {
        // 0.1.3 tickets promised records-only settlement. Never silently turn
        // an imported/unfinished old challenge into a reward-bearing run.
        offlineChallenge: true, ranked: false,
        record: jsonCopy({...normalized, progress: undefined, id: ticket.id, seed: ticket.seed, date: this.now()}),
        stardust: 0, runDust: 0, shinyDust: 0, medal: 0, medalDust: 0,
        joined: [], forms: [], bonk: 0, tasks: [], events: [],
      } : this.rules.Ut(profile, normalized, this.data(), {
        ...ticket, uid: this.state.playerId, now: this.now(), clean: true, ranked: true, coop: Boolean(ticket.lan),
      });
      if (!legacyEvent && Array.isArray(this.modes.eventDefinitions)) {
        // The shared upstream settlement also has calendar-gated event logic.
        // Replace ONLY that accounting with the permanent local formulas so
        // a run cannot earn the same points twice while its event is "live".
        profile.events = previousEvents;
        info.events = applyEventProgress(profile, normalized, this.modes.eventDefinitions);
        if (isEventMode(mode)) {
          info.localEventRewards = true;
          // Upstream's compact recent-run record omits event-specific detail.
          // Keep it for local bests, exports and future compatibility backfill.
          for (const key of ["rush", "tower"]) if (normalized[key]) info.record[key] = copy(normalized[key]);
        }
      }
      const records = ensureRecords(this.state, this.modes.recordMetrics);
      if (expeditionInfo) info.exp = expeditionInfo;
      // Upstream co-op rewards are allowed, but shared-run metrics must never
      // overwrite solo personal bests. Keep an independent local ledger.
      const targetRecords = ticket.lan ? (this.state.lanRecords ??= {version: 1, kos: {}, survival: {}, time: {}}) : records;
      addRecord(targetRecords, {...normalized, ...info.record,
        ...(runConfig.mutationDay != null ? {mutationDay: runConfig.mutationDay} : {})}, this.modes.recordMetrics);
      this.state.finished[ticket.id] = copy(info);
      if (!legacyEvent) recordSeasonalParticipation(this.state, ticket, normalized, this.now(), this.seasonalPolicy);
      for (const id of Object.keys(this.state.finished).slice(0, -100)) delete this.state.finished[id];
      this.state.activeRun = null;
      this.state.suspended = null;
      newlySettled=true;
      // "ranked" is the original client's progression-eligibility flag here;
      // this local result is never submitted to a leaderboard.
      return { profile: this.profile(), ...info, local: true, ranked: !info.offlineChallenge };
    });
    if(newlySettled&&ticket.config?.mode==="expedition"&&ticket.lan)room?.expeditionIO?.settled();
    else if(newlySettled&&ticket.lan)globalThis.PokeBonkLocalCoop?.send?.("room-return",ticket.party);
    return settled;
  }
  checkpoint(account, ticket, result) {
    if (ticket && result && this.state?.activeRun?.ticket.id === ticket.id &&
        this.state.activeRun.ticket.lan) return this.change(() => {
      if(this.state.activeRun?.ticket.id===ticket.id)this.state.activeRun.lastResult = jsonCopy(result);
    });
    if (this.state?.activeRun?.ticket.config?.mode === "expedition") {
      return this.checkpointExpedition(ticket, result);
    }
    if (ticket && result && this.state?.activeRun?.ticket.id === ticket.id) this.state.activeRun.lastResult = copy(result);
  }
  checkpointExpedition(ticket, result) {
    return this.change(() => {
      const active = this.state.activeRun;
      if (active?.ticket.id !== ticket?.id || active.ticket.config?.mode !== "expedition") return;
      if (!result?.exp || result.mode !== "expedition" || result.species !== active.ticket.config.species) throw new Error("Invalid Expedition checkpoint.");
      active.lastResult = jsonCopy(result);
    });
  }
  // Compatibility for the original offline integration. New adapters resolve
  // the current client's checkpoint method structurally and bind checkpoint().
  $14ligir(account, ticket, result) { this.checkpoint(account, ticket, result); }
  async suspendRun(account, ticket) {
    return this.change(() => {
      if (this.state.activeRun?.ticket.id !== ticket.id) throw new Error("Unknown suspended run.");
      this.state.activeRun = { ticket: copy(ticket), status: "suspended" };
    });
  }
  async resumeRun(account, ticket) {
    return this.change(() => {
      if (this.state.activeRun?.ticket.id !== ticket.id) throw new Error("Unknown saved run.");
      this.state.activeRun = { ticket: copy(ticket), status: "running" };
      // Keep the last checkpoint until a later checkpoint or settlement commits.
    });
  }
  recoverRun(a, ticket) { return this.resumeRun(a, ticket); }
  async uploadSave(account, ticket, hash, text) {
    await this.change(() => {
      if (typeof text !== "string") throw new Error("Invalid local saved game.");
      if (this.state.activeRun?.ticket.id !== ticket.id) throw new Error("Unknown saved run.");
      this.state.suspended = { ticket: copy(ticket), hash, text, at: this.now() };
    });
    return true;
  }
  async savedOnServer() {
    await this.init();
    const save = this.state.suspended;
    return save ? { id: save.ticket.id, hash: save.hash, blob: true, at: save.at } : null;
  }
  async downloadSave(account, id) {
    const save = this.state.suspended;
    return save?.ticket.id === id ? copy(save) : null;
  }
  async autoWaiting() { return this.state?.activeRun?.status === "running"; }
  async discardSaved() {
    await this.change(profile => {
      const active = this.state.activeRun, ticket = active?.ticket;
      if (ticket?.config?.mode === "expedition") {
        const entry = ticket.exp;
        const result = active.lastResult ?? {species: ticket.config.species, time: 0, kills: 0, exp: {
          out: false, loot: [], gear: Object.fromEntries(Object.entries(entry.gear).map(([s, item]) => [s, "e" + item.id])),
          bag: entry.bag.map(item => "e" + item.id), pocket: entry.pocket ? "e" + entry.pocket.id : null,
        }};
        // Explicit abandonment is a defeat, never a free extraction. A saved
        // pocket/insured loadout can return, but unextracted loot cannot.
        if(ticket.lan&&!ticket.lan.launched){
          cancelExpeditionPreparation(profile,ticket);
          delete this.state.expeditionTeams?.parties?.[ticket.party];
        }else{
          const team=ticket.lan?teamLedger(this.state,ticket.party):undefined;
          settleExpedition(profile, this.expedition, ticket, {...result, exp: {...result.exp, out: false}}, this.now(), {abandoned: true,team});
          if(team)applyWaitingReturns(this.state,this.expedition,team);
        }
      }
      this.state.activeRun = this.state.suspended = null;
    });
  }
  hasPending() { return false; }
  async retryNow() { return { left: 0, saved: 0 }; }
  afterRun() {}
  async stashGet() { await this.init(); return copy(this.state.stash); }
  async stashPut(account, key, data, updated) {
    return this.change(() => {
      this.state.stash[key] = { data: copy(data), updated };
      return { kept: false, data: copy(data), updated };
    });
  }
  async renameLocal(name) {
    return this.change(profile => {
      name = String(name).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 24);
      if (!name) throw new Error("Enter a player name.");
      profile.name = name;
      this.state.onboarding = {...this.state.onboarding, playerName: 1};
      return this.profile();
    });
  }
  async exportSave() {
    await this.init(); await this.queue.catch(() => {});
    return this.transport.export ? this.transport.export(jsonCopy(this.state)) : jsonCopy(this.state);
  }
  async importSave(value) {
    value = this.transport.import ? this.transport.import(value) : value;
    try { validateState(value); } catch (error) { throw new Error(`Choose a compatible PokéBonk Offline save backup. ${error.message}`); }
    return this.change(() => {
      this.state = copy(value);
      this.state.profile = this.normalize(this.state.profile);
      this.state.stash ??= {};
      this.state.finished ??= {};
      this.state.spins ??= {};
      this.state.playerId ||= `offline-${randomId()}`;
      ensureRecords(this.state, this.modes.recordMetrics);
      ensureSeasonalMail(this.state, this.now(), this.seasonalPolicy);
    });
  }
}
