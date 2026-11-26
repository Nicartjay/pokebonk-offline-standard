# Maintain, build, sign locally, approve publication

Publisher: **Nicartjay/pokebonk-offline-standard**. Visible app: **PokéBonk Offline**.
The internal edition, application ID, save directories and signing identities
remain Standard-compatible; the old mixed-edition repository is independent.

## Private keys stay on the Mac

**Do not upload private signing keys/passwords to GitHub.** No signing secrets are
needed by these workflows. Keep and securely back up the original external
`../pokebonk-standard-signing/` directory, including its build-machine-only
`credentials.json`, Android keystore and P-256 release key. Files must not be
committed, logged, put in the game, cached/uploaded by CI, or rotated.

Only the public P-256 key and APK certificate fingerprint belong in config.json.
Losing the original keys prevents ordinary trusted updates to existing installs.
A nearby copy is not a disaster-recovery backup: keep another secure offline copy.

GitHub's **release-publication** environment requires owner/release-maintainer
approval and permits only `main` and `standard-v*` tags. It needs no private key:
publication verifies files which were already signed locally.

## 1. Detect website changes, without publishing them

`check-upstream.yml` runs daily at **09:41 Asia/Manila** (01:41 UTC), or manually.
It compares the actual website version/build to `standard/accepted.json`, then
creates/updates one managed tracking issue. It preserves human issue notes and
fails closed if discovery is unsupported.

The checker cannot capture, promote, commit, tag, sign, or publish game code.
An online update is a review request, not automatically trusted offline code.

## 2. Capture and adapt a pristine candidate

1. Review the detected build and applicable permissions/credits.
2. Capture bounded public source:
   `node scripts/capture-live-graph.ts upstream/standard-review`.
3. Review generated resource paths, retained modes, models, sprites/forms, cries,
   music, atlases, fonts, items and map previews. Produce a finite JSON contract
   with `reviewedBuild`, `required` and `optional` path arrays. Do not call a missing
   required asset “optional” merely to get a successful build.
4. Run:
   `node standard/scripts/capture-candidate.mjs upstream/standard-review CONTRACT.json`.
   It verifies hashes/versioned requests and records a new pristine candidate in
   `upstream/standard-candidates/BUILD/`; it does not change accepted.json.
5. Add/test a structural adapter under `standard/adapters/`. The current source
   revision selects **0.10.31/mwv6wzyo** in `vendor/pokebonk-standard-0.10.31`,
   pinned to `4e20fcc6612cd5c2e3e010f45136bd5e1710be74aa9975d0741d0783ffb0f7d5`.
   It is a development source candidate, NOT a tested or release-approved payload.
   Its lifecycle module initializes App internally rather than exporting it.
   Role matching explicitly handles this structure and its decoded-track audio
   instance. The 0.10.31 binding review additionally resolves the changed
   Pokédex+ entry, profile normalizer and earned-reward settlement by unique
   semantic AST roles. This retains the original collection/move-history
   backfill and future updates from earned runs, rather than replacing them
   with unlock-all values. Its new Expedition `want`/`wants` and `tidy` actions
   have local transactional handlers: use the original wanted-loot allowlist
   and stack limits, retain locked items and equipment identities, and conserve
   quantities without combining inventory with the safe pocket or escrow.
   Four new collection-goal icons are hash-pinned in
   `standard/asset-additions.json`; eleven form sheets remain required
   alongside the event resources.
   The preceding 0.10.26, 0.10.23 local-complete capture, events capture and
   **0.10.20/mwqb4pwz** remain immutable references; their partial
   event asset sets are not sufficient for a new event-enabled payload.
   The current adapter resolves changed bindings by reviewed AST
   contracts and the hash-verified original reference, including a stable
   progression API facade. Unrelated reused minified names are never treated as
   role matches. Unsupported or ambiguous
   structures stop preparation instead of producing a partly working release.
