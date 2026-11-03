# Extra-visit rewards

Device-only development points cannot be redeemed. See [weekly points](weekly-points.md) for the current earning policy and database-free development fallback.

Implementation is local; hosted migration and real email delivery still require setup. Redemption is disabled by default.

## Behavior

- One point is still earned per distinct successfully reported product per account, following `inventory-points.md`. Existing earnings are never deleted or reset.
- From **Points**, a student confirms a 100-point request. Submission reserves 100 points; approval spends them. Rejection or pending cancellation releases them. Only one pending or unused approved reward is allowed per account, with no monthly redemption cap.
- Requests remain pending until reviewed or cancelled. `/visit-review?request=<id>` requires sign-in to a verified, allowlisted approver account and an explicit confirmed decision. Reading the link never makes a decision. `/visit-review` lists requests for approvers; their Points page links there.
- Approval grants one extra app check-in, valid for exactly 720 hours (30 days) from approval. Unused expiry refunds the 100 points once. Used rewards never refund. The student cannot cancel an approved reward.
- The normal monthly check-in is used first. Further check-ins require an approved, unexpired reward. A current 30-minute session is reused across both kinds of visits. Extra check-ins preserve the QR, hours, closing cutoff and stock presence gate.
- No scheduling API is called. Approval does not book an appointment or guarantee admission. Coordinate the visit manually before arrival.
- The student's in-app status is authoritative. Email can be delayed; delivery failures do not lose requests or alter point balances.

## 1. Apply the migrations and configure the Gmail approver

Apply `supabase/migrations/20261102030000_extra_visit_rewards.sql` after the existing pantry-gate and inventory-points migrations, followed by `supabase/migrations/20261102040000_gmail_visit_approver.sql`. The new setting `visit_rewards_enabled` starts as `false`. No existing earning records or regular check-ins are rewritten.

Keep Supabase email confirmation enabled. Register **salmanfarse2025@gmail.com** through the normal Register form and confirm the verification email. The new migration permits this exact Gmail address as a registration exception; it does not grant review privileges automatically. Other Gmail addresses and aliases remain blocked. Then run this in the Supabase SQL editor:

```sql
insert into public.visit_reward_approvers(user_id)
select id from auth.users
where lower(email) = lower('salmanfarse2025@gmail.com')
  and email_confirmed_at is not null
on conflict do nothing;

-- Verify that the expected account was added; receiving review emails grants no access.
select u.id, u.email from public.visit_reward_approvers a
join auth.users u on u.id = a.user_id;
```

Approvers are managed through trusted SQL/service access. Ordinary accounts cannot add themselves. The designated Gmail must be both verified and allowlisted before it can review. A verified approver must exist before student request submission succeeds. Changing `VISIT_REVIEW_EMAIL` only changes the inbox; it never grants sign-in or reviewer access.

Sign in at `/login` with the Gmail address and its app account password. Without a specific return link, this account goes directly to `/visit-review`; the desktop and mobile account menus also show **Review visit requests**. The Gmail account cannot request rewards, check in, or update student inventory. Use a normal UTA student account to test those actions. Existing explicitly allowlisted UTA approvers remain supported.

## 2. Configure the email sender

