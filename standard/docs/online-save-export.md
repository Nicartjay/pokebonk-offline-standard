# Copy your online progress to Offline

1. Open the official PokéBonk website, sign in to **your own account**, finish
   any current run, leave co-op and wait at the homepage for syncing to finish.
   Do not play or switch accounts on another device during the export.
2. Open browser **Developer Tools → Console**. Paste the entire contents of
   `standard/tools/export-online-save.js` and run it.
3. A JSON file named `pokebonk-OFFLINE-IMPORT-….json` downloads.
4. In **PokéBonk Offline 1.3.1 → Player & saves**, **Export backup** first.
   Then choose **Import backup** and select the downloaded file.

**Import replaces offline progress; it does not combine two saves or currencies.**
The script does not change the online save. Keep your exported backups private.
It never downloads your login token, cookies or the rest of browser storage.

## Compatibility and safeguards

- Reviewed online source: **0.10.35 / mwwhf156**, client protocol **8**.
  Target offline game: **0.10.31 / mwv6wzyo**, app **1.3.1**, save schema **1**.
  New online features are not added to the older offline engine by importing.
- The file includes the original profile and saved-build library under
  `onlineArchive`, plus a separately validated offline representation. The
  source upstream version is recorded honestly, not relabelled as 0.10.31.
- Completed Pokémon progression, balances, upgrades, settings, saved builds and
  retained run records are copied when compatible. No 10k top-up or automatic
  unlocks are applied. Online leaderboards/account services are not migrated.
- Suspended runs, live rooms, pending rewards, market listings and server-only
  claims are not recreated as local tickets or payouts. Finish/settle them online.
- Existing Expedition items retain their identities, quantities and balances.
  Conversion requires the offline inventory schema, known item catalog and no
  active raid/unsettled insurance references. Unsupported data is not deleted.
  Online `stats.out`/`stats.best` are copied to the local extraction counters.
  An absent pass uses the original UI's zero-XP/no-claims defaults; `sp` is the
  borrowed-Pokémon list, not a pass. Existing pass progress is retained.
  If the online response has only `last`, no complete history rows are invented;
  that summary is kept unchanged and the local history ledger starts empty.
- If conversion fails, the download is named
  **`ONLINE-ARCHIVE-NOT-IMPORTABLE`**. Keep it, but **do not import or hand-edit it**
  to bypass validation. Ask for a reviewed converter and share only the error
  message—not your session/token or the entire personal backup.
- Only fixed official GET endpoints are used: `/auth/me`, `/profile` and
  `/profile/stash` on the API, plus the website's public `/version.json`.
  Requests have timeouts, size limits, no cookies and no redirects.
  No methods that flush rewards, save settings, initialize an Expedition, upload,
  sign out or change account storage are called.

## Maintenance

Review the current **public** client before adding an online build to
`create-online-save-exporter.mjs`. Regenerate with that command against the
matching prepared offline payload. The output embeds the actual native
JavaScript save validator and the accepted Expedition catalog; it does not
load a converter from another website when pasted.

Run the focused synthetic regression test once:

```sh
node --test standard/test/online-save-export.test.mjs
```

That test does not contact a real account or modify real online/offline saves.

## Convert an archive that was already downloaded

You do not need to export or sign in again for a supported archive:

```sh
node standard/scripts/convert-online-save.mjs "/path/to/online-archive.json"
```

This creates a **new** `pokebonk-OFFLINE-IMPORT-….json` beside the original.
It uses the same reviewed converter and native validator as the console script.
It never overwrites the archive, launches the app, contacts the online account
or imports progress automatically. Output backups are private files; inside this
repository, only ignored destinations are permitted.