6. Verify progression, modes, complete resources, serializer compatibility and
   network isolation. Only then put the pristine snapshot in a **new** vendor
   directory and review accepted.json, config and adapter allowlist changes.
   Never edit a pristine snapshot or patch an already patched game.
   Website-only Cloudflare email decoding is omitted from the prepared game,
   alongside the website updater/service-worker metadata; original pristine
   source and artist credits remain preserved.
   Check room/prop model IDs as well as URL literals: the Boss Rush lamps,
   consoles, crates, lighthouse, pillars and statues are resolved dynamically.
   `standard/resource-contracts/BUILD-events.json` requires all 27 reviewed
   Rush/Tower models and all six pass/mission item icons before preparation can
   succeed. The 0.10.26 contract additionally requires the eleven new form sheets.
   `capture-candidate.mjs` accepts an optional third argument naming a pristine
   reuse snapshot. It may reuse hash-verified bytes only when the exact
   versioned asset-catalog key is unchanged; it never reuses patched payloads.

### Keep local vendor storage small

Run `node standard/scripts/compact-vendor.mjs` to preview duplicate storage, then
add `--apply` to compact it. All snapshot hashes are verified before changes;
identical game files on the same volume become read-only hard links. Every
original version/path and manifest is retained for builds, tests and provenance.
No game payload, installed application, save, release or signing file is changed.
Never edit shared vendor files in place: import new snapshots instead.
Fresh checkouts/captures may recreate copies; rerun compaction when needed.
Reports are written under `evidence/vendor-compaction/`.

### Boss/elite status artwork

The original status renderer builds icon names from its finite status catalog
(`st-` plus each status ID). Literal-only discovery missed this entire family
in v1.2.0. `image-references.mjs` now resolves those catalog entries structurally
through the real icon factory, including renamed imports, and refuses an
unsupported dynamic status expression instead of guessing filenames.

For an accepted/reviewed upstream build, run
`node standard/scripts/capture-status-icons.mjs` when that contract identifies
new missing statuses. It fetches only those public PNGs, pins their size/hash in
`standard/asset-additions.json`, and keeps all pristine vendor files unchanged.
The current set has 15 original status images. Review this catalog alongside
future upstream updates; a cosmetic frame/banner with the same name cannot
satisfy a missing status icon. Preparation includes this contract automatically.

### Treasures portrait frames and animated banners

`cosmetic-images.mjs` resolves the original finite wheel and look catalogs,
portrait-frame image builder and animated banner renderer. It requires the
ordinary prize frames, look-style frames, banner JPG backgrounds and separate
glow PNGs. Seeing a banner's JPG is not proof that its glow layer was captured.

For the accepted build, `node standard/scripts/capture-treasure-images.mjs`
captures missing original artwork and pins its size/hash in the supplement.
The six Series 2 banner glows are original downloads. The original site's
twelve grand-look frame URLs return 404: those have explicitly recorded
offline aliases to each wheel's already-captured matching original grand-prize
frame. These aliases are not claimed to be downloaded style-frame originals,
never grant cosmetics, and never modify a vendor file.

Preparation verifies each alias's original snapshot path, size and hash, and
refuses to overwrite different captured artwork. Review/retire these aliases
when a later upstream version supplies its own style frames. Do not hide the
game's graphics retry notice to mask missing resources.

### Bag and rotating-task reward artwork

The original Bag catalog, not just `data/items.json`, is authoritative for
custom daily/weekly task and Shop items. The original item factory uses a
metadata icon when available, otherwise `items/ITEM-ID.png`. Lure has no entry
in the older PokeAPI metadata; `lure-ball.png` is a different item.

`catalog-image-references.mjs` requires all nine current Bag item images.
For an accepted/reviewed snapshot, `node standard/scripts/capture-task-images.mjs`
fetches only missing original PNGs and pins their size/hash in the supplement.
Refresh/review this catalog during upstream updates so a later reward rotation
cannot reveal another uncaptured item. Do not replace rewards, hide the retry
counter or call its Poké Ball error fallback the intended artwork.

