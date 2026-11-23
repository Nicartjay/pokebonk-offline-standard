# Local co-op — experimental LAN test

Target: two to four devices on one private Wi-Fi/LAN or local hotspot, playing
Classic / Viridian Forest / Normal. Each device retains its own progression.
Existing solo saves must be completed or explicitly ended before joining.

## Room presentation

The room is the **captured upstream room**, not a separate imitation.
`adapters/lan-room.mjs` structurally adapts the existing menu function, retaining
its destination pane, animated Pokémon stages, trainer cards, room chat, Invite
pane, Lab navigation, and ready/start bar. Upstream styles and sprite helpers
remain in use; `runtime/lan.css` changes only LAN-specific layout details.

The original four-seat room is retained. Public matchmaking, friends/clans, website
profile links, online standing, vote/kick APIs, and website invite URLs are
removed. The invite contains a private address and an ephemeral pairing key.
Unsupported mode/difficulty controls cannot change the native rules.

`runtime/lan-lobby.js` maps native session state to the original screen's
interface. The gameplay room facade is separate: drawing a room is **not**
evidence that a multiplayer game works.

The **Local co-op** homepage entry opens the adapted Create/Join page.
Choose a private interface to host, then share the full
`address:port#pairing-key` invitation. Joining devices paste that invitation.
An owned Pokémon is selected automatically; change it inside the room.
The host starts only when every direct
peer pair is connected and every participant is ready.

**Find a match** asks compatible apps on the current private network for open
rooms, then joins one with a free seat. Hosts advertise only while waiting for
players (not while full, preparing or playing). Creating a room makes it
discoverable to other devices on that LAN; its display name and temporary
invitation are shared locally. The UI explains this before Create room.
Search lasts four seconds, can be cancelled, and is cancelled when leaving
the entry screen or backgrounding Android. No room found is not an error;
manual invitations and Create room remain available.

Use matching local builds. The pairing identity includes the application ID,
application/game versions and the complete game-payload digest. Ordinary
four-letter codes from the online website do not work here.

Discovery uses a TTL-one multicast question and bounded unicast replies,
not a subnet/IP sweep. Identity, per-search nonce, source/private subnet,
capacity and invitation address are validated before autojoining. Android
holds a Wi-Fi multicast lock only while an open host answers discovery.
Networks that block multicast can still use manual invitations.

No public lobby, Bluetooth or Wi-Fi Direct setup is implemented.
Use the same LAN or a manually enabled hotspot that permits peer traffic.
Allow the system's Local Network/private firewall prompt; never forward a
router port for this feature.

## Transport and future internet co-op

The original WebRTC control/snapshot transport runs in a native-owned broker.
The game renderer must not gain arbitrary WebRTC, sockets, URLs or ICE config.
LAN uses no external STUN/TURN and accepts only private/local ICE candidates.
`runtime/lan-session.js` and `lan-rtc.js` are shared by both shells. Native
TCP carries authenticated/encrypted pairing, room changes and signaling;
the game uses a full mesh of reliable control and unreliable snapshot
channels, one pair per teammate. Native adapters never accept public
destinations, arbitrary DNS names, native paths or executable commands.

Each player atomically commits a versioned local ticket before the start
barrier can release the shared seed/party. Rewards settle on each device using
the original co-op rules, deduplicated by ticket. LAN bests are stored separately
from solo bests. No other player's save or permanent profile ID is shared.

If a client leaves mid-run, its peer closes but the original match roster and
save identity remain fixed. If the host/process/connection stops, the last
durable ticket/checkpoint remains. Exact co-op reconnection/resume and host
migration are not supported: export a backup if needed, then explicitly end
an interrupted run in Player & saves before joining another room.

After LAN is stable, an **optional, separately authorized Internet co-op mode**
can add invitation/signaling and STUN/TURN adapters. TURN credentials must be
short-lived and issued by that service, never embedded in the game or Git.
Add authentication, room expiry, rate/bandwidth limits and relay abuse controls
before enabling it. Do not weaken the LAN policy or deploy a service now.

Single-player, saves and local co-op must remain independent of that service.
Internet-service failure must never block the installed offline game.

## Current evidence

Source-only previews are under `evidence/previews-lan-functional-source/` (ignored).
They use synthetic profiles/session data, not real saves or peer connections.
The focused checks cover private-network policy, 2/3/4-player ready/start
barriers, pairing corruption/replay and Java/Node encrypted-wire compatibility.
`standard/scripts/check-lan.mjs` exercises an isolated Electron host and three
isolated game clients over native private TCP and real WebRTC, with temporary
saves. Its report is `evidence/lan-check/checks.json` when successful.

These automated checks do not replace the maintainer's physical Mac/Android
gameplay acceptance. Local packages remain unpublished until that testing.
