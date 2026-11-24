# Co-op service security

## Permanent keys

The TURN issuer key, usage-monitor token, admin bearer and IP-hashing secret
are server-side secrets. They are never shipped in the game, native packages,
Git history, release metadata, CI secrets, error responses or application logs.
Local operational copies are stored outside the repository with permissions
0600. The monitor is read-only and scoped to this Cloudflare account.
Cloudflare account/deployment access can still expose server secrets: protect
the account with MFA and review authorized tokens and users.

Provider API destinations are fixed HTTPS endpoints. Redirects are never
followed with a bearer token. Public API errors contain safe codes, not provider
bodies, headers, stack traces or credentials. Worker observability is disabled.

## Temporary credentials

TURN cannot function without giving its clients temporary ICE credentials.
An authorized device owner can inspect its own credentials; hiding or
obfuscating them in a public app would not make them secret.

The service instead requires an unguessable member bearer, an active room
socket and an active peer in that exact room. STUN-only rooms cannot obtain
TURN credentials. The issuer accepts only server-chosen TTL/options, with
eight relay requests per member per minute, bounded rooms/members/overlap,
and a new conservative byte reservation before each actual issuance.
Old credentials expire after five minutes and are revoked on room departure.
Failed revocations are retried; ambiguous issuance blocks further issuance
until operator review. Temporary credentials stay in the isolated native
broker, never the game renderer or save files.

## Abuse and cost limits

Anonymous matchmaking is not strong user authentication. Client assertions
about ICE failure, native-app identity, Origin/CORS, client bandwidth limits,
or a public build ID are not proof against a modified or malicious client.
The server enforces membership, rates, credential lifetime and budget checks
independently. A botnet or compromised account cannot be ruled out.

The 800,000,000,000-byte operational cutoff uses trusted account-wide TURN
plus SFU analytics, real billing periods, high-water marks and nonrefundable
reservations. Missing/stale/partial metering fails closed. Analytics lag,
credential misuse and unrelated account traffic mean this is NOT a guaranteed
1,000 GB hard billing cap. LAN and single-player do not depend on this service.

## Incident response

From the repository root, use the private operator tool:

```sh
node services/coop-gateway/scripts/relay-admin.mjs disable
```

This latches the gate closed and batches revocation of known leases. Expiry is
the backstop. If an issuer/admin/monitor key is suspected exposed, revoke it
in Cloudflare, create a least-privilege replacement, store it outside Git and
reprovision only the exact Worker secrets. Never paste credentials into chat,
commit them, or include the one-time token screen in a screenshot.
Refreshes do not undo a kill switch; `resume` requires explicit operator review.

Use the local known-secret audit against source/history, the shared payload
and decompressed ZIP/APK artifacts before distribution. Public CI has no
private keys and runs the structural credential guard only. This reduces
leak risk; it is not a proof of immunity to every exploit.