### Audit current artwork without creating/replacing a build

Run `node standard/scripts/audit-images.mjs --source` for the exact accepted
candidate adapted in memory. It does not replace `build/standard-game`, create
an installer, read a native save or launch/close the installed game. The usual
disk-writing preparation still refuses any missing required image.

The image contract now resolves computed appearance/reward IDs, default
look borders (not just Treasures), trainers, seasonal layers, ranks, relics and
Expedition item/faction/pass/Refuge catalogs in the existing data-only VM.
Do not assume a literal-path scan or a clean decoder result proves that no
referenced image is absent.

Optional `--probe-missing` checks only the bounded list of missing public URLs
on pokebonk.com; a network failure is not recorded as an upstream 404.
`--serve` exposes a local-only report with a one-pass browser decoder for all
present images. It serves only the report and image inventory, not the game,
save data or native files. Stop that server after capture.
Results are under `evidence/image-audit-1.3.0/`.

Missing references and corrupt/undecodable present files are separate findings.
Vanguard/Mythic Pokémon looks are generated by the original renderer, not
downloaded as `look-STYLE.png`. Their five decorative border attempts are
reported separately as optional only after structurally verifying the original
remove-on-error handler. Any explicit required use of the same path takes
precedence. This does not exempt base sprites, materials, reward frames or
unknown future tiers. No substitute artwork is added for these five borders.
Other unresolved required original-site 404s remain blockers until reviewed;
never relabel a missing required resource merely to get a green report.

### Rental-build snapshots — refresh with every upstream game update

The installed game never contacts the website's rental API. The original
Builds → Rental browser reads a bundled, hash-checked snapshot. Creator names
and attribution remain visible; website account IDs are replaced with local
snapshot identifiers. Copying plans must not grant Pokémon, items, Lab upgrades,
currency, rental payouts or leaderboard entries.

Whenever bringing in a new upstream version/build, run:

```sh
node standard/scripts/capture-rentals.mjs --target-snapshot PATH_TO_REVIEWED_CANDIDATE
```

After accepting a version, `pnpm capture:rentals` defaults to its accepted
snapshot. The command reads both playable catalogs structurally and captures
every public per-Pokémon rental listing using sequential, rate-limited GETs,
without account credentials. It honors Retry-After, stops on incomplete or
unsupported data, and refuses to finish if the website build changes mid-capture.
It does not retrieve private/unshared builds or claim a full database export.

Raw provenance and hashes stay under `upstream/rental-snapshots/`. The reviewed
runtime data is under `standard/resources/rentals/`, selected by
`standard/rental-snapshot.json`. Preparation checks the target upstream
version/build/digest and refuses a stale/missing snapshot, so a game update
cannot silently reuse the previous rental library. Review any new data fields
and incompatible references before packaging. All captured entries are
preserved; incompatible entries are explicitly blocked from copying, never
silently converted or used to unlock progression.

The current capture is from online **0.10.31 / mwv6wzyo**, targeting the same
**0.10.31 / mwv6wzyo** game snapshot: **1,104 builds across 138 Pokémon**.
Refreshing the snapshot is a maintainer step in each upstream update; it is not
an automatic background download, publication, or permission to contact
official accounts.

### November 25 development source refresh

The new 0.10.31 engine, UI, data and fonts are captured independently of the old
game payload. Offline app version **1.3.0**, Android code **13**, Standard identity,
native storage keys and save schema **1** are unchanged. Do not mistake older
local 1.3.0 installers for this source refresh.

Completed progression profiles remain compatible. Until approved replay proves
otherwise, only `mwv6wzyo` is in `compatibleRunBuilds`: an unfinished older run is
preserved, not automatically loaded, converted or discarded. The user must
finish it with the previous app version first. Never loosen this gate just to
make a preview boot. Source previews use only isolated, in-memory sample saves.

