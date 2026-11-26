# Offline seasonal mailbox

Mailbox layout approved November 26, 2026. One focused source-level pass
completed: **37 tests passed**, covering the mailbox, local backend and online
save exporter. No release/native build or change to installed saves is implied.

The original mailbox screen/header, cards, buttons, avatar renderer and frame
effects are reused. Open it from the mail icon beside the homepage trainer,
or **Player & saves → Mailbox**. Sender: **PokéBonk Offline**. There are no
website requests, accounts, invitations, rankings or clan membership.

## Seasons 1–4: archive gifts for everyone

As explicitly requested, historical participation is **not** required for
any defined Season 1–4 archive pack, including an active Season 4 gift when its
actual cosmetics become available. The reviewed catalog currently has these
three packs, each available to claim once per local profile:

| Season | Bundled rewards |
| --- | --- |
| 1 | `tr:pioneer` (Kanto Pioneer), `title:s1` (PokéBonk Pioneer) |
| 2 | `frame:s2` (Frozen Storm), `title:s2` (Storm Veteran) |
| 3 | `frame:s3c-1`, `frame:s3c-2`, `frame:s3c-3`, `frame:s3i-1`, `frame:s3i-2` |

Season 3 frame names are Tin Tower Phoenix, Bell Tower, Johto Lantern,
Lord of the Whirlpool and Crystal Aurora. Some were online ranking/clan
rewards; here they are explicitly **offline cosmetic archive unlocks**.
Do not create leaderboard medals, rank claims or a real clan for them.
Season 1 has no participation frame in the reviewed catalog; none is invented.
Other cosmetics, treasures, currencies and progression are unaffected.

Existing ownership is retained. A fully owned pack displays **Owned**;
a partially owned pack grants only its missing cosmetics. A successful native
commit displays **Claimed**. Items are never automatically equipped.

## Current catalog and later updates

The current content season is explicitly **Season 4**, from the accepted
0.10.31/mwv6wzyo content gate. It is not calculated from the device date or
the separate competitive calendar.

New solo and launched co-op tickets carry an additive `offlineSeason` marker.
A durably settled run counts once if it lasts at least 60 seconds, or wins.
Practice, lobby preparation, explicit abandonment, failed settlement and
duplicate result submissions do not count. Legacy tickets have no assumed
season. Existing past run counters are not reinterpreted as participation.

No separate Season 4 gift is defined in the reviewed cosmetic catalog, so the UI
states that plainly rather than inventing or promising artwork. When reviewed
Season 4 personal cosmetics become available, add their actual gift with
`eligibility: "archive"`; it must not require participation or wait for that
season to end. New explicit personal season IDs not represented in the archive
stop preparation for review. Clan-only emblem symbols/decorations have no
offline clan UI; do not pretend they are trainer frames or grant clan membership.

For Season 5 and later, a future reviewed update can close the season, add an
actual gift with `eligibility: "participation"`, and change the active season.
Stored participation then makes that gift deliverable. Gifts do not expire;
moving the clock cannot close a season or unlock another pack.

## Persistence and maintenance

- `state.seasonalMail` is an additive independently versioned schema-1 extension:
  participation per season and delivery/read/claim receipts per stable gift ID.
- Grants and receipts use the existing serialized native transaction and atomic
  save/backup path. Failed writes roll back both. There is no arbitrary payload
  supplied by a message, save field, peer or renderer.
- Export/import and optional cross-platform cloud saves retain the ledger.
  Existing conflict selection applies; currencies and histories are not merged.
- Older saves gain claimable archive messages, not automatically equipped
  cosmetics. Future unknown formats fail closed;
  unknown same-version season/receipt IDs are preserved, not deleted or claimed.
- Never reuse or change a published gift ID's rewards. Add a new reviewed pack
  for additional artwork. Retain closed catalog entries to render old mail.
- Preparation structurally verifies the season/content gate and every explicit
  cosmetic against the accepted source. Seasonal archive descriptions replace
  online-only eligibility text, without bypassing original ownership checks.
- All images/effects are already bundled. No additional runtime download or
  cloud-mail infrastructure is needed.

## Verification

The single focused pass ran `seasonal-mail.test.mjs`, `backend.test.js` and
`online-save-export.test.mjs`: **37 passed, 0 failed**. Coverage includes
fresh/owned/partial profiles, serialized duplicate claims, rollback after an
interrupted native write, restart/import/export, direct cloud portability,
pinned solo/co-op participation rules, future delivery, unknown formats and
the complete explicit personal Season 1–4 catalog contract.

Synthetic future-season tests verify policy only; they do not create production
Season 4 artwork. This is not a packaged-app, physical-device microphone,
full multiplayer or live cloud-service test. The updated desktop screenshot
uses a memory-only sample save. No native build or publication was run.
