# Upstream maintenance and approved releases

## One-time repository setup

Publisher: **`Nicartjay/pokebonk-offline-standard`**. This is independent of the
older mixed-edition repository. The visible app is **PokéBonk Offline**, but its
existing Standard application ID and signing identities are intentionally kept.

Create two GitHub Actions environments:

- `release-signing`: allow only `main` and `standard-v*` tags. No PR workflow uses
  it. Store the five signing secrets below here.
- `release-publication`: require an owner/release-maintainer approval and restrict
  deployment refs to `main` and `standard-v*`. This is the final public-release gate.

With the GitHub CLI authenticated to the owned repository, the explicit helper
verifies the existing public identities and transfers the original keys through
stdin into encrypted environment secrets:

```sh
JAVA_HOME=/path/to/jdk21 node standard/scripts/configure-ci-secrets.mjs --approve-upload
```

It reads `../pokebonk-standard-signing/credentials.json` by default, never commits,
prints, rotates or deletes local keys, and sets:

- `STANDARD_ANDROID_KEYSTORE_BASE64`
- `STANDARD_ANDROID_STORE_PASSWORD`
- `STANDARD_ANDROID_KEY_PASSWORD`
- `STANDARD_ANDROID_KEY_ALIAS`
- `STANDARD_UPDATE_PRIVATE_KEY`

Only public verification material belongs in `standard/config.json`. Keep the
external local key directory securely backed up on another device. GitHub secrets
are not a replacement for a recoverable offline key backup.

## Daily detection is report-only

`check-upstream.yml` runs daily at **09:41 Asia/Manila** (01:41 UTC), or manually.
It compares the actual website build/version to `standard/accepted.json` and
reconciles one tracking issue. Detection failures fail the check; they do not
approve unknown code.

It cannot capture assets, change the baseline, commit, tag, sign, build releases or
publish. There is no unattended website-to-public-release path.

## Capture and review a candidate

1. Review the detected build and applicable credits/permissions.
2. Capture a bounded source graph:
   `node scripts/capture-live-graph.ts upstream/standard-review`.
3. Review generated resource paths, retained modes, models, sprites/forms, cries,
   music, atlases, fonts, items and map previews. Produce a finite JSON resource
   contract with `reviewedBuild`, `required` and `optional` path arrays.
   A previous asset inventory is not proof that a new build is complete.
4. Run:
   `node standard/scripts/capture-candidate.mjs upstream/standard-review CONTRACT.json`.
   This verifies captured hashes and versioned URLs and writes a new pristine
   candidate under `upstream/standard-candidates/BUILD/`. It does not accept it.
5. Add/test an explicit structural adapter under `standard/adapters/`. The current
   preparation script accepts **only 0.10.20/mwqb4pwz** and its pinned pristine
   digest. Missing/ambiguous roles or unsupported builds stop preparation.
6. Test actual progression, every retained mode, all required assets, serializer
   compatibility and renderer network isolation.
7. Only after review, put the pristine snapshot in a **new** vendor directory and
   update accepted.json, config and the adapter allowlist. Never patch a previously
   patched game or edit the pristine snapshot in place.

## Versioning and save compatibility

Track independently: application version, Android versionCode, upstream game
version/build, save schema, source commit, pristine digest and prepared digest.

- Increase app `version` in **both package.json and standard/config.json**, and
  increase `androidVersionCode`, for each published release.
- Preserve `dev.nicartjay.pokebonk.offline.standard`, app-data locations, save
  keys, APK signing certificate and P-256 manifest key.
- Back up before explicit save migrations. Unknown schemas fail closed.
- Add old builds to `compatibleRunBuilds` only after testing their real serialized
  runs. Otherwise complete an unfinished run in the old app.
- Do not import unlock-all identities or automatically convert unlock-all saves.
- Keep previous releases and corresponding source available.

## Build all requested formats

Commit reviewed source, then use **Actions → Build all installers → Run workflow**
on `main` with an empty tag for a test-only build. It builds:

- Apple Silicon DMG + app ZIP.
- Intel Mac DMG + app ZIP.
- Windows x64 NSIS setup EXE + portable EXE + unpacked ZIP.
- Linux x64 AppImage + Debian/Ubuntu DEB.
- Android signed universal APK, using the original signing identity.

The shared job prepares/verifies the game **once** and distributes that exact
payload to every job. Every artifact receipt includes the same version and game
digest. The assembler rehashes every output, rejects mixed/incomplete platform
sets, signs metadata for **all ten** distributions, and adds SHA256SUMS, readable
provenance, platform receipts and the full corresponding committed source.

An untagged run produces Actions artifacts only (14-day retention), not a release
or channel update. Builds cannot generate replacement signing identities.

To create a draft after source review:

```sh
git tag standard-v0.1.0   # replace with the configured version
git push origin standard-v0.1.0
```

The tag trigger builds the same matrix and uploads an **unpublished draft**. An
existing tag can also be passed to the manual build workflow. A release tag must
match config and identify a commit already on `main`. Reruns may replace files
only in a draft, never in an already published version.

## Actual acceptance, then explicit publication

Download/test the **actual packaged apps**. Do not mark tests complete merely
because CI packaged them:

- Normal starter selection; earned rewards; purchases, insufficient funds and
  duplicate claims; Classic/Endless/Relay/Practice.
- Save export/import, process restart, interrupted writes, Android backgrounding
  and process death.
- Install N+1 over N without losing progress or changing installation identity.
- Actual Mac arm64, Mac Intel, Windows, Linux and physical Android gameplay.
- Fullscreen, keyboard/pointer lock, touch controls, audio and airplane-mode play.
- Rejection of corrupt manifests/signatures/hashes, wrong editions/platforms,
  incompatible save schemas/runs, and wrong-package/certificate/version APKs.
- Original credits, licensing and asset-distribution permissions reviewed.

Fill `standard/acceptance.template.json` using the exact release version,
`source.commit` and `source.gameDigest` from the signed/readable provenance. Every
required field must be true, with a real approver and date. Never fabricate
device results. The receipt is supplied to the publication workflow, not committed
as part of the source it is approving.

Run **Actions → Publish approved release**, enter the draft tag and receipt JSON,
and approve `release-publication`. Enable `first_release` only for the first
publication when the channel does not yet exist.

The publisher validates the signature, all receipts/files/checksums, exact clean
source/tag and owned public repository; versions and Android version codes must
increase. It publishes the versioned release, then advances only the mutable
signed `standard-channel/standard-update.json` discovery asset. Old releases stay.
Neither a schedule nor app launch invokes publication.

## Installed-app updating

Apps check only this repository's public GitHub channel, not the website. Automatic
checks are throttled to 24 hours (including failed/offline attempts); manual checks
bypass the timer. Errors never prevent offline play and prompts wait for the menu.

The native host verifies the ECDSA P-256/SHA-256 DER envelope, exact edition,
publisher, version, save/run compatibility, platform/distribution, URL, signed
size and streamed SHA-256. Android additionally validates the actual APK package,
version, SDK and signing certificate against the installed app before handing it
to the system installer. The game has no callable updater or arbitrary filesystem
bridge.

Installation is explicit. Mac users replace the app; Windows users run setup or
replace their portable file/folder; Linux users replace AppImage or install DEB;
Android users confirm the system installer. Saves remain outside installation.
No paid Apple/Windows signing setup is included: macOS is ad-hoc signed and not
notarized; Windows is unsigned; Android and update metadata use stable private keys.
