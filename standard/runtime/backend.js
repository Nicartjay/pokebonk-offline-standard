// Local-only replacement for the published game's HTTP backend.
// No official account, API, leaderboard, or multiplayer service is contacted.
import {validateState} from "../common/state.mjs";
import {isEventMode, localEvents} from "./modes.js";
import {addRecord, ensureRecords, personalRecords} from "./records.js";
import {EVENT_POLICY, applyEventProgress, claimTrack, claimMission} from "./event-rewards.js";
const STATE_KEY = "dev.nicartjay.pokebonk.offline.standard.state.v1";
const PREFS = ["settings", "lastSpecies", "lastBiome", "avatar", "frame", "title", "banner", "skins", "team"];
const copy = value => structuredClone(value);
// Upstream reward summaries contain optional undefined fields. Persist the same
// JSON representation the original server endpoint accepted, not JS-only values.
const jsonCopy = value => JSON.parse(JSON.stringify(value));
const randomId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class OfflineBackend {
  constructor({ data, rules, config, cosmetics, modes, storage, transport, now } = {}) {
    this.kind = "local";
    this.clockSkew = 0;
    this.data = data;
    this.rules = rules;
    this.config = config;
    this.cosmetics = cosmetics;
    this.modes = modes ?? {};
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
  recordsLocal(tab = "kos") { return copy(personalRecords(this.state, tab, this.modes.recordMetrics)); }
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
      if (this.state.activeRun || this.state.suspended) throw new Error("An unfinished run is preserved. Continue it, or explicitly end it in Player & saves before starting another.");
      const mode = config.mode ?? "standard";
      if (!["standard", "endless", "relay", "mutation", "bossrush", "tower"].includes(mode)) throw new Error("This mode is not part of the local single-player edition.");
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
      };
      this.state.activeRun = { ticket, status: "running" };
      this.state.suspended = null;
      return copy(ticket);
    });
  }
  async finishRun(account, ticket, result) {
    return this.change(profile => {
      if (this.state.finished[ticket.id]) {
        const info = copy(this.state.finished[ticket.id]);
        return {profile: this.profile(), ...info, local: true, ranked: !info.offlineChallenge};
      }
      if (!ticket.id?.startsWith("offline-")) throw new Error("This is not a local game.");
      if (this.state.activeRun?.ticket.id !== ticket.id) throw new Error("This run is not the active local run.");
      ticket = this.state.activeRun.ticket;
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
      const info = legacyEvent ? {
        // 0.1.3 tickets promised records-only settlement. Never silently turn
        // an imported/unfinished old challenge into a reward-bearing run.
        offlineChallenge: true, ranked: false,
        record: jsonCopy({...normalized, progress: undefined, id: ticket.id, seed: ticket.seed, date: this.now()}),
        stardust: 0, runDust: 0, shinyDust: 0, medal: 0, medalDust: 0,
        joined: [], forms: [], bonk: 0, tasks: [], events: [],
      } : this.rules.Ut(profile, normalized, this.data(), {
        ...ticket, uid: this.state.playerId, now: this.now(), clean: true, ranked: true, coop: false,
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
      addRecord(records, {...normalized, ...info.record,
        ...(runConfig.mutationDay != null ? {mutationDay: runConfig.mutationDay} : {})}, this.modes.recordMetrics);
      this.state.finished[ticket.id] = copy(info);
      for (const id of Object.keys(this.state.finished).slice(0, -100)) delete this.state.finished[id];
      this.state.activeRun = null;
      this.state.suspended = null;
      // "ranked" is the original client's progression-eligibility flag here;
      // this local result is never submitted to a leaderboard.
      return { profile: this.profile(), ...info, local: true, ranked: !info.offlineChallenge };
    });
  }
  checkpoint(account, ticket, result) {
    if (ticket && result && this.state?.activeRun?.ticket.id === ticket.id) this.state.activeRun.lastResult = copy(result);
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
  async discardSaved() { await this.change(() => { this.state.activeRun = this.state.suspended = null; }); }
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
    });
  }
}
