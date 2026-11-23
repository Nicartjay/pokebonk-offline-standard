# PokéBonk Offline

Unofficial, fully bundled **normal-progression** PokéBonk for desktop and Android.
No Python server, separate browser, game account, live website loading, or automatic
unlocks. Classic, Endless, Relay, Practice and Daily Mutation are retained.
Mewtwo Strikes Back (Boss Rush) and Lavender Tower are permanent offline event
replays with locally earned pass/mission rewards, without competitive prizes or leaderboards. Server-dependent modes and services
are excluded.

**Version 1.0.0** bundles **PokéBonk 0.10.26 / `mwsewi0r`**.
This is a pinned offline snapshot, not a live website wrapper or a claim that
every future online update has already been adapted.

## Downloads and app identity

| Platform | Release files | Installation after a verified download |
| --- | --- | --- |
| macOS 13+, Apple Silicon | `.dmg`, app `.zip` | Drag **PokéBonk Offline.app** into Applications |
| macOS 13+, Intel | `.dmg`, app `.zip` | Drag **PokéBonk Offline.app** into Applications |
| Windows x64 | NSIS setup `.exe` | Run the installer; later installers upgrade in place |
| Windows x64 portable | Portable `.exe`, unpacked `.zip` | Replace the portable EXE/application folder |
| Linux x64 | `.AppImage` | Make executable and run; replace the file to upgrade |
| Debian/Ubuntu x64 | `.deb` | Install/upgrade with the system package manager |
| Android 8+, compatible WebView/WebGL | Signed universal `.apk` | Confirm installation in Android's installer |

macOS downloads use **`macos`** in their filenames, for example
`pokebonk-offline-0.1.1-macos-arm64.dmg` (Apple Silicon) and
`pokebonk-offline-0.1.1-macos-x64.dmg` (Intel). Their app ZIPs, checksum entries,
update URLs and receipt files use the same naming. `darwin` remains an internal
Electron platform ID, not a download filename.

Android keeps the normal edge-to-edge game layout, with HUD and touch controls
scaled 10% smaller without modifying saved size preferences. There is no extra
rounded-corner border and no native three-dot overlay/reserved slot. **Player &
saves** includes update checks, native document-picker backup import/export and
bug reporting, in the game's own theme. Back retains a startup-recovery path if
the game cannot initialize.
Android has no redundant fullscreen controls, its minimap slider supports
60–200%, and battery saver caps actual game rendering at 30 FPS even when a
higher FPS option was selected. Tablet card headers explicitly stretch to keep
starter pictures and upgrade artwork visible.

Desktop menu hover uses the same selection animation as keyboard focus, with the
upstream button styling and a matching colored Relay tile. Closing the last
macOS window quits the game after pending native save writes finish.
The native desktop shell now remembers window/maximized/fullscreen state, fits
off-screen windows back onto a connected monitor and offers **Display & graphics**
from Player & saves or View. It has logical-pixel size/monitor controls, foreground
keep-awake and GPU diagnostics. Graphics choices apply after an explicit restart:
Auto/Metal/OpenGL on macOS; Auto/Direct3D 11/OpenGL/Vulkan on Windows;
Auto/OpenGL/Vulkan on Linux. Auto is recommended and Vulkan is experimental.
An unsuccessful alternate-backend launch restores Auto next time. Alternative
graphics backends depend on the device and driver; Auto remains recommended.

The illustrated offline Guide opens once on the homepage after starter selection,
then offers initial player-name setup. Existing names and progress are preserved.
The Guide also remains manually available. Startup waits for the real menu BGM to decode (not for an autoplay
permission), honors muted settings and continues automatically after at most
twelve seconds if audio is unavailable. There is no loading-screen button.
Android title outlines use behind-the-fill shadows to avoid broken paint-order
rendering on tablet WebViews; forced OEM darkening is disabled.

The homepage keeps Play beside stacked Endless/Relay buttons, website-style
Event/Tasks tiles, four collection/build tiles and an inline Personal Records
table. Relay uses portraits from your own League, like the website. New profiles
start with **10,000 Stardust**; existing or imported balances are never topped up.

**Personal Records** has KOs, Survival and Time Attack tables with mode/map/
difficulty filters. These are only this save's results, never an online board.
Best rows persist independently of the upstream 30-run recent-history limit.
Compatible older saves are backfilled from their retained data; missing original
details are not invented. Challenge rotations are kept separate.

Boss Rush and Tower retain earned local progression, event points, Challenge
Passes and Missions. Competitive leaderboard/clan prizes are excluded. Older
records-only tickets keep their original no-reward policy. They are one-session
modes, as is Relay. Daily Mutation uses the game's on-device daily rules/seed,
retains earned progression and has no server ranking. **The Great Expedition is
only a disabled visual preview**, not a playable offline mode. Duels and co-op
remain excluded rather than simulated with fake server responses.

Click the original-style **OFFLINE v1.0.0** badge for bundled offline version
history and the corresponding upstream game version/build for each entry.
The app version is not the upstream game version.

All platforms display **PokéBonk Offline** and use the bundled PokéBonk icon.
The internal edition remains `standard`, and the application ID remains
**`dev.nicartjay.pokebonk.offline.standard`** for save/update compatibility.
The repository name is not the displayed app name.

These are **Electron desktop apps** and a native Java **Android WebView** shell,
not Tauri packages or a renderer rewrite. macOS builds are free **ad-hoc signed,
not notarized**; Windows installers are **not Authenticode signed**. OS security
prompts are expected. APK signing and signed update metadata do not imply Apple
Developer ID or Windows publisher certification.

