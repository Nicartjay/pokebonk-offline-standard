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
5. Add/test a structural adapter under `standard/adapters/`. Preparation currently
   accepts **only 0.10.20/mwqb4pwz** and its pinned digest. Unsupported or ambiguous
   structures stop preparation instead of producing a partly working release.
6. Verify progression, modes, complete resources, serializer compatibility and
   network isolation. Only then put the pristine snapshot in a **new** vendor
   directory and review accepted.json, config and adapter allowlist changes.
   Never edit a pristine snapshot or patch an already patched game.

## 3. Version and commit reviewed source

Keep independent: app version, Android versionCode, upstream version/build, save
schema, source commit, pristine asset digest and prepared game digest.

- Increase `version` in **both package.json and standard/config.json**, and
  `androidVersionCode`, for each published release.
- Keep **dev.nicartjay.pokebonk.offline.standard**, save locations/keys, APK
  signing certificate and P-256 verification key unchanged.
- Back up before explicit save migrations. Unknown schemas fail closed.
- Add a prior build to `compatibleRunBuilds` only after testing its actual serialized
  runs. Otherwise finish the incompatible run in the previous version.
- Never automatically convert unlock-all saves.
- Keep old releases and corresponding source available.

Run `pnpm prepare:game`, `pnpm test`, `pnpm verify` and the relevant layout/native
checks, then commit the reviewed source to `main`.

## 4. GitHub builds every platform without private keys

Use **Actions → Build all installers** on `main`, leaving the tag empty, for test
candidates. For an intended release, create/push the exact configured version tag:

```sh
git tag standard-v0.1.0   # replace with the configured release version
git push origin standard-v0.1.0
```

The tag trigger (or a manual run with an existing tag) builds:

- Apple Silicon: DMG and app ZIP.
- Intel Mac: DMG and app ZIP.
- Windows x64: NSIS setup EXE, portable EXE and unpacked ZIP.
- Linux x64: AppImage and Debian/Ubuntu DEB.
- Android: optimized universal **UNSIGNED** release candidate, with unit tests/lint.

The shared job prepares/verifies the game **once**. All native jobs consume that
exact archive and verify it against the source commit. Desktop bundles are checked
after packaging. The Android ZIP is streamed without extraction to verify every
game file and its native config. Receipts include file sizes/hashes and one common
game digest. The final candidate-audit job rehashes all formats together.

Artifacts have **3-day retention**; download/finalize promptly. There are no private
keys, signing environments or public-release write permissions in this workflow.
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
  claims; Classic, Endless, Relay and Practice.
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
