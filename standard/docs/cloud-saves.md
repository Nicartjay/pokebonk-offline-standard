# Optional cross-platform cloud saves

Available in **PokéBonk Offline 1.3.1**. Cloud saves are entirely optional:
local play and JSON backups do not need an account. Connecting an account
does not upload or replace progress, and automatic sync starts off.

macOS keeps its cloud login only in native memory, avoiding Keychain access.
Reconnect after fully quitting. Windows/Linux/Android use supported
OS-protected credential storage. No platform writes a plaintext login token.

The configured private Cloudflare service uses Google for identity only,
not Google Drive access. It is separate from co-op/TURN, has finite free-tier
capacity, and stores up to ten compatible save versions per player.
Keep independent exported backups. Cloud backups are not end-to-end encrypted.

## Across devices

Use the same Google account on macOS, Windows, Linux and Android. Google is
identity only—no Google Drive permission. A separate private service authorizes
each device to the same player's save history; it is not tied to an Android or
desktop installation and does not reuse the co-op/TURN gateway.

Open **Player & saves → Cloud saves → Connect account** on each device.
Approve only if the browser's device code matches your own app.
Use **Sync now**, review both copies and confirm the one you want.
If two devices progressed independently, neither branch is silently merged.
Automatic syncing requires a separate opt-in.

On Android Chrome, tap **Return to game** after consent. Use the alternate
link or your launcher if Chrome blocks the handoff. On Mac, the browser uses
a temporary localhost callback and a five-second return attempt.

## Agreed behavior

- Off by default; no account needed and no cloud requests while disconnected.
- Local atomic saves and previous-file recovery remain the primary storage.
- Connect account is separate from enabling automatic synchronization. Manual
  Sync now is available; automatic sync starts only after explicit opt-in.
- Storage uses a separate Cloudflare Worker/private R2 service, not
  Google Drive and not the co-op signaling/TURN gateway.
- First version syncs consistent, completed progress only: no active/suspended
  run, unsettled Expedition escrow or pending ownership returns.
- Preserve each device's settings. Never add currencies, rewards, inventories
  or task claims together when resolving independently advanced saves.
- Detect conflicts with base revisions and content digests, not device
  timestamps. Require explicit choice and another confirmation before replacing
  either branch. A changed remote head invalidates the pending confirmation.
- Validate a restore before application, serialize it against local writes and
  keep an immutable pre-restore recovery copy. Failure preserves the old save.
- Backups/restore and disconnect use the game's modal system. Disconnect keeps
  local progress and existing remote backups; deleting remote data must be a
  distinct, authenticated, explicitly confirmed action.
- Restoring an older revision creates a local branch. The UI shows that branch
  beside the actual current cloud copy and requires a choice, not a false
  “backed up” status.

## Native and service boundaries

- One `common/cloud-sync.mjs` engine runs in Electron and an isolated,
  native-owned Android WebView broker. It is not exposed to the game WebView.
- HTTPS and credentials live in native hosts. Updated macOS source holds its
  session only in memory; Windows/Linux retain OS-protected storage and Linux
  plaintext fallback is rejected. Android uses Keystore AES-GCM. The game gets
  bounded presentation data and fixed click actions.
- External-browser login uses PKCE, a native proof and explicit browser consent.
  The service verifies Google JWT signatures/claims and issues revocable device
  sessions. No Google secret, R2 key or native session token reaches the game.
- Mac and legacy desktop browser success pages offer **Return to game** and a
  five-second automatic attempt, with a manual fallback. Updated Android
  uses a tap, not a misleading timer: Chrome requires a user gesture for
  external-app intents. The short `pokebonk-offline://` scheme targets our
  installed package and retains the older long-scheme alias. The
  edition-specific activation contains only the public login-flow ID. Native
  handlers match an in-memory, unexpired flow and foreground the existing app;
  proof polling, not the link, authenticates. No external intent is loaded into
  a WebView. Android reuses the current activity rather than restarting it.
- The Windows async credential reader unpacks Electron's `{result,
  shouldReEncrypt}` response and atomically re-encrypts when requested. It
  preserves old encrypted credentials and refuses a plaintext fallback.
  Consent completed in a background browser stays connected without trying
  to read/restore progress before the idle gate allows it.
- The Mac listener binds `127.0.0.1` on an OS-selected unprivileged port, uses a
  random one-use path and validates peer address, Host, method and Origin.
  Only the native proof-bound login start can set the matching cloud return
  destination. No token, save or Google authorization code travels through
  the callback. It closes on activation, cancellation, timeout or shutdown;
  a successful native poll retains at most a one-minute return grace period.
- Normal Mac quit drops its in-memory sign-in and attempts bounded server
  revocation. Offline/forced termination still loses the local credential;
  an unreached server session expires under the existing service policy.
- Serialized account Durable Objects and private R2 versions enforce compare-and-
  swap, hashes, a 512 KiB save limit, ten retained versions and request/account
  limits. These controls are not a guaranteed Cloudflare billing cap.
- The operator can access backups; this is **not end-to-end encrypted**.
- A separate durable global meter reserves R2 operations before list/put/get,
  retains a conservative rolling window, and fails closed on exhaustion or
  persistence failure. Fixed caps leave substantial free-allowance headroom;
  they do not control unrelated account charges. Workers Free was verified and
  must remain Free. See the service README for exact limits and meter retention.

## Operator rollout checklist

Follow `services/cloud-saves/README.md` for the separate private Worker/R2
bindings, Google Web OAuth callback, consent configuration and local secret
prompts. Never paste secrets into chat or Git. Review costs, privacy and account
limits before enabling users. Do not reuse TURN, co-op or release-signing keys.

The source origin is already configured and real owner sign-in was verified.
Use the three public links in the service README for Google branding, review
their operator/contact wording, then use the latest November 26 local packages for
real-device save transfer testing. Publishing the policy pages does not update
Google's settings or replace that acceptance step. The owner approved the
separate exact-build Internet co-op admission repair. See
`evidence/cloud-return-2026-11-26/` for its deployment/settings comparison,
temporary-room checks and current package report. It does not weaken matching
requirements, expose TURN keys or change relay limits.

The newer memory-only/Android-link checkpoint is
`evidence/mac-session-only-2026-11-26/status.md`: 61 focused checks, 29 Android
JVM results, clean release lint, 33 verified Mac native/common source files,
matching packaged assets and live read-only admission/health/help checks.
The owner withdrew a subsequent co-op join report after confirming it worked;
38 focused co-op diagnostics had passed, but no connection-logic change or
additional live peer/room test was made. Only exact-payload admission changed.

## Verification scope

The focused pass covers authentication/proof validation, per-user authorization,
portable saves, two native-controller/store fixtures, conflicts, backup restores,
device settings, native write fencing and offline failure. Android JVM/compile/
lint and a Worker dry-run also passed. See
`evidence/cloud-sync-2026-11-25/status.md` for logs and limits.

One local UI pass used the real controller/store and in-memory Worker/R2 with
simulated identity—not Google login, deployed storage or physical devices.
The updater fixture streamed and verified synthetic signed bytes; it did not
open an installer. An older-backup status issue found there was corrected with
an affected-only regression run.
