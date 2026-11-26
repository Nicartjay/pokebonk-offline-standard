// Reviewed local reward catalog. This is not the website's mailbox or ranking
// service. Never infer eligibility from the wall clock or accept reward IDs
// supplied by a save, message, peer or renderer.
const reward = (id, name) => Object.freeze({id, name});
const gift = value => Object.freeze({...value, rewards: Object.freeze(value.rewards)});
export const SEASONAL_MAIL_POLICY = Object.freeze({
  version: 1,
  current: "season-4",
  archiveThrough: 4,
  seasons: Object.freeze([
    Object.freeze({id: "season-1", number: 1, name: "Season 1", closed: true,
      gift: gift({id: "season-1-archive", title: "Welcome back to Kanto!",
        text: "The Season 1 keepsakes are yours to collect in PokéBonk Offline. Enjoy the original Kanto Pioneer avatar and PokéBonk Pioneer title.",
        eligibility: "archive", previewAvatar: "tr:pioneer",
        rewards: [reward("tr:pioneer", "Kanto Pioneer"), reward("title:s1", "PokéBonk Pioneer")]})}),
    Object.freeze({id: "season-2", number: 2, name: "Season 2", closed: true,
      gift: gift({id: "season-2-archive", title: "A keepsake from the Frozen Storm",
        text: "Bring the Storm Coast and Celestial Glacier with you. Claim the original Frozen Storm frame and Storm Veteran title as an offline archive gift.",
        eligibility: "archive", previewFrame: "s2",
        rewards: [reward("frame:s2", "Frozen Storm"), reward("title:s2", "Storm Veteran")]})}),
    Object.freeze({id: "season-3", number: 3, name: "Season 3", closed: true,
      gift: gift({id: "season-3-archive", title: "The Season 3 frame collection",
        text: "All five Season 3 frames are available in this offline collection. These are cosmetic archive unlocks, not online ranking awards or clan membership.",
        eligibility: "archive", previewFrame: "s3i-1",
        rewards: [
          reward("frame:s3c-1", "Tin Tower Phoenix"), reward("frame:s3c-2", "Bell Tower"),
          reward("frame:s3c-3", "Johto Lantern"), reward("frame:s3i-1", "Lord of the Whirlpool"),
          reward("frame:s3i-2", "Crystal Aurora"),
        ]})}),
    // No Season 4 gift is invented. When actual Season 4 cosmetics are reviewed,
    // add their gift with eligibility:"archive", even while this season is live.
    // Participation requirements apply only beyond the approved 1–4 archive.
    Object.freeze({id: "season-4", number: 4, name: "Season 4", closed: false, gift: null}),
  ]),
});

const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const uint = value => Number.isSafeInteger(value) && value >= 0;
const seasonId = value => typeof value === "string" && /^season-[1-9]\d{0,4}$/.test(value);
const messageId = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/.test(value);
const fail = text => { throw new Error(text); };

export function validateSeasonalMail(value) {
  if (value == null) return;
  if (!object(value) || value.version !== 1 || !object(value.participation) ||
      !object(value.messages) || Object.keys(value.participation).length > 256 ||
      Object.keys(value.messages).length > 512) {
    fail("Unsupported seasonal mailbox format. Keep the original save.");
  }
  for (const [id, entry] of Object.entries(value.participation)) {
    if (!seasonId(id) || !object(entry) || !uint(entry.runs) || entry.runs < 1 ||
        !uint(entry.firstAt) || !uint(entry.lastAt) || entry.lastAt < entry.firstAt) {
      fail("Invalid seasonal participation record.");
    }
  }
  for (const [id, entry] of Object.entries(value.messages)) {
    if (!messageId(id) || !object(entry) || !uint(entry.deliveredAt) ||
        typeof entry.read !== "boolean" || entry.claimedAt !== null &&
        (!uint(entry.claimedAt) || entry.claimedAt < entry.deliveredAt)) {
      fail("Invalid seasonal mail receipt.");
    }
  }
}

export function validateSeasonalTicket(value) {
  if (value == null) return;
  if (!object(value) || value.version !== 1 || !seasonId(value.id)) {
    fail("Unsupported seasonal run marker. Keep the original run.");
  }
}

export function currentSeason(policy = SEASONAL_MAIL_POLICY) {
  const current = policy.seasons.filter(season => season.id === policy.current && !season.closed);
  if (policy.version !== 1 || current.length !== 1) fail("Unsupported bundled offline season.");
  return current[0];
}

export function seasonalRunMarker(policy = SEASONAL_MAIL_POLICY) {
  return {version: 1, id: currentSeason(policy).id};
}

