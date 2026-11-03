# Personal watchlist

Signed-in students can save products from catalog cards or item details. Open the name menu beside Info and Book Appointment, then choose **Saved products**. The same option is in the mobile menu. The account’s saved list lives at `/profile`; there is no separate Profile menu entry.

The list shows newest saves first, including out-of-stock items, their current reported availability, pending verification and freshness warnings. Search by product name or category, filter by availability, and use the In stock / Low stock / Out of stock totals to plan a visit. A Refresh button checks availability immediately. Remove products from the list or toggle Saved in the catalog. Card and detail buttons share pending state for the same product so overlapping clicks cannot send conflicting requests.

Lists are stored per account in Supabase and refresh every 30 seconds while the page is active. Save buttons update immediately, with failed writes rolling back only the affected product. Saved products is available in the username menu at the top right, and in the mobile menu. Signed-out visitors see Sign in to save on product cards. Saving does not change stock, reserve an item, send notifications, or require a pantry check-in. A saved product later hidden from the catalog appears as an unlisted entry that can still be removed; deleted products and deleted accounts have their saved entries removed automatically.

## Database setup

Apply `supabase/migrations/20261024000000_personal_watchlist.sql` to the same Supabase project used by the app, after the existing migrations. Deploy it before the frontend. The migration creates `watchlist_items`, a unique `(user_id, item_id)` key, and owner-only select/insert/delete policies. Only public catalog products can be saved. Anonymous access and direct updates are denied. If the table is missing (`PGRST205`), saves persist in browser storage under a key scoped to the signed-in account. Saved products clearly indicates that those entries are on this device and waiting to sync. They survive reloads in the same browser, can be removed, and still load current catalog availability. Once the migration is applied, the next refresh copies those entries to the account, avoids duplicate rows, and clears the synced device entries. Account saves then follow the user across devices. Unlisted device entries remain removable locally. Auth, permission and network errors are surfaced rather than treated as successful saves; blocked device storage also produces an error.

The device cache stores only unsynced product IDs and save timestamps, not user credentials. Save/remove/sync operations are serialized per account so a concurrent refresh cannot resurrect a removed item. Browser storage changes and reconnection refresh the shared saved-list query.

No new environment variables or runtime dependencies are required. The application continues using `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Verification

- Run `npm test`, `npm run test:saved`, and `npm run build`. `test:saved` checks device persistence, migration-time sync, account isolation, save/remove races and repository queries and executes the real migration in an isolated in-memory PostgreSQL database using the development-only PGlite dependency. No live credentials are required for these checks.
- On a **dev/staging** Supabase project with the migration applied, run `npm run watchlist-test`. It uses `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` from `.env`, creates temporary confirmed UTA accounts and products, and cleans them up. It checks account isolation, anonymous access, duplicate saves, invalid products, independent lists, removals and product deletion.
- Sign in, save a product, and open Saved products on desktop and mobile. Refresh the page and confirm it stays saved. Open product details and remove it; confirm both the saved list and catalog reflect the change.
- Sign into another account and confirm the first account’s saved products are absent. Signed-out visitors can browse the catalog, are offered a sign-in link in product details, and cannot save products or open the saved list.
- With the table missing, save an item, reload Saved products and check it remains; apply the migration and refresh to verify the device entry syncs without duplication.
- Check the empty-list state, out-of-stock and pending items, loading failures/retry, and removal of an item hidden after it was saved.
