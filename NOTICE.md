# Attribution and source provenance

- **Charcher**: original PokéBonk game. Original artist credits and notices are
  retained verbatim in
  `vendor/pokebonk-standard-0.10.36/game/creditos.txt` and the prepared game.
- **VdustR**: original `VdustR/pokebonk-offline` shell/build tooling. Its GNU
  Affero General Public License v3 text is retained in `LICENSE`.
- **Nicartjay**: normal-progression offline backend integration, native storage,
  sandboxing, signed updater, responsive/safe-area fixes and standalone packaging.

This standalone repository was extracted from the Standard sources in
`Nicartjay/pokebonk-offline` (base commit
`e214e96f853daac73ef3a6b7782f4875804851e0` plus the local Standard integration).
The separate Unlocked/Tauri app was not imported.

The bundled pristine snapshot is PokéBonk **0.10.36**, build **mwxeoqzj**,
digest `1e9733726a187b9f1fc5b58a7b4d5b638d965e30df789657978454dda4402a6f`.
Its original credits, game data, assets and source provenance are retained.
Offline modifications and additional original artwork are tracked separately
by the structural adapter and hash-checked asset supplement.

The preceding **0.10.31 / mwv6wzyo** snapshot remains unchanged at
digest `4e20fcc6612cd5c2e3e010f45136bd5e1710be74aa9975d0741d0783ffb0f7d5`.

The preceding PokéBonk **0.10.26 / mwsewi0r** snapshot remains unchanged at
digest `e5136575172172b5c82df2b65aaf8b58b8b5b4768d32f63a3433984af3cdea77`.
Captured on November 23, 2026, it includes all eleven new Maximum-form sprite
sheets. Versioned assets were reused only after validating the previous pristine
snapshot and matching the exact upstream catalog version. Changed/unversioned
resources were recaptured. No preceding snapshot was edited. Upstream changes
and offline acceptance are separate: consult the exact local build's verification
report for tested behavior, platforms and save compatibility.

The preceding **0.10.23-local-complete / mwro88g3** snapshot is retained at digest
`0ee2d25545fac35c9fa1cc626544695f26796b58bb76e2de7636c69b553273bd`.
The preceding event-complete **0.10.23 / mwro88g3** capture has digest
`de7b05bdd2f2e53e716459f5ed269bf9f68a27c9ebee94370b40b13f468ec04f`.
This separate event-complete capture adds six required Boss Rush scenery models.
The earlier 0.10.23 capture remains unchanged (digest
`ed2910aac4c54771c1a3f8d04abae30c20035a4a9a820534c5187cd3a70c3d1b`);
all source and previously captured assets are byte-identical.
The earlier **0.10.20 / mwqb4pwz** snapshot is also preserved unchanged as the
canonical semantic-binding reference (digest
`22a345dabfc541a31e9a4c0b886db81b70caa30c6603989a205a7714ac46fa60`).
Offline modifications are applied from source by
`standard/scripts/prepare.mjs`; source archives accompany binary releases.

The desktop display/graphics work is informed by the publicly reviewed
CharcherGit/pokebonk-app `src/main.ts` at commit
`14be72c6e8b75c4129807dec70eca23552c6f81d`.
This integration is independently implemented for the local-only sandboxed
shell; it does not import the official client's live-site loader, updater,
Discord integration or unrestricted URL/command-line handling.

Pokémon and all third-party artwork, audio, characters, names and designs belong
to their respective owners. No affiliation or endorsement is claimed. The shell
license does not relicense third-party game assets or grant permission to
redistribute them. Review applicable permissions and retain all original credits
before public binary publication.