function qualifies(book, season, policy) {
  if (!season.gift) return false;
  return season.gift.eligibility === "archive" && season.number <= policy.archiveThrough ||
    season.closed && season.gift.eligibility === "participation" && (book.participation[season.id]?.runs ?? 0) > 0;
}

export function ensureSeasonalMail(state, now, policy = SEASONAL_MAIL_POLICY) {
  validateSeasonalMail(state.seasonalMail);
  if (!uint(now)) fail("Invalid seasonal mailbox timestamp.");
  const book = state.seasonalMail ??= {version: 1, participation: {}, messages: {}};
  for (const season of policy.seasons) {
    if (!qualifies(book, season, policy)) continue;
    book.messages[season.gift.id] ??= {deliveredAt: now, read: false, claimedAt: null};
  }
  return book;
}

export function recordSeasonalParticipation(state, ticket, result, now, policy = SEASONAL_MAIL_POLICY) {
  const book = ensureSeasonalMail(state, now, policy), marker = ticket.offlineSeason;
  validateSeasonalTicket(marker);
  // No retroactive inference from counters, online history or a legacy run.
  // Preparing a co-op lobby, practice and explicitly abandoned runs never count.
  if (!marker || !policy.seasons.some(season => season.id === marker.id) ||
      ticket.lan && !ticket.lan.launched ||
      !["standard", "endless", "relay", "mutation", "bossrush", "tower", "expedition"].includes(ticket.config?.mode) ||
      !(result.victory === true || Number.isFinite(result.time) && result.time >= 60)) return;
  const entry = book.participation[marker.id];
  if (entry) {
    if (!Number.isSafeInteger(entry.runs + 1)) fail("Seasonal participation limit reached.");
    entry.runs++;
    entry.lastAt = Math.max(entry.lastAt, now);
  } else book.participation[marker.id] = {runs: 1, firstAt: now, lastAt: now};
  ensureSeasonalMail(state, now, policy);
}

export function seasonalMailbox(state, policy = SEASONAL_MAIL_POLICY) {
  const book = state.seasonalMail;
  validateSeasonalMail(book);
  const owned = new Set(state.profile.cosmetics ?? []), season = currentSeason(policy);
  const messages = policy.seasons.filter(item => item.gift && book?.messages[item.gift.id])
    .map(item => {
      const receipt = book.messages[item.gift.id], gift = item.gift;
      const complete = gift.rewards.every(reward => owned.has(reward.id));
      return {id: gift.id, season: item.number, title: gift.title, text: gift.text,
        previewAvatar: gift.previewAvatar ?? "", previewFrame: gift.previewFrame ?? "",
        rewards: gift.rewards.map(reward => ({...reward, owned: owned.has(reward.id)})),
        state: receipt.claimedAt !== null ? "claimed" : complete ? "owned" :
          qualifies(book, item, policy) ? "available" : "preserved",
        read: receipt.read, deliveredAt: receipt.deliveredAt, claimedAt: receipt.claimedAt};
    }).sort((a, b) => a.season - b.season);
  return {version: 1, archiveThrough: policy.archiveThrough, current: {id: season.id, number: season.number, name: season.name,
    runs: book?.participation[season.id]?.runs ?? 0, giftAnnounced: Boolean(season.gift)},
    unread: messages.filter(message => !message.read).length,
    ready: messages.filter(message => message.state === "available").length, messages};
}

export function readSeasonalMail(state, now, policy = SEASONAL_MAIL_POLICY) {
  const book = ensureSeasonalMail(state, now, policy);
  // Unknown future receipts are preserved, not marked read by an older app.
  for (const season of policy.seasons) {
    const receipt = season.gift && book.messages[season.gift.id];
    if (receipt) receipt.read = true;
  }
}

export function claimSeasonalGift(state, id, now, policy = SEASONAL_MAIL_POLICY) {
  const book = ensureSeasonalMail(state, now, policy);
  const season = policy.seasons.find(season => season.gift?.id === id);
  if (!season || !qualifies(book, season, policy) || !book.messages[id]) {
    fail("This seasonal gift is not available in this offline version.");
  }
  const receipt = book.messages[id], owned = new Set(state.profile.cosmetics ?? []);
  if (receipt.claimedAt !== null || season.gift.rewards.every(reward => owned.has(reward.id))) {
    fail("This seasonal gift is already claimed or owned.");
  }
  state.profile.cosmetics ??= [];
  for (const reward of season.gift.rewards) {
    if (!owned.has(reward.id)) { state.profile.cosmetics.push(reward.id); owned.add(reward.id); }
  }
  receipt.read = true;
  receipt.claimedAt = Math.max(receipt.deliveredAt, now);
  // Do not equip anything, award currency, fabricate medals/ranks or touch names.
}
