# Persistence and recovery

## Deployment

Apply migration `0025_reliable_writes.sql` after the existing migrations and before deploying the frontend. Reload old browser sessions afterward. The migration revokes client access to the old debit-only `shop_buy` RPC; the new `shop_purchase` function calls it inside a transaction that also delivers the inventory item and records the receipt. Do not restore the old RPC grant as a compatibility workaround.

No live database changes are made by installing dependencies or running tests.

## Character updates

Player and DM writes share `writeCharacter`. It reads the latest row, merges changes made to different object fields, recomputes public vitals, and updates only if the row's timestamp still matches. It retries a raced compare-and-swap up to three times. Migration 0025 makes timestamps strictly advance, including multiple updates in one transaction.

Arrays are treated as single values. Two simultaneous inventory, feature-list, or slot-list changes require the second person to review the latest state and repeat their action. Two competing changes to the same scalar also conflict, even when their desired values happen to match: two casts must not spend one slot and both report success.

The UI displays confirmed character data. Save failures leave it on screen and expose an error; they do not roll back a newer write. Rest, turn advancement, consumable use, spell casts, level acceptance, and feature-use confirmation check the mutation result before reporting success.

## Purchases

The client computes the destination using the existing inventory routing rules. The server locks the shop and owned character, verifies both versions, and derives the item from authoritative shop stock. Coins, stock, inventory and the receipt commit together. Invalid placement, insufficient funds or delivery failure cannot leave a partial purchase.

A request id is written to browser storage before sending. If the reply is lost, retry uses the same id and receives the existing receipt. The key is removed only after a definite response. Browser storage must be available for purchases. Requests made by another account cannot read or create receipts for the original owner.

## Authoring

Autosave queues capture the value and destination together, serialize writes, and retain failures for explicit retry. Switching away flushes valid pending work. Draft forms cache edits immediately; item forms retain a separate local recovery copy even when validation prevents publishing. The item editor restores that copy when reopened. Recovery data is local to that browser.

## Checks

`npm test` runs game-rule tests, React autosave lifecycle tests, and real SQL execution in PGlite (an isolated PostgreSQL runtime). Purchase tests cover rollback, receipt replay, stale versions, stack delivery, insufficient funds and permissions. They do not simulate multiple independent PostgreSQL connections; production row-lock contention should also be checked when deploying to a staging Supabase project.

`npm run build` runs TypeScript and Vite. `.github/workflows/check.yml` runs both tests and build with the Node version in `.nvmrc`.
