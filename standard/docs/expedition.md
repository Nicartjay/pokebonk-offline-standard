# Solo offline Expedition

Development change; not yet published. The bundled 0.10.26 engine runs Wild
Valley and Safari Zone locally. Original artwork, loot generation, equipment
modifiers, inventories, extraction points and result screens are retained.

## Local progression

- Expedition has its own inventory and Valley Tokens, separate from Stardust.
  First entry into the hub creates an empty inventory and 300 Tokens once.
- Bill's shop refreshes daily on the device. Stock is deterministic; purchases,
  refreshes, selling, recycling, repairs and insurance commit atomically.
- Contracts are local daily objectives. The Expedition Pass uses the bundled
  reward catalog but has no seasonal reset. Claims require earned progress and
  are recorded once.
- Equipment, backpack, pocket, route card and insurance are escrowed with the
  run ticket. Loot is regenerated from the original seed/descriptors, not
  accepted as arbitrary items from a result. An extraction returns carried
  items. Defeat returns only the safe pocket and insured entry gear, with wear.
- My Extractions contains the last 50 local results. No other players are
  created, queried or simulated. Player trading, orders, co-op, borrowed
  Pokémon, rivals, rankings and competitive rewards are excluded. The online
  workshop/faction systems are not exposed by this initial local adaptation.

## Interrupted runs

The original Expedition engine does not serialize resumable raids. A background
inventory checkpoint is committed every 15 seconds and when the app backgrounds.
After process termination, the active ticket/loadout remain preserved. Player &
saves offers an **explicit defeat settlement** using the last durable checkpoint:
safe pocket and insurance can return, but this is not a free extraction or a
resumable game. No rewards are granted for manually ending an interrupted raid.
Export a backup first if needed.

Inventory/economy use additive save extension `offlineVersion: 1`; run settlement
uses `local-expedition-v1`, independently of app and upstream versions. Unknown
formats/policies and failed writes are rejected without replacing the original
save. Existing non-Expedition profiles receive no unlocks or retroactive rewards.

## Maintenance

`standard/adapters/expedition-contract.json` records reviewed AST-shape hashes
for the original pure item/rule exports. Private identifier renaming is allowed;
unknown or ambiguous structures stop preparation. Keep pristine snapshots
unchanged. Run `pnpm check:expedition` after preparation for the focused original
engine/theme smoke check; it uses isolated synthetic saves and blocks external
requests. It does not replace physical-phone/tablet acceptance.
