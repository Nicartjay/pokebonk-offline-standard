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
   revision selects **0.10.26/mwsewi0r** in `vendor/pokebonk-standard-0.10.26`,
   pinned to `e5136575172172b5c82df2b65aaf8b58b8b5b4768d32f63a3433984af3cdea77`.
   It is a local-test candidate, NOT a release-approved payload.
   Its lifecycle module initializes App internally rather than exporting it.
   Role matching explicitly handles this structure and its decoded-track audio
   instance. Eleven new form sheets are required alongside the event resources.
   The preceding 0.10.23 local-complete capture, events capture and
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