Show screenshots of the updated screens and obtain design approval **before**
the single focused verification pass or native packaging. Publication and
gateway deployment require separate authorization. In particular, the pending
v1.3 co-op gateway protocol upgrade has not been deployed by this game refresh.

### Expedition co-op source adaptation

`standard/adapters/expedition-team.mjs` adapts the captured **original** team
entry, trainer slots, map radios, chat and Ready/Enter bar. It removes the
official room constructor, account/friends loader and website link sharing.
The existing native LAN/STUN/TURN mode selector, room-code actions and
Find teammates/capacity controls are reused, not a second multiplayer engine.
Tier **4** is restricted to `wilds` and `safari` in JavaScript, Android and the
signaling service. Random discovery from Expedition filters the selected map;
code-only joins and all ordinary room privacy/budget policies are unchanged.

Each device prepares its own equipment/insurance/route-card escrow atomically
with the shared ticket. Actual gear, not a peer summary, is required. Failed or
canceled preparation restores escrow; a launched run cannot be refunded that
way. Current saves retain schema **1** with a validated additive
`expeditionTeams.version = 1` ownership-receipt ledger. Unknown formats fail
closed. The original `~` split references are quantity checked and assigned
non-colliding local identities when settled.

Original `xg` gifts and `xpk` backpacks cross peer links only after durable
outbound receipts. Incoming receipts commit before the original game applies
the message. Acknowledged retries survive temporary link loss without applying
items twice. Extraction returns rescued items to their original owner;
insurance cannot also produce a second copy. Receipts for a permanently
departed teammate stay pending in the save. There is no server inventory
mailbox, process-death room restoration or host migration: keep apps and the
room open until returns are acknowledged. Do not claim parity with the
website's account-based market, offline-delivery mailbox or competitive prizes.

The native `room-return` command requires a matching durable finished-run
record. A room resets only after all remaining trainers finish; a replay or
room-code lookup must not mint a new ticket. Protocol-3 service **source**
supports Expedition settings, equipment summaries and the completion barrier,
but it has **not** been deployed. New Internet acceptance/admission requires
separate authorization after tests; no TURN/signing/admin credentials were
read, changed or transferred for this adaptation.

Screenshots in `evidence/expedition-coop-1.3.0/` are isolated sample-save source
previews, not real connected matches or physical-device acceptance. New
receipt/escrow/mode/lobby tests are authored but await the user's screenshot
approval before the single verification pass and any native builds.

### November 23 local-test continuation

The maintainer reviewed the r4 screenshots and said to continue with tests and
local builds. Publication remains ON HOLD. Older test/installer evidence is for
0.10.23, not 0.10.26; require new digest-pinned reports and receipts. Android code 6
identifies this local build. Actual Classic/Endless snapshots from 0.10.20 and
0.10.23 retained their original values and advanced simulation in the new engine
before those builds were added to the compatibility list. Run the replay suite
again without its review-only reader override before accepting a final payload.

Desktop presentation preferences use their own atomic
`desktop-preferences.json`/`.previous` files, not the progression save. Graphics
trials are recorded before Chromium starts so an early driver crash cannot
repeatedly select an unproven backend. Never add unsafe command-line overrides,
disable the renderer sandbox or globally disable background throttling. Display
changes are fixed native UI actions, validated again in the host.

The Guide's schema-1 additive `state.onboarding.trainerGuide` marker is durable
but grants no progression/unlocks. Android's two JavascriptInterface storage
methods remain unchanged. All ordinary native actions moved into Player &
saves; Back offers recovery only when startup is unavailable.

`check-desktop.mjs` verifies actual macOS controls/Auto/Metal and preference/save
restart using pre-entry isolated appData. It never replaces the installed app.
Keep the packaged-DMG boot/quit check separate: a development-shell pass does not
prove that bundle names/signing in the installer work. Windows/Linux driver and
physical Android acceptance remain separate from simulated Chromium layouts.

