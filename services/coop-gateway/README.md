# Internet co-op gateway

**Guarded TURN deployed for the current local test candidate.** Host, Join and
Find use direct connections first, with optional five-minute TURN leases.
The published v1.1.0 application remains LAN-only.

The owner approved the read-only monitor and residual pay-as-you-go risk.
Account-wide TURN/SFU metering, the actual billing period, private secret
provisioning, policy/security tests and package scans have been verified.
The four-peer native check passed real relay traffic on all twelve directed
links, chat, the prepared/start barrier, renewal beyond initial credential
expiry, and leave/rehost. The final delayed revocation was confirmed separately
after the provider retry, without issuing more credentials. Physical-device
gameplay acceptance and application publication are still pending.

Gateway: `https://pokebonk-offline-coop.nicartjay.workers.dev`

On November 26, 2026, the voice-enabled Worker admitted the matching local
LAN-voice test packages while retaining all eight prior build identities.
Live smoke checks created, joined and closed a code-only room in each Internet
mode and forwarded voice signaling in both directions. No audio or TURN leases
were used in those checks. The app was not published.

On November 24, 2026, the service progressed from disabled-first STUN testing
to owner-approved guarded TURN. Issuer/monitor keys were uploaded only as
private Worker secrets. No app release was published or subscription changed.
The earlier working STUN identity remains accepted; failed, unpublished TURN
candidates are retired as they are replaced.

## Safety defaults

- Only explicitly allowlisted builds can create or find rooms.
- Anonymous matchmaking requires an explicit `PUBLIC_MATCHMAKING_ENABLED=true`.
  Otherwise room admission requires a private-beta token, which is deliberately
  absent from the public native app. Never embed that secret in public clients.
- Find matches exact build, connection policy and Classic/Forest/Normal rules.
  Only discoverable, listening lobbies with a free seat can reserve a player.
- Pending reservations last 60 seconds and count toward capacity. Native
  clients give up after 45 seconds (55 with TURN fallback) and try at most three candidates. Guests
  are admitted after both sides confirm all required peer links.
- Four players/room, eight rooms, expiring rooms, bounded signaling and rate limits.
- At most 12 room creations/hour and 20 Find requests/minute per hashed
  Internet address; devices sharing a household connection share that limit.
- Relay requests require the correct live member/peer and are limited to
  eight per member per minute. Extra issuer parameters are rejected.
- WebSocket hibernation: no idle polling, game snapshots, assets, music, voice or
  video through Workers. Gameplay stays on the peers' WebRTC data channels.
- STUN-only cannot request or signal TURN, even through the service API.
  Fallback mode requires a separate authorized request after direct failure.
- No client IP addresses, credentials or raw SDP in application logs. Candidate
  addresses and credentials must never be forwarded to the game renderer.
- Use SQLite-backed Durable Objects on the existing Workers Free plan. Do not
  activate Workers Paid or change subscription plans automatically.

## TURN budget: a risk control, NOT a hard billing cap

Cloudflare's included 1,000 GB allowance is shared with other Realtime usage.
This gateway starts with `TURN_MODE=disabled` and **must stay that way unless the
owner separately accepts the residual usage-based billing risk** or a genuine
provider-enforced quota is available.

The optional `guarded-payg` path also requires `TURN_PAYG_RISK_ACCEPTED=true`,
fresh **account-wide/shared-service** usage, a verified billing-period boundary,
capacity checks and a reservation before issuance. The operational cutoff is
**800,000,000,000 bytes** (decimal GB), not 800 GiB. Credentials last five minutes.
Reservations are conservative and never refunded within the billing period.
Stale/failed usage monitoring closes the gate; ambiguous issuance requires
operator reconciliation; emergency shutdown revokes known credentials.
Renewal retains a short overlap with the previous credential. Room/member
departure revokes every matching generation; failed revocations are retried.
Revocations are batched to avoid long blocking Durable Object callbacks.

