# Co-op in v1.2.0

Install matching app builds on every device. v1.1.0 has LAN only; Internet
co-op and the short-code room picker require v1.2.0 or a matching test build.

1. Open **Co-op** and choose the same **Connection** mode on every device.
2. One trainer chooses **Create room** and keeps the host app open.
3. Other trainers choose **Find a random match**, select a room in
   **Pick Rooms**, or enter its code in **Join room**.
4. Choose Pokémon inside the room, ready up, then let the host start.

Rooms support up to four trainers in **Classic · Viridian Forest · Normal**.
LAN codes have **four characters**; Internet codes have **six**.
Discovery lists only open rooms using the same build and connection mode.
The locked Connection control in the room reports the actual selected peer
route: LAN, STUN/direct, or TURN—not just the preferred policy.

**LAN** needs the same private Wi-Fi/hotspot and no Internet. **STUN only**
tries direct Internet connections without a relay. **STUN + TURN fallback**
tries direct/STUN first and requests TURN only if needed.
Relay availability depends on the service's safety/budget gate. **STUN only**
never requests a relay. No router port forwarding or online game account is
required; restricted networks may still prevent connections.

Permanent issuer/admin/monitor keys are never shipped in the app. Only temporary
five-minute ICE credentials enter the isolated native broker. The room shows
the actual route; no network badge is added during gameplay.

The owner-approved service uses an 800 GB operational cutoff and fails closed
when account metering is unavailable. This is not a guaranteed billing cap.

Single-player and LAN continue working without Internet. Your normal local
progress and save export/import remain unchanged. Back/Esc asks before leaving.
Exact interrupted-run reconnection and host migration are not supported.

Export a backup before updating. Fully quit the old Mac app with Command-Q
before opening its replacement. Install Android updates over the existing app;
do not uninstall first.
