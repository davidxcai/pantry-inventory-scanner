# Wishlist inside Saved products

**Saved products remains the main page at `/profile`.** Saving/unsaving products, search, availability filters, refresh, and device persistence keep their existing behavior. Saving a product does **not** subscribe it to email.

Inside that page are two tabs:

- **Saved products** shows everything the account saved. Open an out-of-stock product’s photo card on the homepage or Saved products page to find **Add to wishlist** inside its popup. Adding from the homepage saves the product first. Available and low-stock products do not offer this action; photo cards keep their existing Save controls.
- **Wishlist** shows only the saved products the user explicitly selected for availability alerts. Removing one from Wishlist keeps it in Saved products. A tracked product stays visible after restock with “Available now,” and can still be removed.

An email preference inside the Wishlist tab pauses/resumes emails without deleting either list. The recipient is always the current verified Supabase Auth email used for login; there is no separate email input. `/wishlist` and the retired `/watching` URL redirect to `/profile?list=wishlist`. The account menu keeps **Saved products**; Wishlist is not a replacement top-level list.

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

1. Apply `supabase/migrations/20261102060000_wishlist_availability_emails.sql` after the existing Saved products and notification migrations. This is an unshipped migration; its earlier draft that renamed/unified the lists has been replaced with this explicit opt-in model.
2. Deploy the frontend, `/api/notify`, and `/api/unsubscribe` with that migration. The sender needs server-only `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN`, `APP_URL`, and `CRON_SECRET`. Existing provider setup is in `email-and-accounts.md`.
3. Reuse the protected Supabase notification schedule (`20261101010000_notify_schedule.sql`). The frontend never holds mail credentials or invokes the scheduler.
4. Using a tester-owned verified account, save an out-of-stock product, explicitly add it to Wishlist, legitimately report it available, and check the login inbox/junk folder after the scheduled sender runs. Separately verify that saving alone produces no email.

## Delivery and validation

The worker requires `Authorization: Bearer <CRON_SECRET>`, leases jobs for five minutes, and acknowledges only delivered or obsolete messages. Crashed leases expire; failures, missing verified emails, and provider limits leave work retryable. Completion requires the matching claim token. Delivery is at-least-once: a crash after provider acceptance but before acknowledgement can repeat an email.

`npm run test:wishlist` covers separate list state, out-of-stock-only eligibility, account privacy, stock transitions, cancellation/removal, leases, verified recipients, unsubscribe, UI, and device fallback. `node --import tsx --test shared/*.test.ts` covers digest and existing shared logic without the tsx CLI IPC socket. Existing point/photo suites and `npm run build` verify regressions and TypeScript. The live `rls-test` requires owner credentials and the applied migration and was not run against the hosted database.
