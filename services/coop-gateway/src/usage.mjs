import {Fault, requireValue, freshUsage} from "./policy.mjs";

// Server-only. Neither this token nor the TURN issuer key is a client secret.
// Query the WHOLE account, not a key/app/customIdentifier-filtered subset.
const API = "https://api.cloudflare.com/client/v4";
const QUERY = `query RealtimeAccountUsage($account: String!, $from: Time!, $to: Time!) {
  viewer { accounts(filter: {accountTag: $account}) {
    turn: callsTurnUsageAdaptiveGroups(limit: 1, filter: {datetime_geq: $from, datetime_leq: $to}) { sum { egressBytes } }
    sfu: callsUsageAdaptiveGroups(limit: 1, filter: {datetime_geq: $from, datetime_leq: $to}) { sum { egressBytes } }
  } }
}`;

async function providerJSON(url, token, options, request) {
  let response;
  try {
    // workerd does not implement redirect:"error". Manual + explicit status
    // rejection also prevents forwarding the bearer to another destination.
    response = await request(url, {...options, redirect: "manual", signal: AbortSignal.timeout(8000),
      headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"}});
    requireValue(response.ok, 503, "usage_provider_http_"+response.status);
    const text = await response.text();
    requireValue(text.length <= 256000, 503, "invalid_usage_response");
    return JSON.parse(text);
  } catch (error) {
    // Never propagate provider bodies, headers or URLs containing credentials.
    if (error instanceof Fault) throw error;
    throw new Fault(503, "usage_provider_unavailable");
  }
}
function total(rows) {
  requireValue(Array.isArray(rows) && rows.length <= 1, 503, "incomplete_usage_response");
  if (!rows.length) return 0; // A successful, account-wide query can have no traffic.
  const bytes = rows[0]?.sum?.egressBytes;
  requireValue(Number.isSafeInteger(bytes) && bytes >= 0, 503, "invalid_usage_response");
  return bytes;
}
export async function realtimeSubscriptions(env, request = globalThis.fetch.bind(globalThis)) {
  requireValue(/^[a-f0-9]{32}$/.test(env.CF_ACCOUNT_ID ?? "") &&
    typeof env.CF_USAGE_API_TOKEN === "string" && env.CF_USAGE_API_TOKEN.length >= 24, 503, "usage_monitor_not_configured");
  const data = await providerJSON(`${API}/accounts/${env.CF_ACCOUNT_ID}/subscriptions?per_page=50`,
    env.CF_USAGE_API_TOKEN, {method: "GET"}, request);
  requireValue(data.success === true && Array.isArray(data.result) && data.result.length < 50 &&
    (data.result_info?.total_count === undefined || data.result_info.total_count === data.result.length), 503, "incomplete_subscription_response");
  return data.result;
}
export async function readAccountUsage(env, {request = globalThis.fetch.bind(globalThis), now = Date.now()} = {}) {
  requireValue(/^[a-zA-Z0-9_-]{16,128}$/.test(env.REALTIME_SUBSCRIPTION_ID ?? ""), 503, "realtime_subscription_not_configured");
  const subscriptions = await realtimeSubscriptions(env, request);
  const subscription = subscriptions.find(value => value.id === env.REALTIME_SUBSCRIPTION_ID);
  // An operator must select the actual Realtime subscription. Do not pick an
  // unrelated Workers subscription, assume calendar months, or invent a reset.
  requireValue(subscription && subscription.frequency === "monthly" &&
    ["Trial", "Provisioned", "Paid"].includes(subscription.state), 503, "realtime_subscription_unavailable");
  const periodStart = Date.parse(subscription.current_period_start), periodEnd = Date.parse(subscription.current_period_end);
  freshUsage({scope: "account-shared-realtime-egress", complete: true, bytes: 0, asOf: now, periodStart, periodEnd}, now);
  const data = await providerJSON(`${API}/graphql`, env.CF_USAGE_API_TOKEN, {
    method: "POST", body: JSON.stringify({query: QUERY, variables: {account: env.CF_ACCOUNT_ID,
      from: new Date(periodStart).toISOString(), to: new Date(now).toISOString()}}),
  }, request);
  requireValue((data.errors == null || Array.isArray(data.errors) && data.errors.length === 0) && Array.isArray(data.data?.viewer?.accounts) &&
    data.data.viewer.accounts.length === 1, 503, "incomplete_usage_response");
  const account = data.data.viewer.accounts[0], turnBytes = total(account.turn), sfuBytes = total(account.sfu);
  const bytes = turnBytes + sfuBytes;
  requireValue(Number.isSafeInteger(bytes), 503, "invalid_usage_response");
  return {scope: "account-shared-realtime-egress", complete: true, source: "cloudflare-graphql",
    subscriptionId: subscription.id, bytes, turnBytes, sfuBytes, asOf: now, periodStart, periodEnd};
}