Use a dedicated Gmail account. Follow [Google's app-password setup](https://support.google.com/accounts/answer/185833?hl=en), including its 2-Step Verification prerequisite. Set these values privately in local `.env.local` and the deployed server environment, never with a `VITE_` prefix:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | Existing Supabase project URL |
| `SUPABASE_SECRET_KEY` | Existing server-only service credential |
| `SMTP_USER` | Dedicated Gmail sender address |
| `SMTP_PASS` | Gmail app password |
| `APP_URL` | Deployed app origin, e.g. `https://your-app.vercel.app`; `http://localhost:3000` allowed for local testing |
| `CRON_SECRET` | Random private bearer secret used by the worker and scheduler |
| `VISIT_REVIEW_EMAIL` | Optional; defaults to `salmanfarse2025@gmail.com` |
| `VISIT_APPOINTMENT_INSTRUCTIONS` | Optional email instructions; defaults to “Your extra visit is approved. Reply to the approval email to arrange your appointment before visiting.” |

The request message goes to the review mailbox with the student's verified email as Reply-To. Decision emails go to the student's verified account email with the review mailbox as Reply-To. Review emails include the student name, email, request ID, submission time, and signed-in review URL. Emails use plain text to avoid injecting HTML from names or notes.

Run local functions with `npm run dev:api`; plain `npm run dev` serves the UI and any already-configured inventory proxy, but does not run this worker. Set `APP_URL` to the actual local functions URL when testing email links.

## 3. Schedule the worker

`GET` or `POST /api/visit-rewards-worker` requires `Authorization: Bearer <CRON_SECRET>`. It expires unused rewards, then sends up to 20 queued messages within its time budget. A daily Vercel cron at 08:10 UTC is included as a fallback. Configure the primary worker every five minutes so requests reach the reviewer promptly.

Using [Supabase Cron with Vault and pg_net](https://supabase.com/docs/guides/functions/schedule-functions), enable the Cron (`pg_cron`) and `pg_net` integrations. Privately store two Vault secrets named `visit_rewards_app_url` (the app origin) and `visit_rewards_cron_secret` (matching `CRON_SECRET`). Then schedule:

```sql
select cron.schedule(
  'visit-rewards-mail',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'visit_rewards_app_url') || '/api/visit-rewards-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'visit_rewards_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
```

Manage Vault secrets through trusted operator access. The worker returns 401 without the secret and 503 on setup/database failures. Missing sender configuration leaves mail queued. Balance reads, new requests, and check-ins also enforce expiry, so delayed scheduling cannot permit an expired check-in.

## 4. Test, then enable

Run `npm run test:points`, `npm test`, and `npm run build`. Automated database tests run against isolated PostgreSQL via PGlite, with serialized concurrent-call checks; they do not substitute for a live multi-connection database smoke test.

Keep production redemption disabled until setup is verified. In a separate development Supabase project, register and allowlist the verified Gmail approver, configure the sender and scheduler, then enable requests there:

```sql
update public.pantry_settings set value = 'true' where key = 'visit_rewards_enabled';
```

Use two verified test students with legitimately earned points. Verify a 99-point rejection, a 100-point reservation, reviewer permissions, approval and rejection emails (including UTA junk folders), pending cancellation, and an extra QR check-in after the normal monthly session. Check two tabs submitting/scanning together, and a cancellation racing an approver decision. Verify one reservation/decision/extra check-in and matching audit events. Test unused expiry/refund in the development database by moving only a test request's `expires_at` into the past; never modify live student balances to test.

Once real review and student mail delivery and manual pantry coordination are confirmed, configure production and enable its setting with the same SQL. Turning it back to `false` stops new requests; existing pending decisions, approved visits, refunds, and email delivery still work.

## Operations and recovery

Available balance = earnings − pending reservations − approved/used spending. Expired, cancelled and rejected requests contribute no debit. `visit_reward_events` records transitions; returning a request to `expired` is idempotent and creates one refund event without changing earnings.

Review queue health using trusted SQL:

```sql
select id, request_id, kind, attempts, next_attempt_at, lease_until, last_error
from public.visit_reward_mail where sent_at is null order by created_at;

select request_id, status, actor_id, created_at
from public.visit_reward_events order by created_at desc limit 50;
```

Failures retry with exponential delay, capped at 256 minutes. Jobs have a 10-minute lease; overlapping workers skip leased messages. After correcting SMTP configuration, bring `next_attempt_at` forward for failed messages if needed. Expired leases are reclaimable; completion requires the matching lease token.

SMTP is at-least-once: a crash after Gmail accepts a message but before the database records completion can cause a repeated email. Stable Message-ID values help recipients identify duplicates; points, decisions, and check-in consumption remain idempotent. Cancelled requests and obsolete approval messages are skipped. No account passwords, SMTP failures containing credentials, or service keys are exposed to clients.
