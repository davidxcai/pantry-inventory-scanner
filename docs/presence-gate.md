# Presence gate

Status: **written, migration not yet applied or tested** (2026-10-16). Migration: `supabase/migrations/20261015020000_pantry_gate.sql`. UI mirror: `shared/pantryGate.ts`, `src/features/checkin/`, route `/checkin`.

## Problem
Anyone signed in with a UTA email can upload photos and change item statuses from anywhere, so the catalog can be edited by people who have never been to the pantry. Nobody at the pantry runs this app (see `project-direction-plan.md`), so the app has to decide on its own who is allowed to write.

## Decision
A student may create an intake job (photo upload) or call `set_item_status` only when both hold:

1. **The pantry is open.** Hours come from the `pantry_hours` table, in `America/Chicago`: Tue and Wed 9:00-15:00, Thu 11:00-17:00, closed every other day.
2. **They checked in less than 30 minutes ago.** Check-in means scanning the QR code posted at the pantry.

Hours are the first gate and check-in the second. Both are evaluated on every write, so a check-in made 20 minutes before closing stops working at closing time without any stored expiry.

Location services were rejected as the gate: permission prompts, poor indoor accuracy and easy spoofing. The QR code is a stronger signal and needs no permission.

## Check-in rules

With `20261102030000_extra_visit_rewards.sql` applied, approved 100-point rewards permit additional single-use check-ins without changing the regular monthly allowance. Extra check-ins also satisfy the inventory presence gate. See [extra-visit rewards](extra-visit-rewards.md) for the extended policy and setup. The rules below describe the original monthly allowance.
`check_in(p_code)` is the only way to create a row in `pantry_checkins`.

- **Login required.** The check-in belongs to the account, never the device, so a dead phone or a second phone does not matter. The `/checkin` screen sends signed-out visitors to `/login` and returns them to the scan afterwards.
- **One per calendar month**, matching the pantry's one visit per student per month. Enforced by a unique constraint on `(user_id, visit_month)`; the month is computed in the pantry's timezone.
- **Refused when the pantry is closed, or closes in under 15 minutes.** Nothing is recorded, so the month is not used up and they can try again on another day.
- **Idempotent inside its 30 minutes.** Scanning again (crash, other phone) returns the same check-in and does not extend it. After 30 minutes the same scan says the month is already used.
- **The QR carries a secret**, stored in `pantry_settings` (`checkin_code`, random at migration time). The code only proves the scan came from a code we printed.

## What is gated
| Write | Gated | Why |
|---|---|---|
| Inserting an `intake_jobs` row (photo upload) | Yes, by a `before insert` trigger | This is the moment the student submits. |
| `set_item_status` | Yes, one line at the top | Direct status changes and confirmations. |
| `/api/identify`, `/api/sweep` finishing a job | No (`auth.uid()` is null) | The job was accepted at submission; closing time must not strand it. |
| `resolve_job_*`, `confirm_job` | No | They act on a job that already passed the gate. |

The trigger lets an insert through when the job id already exists. The upload queue retries inserts and treats a duplicate-key error as "already done"; the gate must not turn that into a refusal.

## Testing and switches
There is no staff or admin role. Everything is a row in the database, changed from the Supabase SQL editor.

- **`pantry_settings.gates_enabled`.** Starts `'false'`, so development and testing are open and the existing scripts keep working. With it off, check-in also skips the hours rules, so the flow can be tried at any time. **Set it to `'true'` on the production project**; if you forget, nothing is protected.
- **`pantry_gate_exempt`.** Accounts listed here skip both gates (and the hours rules at check-in). For testing on a project where the gates are on, for example the team visiting on Mondays and Fridays when the pantry is closed. Remove the row when done.

```sql
-- QR code: print https://<site>/checkin?code=<value>
select value from public.pantry_settings where key = 'checkin_code';

-- Rotate it (leaked code, reprint)
update public.pantry_settings
  set value = replace(gen_random_uuid()::text, '-', '') where key = 'checkin_code';

-- Gate on or off
update public.pantry_settings set value = 'true' where key = 'gates_enabled';

-- Test accounts that skip the gate
insert into public.pantry_gate_exempt (user_id) values ('<auth.users id>');
delete from public.pantry_gate_exempt where user_id = '<auth.users id>';

-- Let one student check in again (testing, or a genuine mistake)
delete from public.pantry_checkins where user_id = '<auth.users id>';
```

Hours and closures are rows in `public.pantry_hours` (`dow` 0 = Sunday ... 6 = Saturday); a day with no row is closed. Changing them also means updating `shared/pantryGate.ts`, which drives the UI messages and its tests.

## Accepted limits
There is no staff to reset a mistake, and this is a crowdsourced app, so some abuse is accepted. These were considered and left alone:

- **A photo of the QR code.** Anyone who scans it during open hours passes, but it uses up their own visit for the month, so it costs them. A changing code on a screen at the pantry would defeat photos; it can be added later without changing the tables.
- **Late arrivals.** The 15-minute cutoff means someone who shows up in the last 15 minutes cannot check in that day. They are told, and the month is kept.
- **No location, IP or device check.** They were considered as soft signals and not built.
- **Mistakes cannot be undone from the app.** A wrongly used visit is a SQL delete.

## Known gaps
- **Offline captures.** The capture queue treats any upload error as "offline" and retries. A capture refused by the gate stays pending and blocks the ones behind it, with no message to the student. It uploads once they are checked in during open hours. Showing the refusal in the queue UI is not done.
- **`set_item_status` is copied** into the gate migration with one added line. A change to it in `20261015010000_status_verification.sql` has to be repeated in `20261015020000_pantry_gate.sql`.
- **The SQL has not been run.** Only `shared/pantryGate.ts` has tests (hours, the 15-minute cutoff, the 30-minute window, the daylight-saving change).

## To finish
1. Apply the migration to a dev project.
2. Test with an ordinary student account, not an exempt one: closed pantry refused, update before check-in refused, check-in then update works for 30 minutes, second scan after the window refused, check-in in the last 15 minutes refused and not recorded.
3. Print the QR and post it inside the pantry.
4. Set `gates_enabled` to `'true'` on production.
