# Wishlist inside Saved products

**Saved products remains the main page at `/profile`.** Saved products and Wishlist are separate views: out-of-stock tracked products and explicit wishlist choices appear only in Wishlist. Other tracked products appear in Saved products. Tab counts, search, and availability totals use those separate lists. Saving a product does **not** subscribe it to email.

Inside that page are two tabs:

- **Saved products** shows available saved products that are not explicitly wishlisted, plus removable unlisted entries. Out-of-stock homepage cards show **Add to Wishlist** instead of Save. Adding to Wishlist saves the product first, then enrolls it for availability alerts. Enrolled cards show **Wishlisted**, which removes the alert when clicked again. Available and low-stock cards keep their Save controls. The out-of-stock product popup also offers **Add to Wishlist**; Saved products cards retain their Remove control.
- **Wishlist** shows out-of-stock tracked products, including older saves, and explicit availability-alert choices. An older save moving into this view does not silently enable email alerts. Removing an explicit alert keeps the underlying tracked entry; an available product then appears in Saved products. The card’s Remove control removes the tracked product entirely. A tracked product stays visible after restock with “Available now,” and can still be removed.

An email preference inside the Wishlist tab pauses/resumes emails without deleting either list. The recipient is always the current verified Supabase Auth email used for login; there is no separate email input. `/wishlist` and the retired `/watching` URL redirect to `/profile?list=wishlist`. The account menu keeps **Saved products**; Wishlist is not a replacement top-level list.

The Wishlist tab shows the login email, alert setting, and device-sync limitations next to the toggle. After adding a product, its popup shows whether emails are enabled, paused, or waiting for sync, with a link to manage alerts.

## Membership and privacy

`watchlist_items` is the existing saved-products table and is unchanged. A separate `wishlist_items` table stores explicit opt-ins, with a composite foreign key to the owner's saved product. Unsaving a product therefore removes its server wishlist membership automatically.

`set_wishlist_item(item_id, enabled)` authenticates the account and accepts no caller-selected owner/email. To add, it requires that the product is saved by the caller, visible in the catalog, and currently out of stock. An item row lock serializes enrollment against restocking so the transition cannot be missed. Retries are idempotent. Owners can remove their wishlist selection at any stock level. Clients cannot forge rows directly or read/change another account's choices.

The migration does not automatically wishlist any saved products or convert legacy Watching entries into new saves. Historical `item_subscriptions` rows are retained, but legacy Watching writes and generic status-change mail are retired.

## Availability email behavior

- Only explicit Wishlist entries receive alerts when stock changes from `out` to `in_stock` or `low`. Low stock counts as available.
- Saving an available product, confirming the same stock report, available-to-available changes, and becoming unavailable do not create an email. Self-reported restocks can notify the user's own opted-in wishlist too.
- The database transition trigger covers manual stock reports, close-up photos, and shelf restocks. Pending events for one product are collapsed into the latest digest entry.
- Before delivery, the worker rechecks Wishlist membership, current catalog availability and visibility, the account email preference, and the current verified login email. Removed, unavailable, unlisted, paused, or unverified recipients are not emailed.
- Unsubscribe links pause email for the account without deleting saved products or wishlist choices. GET only displays confirmation, protecting against mail-security scanners; signed POST applies the change.

## Database-free development

Saved products use their existing device fallback when the shared table is missing. Wishlist choices have a separate project/account-scoped local storage key, and adding an unsaved product to Wishlist saves it first. The Wishlist tab and out-of-stock buttons work locally. Unsaving a product clears its local wishlist choice too.

Device-only choices cannot send reliable background email. The UI explicitly says that email starts after account sync/server setup. Once the migration is available, pending device choices sync through the validated RPC. A product that is already available at sync time is not backdated into a subscription; it stays removable locally and can show “Available now.” No actual email is promised for a transition that happened before server enrollment.

## Deployment by the project/database owner

No hosted migration or real email was run during implementation.

1. Apply unapplied database migrations in timestamp order. In particular, the feature requires `20261024000000_personal_watchlist.sql`, `20261101000000_notifications.sql`, and `20261102060000_wishlist_availability_emails.sql`, alongside the existing catalog/auth migrations. Do not rerun migrations already applied. The wishlist migration's earlier unshipped draft that renamed/unified the lists has been replaced with this explicit opt-in model.
2. Deploy the frontend, `/api/notify`, and `/api/unsubscribe` together. Configure server-only `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `APP_URL` (the public HTTPS app origin), and `CRON_SECRET`. Choose one mail provider:
   - **Resend:** `RESEND_API_KEY` and `RESEND_EMAIL_DOMAIN` (verified sending domain). Existing setup is in `email-and-accounts.md`.
   - **Gmail SMTP:** `SMTP_USER` and `SMTP_PASS` (Gmail app password), reusing the extra-visit email configuration. Resend takes precedence when its API key is set. A failed delivery never silently switches providers.
3. Configure the protected Supabase notification schedule (`20261101010000_notify_schedule.sql`) and its Vault secrets. The `notify_url` must point to the deployed app's `/api/notify`; Vault's `cron_secret` must match the server's `CRON_SECRET`. The `send-stock-notifications` job calls it every ten minutes. This job is separate from the daily Vercel jobs. The frontend never holds mail credentials or invokes the scheduler.
4. Using a tester-owned verified account, save an out-of-stock product, explicitly add it to Wishlist, legitimately report it available, and check the login inbox/junk folder after the scheduled sender runs. Separately verify that saving alone produces no email.

Run `npm run check:wishlist-emails` in an environment with the server variables to check provider configuration and required database tables/lease columns without reading user records, claiming jobs, changing stock, or sending email. It returns a nonzero exit code for missing configuration or schema. It does not verify SMTP credentials, domain delivery, or the cron/Vault configuration; check the schedule in Supabase separately.

The connected development project was checked using zero-row public REST requests during this update: `watchlist_items` and `wishlist_items` were absent. Local configuration has only frontend Supabase settings, with no service key or mail credentials. Live activation therefore still requires the owner to apply migrations and configure the server; a local Wishlist choice alone cannot deliver email.

## Delivery and validation

The worker requires `Authorization: Bearer <CRON_SECRET>`, checks mail configuration before claiming jobs, leases jobs for five minutes, and acknowledges only delivered or obsolete messages. It initializes only the database and mail clients; no Gemini/photo-analysis API key is needed. Crashed leases expire; failures, missing verified emails, and provider limits leave work retryable. Completion requires the matching claim token. Delivery is at-least-once: a crash after provider acceptance but before acknowledgement can repeat an email.

`npm run test:wishlist` covers separate list state, out-of-stock-only eligibility, account privacy, stock transitions, cancellation/removal, leases, verified recipients, unsubscribe, UI, and device fallback. `node --import tsx --test shared/*.test.ts` covers digest and existing shared logic without the tsx CLI IPC socket. Existing point/photo suites and `npm run build` verify regressions and TypeScript. The live `rls-test` requires owner credentials and the applied migration and was not run against the hosted database.