After the final local Mac/Android artifacts, digest-pinned layout/content/native
reports, packaged-DMG check, JVM tests and lint all pass, run
`node standard/scripts/local-test-report.mjs build/local-test-APPVERSION-GAMEVERSION`.
It refuses stale/different-payload reports and review-only reader overrides,
copies the verified signed APK beside the Mac files, and writes local checksums
and testing instructions. It creates no signed update manifest, tag or release.

### Internet co-op test builds

Keep the gateway separate from game releases; its secrets and OAuth credentials
never go to GitHub or into app assets. After the **final committed shared
payload** is prepared/verified in `build/standard-game`, run:

```sh
node standard/scripts/configure-coop.mjs --enable-stun
cd services/coop-gateway
npm run deploy
```

This admits its exact app/upstream/payload identity and retains up to eight prior
identities. `--replace-test-builds` is only for deliberately retiring earlier
test candidates. The local co-op check uses
`pnpm exec electron standard/scripts/check-internet-native.mjs`; it creates
isolated fixture profiles and does not run gameplay or access real saves.
Use `package-desktop.mjs darwin arm64 --local-test` and
`build-android.mjs --local-test` for unpublished, clearly named test packages.
TURN remains disabled until its separate budget/usage requirements are met.
See the [connection policy](coop-connection-mode.md) and
[device testing steps](internet-coop.md). Publication still requires approval.

## 3. Version and commit reviewed source

Keep independent: app version, Android versionCode, upstream version/build, save
schema, source commit, pristine asset digest and prepared game digest.

- Increase `version` in **both package.json and standard/config.json**, and
  `androidVersionCode`, for each published release.
- Add a truthful entry to **standard/history.json** with that app version,
  its corresponding upstream version/build and actual publication/test status.
  Preparation fails if the current entry and native config disagree. The
  renderer receives only this safe display metadata, never updater URLs/keys.
- Keep **dev.nicartjay.pokebonk.offline.standard**, save locations/keys, APK
  signing certificate and P-256 verification key unchanged.
- Back up before explicit save migrations. Unknown schemas fail closed.
- Add a prior build to `compatibleRunBuilds` only after testing its actual serialized
  runs. Otherwise finish the incompatible run in the previous version.
- Never automatically convert unlock-all saves.
- Personal bests are an additive schema-1 `state.records` extension, committed
  atomically with the profile. Backfill older saves only from known retained
  values; never fabricate missing run details or reset a future records format.
- Keep old releases and corresponding source available.

Run `pnpm prepare:game`, `pnpm test`, `pnpm verify` and the relevant layout/native
checks, then commit the reviewed source to `main`.

## 4. GitHub builds every platform without private keys

Use **Actions → Build all installers** on `main`, leaving the tag empty, for test
candidates. For an intended release, create/push the exact configured version tag:

```sh
git tag standard-v0.1.1   # replace with the configured release version
git push origin standard-v0.1.1
```

The tag trigger (or a manual run with an existing tag) builds:

- Apple Silicon: DMG and app ZIP.
- Intel Mac: DMG and app ZIP.
- Windows x64: NSIS setup EXE, portable EXE and unpacked ZIP.
- Linux x64: AppImage and Debian/Ubuntu DEB.
- Android: optimized universal **UNSIGNED** release candidate, with unit tests/lint.

Public macOS files and artifact labels use `macos-arm64` / `macos-x64`, including
`macos-arm64.json` / `macos-x64.json` receipts. The signed platform/distribution IDs
and Electron build arguments remain `darwin-arm64` / `darwin-x64`; do not rename
those internal IDs. Rebuild after changing the filename contract: every native
updater embeds the full expected distribution set, so renaming installers alone
would leave installed validators out of sync with release metadata.

Keep macOS `CFBundleName` in exactly the same NFD Unicode spelling as the
helper executables. `CFBundleDisplayName` retains the visible **PokéBonk Offline**
name. Electron's child-path guard compares bytes, not just visually identical
characters; the packager validates these names without Unicode normalization.

