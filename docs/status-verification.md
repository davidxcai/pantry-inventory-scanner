# Two-student status verification

> **Superseded 2026-11-02** by `supabase/migrations/20261102070000_single_student_verification.sql`. One student's report is now verified immediately; nothing is pending. Two-student confirmation was too strict for the pantry's traffic and most reports stayed "Pending verification" indefinitely. What changed:
> - Any report (button, close-up photo, shelf scan) sets `status_verified = true`. All existing pending items were marked verified. Repeating the current status records a re-check (refreshes who checked it, logs a `confirm` row so points still accrue, per `20261102050000`); the "you already reported this" error is gone.
> - The 10-minute cooldown stays; the exception is now "you are the current reporter" (still lets you fix a mis-tap).
> - The 30 `out` cap now counts `out` reports in `item_status_log` over the last **24 hours** (index `item_status_log_user`), since unverified reports no longer exist.
> - `status_verified`, and the view's `pending` / `reported_by_me` columns, are kept for older clients but are always true / false / false. The UI no longer shows a pending badge or a confirm button, and wishlist emails show the status alone. `confirm` log rows (old confirmations and new re-checks) still show as "Confirmed" in the timeline.
>
> The rest of this page describes the original two-student design.

Status: **implemented, migration not yet applied** (2026-10-15). Migration: `supabase/migrations/20261015000000_status_verification.sql`.

## Problem
Any signed-in UTA student can call `set_item_status` with no photo, rate limit or review. One user could mark every item "out" in seconds, and the public catalog would show it. Attribution (display name on each update) was the only deterrent.

## Decision
Self-moderation instead of heavy restriction: a change is shown immediately but marked **pending** until a *different* student reports the same status. Anomaly detection (burst size, share of catalog flipped, reversal rate) was considered and deferred; the log below keeps the data it will need.

## Rules
Applied inside `set_item_status`, with the item row locked.

| Situation | Result |
|---|---|
| Different status from the current one | New report. Shown immediately, **pending**, attributed to the reporter. Replaces whatever was there, including a verified status. |
| Same status, reported by a **different** user, currently pending | **Confirmed**: `status_verified = true`. Logged as `kind = 'confirm'`. The reporter stays the original user. |
| Same status, reported by the **same** user | Error: "you already reported this; another student needs to confirm it". |
| Same status, already verified | Silent no-op. Nothing is written or logged. |
| Item has no reporter (status carried over from the old ledger) | Any report is treated as a new report, never a confirmation. Such items are not shown as pending. |

### Abuse limits
- **Cap: 30 unverified `out` reports per user.** Counted from `items` (rows where `status_updated_by` is the user, `status = 'out'`, not verified). A confirmation by someone else frees a slot. `in_stock` and `low` reports are not capped. The check takes a per-user advisory lock so parallel calls cannot get past it. Backed by the partial index `items_unverified_out`.
- **Cooldown: 10 minutes per user per item.** A user who has any log row for the item in the last 10 minutes cannot change it. Exception: correcting your own still-pending report is always allowed (fixes a mis-tap). The cooldown stops two accounts flipping an item back and forth.
- Both limits are constants at the top of the function (`c_out_cap`, `c_cooldown`). Changing them means a new migration that redefines the function.

## Data
- `items.status_verified boolean not null default false`.
- `item_status_log.kind text` (`'report'` or `'confirm'`, default `'report'`). One row per report and per confirmation. No client access; written only by the function.
- `available_items` (public view) gains `pending` = `status_updated_by is not null and not status_verified`. It keeps the `other`-category filter from the guardrail migration.
- Existing items that already have a reporter become pending when the migration runs, until someone confirms them.

## UI (`src/features/catalog/ItemDialog.tsx`)
There is no edit mode. Tapping an item card opens a detail view; signed-in users get **Mark low** and **Mark out of stock** there. Saying an item is **in stock** needs a photo (Add item / Update stock), and shelf scans confirm through `confirm_shelf_scan`, which calls `set_item_status` per item, so every rule above applies to them too.
- A "Pending verification" badge beside the availability badge when `pending` is true (card and detail view).
- On a pending Low or Out item the detail view says another student reported it and to tap the same button to confirm. The button stays enabled while an item is pending; it is disabled only when the status already matches and is verified.
- Rule violations (self-confirm, cooldown, cap) show as an error alert in the detail view, using the database error message.

### Recent updates timeline
The detail view lists the item's last 5 `item_status_log` rows ("Marked low · name · 2h ago", "Confirmed out · …"). They come from `item_history(item_id, limit)` (migration `20261101030000_item_history.sql`), a security-definer function open to anon like `available_items`: it returns status, kind, display name and time only, never user ids, and nothing for `other`-category items. Each log row keeps a copy of the updater's display name (`item_status_log.user_name`, filled by a before-insert trigger), so a deleted account's updates still show their name; the current profile name is preferred while the account exists. Photo updates log as `report` with no source column, so the timeline cannot say "via photo".

## Known gaps
- Close-up photos (Add item, `resolve_job_existing` / `resolve_job_new`) set the status through `apply_item_status`, not `set_item_status`. They are never pending, never confirm anything, and skip the cooldown and the out cap. The photo is the proof, but a close-up can replace a pending Low/Out report without a second student. Shelf scans do go through `set_item_status`.
- Two real UTA accounts can confirm each other's reports. This takes effort and both accounts are attributable.
- Pending reports never expire. The catalog shows the report's age and a stale warning after 7 days, but an old pending "out" stays pending.
- Disputing is a single report from one student, so it can also be abused in reverse (replacing a true "out" with "in stock"). The 10-minute cooldown and attribution are the only limits on that.
- No staff view of reports or users, and no ban. Needed before anomaly detection has anywhere to send its findings.

## Interaction with other plans
- `notifications-plan.md` says *any* call to `set_item_status`, including re-confirming the same status, notifies watchers. With this change only a report or a first confirmation writes to `item_status_log`; a repeat on an already verified status writes nothing, and a self-repeat errors. If notifications trigger from the log, "confirmed" notifications will fire once per item per report, not on every tap.

## Testing
`npm run status-test` (`scripts/status-verify-test.ts`) runs against a real Supabase project: report, self-confirm rejection, confirm, replace, cooldown, own-correction, the 30 cap, and slot release on confirm. It creates and deletes throwaway `@mavs.uta.edu` users and items, so point `.env` at dev or staging. `npm run typecheck` and `npm test` cover the TypeScript side.

## Possible next steps
1. Staff view of reports and users, with revert and ban.
2. Shadow-mode anomaly detector over `item_status_log` (burst size, share of catalog flipped, reversal rate), thresholds in a config table, enforcement behind a flag.
3. Auto-expire old pending reports.
