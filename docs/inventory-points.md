# Inventory points

For the current rolling seven-day earning policy and device-backed development mode, see [weekly points](weekly-points.md). Device points work without database administration; they cannot be spent on visit rewards.

Open the username menu in the top-right corner and choose **Points**. The mobile menu has the same entry. The page shows the account's saved points, progress toward each 100-point milestone, and its latest 20 awards. Add item and Queue also link to the points balance.

The earning migration accumulates and displays points. The separate [extra-visit rewards feature](extra-visit-rewards.md) adds 100-point reservations, approval and extra check-ins, disabled until configured. Earned history remains intact; available balance subtracts active reservations and approved/used redemptions. No scheduling API is called.

## Earning rules

- A successful inventory status report earns one point for a distinct product per account every seven days. This includes accepted new-item photos, matching existing-item photos, manual stock reports, second-student confirmations, and confirmed shelf products.
- Camera and photo-library uploads follow the same database path. Merely selecting or uploading a photo does not earn a point: a persisted inventory update must occur. An automatically created product already changes inventory and earns its point; checking it again in Review does not earn a second one.
- Repeated updates and duplicate entries for the same normalized product within seven days do not earn additional points; retries of one operation never earn again. Product identity includes brand, variety and strength; punctuation, accents, package size, word order and simple plurals are ignored. An item-ID cooldown also prevents earning again by renaming the same entry.
- Failed/rejected photos and queued jobs that have not changed inventory do not count. Saving products is independent of points.
- Without the points migration, device mode recovers recent successful uploads. The optional weekly migration recovers recent successful status reports. Deleting a catalog item does not remove points already earned.

## Enable in Supabase

Apply `supabase/migrations/20261028000000_inventory_points.sql` in the same Supabase project as the app, after the existing inventory/status migrations. No server keys are added to the frontend. This migration is independent of the saved-products migration.

The migration creates an owner-readable, server-written `inventory_point_awards` table, a trigger on the existing `item_status_log`, and the read-only `get_inventory_points()` RPC. It makes no changes to check-in tables, appointment links, or scheduling functions. Point awards commit or roll back in the same transaction as the inventory update. The weekly migration serializes earning per account to prevent concurrent duplicate awards. Clients cannot grant, edit, delete, transfer, or spend points.

If the shared points function is missing, the page shows an account-scoped device balance, with an explicit device-storage notice. Inventory updates continue to work. Balances refresh every ten seconds and on window focus; successful queue reviews, intake updates, shelf confirmations and manual status updates invalidate the points query immediately.

## Redemption integration

Apply `20261102030000_extra_visit_rewards.sql` and then `20261102040000_gmail_visit_approver.sql` after this earning migration to enable the server-side redemption interfaces. Follow [extra-visit rewards setup](extra-visit-rewards.md) for the approver allowlist, Gmail sender, scheduled queue worker, tests, and feature switch. The summary RPC then reports available/reserved/spent balances and request history; account-level transactions protect spending and check-in consumption.

## Verification

- `npm run build`
- `node --import tsx --test shared/*.test.ts`
- `npm exec vitest run scripts/points-db.test.ts scripts/points-ui.test.ts`

The database tests run the migration in isolated PostgreSQL (PGlite) using the real intake, review, status and shelf-resolution functions. The original earning tests verify attribution to the upload owner, one point per distinct product, retries, rejected/failed jobs, privacy, forbidden client writes, rollback behavior, retention after catalog deletion, and the original earning migration’s unchanged check-in function. Separate reward tests cover the extended check-in policy. The UI tests verify balances, milestones, unavailable setup, and redemption disabled before configuration.

After applying the migration: sign in, open Points, make a valid inventory update, return to Points and check for one new point and an activity entry. Reload to confirm persistence. Updating the same product again should not add another point. Another signed-in account must see its own separate balance.
