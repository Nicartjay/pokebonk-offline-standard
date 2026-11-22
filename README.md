# PokéBonk Offline

Unofficial, fully bundled **normal-progression** PokéBonk for desktop and Android.
No Python server, separate browser, game account, live website loading, or automatic
unlocks. Classic, Endless, Relay and Practice are retained; server-dependent modes
and services are excluded.

The reviewed game snapshot is **0.10.20 / `mwqb4pwz`**. This is a pinned baseline,
not a claim that it is the newest online game.

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
scaled 10% smaller without modifying saved size preferences. Only the native
app-menu button reserves its own space; no extra rounded-corner border is added.

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
```

These use temporary, in-memory save bridges, not your installed progress.

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
