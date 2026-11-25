# Co-op in v1.3.0

Install the same official release on every device. Local test builds can differ
even when their displayed version matches, so replace them with the release
downloads before playing together.

1. Open **Co-op** and choose the same **Connection** mode on every device.
2. One trainer chooses **Create room** and keeps the host app open.
3. To appear in **Find a random match** or **Pick Rooms**, the host enables
   **Find teammates**. Otherwise, share the code and use **Join room**.
4. Choose Pokémon inside the room. The host selects the map, difficulty, mode
   and Duo/Trio/Squad capacity; everyone readies up before starting.

Rooms support 2–4 trainers in Classic, Survival, Relay, Daily Mutation and
Boss Rush. Ordinary map/difficulty choices respect the team's earned unlocks.
The Great Expedition's team panel also supports Wild Valley and Safari Zone.
Each trainer uses their own loadout and loot ownership; keep the room and apps
open until rescued-item returns are acknowledged.

LAN codes have **four characters**; Internet codes have **six**.
Discovery lists only open rooms using the same build and connection mode.
Expedition searches also match the selected destination.
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
Temporary interruptions pause the current run and retry for up to **90 seconds**
while the apps remain open. The team resumes after synchronization. Choose
**Give up** to stop retrying; permanent failure ends the attempt through the
normal results/save path. Force-closed apps and host migration are not supported.

Finish older-version unfinished runs and export a backup before updating.
Fully quit the old Mac app with Command-Q
before opening its replacement. Install Android updates over the existing app;
do not uninstall first.