## Updates: website changes are not blindly published

1. **Detect**: the daily GitHub workflow checks the online game and creates or
   updates one tracking issue when its build changes. It only reports.
2. **Maintain**: capture a pristine candidate, adapt offline patches structurally,
   review assets and save compatibility, and test it.
3. **Build**: one accepted game payload feeds every platform. CI builds nine
   desktop packages and a clearly marked **unsigned Android candidate**, with
   hashes and an audit. CI never receives your private signing keys.
   After a complete build passes its candidate audit, older completed installer
   runs' Actions artifacts are removed. The newest complete set is retained;
   active/newer builds, source snapshots and GitHub Releases are not deleted.
4. **Finalize and approve**: one local command verifies the completed CI run,
   signs the APK and update metadata with the original keys on your Mac, and can
   prepare an **unpublished draft**. After real-device/licensing acceptance, approve
   **Publish approved release**. Only that advances the public channel.
5. **Receive**: installed apps check this repository's signed channel on launch or
   foregrounding, at most once per 24 hours. There is also **Check for updates**.

The game renderer cannot access the network or the updater. Checks/downloads run
in trusted native code; release metadata is signed with ECDSA P-256/SHA-256 and
each download has a signed size and SHA-256. The app chooses the matching
installer/portable/Linux distribution. Prompts wait until the game is at the menu.
**Download and installation are explicit**; nothing silently self-replaces.
Offline checks/failures never block the installed game.

See [maintenance and release instructions](standard/docs/maintenance.md).

## Develop

Use Node **26** (or the package's supported Node 24 range), pnpm **10.33.2**,
JDK **21**, Android SDK **36** and build-tools **36.0.0**.

```sh
pnpm install --frozen-lockfile
pnpm prepare:game
pnpm test
pnpm verify
pnpm dev
```

Desktop packaging must run on the target OS (both Mac architectures can be
packaged on a Mac):

```sh
pnpm package:desktop darwin arm64
pnpm package:desktop darwin x64
pnpm package:desktop win32 x64
pnpm package:desktop linux x64
pnpm package:android
```

Outputs: `standard/release/`; unpacked desktop bundles:
`build/desktop-out/`. Local Android builds read the **existing external** signing
credentials from `../pokebonk-standard-signing/credentials.json`. Never generate
replacement keys for an already configured application.

To finalize a successful full installer run and prepare a draft:

```sh
# Set JAVA_HOME (JDK 21) and ANDROID_HOME first.
pnpm release:finalize RUN_ID --prepare-draft
```

Use the exact clean source commit that CI built. Private keys stay in the
external `../pokebonk-standard-signing/` folder; **no GitHub signing secrets are
required**. The separate publication workflow verifies the already signed files
without needing those keys. See the maintenance guide before releasing.

For headless UI regression checks, install Playwright's Chromium headless shell,
or set `CHROME_PATH` to an existing headless executable:

```sh
pnpm exec playwright-core install chromium --only-shell
pnpm check:layout
CHECK_PLATFORM=win32 pnpm check:layout
CHECK_PLATFORM=android pnpm check:layout
node standard/scripts/check-platform-fixes.mjs
node standard/scripts/check-offline-content.mjs
```

These use temporary, in-memory save bridges, not your installed progress.
The platform-fix checks also use the preserved previous prepared payload at
`build/compat-game-0.10.20/` for real suspended-run replay tests; this local fixture
must be captured from the previous app before preparing its replacement.
Offline-content checks exercise the real event/mutation entry points, result
settlement, tabbed records and version history with synthetic local saves. They
are not a substitute for physical Android/Windows gameplay checks.

## Saves

Saves are atomic with a previous-file backup, **outside the installed app**:

- macOS: `~/Library/Application Support/dev.nicartjay.pokebonk.offline.standard/saves/`
- Windows: `%APPDATA%\dev.nicartjay.pokebonk.offline.standard\saves\`
- Linux: `$XDG_CONFIG_HOME/dev.nicartjay.pokebonk.offline.standard/saves/`
  (normally `~/.config/...`)
- Android: private app `files/standard-saves-v1/`

Portable Windows packages also keep saves in application data, **not beside the
EXE**; installer and portable formats share this same normal-progression identity.
Replacing/upgrading the app preserves progress. Uninstalling Android deletes its
private data, so export a backup first.

Use **Saves** on desktop, Android's native **⋮** menu, or in-game **Player & saves**
to export/import JSON. Compatible older offline progression backups can be
imported explicitly; unlock-all saves are rejected, never automatically converted.
Incompatible schemas or suspended runs are preserved and block unsafe writes or
updates. Finish an incompatible run in the previous version.

**Save and quit** makes an exact checkpoint. Complete serialized checkpoints are
also persisted every 15 seconds and when backgrounded. Abrupt termination may
lose work since the last completed checkpoint, not already committed progress.

## Credits and licensing

Original game: **Charcher**. Original shell/build tooling: **VdustR**. Offline
integration: **Nicartjay**. See [NOTICE.md](NOTICE.md), [LICENSE](LICENSE), and
the pristine game's `creditos.txt`.

Pokémon/game art, audio, names and designs remain their respective owners'
property. The shell license is not a grant of redistribution rights to those
assets. Public binary publication is gated on rights/credits review and actual
device acceptance; a successful CI build is not that approval.