These controls cannot guarantee zero overage: provider analytics can lag/be
sampled, issued credentials can be abused, revocation can be delayed, clients
cannot enforce a malicious user's byte rate, and unrelated Realtime usage also
counts. **The automatic account-usage feed is configured and verified live.**
The server meter queries both account-wide TURN and SFU GraphQL datasets and
reads the explicitly selected Realtime subscription's actual billing period.
Partial/error responses close the gate; an unrelated subscription, guessed
month reset, client byte counter or fabricated zero is not accepted.
An empty successful dataset is a provider-reported zero, not a substitute for
an unavailable dataset. Both datasets and the subscription boundary passed
the live probe. The current verified period is November 7–December 7, 2026;
future periods come from the provider API, not this documentation.
Usage high-water marks and reservations do not decrease within a billing
period. Live credentials carry their full reservation across period changes.
Workers/DO usage is separately subject to the account's plan limits.

Honest app clients have a 128 KiB/s per-peer send budget with control headroom
and lossy-snapshot dropping. This is a gameplay efficiency measure, not an
abuse-proof billing meter. No assets/audio/video are sent through the relay.

## Credentials / deployment

Install this service's pinned dependencies separately; do not reinstall the
desktop build toolchain just to deploy the gateway.

```sh
cd services/coop-gateway
npm ci --ignore-scripts
npm run whoami
```

Workers deployment authorization was approved through Wrangler's normal
Cloudflare OAuth flow. Credentials are encrypted locally, with the key held in
macOS Keychain. The granted scopes are `user:read`, `account:read`,
`workers_scripts:write` and `offline_access`; no billing-write scope was granted.
Never export browser cookies or use an account-global API key. Reauthorization
or additional permissions still require owner approval.

Current Worker secrets: `ADMIN_TOKEN`, `PRIVATE_BETA_TOKEN`, `IP_HASH_SECRET`,
`TURN_TOKEN_ID`, `TURN_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_USAGE_API_TOKEN`.
The operator-only `scripts/provision.mjs --upload-gateway-only` stores independent
32-byte base64url values outside Git and uploads only these three secrets.
The TURN issuer credentials are stored locally
outside Git under `../pokebonk-standard-signing/cloudflare-coop.json` relative
to the application repository, and must be uploaded as Worker **secrets** only.
Never put them in `wrangler.jsonc`, app assets, logs, screenshots or commits.

The monitor uses a separate account-scoped **Account Analytics: Read** and
**Billing: Read** token. It cannot edit subscriptions, but can read sensitive
billing information; owner approval is required before creating it. Its
`{accountId,apiToken,createdAt,expiresAt}` file is
`../pokebonk-standard-signing/cloudflare-usage.json`, permissions 0600.
The issuer's long-lived key is never a client credential. Authorized peers
necessarily receive short-lived ICE credentials inside their isolated native
brokers; device owners can inspect these, so expiry/budget controls are essential.

`scripts/provision-turn.mjs --upload-turn-secrets` uses stdin to upload only
`TURN_TOKEN_ID`, `TURN_API_TOKEN`, `CF_ACCOUNT_ID`, `CF_USAGE_API_TOKEN` as Worker
secrets, never app files or GitHub Actions secrets. Uploading them does not
enable the relay. Do not run the provisioner until the monitor was approved.

Cloudflare Workers requires `redirect: "manual"` with explicit status checks;
its runtime does not implement `redirect: "error"`. Never switch provider calls
to `follow`, which could forward credentials to a redirect destination.
Durable Object code updates can defer for five minutes. Wait for fresh,
successful private meter status before resuming a gate after deployment;
do not force resets of active rooms merely to speed up a check.

Operator commands from the repository root:

```sh
node services/coop-gateway/scripts/relay-admin.mjs status
node services/coop-gateway/scripts/relay-admin.mjs refresh
node services/coop-gateway/scripts/relay-admin.mjs disable
node services/coop-gateway/scripts/relay-admin.mjs resume
```

See [security boundaries and incident response](SECURITY.md).

## Guarded TURN activation checklist

1. With the approved monitor token stored privately, use
   `node services/coop-gateway/scripts/usage-status.mjs --subscriptions`.
   Review the actual Realtime subscription and set its ID as the non-secret
   `REALTIME_SUBSCRIPTION_ID` Worker variable. Do not select a Workers plan.
