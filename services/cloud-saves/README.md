# Private cross-platform cloud saves

**App integration: v1.3.1.** Mac uses memory-only cloud
sign-in and a validated temporary loopback notification, avoiding Keychain
access. Reconnect after a full quit; local progress remains saved. Android
Chrome uses an explicit app-targeted return tap with `pokebonk-offline://`
and a legacy alias, plus bounded same-attempt sign-in poll retries.
Other platforms retain protected credential storage. The service is separate
from native-app publication; use the release notes and cloud-save guide for
client requirements. Internal local-build evidence is kept outside Git.

Separate from co-op/TURN. **Service active; real owner Google sign-in verified.
Native source configuration is enabled for the next local builds.**
One Google account identifies the same player on macOS, Windows, Linux and
Android. Google is used for identity only; no Drive permission is requested.

## Provisioning checkpoint — November 25, 2026

The owner enabled R2 and approved keeping it within the included allowance.
The dashboard confirmed **Workers Free**; no plan upgrade was made. The
`pokebonk-offline-private-saves` bucket was created as **Standard**, with public
`r2.dev` access disabled, no custom domains and zero objects. The separate
disabled Worker is deployed with a private global budget Durable Object.

Worker origin: `https://pokebonk-offline-cloud.nicartjay.workers.dev`.
Google OAuth redirect:
`https://pokebonk-offline-cloud.nicartjay.workers.dev/auth/callback`.
The provided Google Web OAuth client was validated for this exact callback.
Its client ID is configured only on the Worker; ordinary deployments preserve
that server-side binding with `keep_vars`. The client secret was uploaded
directly to this Worker's secret store. Neither value is committed to this
repository.
The service is enabled and `/health` reports ready. The real owner browser check
passed native-proof approval, authenticated head access and temporary-session
revocation, without uploading a save. Native source configuration and staged
Android assets now use only the public service origin; accounts/automatic sync
remain opt-in. Existing installed apps have not been rebuilt or changed.
No co-op/TURN settings changed. Current evidence:
`evidence/cloud-activation-2026-11-25/status.md`.

Cloud-enabled **unpublished local macOS arm64 and signed Android test packages**
were built on November 26, 2026. Use
`build/local-test/mac-session-only-2026-11-26/START-HERE.md`.
The installed apps and GitHub releases are unchanged; real-device progression
sync testing remains with the owner. Packaging evidence:
`evidence/cloud-local-build-2026-11-26/status.md`.

An earlier November 26 candidate corrected the Mac async credential reader and
adds a browser **Return to game** button/five-second automatic attempt, backed
by validated native activation on desktop and Android. The source-only design
was approved before testing/packaging. The same follow-up admits the exact test
payload to the separate Internet co-op gateway, without changing TURN keys or
limits. Current evidence: `evidence/cloud-return-2026-11-26/status.md`.

## Public pages / Google consent-screen fields

The following pages are published, public without sign-in, and served without
reading R2 or creating an account:

| Google field | Value |
| --- | --- |
| Application home page | `https://pokebonk-offline-cloud.nicartjay.workers.dev/` |
| Application privacy policy link | `https://pokebonk-offline-cloud.nicartjay.workers.dev/privacy` |
| Application terms of service link | `https://pokebonk-offline-cloud.nicartjay.workers.dev/terms` |
| Authorized domain | `nicartjay.workers.dev` |

The owner updates Google branding manually; publishing these pages does not
change Google settings. The OAuth callback remains unchanged. Do not use the
original online game's policy as this independent service's policy.

Review the published wording before public rollout. It describes actual
implementation and uses the project's GitHub support page for contact, with a
warning not to post personal data publicly and a maintainer-assisted private
follow-up/deletion process. No personal contact email or address was published.
These notices do not establish Google approval or guarantee legal compliance.

## Free-allowance safeguards

The service fails closed at these fixed, server-side limits:

| Limit | Service cap |
| --- | --- |
| Players | 100 |
| Retained backups / player | 10 |
| Save size | 512 KiB |
| Admitted API/auth requests / UTC day | 5,000 |
| Upload attempts / UTC day | 500 |
| R2 Class A reservations / rolling window | 50,000 |
| R2 Class B reservations / rolling window | 100,000 |