The shared job prepares/verifies the game **once**. All native jobs consume that
exact archive and verify it against the source commit. Desktop bundles are checked
after packaging. The Android ZIP is streamed without extraction to verify every
game file and its native config. Receipts include file sizes/hashes and one common
game digest. The final candidate-audit job rehashes all formats together.

Artifacts have **3-day retention**; download/finalize promptly. There are no private
keys, signing environments or public-release write permissions in this workflow.
After the complete candidate audit succeeds, an Actions-only cleanup job keeps
the newest full installer set and removes superseded completed builds' artifacts.
Incomplete/failed builds cannot replace the retained set. Active/newer runs and
GitHub Releases are protected; pristine source snapshots and signing keys are
never part of artifact cleanup.
`desktop_only` is available for a smaller smoke test, but skips Android and the
complete audit and therefore cannot be finalized as a release.

**An UNSIGNED.apk is not an installable signed release.** It uses a separate name,
kind and receipt, and is rejected by the release assembler and installed updater.
Do not rename it to bypass the gate or sign it with a new/debug key.

## 5. One local finalization command

Use the key-holding Mac, JDK 21, Android build-tools 36.0.0 and the authenticated
GitHub CLI. For this Mac's Homebrew/SDK setup, for example:

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME="$HOME/Library/Android/sdk"
pnpm release:finalize RUN_ID --prepare-draft
```

`RUN_ID` is the successful **full installer** Actions run. The current clean
checkout must be its exact reviewed commit. For `--prepare-draft`, the exact
`standard-vX.Y.Z` tag must already exist locally/remotely at that commit.

The command:

1. Rejects failed, running, fork/PR, wrong-workflow or wrong-commit runs.
2. Restores the single CI game payload, downloads the expected per-platform
   artifacts/receipts and independently rehashes them.
3. Verifies the candidate audit, APK package/version/name, alignment, every game
   asset and native configuration.
4. Signs the APK **locally with the original keystore**, then verifies the actual
   signing certificate and game payload again.
5. Assembles and signs ECDSA P-256/SHA-256 DER update metadata **locally**, with the
   original release key, covering **all ten** final distributions.
6. Adds checksums, readable provenance, platform receipts and full corresponding
   committed source, then optionally uploads an **unpublished draft**.

Large installers are moved rather than duplicated. Only temporary downloads are
removed afterward. The original keys remain unchanged outside Git; neither keys
nor passwords are passed as command-line values or uploaded. No public update
channel is changed during finalization.

Omit `--prepare-draft` for local output only. Local platform development builds
still work through `package:desktop` and `package:android`.

## 6. Actual acceptance, then explicit publication

Test the actual packaged apps; compilation is not gameplay/device acceptance:

- Starter selection; earned rewards; purchases, insufficient funds, duplicate
  claims; Classic, Endless, Relay, Practice and Daily Mutation.
- Offline Boss Rush and Lavender Tower entry/Back/restart/result screens,
  including dates outside the original event window. New tickets earn local
  progression and the reviewed event points, pass and mission rewards exactly
  once; earlier records-only tickets retain their no-reward policy. Claims must
  roll back on failed writes and survive restart/import without duplicates.
  No server board, clan/competitive prize or unreviewed event may be reachable.
- The Great Expedition is a disabled, clearly labelled visual preview only.
  Never advertise playable inventory/extraction or include it in acceptance as
  a working mode before its real local settlement is implemented and verified.
- KOs/Survival/Time Attack records, filters, legacy backfill, restart and backup
  round trips; retain bests after more than 30 recent runs. Keep challenge
  rotations separate and use the real upstream Classic overtime metrics.
- Clickable OFFLINE app-version badge, readable offline history and matching
  upstream version/build metadata at desktop, phone and tablet sizes.
- Save export/import, restart, interrupted writes, Android background/process death.
- N+1 installation preserving saves, application ID and signing identity.
- Actual Mac arm64, Mac Intel, Windows, Linux and physical Android gameplay.
- Fullscreen, pointer/keyboard input, touch controls, audio and airplane-mode play.
- Corrupt signatures/hashes/manifests, wrong editions/platforms, incompatible
  schemas/runs, wrong-package/certificate/version APKs are rejected.
- Original credits and game/asset redistribution permissions reviewed.

Fill `standard/acceptance.template.json` with the exact version, source commit and
game digest from signed provenance, plus the real reviewer/date. Record only
verified outcomes; never substitute CI/JVM results for physical-device testing.

Run **Actions → Publish approved release**, enter the draft tag and completed
receipt JSON, and approve **release-publication**. Enable `first_release` only for
the first publication, when the channel has not yet been created.

The publisher revalidates signature, source/tag, owned public repository, all
receipts/files/checksums and increasing app/APK versions. It publishes the versioned
release and advances only signed `standard-channel/standard-update.json`.
Published versioned assets are never overwritten; previous releases stay available.
If publication is interrupted, inspect the release/channel before retrying.

### Optional initial prerelease, without asserting full acceptance

If the maintainer explicitly chooses to share every platform before the full
device checklist is complete, run the same **Publish approved release** workflow
**from main**, using the exact existing draft tag and enabling **prerelease**.
Supply a truthful review receipt: passing `automatedTests` is mandatory, and
unconfirmed checklist items must remain `false`. `approvedBy` must match the
dispatching GitHub account. The protected **release-publication** owner approval
is still required, as are the original Android and update-signing identities.
Private signing keys remain on the build Mac.

This path independently re-verifies the signature, exact tagged source, all ten
installers, 19 remote assets, receipts and checksums. It publishes only the
already-verified draft as a **prerelease**, lists unfinished acceptance items in
its public notes, and never creates or advances `standard-channel` or marks the
release Latest. `first_release` has no effect in this mode. Prerelease status does
not grant third-party asset redistribution rights or establish licensing review.

The default stable path requires every original device/save/licensing check to
be true. Published prerelease files are immutable too: use a new app version and
Android versionCode for a subsequent stable release rather than replacing these
downloads. Installed apps will not discover an initial prerelease automatically.

### Explicit owner acceptance of remaining checks

Never change an incomplete result to `true` merely to publish. When the repository
owner explicitly accepts the remaining checks for an exact stable release, the
truthful receipt may instead contain `maintainerWaiver` with `version: 1`,
`approveStable: true`, the same `approvedBy`/`approvedAt` as the receipt, a
substantive `reason`, and a `checks` array containing exactly every false field.
Enable `accept_maintainer_waiver` in the protected publication workflow (or use
`--accept-maintainer-waiver` with the local publisher). It defaults to false.
The authenticated workflow actor must be the repository owner and receipt
reviewer. Automated tests and corrupt-update rejection cannot be waived.
All signature/hash/source/tag/version/identity gates remain mandatory.

This is a recorded owner decision, not device-test evidence or a grant of
third-party redistribution rights. The receipt remains separate from the
feature-focused release notes; it is not added to the release's public assets
or transformed into a claim that its false checks passed. Owner approval does
not automatically run or repeat device tests.

## Installed-app updates

Apps check the **public GitHub channel**, not the website, on launch/foregrounding
at most once per 24 hours (including failed/offline checks). Manual checks bypass
the timer. Prompts wait for the main menu; offline failures never prevent playing.

Trusted native code verifies the signature, exact publisher/edition, save/run
compatibility, platform/distribution, URL, signed size and streamed SHA-256.
Android also checks the actual APK package, version, SDK and certificate against
the installed app before its system installer. The renderer has only validated
`loadState`/`saveState`, never a callable updater or arbitrary filesystem bridge.

Download/installation stay explicit: replace the Mac app, run Windows setup or
replace a portable file/folder, replace AppImage/install DEB, or confirm Android's
installer. Saves stay outside installation. macOS builds are ad-hoc signed and not
notarized; Windows is not Authenticode signed. No paid signing/store setup is used.