2. Run the read-only probe without `--subscriptions`; both datasets and the
   current billing boundary must succeed. If the account/API cannot expose
   them, stop and leave TURN disabled.
3. Run the local known-secret audit over source/history. Provision the exact
   four Worker secrets. Never add a `.dev.vars` file to the app or repository.
4. After UI approval, set the native `internetCoop.relayEnabled` feature flag,
   prepare/verify one shared payload, then use
   `node standard/scripts/configure-coop.mjs --enable-guarded-turn --accept-payg-risk`.
   This probes the meter, retains older accepted identities, and configures a
   one-minute monitor cron. Deployment is still a separate operator action.
5. Deploy; inspect private admin status, force a provider refresh and, only
   after reconciling any pending issuance/revocation, explicitly resume the
   gate if necessary. A successful meter refresh cannot undo a kill switch.
6. One focused pass: policy/lifecycle/boundary tests, the real native check
   with `--force-relay` (including renewal past initial credential expiry),
   then local Mac ARM/Android packaging and archive credential audits.
   If only the final asynchronous lease-count assertion is pending,
   `node standard/scripts/check-turn-cleanup.mjs` can confirm it without
   repeating gameplay or issuing credentials; it refuses incomplete transport
   or renewal evidence. `node standard/scripts/report-coop-test.mjs WORKER_UUID`
   refuses stale payloads/packages and writes the local instructions/checksums.
   None of these commands publishes an application release.

Run the operator secret audit from the repository root:
`node standard/scripts/audit-coop-secrets.mjs --history --payload`.
Use `--artifact path/to/test.zip` or `--artifact path/to/test.apk` to inspect
decompressed distribution contents. Local known secrets are read outside Git
and never printed. Public CI has only the structural/literal-file guard, not
private credentials. A scan cannot prove absence of unknown or encoded leaks.

Prepare/verify one shared game payload. From the repository root, run
`node standard/scripts/configure-coop.mjs --enable-stun` to allowlist its exact
`lanIdentity(config,digest)`, then deploy this service separately. The native
`internetCoop` endpoint is pinned to this Worker's HTTPS `*.workers.dev` root;
it is not passed into the game configuration. The default STUN preparation
requires TURN disabled; the explicitly approved guarded path above is separate.
Use the live Worker settings as a baseline when a deploy carries forward
previous releases. The allowlist supports up to nine accepted identities;
preparation fails instead of removing an older build if it is full.
`--replace-test-builds` replaces the entire existing list with the prepared
candidate. Never use it to retire released builds without deliberately
planning that compatibility change.

`standard/scripts/check-internet-native.mjs` is an isolated real-Electron
transport check, not a gameplay test. It uses fixture profiles and the deployed
gateway without touching saves. Test two real devices on different networks
before claiming cross-network/physical-Android acceptance. No release is
published by service deployment or local packaging.

## API

- `GET /health`: public, no credentials/usage details.
- `GET /v1/connection-policy`: STUN-first policy when the service is enabled.
- `POST /v1/rooms`: `{buildId,connectionMode,name,species,discoverable?}`.
- `POST /v1/matchmaking/find`: `{buildId,connectionMode,name,species,exclude?}`;
  returns a leased seat, or `404 no_matching_room`.
- `POST /v1/rooms/CODE/join`: `X-Coop-Access: Bearer …`;
  `{buildId,connectionMode,joinSecret,name,species}`.
- `GET /v1/rooms/CODE/socket`: protocols `pb-coop-v1`, room session token.
- `POST /v1/rooms/CODE/turn`: room bearer; `{peer,directAttemptFailed:true}`.
- `POST /v1/rooms/CODE/leave`: room bearer; releases the seat immediately.
- `GET /admin/status`, `POST /admin/refresh-usage`,
  `POST /admin/disable-relay`, `POST /admin/resume-relay`: separate admin bearer.
  There is no public enable-relay endpoint or arbitrary usage-ingestion route.

Room creation/find need private-beta authorization unless anonymous admission
is explicitly enabled. Other room actions use the member token. Matchmaking is
not account authentication; accounts, leaderboards and host migration remain
out of scope. Native save/owned-Pokémon and durable start-barrier rules remain.