The rolling meter retains 32 full preceding UTC days plus the current partial
day, rather than resetting at a calendar-month boundary. A commit reserves two
Class A operations **before** its list/put; a read reserves one Class B operation
before its get. Failed attempts are never refunded. Meter failure, corruption or
exhaustion prevents the R2 call. Reservations are serialized and persisted,
including across object restarts. Metadata/head/history do not read R2.

The bounded account/history model keeps logical backup objects below 600 MiB,
including temporary/orphan headroom. Cleanup never changes to Infrequent Access.
No public bucket routes or S3 credentials are distributed to clients.

**These are service limits, not a provider-enforced $0 account cap.** R2's free
allowance is shared with other account usage; dashboard/API actions and other
apps are outside this meter. The conservative caps leave substantial headroom,
but cannot promise a zero invoice if other products/people use the account.
Workers/Durable Objects must remain on Free. Their shared limits can temporarily
interrupt cloud saves or other Workers; this code never upgrades the plan.
No changes to existing co-op/TURN billing or admission are made.
Rejected invocations, `/health` and public information pages can still consume
Workers Free request allowance; the application meter is not Cloudflare's
invocation meter. Public information pages bypass private storage and the cloud
API admission meter, and remain readable when syncing is disabled or at quota.

Never reset/delete/recreate the budget namespace, rename its class/object ID or
clear its meter during the rolling window. Preserve it across future releases.
Quota exhaustion stops sync, not local game saving or JSON export/import.

## Included

- Browser sign-in with native proof/nonce, PKCE, validated Google identity
  signatures and a separate browser confirmation bound to the initiating app.
- Revocable, expiring device sessions. Only session hashes reach account
  storage; native credentials use OS-protected storage.
- A serialized Durable Object per player; private R2 immutable save versions.
  Compare-and-swap prevents independent devices silently replacing each other.
- Completed progression only. No live runs, co-op sessions or pending item
  returns. Device settings and native account credentials are never uploaded.
- Ten retained revisions, 512 KiB per cloud save, six commits / sixty account
  reads per minute, eight device sessions and a configurable account cap.
  The global durable meter additionally enforces the conservative caps above.

The operator can read backups; this is not end-to-end encryption. Review
privacy/contact/deletion procedures, Google consent requirements and the
Cloudflare account's costs/quotas before enabling real users.

## Operator setup — approval required

1. Verify the existing separate Worker/bucket and Workers Free plan. Do not
   create duplicates, reset the budget namespace or enable public bucket access.
2. Reuse the configured Google **Web application** OAuth client and exact
   callback above. Start with the owner's test account and correct the consent
   screen branding/policy links before public rollout.
3. In this service's Wrangler config set `PUBLIC_ORIGIN`, `MAX_ACCOUNTS` and
   `SESSION_DAYS`. Configure `GOOGLE_CLIENT_ID` only on the Worker, or in an
   ignored local `.dev.vars` for development. It is a public OAuth identifier,
   but stays out of source to comply with managed repository scanning.
   `keep_vars` retains the existing production binding; a missing runtime
   binding fails closed. No service credential belongs in this file.
4. The three dedicated Worker secrets are configured. Do not overwrite or
   regenerate them as part of routine updates. Enter authorized replacements
   locally; never reuse co-op/TURN/signing keys or paste secrets into chat/Git.
5. Preserve the enabled service's bindings/migrations and budget meter across
   deployments. `/health` reports configuration readiness without exposing
   secrets; it does not replace a real sign-in check.
6. Native source is configured with the public origin. Package matching local
   clients for owner testing; real cross-device progression transfer is still
   an acceptance step. Clients never embed the Google secret or R2 keys.

The existing pinned Wrangler in `services/coop-gateway/node_modules/` can run
this service with `--config services/cloud-saves/wrangler.jsonc`. A dry-run bundle
does not provision or deploy anything. Enabling live sync remains a separate
operator step.

## Safety and limits

Local saves are primary. Sync is off by default and automatic sync requires
another opt-in after connecting. Foreground idle checks are throttled; active
gameplay never depends on cloud availability. Conflicts need an explicit whole
save choice and confirmation. Restores validate the envelope, retain an immutable
local backup, compare the latest native file stamp and fence stale renderer
writes before reloading. A changed cloud head invalidates a pending confirmation.

Use the same tested save-schema-compatible app build when testing real devices.
The source tests use isolated native-controller/store fixtures and an in-memory
Worker/R2 implementation—not real Google accounts, deployed R2 or physical devices.
