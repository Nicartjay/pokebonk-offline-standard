# Co-op launch and results return

Keep match identity comparisons **after** `internetState()` validation.
Worker JSON and native `lanState()` use different property insertion orders;
comparing raw JSON strings incorrectly closes a valid room during preparation.
The comparison must still reject changed match fields and require the local
completed-party acknowledgment before returning to the lobby.

Fresh room events have no previous run-room or completed-party marker. Check
that the run-room exists before retiring it; `undefined === undefined` is not
evidence of a completed run.

The original results Co-op button is structurally marked
`data-standard-coop-return="true"` so offline cleanup retains it in `.sm-foot`.
Its callback calls the engine's `keepRoom()` before disposing the run, then
opens the existing native lobby. Shared Boss Rush uses that same footer.
Do not re-enable website Co-op entries or the solo Play again flow for co-op.

Regressions: `internet-coop.test.mjs`, `lan-lifecycle.test.mjs`,
`guard-coop.test.mjs` and `upstream-refresh.test.mjs`.
Internet fixtures preserve the actual Worker's match construction order.
