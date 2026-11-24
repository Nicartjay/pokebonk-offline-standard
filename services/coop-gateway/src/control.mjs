import {POLICY, MATCH_RULES, internetMode, roomCodeValid, coopProtocol, Fault, requireValue, body, json, hash, randomToken, freshUsage, relayAdmission, turnServers} from "./policy.mjs";
import {readAccountUsage} from "./usage.mjs";

export class CoopControl {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async schedule(at) {
    const previous=await this.ctx.storage.getAlarm();
    if(previous===null||previous>at)await this.ctx.storage.setAlarm(at);
  }
  async recordUsage(usage) {
    freshUsage(usage);
    const storage = this.ctx.storage, state = await storage.get("budget") ?? {}, previous = state.usage;
    if (previous?.periodStart === usage.periodStart) {
      requireValue(previous.periodEnd === usage.periodEnd && previous.subscriptionId === usage.subscriptionId &&
        usage.asOf >= previous.asOf, 409, "usage_period_changed");
      // Adaptive analytics can revise a sample downward. Keep the high-water
      // mark instead of reopening spent capacity.
      usage.bytes = Math.max(previous.bytes, usage.bytes);
    } else {
      requireValue(!previous || usage.periodStart >= previous.periodEnd, 409, "billing_period_overlap");
      // Credentials that cross a real billing boundary retain their FULL
      // reservation in the new period. Ambiguous issuances are not refunded.
      state.reservedBytes = [...(await storage.list({prefix:"lease:"})).values()]
        .filter(lease => lease.expiresAt > usage.periodStart)
        .reduce((sum, lease) => sum + (lease.reservationBytes ?? POLICY.reservationBytes), 0);
    }
    state.usage = usage;state.meterError=null;
    await storage.put("budget", state);
    return state;
  }
  async refreshUsage(force = false) {
    const storage = this.ctx.storage, state = await storage.get("budget") ?? {};
    if (!force && state.usage?.asOf > Date.now() - POLICY.usageRefreshMs) return state;
    try { return await this.recordUsage(await readAccountUsage(this.env)); }
    catch(error) {
      await storage.put("budget", {...state, disabled:true, disabledReason:"usage_monitor_failed",
        meterError:error instanceof Fault ? error.code : "usage_monitor_failed"});
      await this.markRevoked({});
      await this.schedule(Date.now() + 1000);
      throw new Fault(503, "fresh_account_usage_required");
    }
  }
  async fetch(request) {
    // Catch expected admission denials inside the gate: letting the callback
    // reject resets the real Durable Object, even with a catch outside it.
    return this.ctx.blockConcurrencyWhile(async()=>{
      try{return await this.route(request);}
      catch(error){return json({error:error instanceof Fault?error.code:"control_unavailable"},error.status??503);}
    });
  }
  async route(request) {
    const route = new URL(request.url).pathname, storage = this.ctx.storage, now = Date.now();
    if (route === "/status") {
      const state = await storage.get("budget") ?? {};
      const leases = [...(await storage.list({prefix: "lease:"})).values()];
      return json({turnMode: this.env.TURN_MODE, disabled: state.disabled === true, usage: state.usage ?? null,
        disabledReason:state.disabledReason ?? null, meterError:state.meterError ?? null,
        monitorConfigured:/^[a-f0-9]{32}$/.test(this.env.CF_ACCOUNT_ID??"") && typeof this.env.CF_USAGE_API_TOKEN==="string",
        pendingLeases:leases.filter(lease=>lease.pending).length,
        reservedBytes: state.reservedBytes ?? 0, liveLeases: leases.length, cutoffBytes: POLICY.cutoffBytes, hardBillingCap: false});
    }
    if (route === "/refresh") {
      requireValue(this.env.TURN_MODE === "guarded-payg", 503, "turn_disabled");
      const state = await this.refreshUsage(true);
      await this.schedule(now + 1000);
      return json({recorded:true, disabled:state.disabled === true, hardBillingCap:false});
    }
    if (route === "/resume") {
      const state = await this.refreshUsage(true), leases = await storage.list({prefix:"lease:"});
      requireValue(![...leases.values()].some(lease=>lease.pending || lease.revoke), 503, "revocation_or_issuer_review_required");
      relayAdmission({env:this.env, usage:state.usage, reservedBytes:state.reservedBytes ?? 0});
      delete state.issuancePending;
      await storage.put("budget", {...state, disabled:false, disabledReason:null});
      return json({resumed:true, hardBillingCap:false});
    }
    if (route === "/register-room") {
      const value = await body(request), key = `room:${value.code}`;
      requireValue(roomCodeValid(value.code) && value.code.length===(coopProtocol(value.protocolVersion)===2?6:8)&&
        /^[a-f0-9]{64}$/.test(value.client), 400, "invalid_registration");
      const rooms = await storage.list({prefix: "room:"});
      for (const [name, room] of rooms) if (room.expiresAt <= now) { await storage.delete(name); rooms.delete(name); }
      requireValue(!rooms.has(key), 409, "code_collision");
      requireValue(rooms.size < POLICY.maxRooms, 429, "room_capacity_reached");
      const rateKey = `create-rate:${value.client}`;
      const rate = await storage.get(rateKey);
      requireValue(!rate || rate.until <= now || rate.count < POLICY.maxRoomCreatesPerHour, 429, "room_creation_rate_limited");
      await storage.put(rateKey, rate?.until > now ? {...rate, count: rate.count + 1} : {until: now + 3600000, count: 1});
      internetMode(value.connectionMode);
      requireValue(typeof value.buildId==="string"&&value.buildId.length<=256&&/^[A-Za-z0-9_-]{22}$/.test(value.generation),400,"invalid_registration");
      await storage.put(key, {expiresAt: now + POLICY.roomLifetimeMs, buildId:value.buildId, connectionMode:value.connectionMode,
        generation:value.generation, rules:MATCH_RULES, discoverable:value.discoverable===true,protocolVersion:coopProtocol(value.protocolVersion)});
      await this.schedule(now + 60000);
      return json({registered: true});
    }
    if(route==="/unregister-room"){
      const value=await body(request),key=`room:${value.code}`,room=await storage.get(key);
      if(room&&room.generation===value.generation)await storage.delete(key);
      return json({removed:true});
    }
    if(route==="/matchmaking"){
      const value=await body(request);internetMode(value.connectionMode);const protocolVersion=coopProtocol(value.protocolVersion);
      requireValue(/^[a-f0-9]{64}$/.test(value.client)&&Array.isArray(value.exclude)&&value.exclude.length<=POLICY.maxRooms&&
        value.exclude.every(roomCodeValid),400,"invalid_matchmaking_request");
      const key=`find-rate:${value.client}`,rate=await storage.get(key);
      requireValue(!rate||rate.until<=now||rate.count<20,429,"matchmaking_rate_limited");
      await storage.put(key,rate?.until>now?{...rate,count:rate.count+1}:{count:1,until:now+60000});
      await this.schedule(now+60000);
      const candidates=[];
      for(const [key,room] of await storage.list({prefix:"room:"})){
        if(room.expiresAt<=now){await storage.delete(key);continue;}
        const code=key.slice(5);
        if(room.discoverable&&room.buildId===value.buildId&&room.connectionMode===value.connectionMode&&
          (room.protocolVersion??1)===protocolVersion&&room.rules===MATCH_RULES&&!value.exclude.includes(code))
          candidates.push(code);
      }
      return json({rooms:candidates.slice(0,POLICY.maxRooms)});
    }
    if (route === "/disable") {
      const state = await storage.get("budget") ?? {};
      await storage.put("budget", {...state, disabled: true, disabledReason:"operator_disabled"});
      await this.markRevoked({});
      await this.revokeLeases(true);
      await this.schedule(now + 1000);
      return json({disabled: true});
    }
    if (route === "/release") {
      const value = await body(request);
      requireValue(roomCodeValid(value.room) && /^[A-Za-z0-9_-]{22}$/.test(value.generation) &&
        (value.member === undefined || /^[A-Za-z0-9_-]{16,64}$/.test(value.member)),400,"invalid_relay_member");
      await this.markRevoked(value);
      await this.revokeLeases();
      await this.schedule(now + 1000);
      return json({released:true});
    }
    if (route === "/issue") {
      const value = await body(request);
      requireValue(roomCodeValid(value.room) && /^[A-Za-z0-9_-]{22}$/.test(value.generation) &&
        /^[A-Za-z0-9_-]{16,64}$/.test(value.member), 400, "invalid_relay_member");
      requireValue(this.env.TURN_MODE === "guarded-payg" && this.env.TURN_PAYG_RISK_ACCEPTED === "true",503,"turn_disabled");
      const group = await hash(value.room + "|" + value.generation + "|" + value.member);
      const state = await this.refreshUsage();
      const leases = await storage.list({prefix: "lease:"});
      if (state.issuancePending || [...leases.values()].some(lease=>lease.pending)) {
        await storage.put("budget",{...state,disabled:true,disabledReason:"ambiguous_credential_issuance"});
        await this.markRevoked({});await this.schedule(Date.now()+1000);
        throw new Fault(503,"issuer_requires_operator_review");
      }
      const memberLeases = [...leases.values()].filter(lease=>lease.group === group);
      requireValue(!memberLeases.some(lease=>lease.pending || lease.revoke),503,"credential_rotation_pending");
      const existing = memberLeases.sort((a,b)=>b.expiresAt-a.expiresAt)[0];
      // Re-check the kill switch and fresh usage even when reusing credentials.
      const reuse = existing?.expiresAt > Date.now() + POLICY.credentialRotateBeforeMs && existing.iceServers;
      const admission = relayAdmission({env:this.env, usage:state.usage, reservedBytes:state.reservedBytes ?? 0,
        activeLeases:reuse ? leases.size-1 : leases.size, disabled:state.disabled, reuse:Boolean(reuse)});
      if (reuse) return json({iceServers:existing.iceServers, expiresAt:existing.expiresAt});
      requireValue(memberLeases.length < 2, 429, "credential_rotation_pending");
      const groups = new Set([...leases.values()].map(lease=>lease.group));
      requireValue(groups.has(group) || groups.size < POLICY.maxRelayMembers,429,"relay_capacity_reached");
      requireValue(typeof this.env.TURN_TOKEN_ID === "string" && /^[a-f0-9]{32}$/.test(this.env.TURN_TOKEN_ID) &&
        typeof this.env.TURN_API_TOKEN === "string" && this.env.TURN_API_TOKEN.length >= 24, 503, "issuer_not_configured");
      // Persist the reservation BEFORE calling the provider. A timeout/crash
      // may have created a credential: never automatically refund or retry it.
      const key = "lease:" + group + ":" + randomToken(16);
      const lease = {room:value.room,generation:value.generation,member:value.member,group,
        expiresAt:admission.expiresAt,reservationBytes:admission.reservationBytes};
      state.reservedBytes = (state.reservedBytes ?? 0) + admission.reservationBytes;
      state.issuancePending = key;
      await storage.put("budget", state);
      await storage.put(key, {...lease, pending:true});
      await this.schedule(now + 60000);
      try {
        const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_TOKEN_ID}/credentials/generate-ice-servers`, {
          method: "POST", headers: {Authorization: `Bearer ${this.env.TURN_API_TOKEN}`, "Content-Type": "application/json"},
          body: JSON.stringify({ttl: POLICY.credentialTtlSeconds, customIdentifier:"pb-"+group.slice(0,32)}),
          signal: AbortSignal.timeout(8000), redirect: "manual",
        });
        requireValue(response.status === 201, 502, "credential_issuer_unavailable");
        const iceServers = turnServers(await response.json());
        await storage.put(key, {...lease, iceServers});
        delete state.issuancePending;
        await storage.put("budget",state);
        return json({iceServers, expiresAt: admission.expiresAt});
      } catch {
        // An ambiguous issuance poisons the gate until an operator reconciles
        // it. Do not mint untracked replacement credentials.
        await storage.put("budget", {...state, disabled: true, disabledReason:"ambiguous_credential_issuance"});
        await this.markRevoked({});
        await this.schedule(Date.now()+1000);
        throw new Fault(503, "issuer_requires_operator_review");
      }
    }
    throw new Fault(404, "not_found");
  }
  async markRevoked({room,generation,member}) {
    for (const [key,lease] of await this.ctx.storage.list({prefix:"lease:"})) {
      if ((!room || lease.room === room) && (!generation || lease.generation === generation) && (!member || lease.member === member))
        await this.ctx.storage.put(key,{...lease,revoke:true});
    }
  }
  async revokeLeases(force = false) {
    const storage = this.ctx.storage, now = Date.now();
    const leases = [...await storage.list({prefix:"lease:"})];
    // At most eight concurrent revocations/event; bounded time/subrequests,
    // rather than a 32*5-second loop inside a Durable Object gate.
    await Promise.all(leases.filter(([,lease])=>force || lease.revoke || lease.expiresAt <= now).slice(0,8).map(async([key,lease])=>{
      if (lease.expiresAt + 60000 <= now) { await storage.delete(key); return; }
      if (lease.pending) return; // Ambiguous issuances require operator review.
      let revoked = true;
      for (const server of lease.iceServers ?? []) {
        try {
          const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${this.env.TURN_TOKEN_ID}/credentials/${encodeURIComponent(server.username)}/revoke`, {
            method: "POST", headers: {Authorization: `Bearer ${this.env.TURN_API_TOKEN}`},
            signal: AbortSignal.timeout(5000), redirect: "manual",
          });
          if (response.status !== 204) revoked = false;
        } catch { revoked = false; }
      }
      // Retain failed revocations for retries; do not silently forget them.
      if (revoked) await storage.delete(key);
    }));
  }
  async alarm() { return this.ctx.blockConcurrencyWhile(async()=>{
    try { await this.runAlarm(); }
    catch { await this.schedule(Date.now()+10000); }
  }); }
  async runAlarm() {
    const storage = this.ctx.storage, now = Date.now();
    let state = await storage.get("budget") ?? {};
    let unsafe = state.disabled === true || Boolean(state.issuancePending);
    if ((await storage.list({prefix: "lease:", limit: 1})).size) {
      try {
        if (this.env.TURN_MODE !== "guarded-payg" || this.env.TURN_PAYG_RISK_ACCEPTED !== "true") throw new Fault(503,"turn_disabled");
        state = await this.refreshUsage();
        freshUsage(state.usage);
        unsafe ||= state.usage.bytes + (state.reservedBytes ?? 0) >= Math.min(Number(this.env.TURN_CUTOFF_BYTES), POLICY.cutoffBytes);
      } catch { unsafe = true; }
    }
    if (unsafe) {
      // A stale meter does not silently recover. An operator must review it.
      await storage.put("budget", {...(await storage.get("budget")??state), disabled: true,
        disabledReason:state.disabledReason ?? "unsafe_usage_or_budget"});
      await this.markRevoked({});
    }
    await this.revokeLeases(unsafe);
    for (const [key, room] of await storage.list({prefix: "room:"})) if (room.expiresAt <= now) await storage.delete(key);
    for (const [key, rate] of await storage.list({prefix: "create-rate:"})) if (rate.until <= now) await storage.delete(key);
    for (const [key, rate] of await storage.list({prefix: "find-rate:"})) if (rate.until <= now) await storage.delete(key);
    if ((await storage.list({prefix: "lease:", limit: 1})).size ||
        (await storage.list({prefix: "room:", limit: 1})).size ||
        (await storage.list({prefix: "create-rate:", limit: 1})).size ||
        (await storage.list({prefix: "find-rate:", limit: 1})).size) await this.schedule(now + (unsafe ? 10000 : 60000));
  }
}
