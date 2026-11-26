# Homepage trainer identity

The homepage follows the original trainer identity composition:

- Selected Pokémon/trainer avatar and skin.
- The original portrait ring colour, standard/large frames and generated frame effects.
- Player name, with the automatic **[OFF]** clan-style badge.
- Equipped title, using the original formatter, including Pokémon names and `×N`.
- Existing currencies, usable-Pokémon counter and **Player & saves**.

The badge uses the original `ctag` component but is only an edition label.
It is not clan membership and does not contact the website. It is created
whenever any local profile's homepage is rendered, including imported profiles.
It is **never** prepended to `profile.name`, exported saves or network player names.
Server clan membership, news/mail/friend counts and account controls stay excluded.

The original animated PokéBonk wordmark, ball, shine and sparkles are retained.
The `.com` suffix stays removed and the existing **OFFLINE app-version** pill
still opens local release history. Android's text/shine alignment fix is retained.

## Reviewed cosmetic presentation backport

The bundled engine remains **0.10.31 / mwv6wzyo**. Public **0.10.35 / mwwhf156**
adds two relevant literal cosmetic IDs: `tr:visionary` (Bright Mind) and
`title:idea` (PokéBonk Visionary).

Only their presentation/catalog support is backported:

- `appearance.js` reproduces the original animated trainer-avatar layers.
- `appearance.css` bundles the original avatar animation CSS and reduced-motion rules.
- One 256×256 foreground PNG is recorded with source version/build, size and SHA-256
  in `asset-additions.json`; it is never downloaded by the installed game.
- `appearance.mjs` preserves the original avatar renderer for every other variant.
  The original cosmetic ownership predicate remains authoritative. Neither
  cosmetic is free or automatically awarded, and no Ideas/reward service is added.
- The image-reference collector resolves this procedural avatar to its real
  foreground artwork, not a nonexistent static `visionary.png`.

No real save is changed to equip a title, frame or avatar. Preview screenshots
use explicitly labelled sample profiles and memory-only storage.

## Verification status

These are source-preview changes pending the maintainer's visual approval.
No native build or formal regression run is implied by screenshots.
After approval, perform one focused pass covering:

- Automatic badge on new/imported profiles, with/without a title; no saved-name mutation.
- Original title formatting, repeat counts, frame spacing and long-name truncation.
- Native ownership rules for the imported-only avatar/title; no automatic grants.
- Animated foreground and reduced-motion rendering using only bundled assets.
- Image-registry and supplemental-image integrity integration.
- Desktop, landscape phone and roomy tablet layout.
