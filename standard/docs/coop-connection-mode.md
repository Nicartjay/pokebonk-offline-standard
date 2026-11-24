# Co-op connection modes and matchmaking

## TURN implementation status — November 24, 2026

Guarded TURN lifecycle/meter/provisioning code is deployed with the owner's
approval. The unchanged co-op screen was shown before testing/building.
The monitor token is private, account-wide provider usage and real billing
periods are verified, and focused security tests passed. The four-peer native
relay check passed both data channels, chat, ready/start, renewal beyond
initial expiry and leave/rehost. A delayed final revocation was confirmed
separately without further issuance. Those forced-relay results apply to their
recorded test payload, not automatically to later room-picker or release builds.
Physical-device and different-network acceptance remain separate checks.

Permanent issuer/monitor keys stay outside Git and app bundles. Only
short-lived ICE credentials go to isolated native brokers, never to the
game renderer. Account-wide monitoring must pass before guarded activation.

## Existing verified STUN implementation

Reuse the existing co-op landing screen, four-seat room, and scope-dropdown
component. No replacement screens, connection badges, new status dialogs or
gameplay overlays.

The single **Connection** dropdown offers:

- **LAN**: same private network; no STUN/TURN.
- **STUN only**: direct Internet connections; never request TURN credentials.
- **STUN + TURN fallback**: direct/STUN first; request an authorized relay only
  after a direct attempt fails.

LAN remains the default. The room's invitation section shows the same dropdown,
locked while joined. Leave the room before choosing another mode.

Host, Join and Find now route through the matching native transport on desktop
and Android. Internet transport runs in the isolated trusted WebRTC broker,
not the game renderer. Its HTTPS/WebSocket access is pinned to the gateway in
the native configuration. The renderer still cannot load external services.

Find a random match uses the gateway's open-room directory, **not STUN for discovery**.
It matches the exact game/app payload identity, connection mode and supported
Classic/Forest/Normal rules. Private, full, started, expired or unlistening rooms
cannot reserve a seat. Pending seats count toward the four-player limit.
Guests enter the lobby only after bidirectional peer links are confirmed.
Failed/cancelled seats are released; expired leases are cleaned up by alarms.
Find tries at most three candidates and never silently changes mode.

The gateway was deployed on **November 24, 2026**, initially disabled, then
enabled for the exact local test payload after provisioning its separate
admission, admin and IP-hashing secrets. Its native endpoint is pinned in the
configuration. Guarded TURN was subsequently enabled with separate metering,
short-lived credentials and the owner's approval.
The room's existing locked dropdown reports the selected peer route from local
ICE statistics, with no added gameplay overlay or periodic telemetry.

Desktop broker requests run in a dedicated nonpersistent Electron session;
the game session blocks all external HTTP/WebSocket requests. Android keeps
its separately isolated broker WebView and blocked game WebView.
LAN remains usable independently. Published v1.1.0 is not modified by source
changes; deployment alone does not upgrade installed clients.

Future payloads must be prepared/verified and added with
`node standard/scripts/configure-coop.mjs --enable-guarded-turn --accept-payg-risk` before a separate
gateway deployment. `--replace-test-builds` deliberately retires earlier test
candidates; omit it to retain up to eight prior accepted identities.

The Cloudflare TURN issuer secret remains outside Git. No relay credentials,
API keys or arbitrary endpoint URLs are exposed to the game.

The existing dropdown screenshot was shown and approved before the focused
verification pass. No replacement screen or gameplay connection overlay.

The local test build was verified with four isolated native peers through the
live gateway: Find, chat, reliable/binary peer packets, prepared-ticket barrier,
full-room rejection and leave/rehost passed. Android unit tests/lint and both
package identity/payload audits passed. This was not physical Android gameplay
or a different-network acceptance test; those remain the owner's device test.
The matching packages and checksums are in `build/local-test/`.
