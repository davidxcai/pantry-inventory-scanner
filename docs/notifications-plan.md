> Superseded by [Wishlist inside Saved products](wishlist.md): Saved products remains unchanged, and only explicitly wishlisted out-of-stock saved items receive availability emails. The details below describe the earlier Watching implementation.

# Stock update notifications

Status: **built, migrations not yet applied** (2026-11-01). Planned 2026-10-14; the email provider changed from Gmail SMTP to Resend once the project got a domain.

## Goal
A signed-in student can "watch" any catalog item, whatever its status (in stock, low, out). When anyone else updates that item, the watcher gets an email, plus an in-app badge.

## Decisions

| Question | Decision |
|---|---|
| What counts as an update? | Every row written to `item_status_log`: a new report (pending), a second student's confirmation, a close-up photo (`apply_item_status`), a shelf scan. Re-reporting an already verified status writes nothing, so it notifies nobody. |
| Subscription lifetime | Persistent until the user turns it off. |
| Delivery | **Batched**: one digest email per user every 10 minutes. Several updates to one item collapse to the latest. |
| Self-notify | No. The student who made the update is never queued for it. |
| Prediction ("likely back in stock") emails | Out of scope. `notification_queue.type` leaves room for it. See `prediction-model.md`. |
| Email provider | **Resend**, free tier (100/day, 3,000/month), installed through the Vercel Marketplace. Sends from `alerts@utapantry.xyz`. |

## Domain and email setup (done 2026-11-01)
Full details, including Supabase auth emails sent through the same Resend account, are in `email-and-accounts.md`.
- `utapantry.xyz` was bought through Vercel and uses Vercel nameservers. It is the production alias.
- Resend integration `resend-email-citron-book` (free plan) is connected to the project. It sets `RESEND_API_KEY` and `RESEND_EMAIL_DOMAIN`.
- Resend added its SPF (`send`) and DKIM (`resend._domainkey`) records itself. We added `_dmarc TXT "v=DMARC1; p=none;"`. Tighten to `p=quarantine` once mail has been landing for a while.
- The sender name and footer say it is a student-run project not affiliated with UTA.

## How it works

### Data (`supabase/migrations/20261101000000_notifications.sql`)
- `item_subscriptions(user_id, item_id, created_at, last_seen_at)`. Users select, insert and delete their own rows. `last_seen_at` changes only through `mark_watches_seen()`.
- `notification_queue`: no client access. Filled by the trigger `item_status_log_notify` (after insert on `item_status_log`), one row per watcher other than the updater. A trigger on the log instead of edits to `set_item_status` catches every update path without another copy of that function.
- `my_watches()`: the user's watches with a `changed` flag (someone else logged an update since `last_seen_at`). Security definer because the log has no client access.
- `claim_notifications(p_users)` / `release_notifications(ids)`: service role only. Claiming marks rows sent before sending, so overlapping runs cannot double-send; a failed send releases them. Rows for items the user stopped watching are claimed but not returned.

### Sending
- `shared/notifyDigest.ts`: grouping, collapsing, email text/html, unsubscribe token. Unit tests in `notifyDigest.test.ts`.
- `api/_lib/sendEmail.ts`: the only file that knows about Resend. Adds `List-Unsubscribe` one-click headers.
- `api/notify.ts`: `Authorization: Bearer $CRON_SECRET`. Up to 25 users per run. On Resend's 429 it releases the rest and stops until the next run.
- `api/unsubscribe.ts`: removes all of a user's watches. GET shows a confirm button and only POST acts, because Microsoft Safe Links (UTA mail) opens links in emails. The token is an HMAC of the user id keyed with `SUPABASE_SECRET_KEY`, so no extra secret is needed. Rotating that key invalidates old links.

### Scheduling (`supabase/migrations/20261101010000_notify_schedule.sql`)
Vercel Hobby crons are daily only, so Supabase `pg_cron` + `pg_net` call `/api/notify` every 10 minutes. The URL and cron secret are read from Supabase Vault (`notify_url`, `cron_secret`), not stored in the migration.

### UI (`src/features/catalog/`)
- `ItemDialog.tsx`: "Notify me when this changes" / "Stop notifying me". Signed-out users get a sign-in link.
- `WatchingScreen.tsx` at `/watching`: watched items, with an "Updated" badge on ones that changed since the last visit. Opening it clears the flags.
- `ItemCard.tsx` (moved out of `CatalogScreen.tsx`): bell icon on watched items, used by both screens.
- Navbar: "Watching" link with a count of changed items. This is the fallback if emails land in junk.
- `useWatches.ts`: query and mutations (TanStack Query).

## To go live
1. Run in the Supabase SQL editor (the secret is the Vercel project's `CRON_SECRET`):
   `select vault.create_secret('https://utapantry.xyz/api/notify', 'notify_url');`
   `select vault.create_secret('<CRON_SECRET>', 'cron_secret');`
2. Apply both migrations, then run `npm run rls-test` against the project.
   - The schedule migration was applied 2026-11-01. The first attempt at the notifications migration stopped partway, leaving both tables (empty) but no functions. Before re-running it, reset with:
     `drop trigger if exists item_status_log_notify on public.item_status_log; drop function if exists public.queue_status_notifications(); drop table if exists public.notification_queue; drop table if exists public.item_subscriptions;`
   - Until `/api/notify` is deployed and the Vault secrets exist, the cron's calls fail harmlessly (visible in the `pg_net` logs).
3. Deploy.
4. Watch an item with a `@mavs.uta.edu` account, update it from another account, and check the inbox and junk folder after the next run.

## Risks
- New domains have no sending reputation, so the first emails to Microsoft 365 may land in junk. Ask early users to mark them "not junk".
- 100 emails/day on the free tier, shared with Supabase sign-up and password-reset emails. With 25 users per run, a busy day can run out; the rest go out the next day.
