# Integrated update UI

The game modal owns checking, download bytes/percentage, verification, errors
and the explicit Install action. Native hosts own requests, signed manifest
verification, size/hash checks and installer handoff. No update URL or local
installer path is sent to the renderer.

Player & saves shows current download status and can reopen a hidden transfer.
Progress uses received bytes divided by the signed artifact size; checking and
verification use an indeterminate indicator, not invented percentages.
Install stays visibly disabled until a verified native `ready` event.
Android manual checks explicitly reopen hidden progress instead of losing it.

Application-controlled feedback never substitutes an OS update alert. The final
Android permission/installation confirmation is still provided by Android.
Desktop installer/file-manager handoff follows the selected distribution.

Source-only screenshots: `preview-candidate.mjs?app-options-preview`.
Sample update metadata in that fixture is not a real release or download.

After screenshot approval, the focused updater regressions passed. An isolated
native-controller/UI fixture also streamed a synthetic signed eight-MiB download,
retained 50% while hidden, verified the bytes and accepted explicit installation
preparation. No real installer was opened. Results and screenshots:
`evidence/cloud-sync-2026-11-25/status.md`. This does not replace actual
cross-platform installation testing.
