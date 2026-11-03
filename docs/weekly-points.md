# Weekly points without database administration

The app now works with the existing stock backend even when the shared points migration has not been installed. No database administration credentials are needed for development, and no hosted database schema was changed.

## Earning

- A successfully saved new product, matched existing product, manual stock update, or shelf-restock confirmation earns **one point per product per account every rolling seven days (168 hours)**.
- Further reports still update stock. They show a cooldown explanation and the next eligible time instead of awarding another point.
- Retries of one photo job or shelf confirmation remain the same operation forever; replaying an old source never earns a new weekly point. Upload a new photo/report after the cooldown to earn again.
- Product comparison includes brand, variety, and strength. Case, accents, punctuation, word order, repeated brand names, simple plurals, and package sizes do not create another reward identity. An item ID check also prevents changing a product name to bypass the cooldown.
- Selecting/uploading a photo alone is not enough: the job must reference a successfully saved product. Queued, unidentified, failed, and rejected jobs earn nothing. A product created automatically already earns once; confirming its review does not earn again.
- Manual Create checks the loaded catalog for an exact normalized product and updates that item rather than creating another copy. Award deduplication also handles duplicate catalog IDs.

## Device balance and recovery

When `get_inventory_points()` is missing, the Points page automatically uses an IndexedDB ledger scoped to the Supabase project and signed-in UTA account. It displays **This device** / a device-storage notice. The ledger survives reloads and sign-out/sign-in in the same browser. IndexedDB transactions prevent concurrent tabs awarding the same product twice.

Recent successfully resolved photo jobs from the last seven days are recovered from the existing owner-readable upload records. Recovery uses the job creation time as a conservative approximation because the old backend does not expose completion time. Newly completed photos are recorded at observed completion time. Existing stock history is private in the old database, so past manual/shelf reports cannot be backfilled; new successful reports are recorded immediately.

Balance and point receipts refresh after photo identification, manual review, stock reports, and shelf confirmation. Realtime and polling provide recovery if a socket or response is lost. No storage credentials or model keys are exposed. A failed points refresh does not undo a saved stock report, and an authentication/network failure is not silently replaced with a zero balance.

At 100 available points, **Request an extra visit** opens an email draft to `salmanfarse2025@gmail.com` for manual review. The draft identifies the balance as device-only development credit so the reviewer can verify eligibility. The student must send it; opening the draft does not reserve/spend points, record a submitted request or approval, or unlock a check-in. Approval and appointment coordination happen by email.

Device points are development credit: they are unavailable on other browsers/devices, can be lost if site storage is cleared, and cannot authorize extra-visit redemptions. If shared points become available, the server balance becomes authoritative; device points are never added to it or automatically uploaded as trusted credit. Global enforcement across devices requires the shared database implementation.

## Optional shared database upgrade

When the team member with database access is ready, apply the original earning migration (`20261028000000_inventory_points.sql`) followed by `20261102050000_weekly_inventory_points.sql`. Visit-redemption migrations are independent. The weekly migration retains existing awards, replaces lifetime uniqueness with a transactional rolling-week check, adds owner-readable operation receipts and source-job attribution, deduplicates exact product creation under a database lock, and recovers successful recent status reports. Neither migration was applied to the hosted project during this development task.

The new activity table does not require a Realtime publication: successful operations invalidate queries directly and the UI polls while waiting for a receipt. Existing job Realtime continues working.

## Verify

- `npm test` — product identity, weekly boundary, replay and rename protection.
- `npm run test:points` — real IndexedDB transactions (via fake-indexeddb), device recovery, balance authority, failed-job exclusions, privacy, optional SQL migration, and reward regressions.
- `npm run test:photos` — upload recovery and point-cache refresh after identification.
- `npm run build` — production bundle and TypeScript checks.

In the running app: sign in with a UTA account, open Points, and check the recovered device balance. Complete a new product upload; the queue should show **+1 point earned** and the balance should increase. Upload that product again: stock still saves, the queue explains the seven-day cooldown, and the balance stays unchanged. A genuinely different product earns another point. Reload to confirm persistence. Use the shelf flow to verify successful selected items count separately while skipped items do not.
