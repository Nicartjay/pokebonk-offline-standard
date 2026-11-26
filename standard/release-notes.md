# PokéBonk Offline 1.3.1

Bundled game: **PokéBonk 0.10.31 / mwv6wzyo**.

- **Optional cross-platform cloud saves:** connect the same Google account on your devices, sync completed progress, review conflicts and restore backup history. Google is used for identity only—no Google Drive permission.
- **Local saves first:** signing in alone does not upload or replace progress. Automatic sync requires a separate opt-in. Device graphics, audio and touch settings stay local; unfinished runs and live co-op sessions do not sync.
- **Mac sign-in without Keychain:** cloud credentials stay only in native memory. A temporary localhost callback returns you to the game; connect again after fully quitting.
- **Android browser return:** tap **Return to game** in Chrome. The app handles `pokebonk-offline://` links, retains the previous link alias and provides an alternate return link.
- **More resilient Android sign-in:** temporary sign-in checks retry within the same attempt, with bounded backoff and safe error references.
- **Updater and co-op fixes:** clearer in-game update feedback and download progress; preserved co-op rooms when returning from results or opening Pokémon selection.
- **Android readability and artwork:** improved outlined combat/collection text and restored missing task-reward artwork.

**Before updating:** export a JSON backup. Use the same new build on all co-op devices. Finish active runs and Expedition item returns before cloud syncing.

Optional cloud saves are capacity-limited and are not a replacement for your own backups. Cloud backups are not end-to-end encrypted. [Privacy](https://pokebonk-offline-cloud.nicartjay.workers.dev/privacy) · [Terms](https://pokebonk-offline-cloud.nicartjay.workers.dev/terms)

Install the Android APK over the existing app—**do not uninstall**. Fully quit the old Mac app before opening the new one. The app ID, save schema, release-verification key and Android signing identity are unchanged.

**Downloads:** macOS Apple Silicon/Intel DMG and ZIP; Windows setup/portable EXE and ZIP; Linux AppImage/DEB; Android APK. macOS builds are ad-hoc signed, not Apple-notarized; Windows builds are not Authenticode-signed.
