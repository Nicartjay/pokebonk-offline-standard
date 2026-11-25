# Optional cloud saves — implementation checkpoint

Status: source-only UI preview awaiting the user's screenshot approval.
Nothing here enables a live service, changes local saves or modifies an installed app.
No cloud source is copied by `prepare.mjs` yet.

## Agreed behavior

- Off by default; no account needed and no cloud requests while disconnected.
- Local atomic saves and previous-file recovery remain the primary storage.
- Connect account is separate from enabling automatic synchronization. Manual
  Sync now is available; automatic sync starts only after explicit opt-in.
- The proposed storage is a separate Cloudflare Worker/private R2 service, not
  Google Drive and not the co-op signaling/TURN gateway.
- First version syncs consistent, completed progress only: no active/suspended
  run, unsettled Expedition escrow or pending ownership returns.
- Preserve each device's settings. Never add currencies, rewards, inventories
  or task claims together when resolving independently advanced saves.
- Detect conflicts with revision ancestry and content digests, not device
  timestamps. Require explicit choice and another confirmation before replacing
  either branch. A changed remote head invalidates the pending confirmation.
- Validate a restore before application, serialize it against local writes and
  keep an immutable pre-restore recovery copy. Failure preserves the old save.
- Backups/restore and disconnect use the game's modal system. Disconnect keeps
  local progress and existing remote backups; deleting remote data must be a
  distinct, authenticated, explicitly confirmed action.

## Next implementation after UI approval

1. Resolve the sign-in configuration. Prefer an ordinary external-browser login
   (Google identity only, without Drive access) through a dedicated backend.
   Native-generated proof/nonce binds login completion to the initiating app;
   no embedded-WebView password entry or shared developer key in the client.
2. Worker authentication, per-player authorization and bounded, serialized
   revision commits; private R2 objects with verified content hashes and retained
   prior versions. Enforce size/request/account quotas and fail closed if storage,
   authentication, rate limiting or configuration is unavailable.
3. Native-only networking and protected credentials: Electron OS-backed secure
   storage (refuse plaintext/basic_text fallbacks), Android Keystore-backed
   storage. Fixed UI actions and presentation-only feedback, never URLs, paths,
   refresh/access tokens or service credentials in the game renderer.
4. Idle-gated safe upload/check scheduling and compare-and-restore in both shells.
   Connectivity, expired sessions and cloud failures cannot block local play.
5. After screenshot approval, one focused verification pass and affected retries
   only; no build/publication until approved.

Cloudflare/Google resource provisioning, secrets, plan changes and deployment
remain separate operator steps. Do not reuse TURN issuer/admin credentials.
The exact deployed endpoint, quotas, retention and sign-in client must be
configured before calling the feature usable across devices.

## Preview

`standard/runtime/cloud-ui.js` renders the proposed game-styled UI using injected
modal helpers and action callbacks. `cloud.css` styles it. Neither is linked from
production UI/index yet.

`cloud-preview.js` is a disposable source-server fixture for the existing
`standard/scripts/preview-candidate.mjs?cloud-preview` controls. Sample trainer,
account, times, device labels and conflicts never enter a native save or build.
Its buttons only switch sample UI states, including confirmation dialogs.
