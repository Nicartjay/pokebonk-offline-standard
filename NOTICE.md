# Attribution and source provenance

- **Charcher**: original PokéBonk game. Original artist credits and notices are
  retained verbatim in
  `vendor/pokebonk-standard-0.10.20/game/creditos.txt` and the prepared game.
- **VdustR**: original `VdustR/pokebonk-offline` shell/build tooling. Its GNU
  Affero General Public License v3 text is retained in `LICENSE`.
- **Nicartjay**: normal-progression offline backend integration, native storage,
  sandboxing, signed updater, responsive/safe-area fixes and standalone packaging.

This standalone repository was extracted from the Standard sources in
`Nicartjay/pokebonk-offline` (base commit
`e214e96f853daac73ef3a6b7782f4875804851e0` plus the local Standard integration).
The separate Unlocked/Tauri app was not imported.

The pristine snapshot is PokéBonk **0.10.20**, build **mwqb4pwz**, digest
`22a345dabfc541a31e9a4c0b886db81b70caa30c6603989a205a7714ac46fa60`.
It is preserved unchanged. Offline modifications are applied from source by
`standard/scripts/prepare.mjs`; source archives accompany binary releases.

Pokémon and all third-party artwork, audio, characters, names and designs belong
to their respective owners. No affiliation or endorsement is claimed. The shell
license does not relicense third-party game assets or grant permission to
redistribute them. Review applicable permissions and retain all original credits
before public binary publication.
