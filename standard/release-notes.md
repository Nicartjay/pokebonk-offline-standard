PokéBonk Offline 1.0.0

Bundled game: PokéBonk 0.10.26 / mwsewi0r, including eleven additional
Maximum-form sprite sheets and upstream changes since 0.10.23.

- Desktop remembers bounds, maximized/fullscreen state and fits disconnected
  monitor positions back onto a usable screen.
- Display & graphics offers DPI-aware monitor/size controls, foreground
  keep-awake, GPU diagnostics and native fullscreen that leaves Esc for pause/back.
- Restart-required graphics choices: Auto/Metal/OpenGL on macOS,
  Auto/Direct3D 11/OpenGL/Vulkan on Windows, Auto/OpenGL/Vulkan on Linux.
  Auto is the default; Vulkan is experimental. No GPU blocklist/sandbox/VSync
  bypasses are enabled.
- First-use Guide opens once on the homepage, after starter selection, using
  the upstream 1.2-second delay and waiting for other dialogs to close.
- Completing or skipping the first Guide opens a game-styled player-name setup.
  The chosen name and completion marker save atomically; existing custom names
  are not overwritten. Android homepage logo outlines and shine alignment are
  corrected for older tablet WebViews.
- Initial loading waits for decoded menu BGM and honors mute settings. There
  is no loading-screen continuation button: after a maximum twelve-second
  audio wait, the game continues automatically if the music is unavailable.
- Android's three-dot overlay is removed. Player & saves contains its native
  backup picker, update and report actions without adding storage-bridge methods.
- Tablet title outlines cannot paint over the letter fills; OEM auto-darkening
  is disabled and bundled runtime files are not served from a stale HTTP cache.
- Classic/Endless checkpoints from 0.10.20 and 0.10.23 were replayed with their
  ticket, balance, elapsed time and gold retained, then advanced real simulation.
  Unknown unfinished-run builds still fail closed with their bytes preserved.

- Classic, Endless, Relay and Practice, bundled for offline use.
- Daily Mutation uses the original on-device daily rules and seed, with earned
  progression and no server leaderboard.
- Mewtwo Strikes Back (Boss Rush) and Lavender Tower have their original
  challenge, pass and mission screens. New runs earn normal local progression
  and the bundled event rewards without deadlines. Competitive leaderboard,
  clan and placement prizes remain excluded. Claims commit atomically and
  cannot award twice; older records-only event runs keep their original rules.
- Compact website-style homepage with Play, stacked Endless/Relay and the
  original animated Game Modes popup. Short subtitles and bounded controls
  leave the background visible. Relay is not repeated inside Game Modes.
- Personal Records is a real inline best-run table, not a navigation card.
  The player row shows how many earned Pokémon are usable in Play.
- Personal Records has KOs, Survival and Time Attack tables, local-only
  mode/map/difficulty filters, persistent bests and honest legacy backfill.
- The original-style OFFLINE badge shows the offline app version, not the
  upstream version. Clicking it opens bundled offline history with each entry's
  corresponding PokéBonk version/build and actual test/publication status.
- Native, edition-isolated saves with atomic commits and previous-file backups.
- Explicit import of compatible backups from the earlier progression edition.
- Signed native-only update discovery; downloads and installation require approval.
- No online accounts, multiplayer, rankings, analytics or game-server connections.
- PokéBonk name/icon across macOS DMG/ZIP, Windows setup/portable/ZIP,
  Linux AppImage/DEB and Android APK packages.
- Transparent Mac/Windows title bars and responsive menu/fullscreen fixes.
- Corrected macOS bundle/helper Unicode normalization to prevent startup crashes.
- Android's normal edge layout restored, with HUD and touch controls 10% smaller;
  the game canvas stays full-screen and saved size preferences remain unchanged.
- Player & saves uses the bundled game fonts, theme and buttons. Its fixed,
  user-clicked native actions never enable renderer networking.
- Player & saves has a Check for updates action without expanding the
  two-method native storage bridge.
- Android minimap scaling honors the complete 60–200% slider.
- Battery saver overrides higher/uncapped FPS choices and limits actual game
  frames, including renderer-forced redraws, to at most 30 FPS.
- Tablet starter and level-up card headers have explicit full-width sizing;
  artwork no longer depends on WebView button-alignment defaults.
- Android starter selection keeps the roomy layout when there is enough space,
  compacts only when necessary, and gives all three image panels equal heights.
  The heading, cards, descriptions and confirmation fit without vertical scrolling.
- New profiles start with 10,000 Stardust. Existing or imported saves are never
  topped up or automatically unlocked.
- Added creator attribution beside Credits and the Player & saves version,
  preserved the full Credits logo, and restored the illustrated offline Guide.
- Report a bug opens a fixed GitHub Issues form through trusted native code,
  without uploading saves or giving the game external network access.
- The Great Expedition is a clearly labelled, disabled design preview only.
  Its offline inventory, extraction and settlement are not implemented.
- Included the missing Clover Sweet event-reward artwork identified by the
  offline screen checks; all earlier pristine source captures are preserved.
- Keyboard navigation follows the homepage's visible button order. The Daily
  Mutation backdrop cannot widen the page, and its Back control clears the
  transparent desktop title bar.
- Desktop mouse hover uses the same focus lift/cursor/icon animations as
  keyboard navigation; Relay now shares the other decorated mode-button design.
- Closing the last macOS window exits the app after pending save writes finish.
- Daily upstream change reporting, separate reviewed builds, and explicit
  publication approval. The live website is never loaded by the installed game.

Desktop builds are not Developer ID/notarized or Authenticode signed. APK updates
retain the Standard package ID and dedicated Android signing certificate.
