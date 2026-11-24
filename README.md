# PokéBonk Offline

Unofficial offline PokéBonk for **macOS, Windows, Linux, and Android**. Play with normal progression and local saves—no online account or automatic unlocks.

**App v1.2.0 · Bundled game v0.10.26**

[Download the latest release](https://github.com/Nicartjay/pokebonk-offline-standard/releases/latest) · [Report a bug](https://github.com/Nicartjay/pokebonk-offline-standard/issues)

## Features

- Classic, Endless, Relay, Practice, and Daily Mutation.
- Offline Boss Rush and Lavender Tower, including earned Challenge Pass rewards and missions.
- Solo Great Expedition with local loot, extraction, inventory, shop and earned pass rewards.
- Experimental 2–4-player co-op: LAN, STUN-only Internet connections, or direct-first TURN fallback (Classic · Viridian Forest · Normal). Browse rooms, find a random match, or join by code. See the [co-op guide](standard/docs/internet-coop.md).
- Personal Records, JSON save backups, desktop graphics options, and Android touch controls.

LAN and solo play need no Internet. Internet co-op uses a separate signaling service; there are no online accounts, leaderboards or competitive prizes.

## Install

| Platform | Download | Installation |
| --- | --- | --- |
| macOS 13+ | DMG / ZIP; `arm64` for Apple Silicon, `x64` for Intel | Drag the app into Applications. |
| Windows x64 | Setup EXE or portable EXE / ZIP | Run setup or unpack the portable version. |
| Linux x64 | AppImage / DEB | Make the AppImage executable or install the DEB. |
| Android 8+ | APK | Install over the existing app; do not uninstall first. |

macOS builds are not notarized, and Windows builds are unsigned, so OS security warnings may appear.

## Saves and updates

Use **Player & saves** to export/import backups or check for updates. Progress is stored outside the installed app. **Back up your save before updating**, especially on Android.

The app automatically checks signed GitHub releases; downloads and installation require your confirmation. Gameplay works offline. Website updates are adapted separately before being included in an app release.

## Develop

Requires **Node 26** and **pnpm 10.33.2**. Android builds also need **JDK 21** and **Android SDK 36**.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

See the [maintenance guide](standard/docs/maintenance.md) for builds, signing, and releases. Successful full builds automatically remove older Actions artifacts while preserving published releases.

The optional [co-op gateway](services/coop-gateway/README.md) keeps permanent TURN credentials server-side.

## Credits

Original game: **Charcher** · Shell tooling: **VdustR** · Offline adaptation: **Nicartjay**

The [AGPL-3.0 license](LICENSE) covers the shell, not third-party game assets. Pokémon and other game assets remain their owners’ property. See [credits and asset notices](NOTICE.md).
