# Email and account verification

Status: **set up 2026-11-01.** Link mechanics are tested (below). Delivery to a real UTA inbox still needs a manual check.

## Problem
Registration was limited to `@uta.edu` / `@mavs.uta.edu`, but Supabase's "Confirm email" was off, so anyone could register a made-up UTA address and use it straight away. Turning it on needs a mailer that can reach students. Supabase's built-in mailer is rate-limited and only meant for testing, and the project had no domain to send from.

## Setup

### Domain
- `utapantry.xyz`, bought through Vercel (renews Nov 2027). Vercel nameservers. It is the production alias of the `pantry-inventory-scanner` project.

### Resend (Vercel Marketplace)
- Integration `resend-email-citron-book`, free plan (100 emails/day, 3,000/month), region `us-east-1`, connected to the project.
- Env vars it sets: `RESEND_API_KEY`, `RESEND_EMAIL_DOMAIN` (`utapantry.xyz`). Installing it ran `vercel env pull`, which overwrote `.env.local`; secrets that are not in Vercel live in `.env`.
- Installed with `vercel integration add resend/resend-email -m domain=utapantry.xyz -m region=us-east-1`. Do not re-run it: it would provision a second resource.

### DNS (all on Vercel)
| Record | Type | Added by | Purpose |
|---|---|---|---|
| `send` | CNAME | Resend | SPF / bounce handling |
| `rsend` | CNAME | Resend | Added by Resend with the domain; leave it in place |
| `resend._domainkey` | TXT | Resend | DKIM signing key |
| `_dmarc` | TXT `v=DMARC1; p=none;` | us | DMARC; Microsoft 365 (UTA mail) weighs it heavily |

`p=none` only reports, never blocks. Tighten to `p=quarantine` once mail has been arriving reliably for a few weeks.

### Supabase Auth (dashboard)
- **Emails → SMTP Settings**: custom SMTP on. Host `smtp.resend.com`, port `465`, user `resend`, password = the Resend API key, sender `no-reply@utapantry.xyz`, name `Thyme Saver`.
- **Sign In / Providers → Email**: Confirm email **on**.
- **URL Configuration**: Site URL `https://utapantry.xyz`. Redirect URLs `https://utapantry.xyz/**`, `http://localhost:5173/**`. A redirect not on the list silently falls back to the Site URL.
- **Rate Limits**: emails per hour left at the custom-SMTP default (30).
- Email templates are still Supabase's defaults. They can be reworded under **Emails → Templates**.

## Flows (`src/features/auth/AuthScreen.tsx`, `ResetPasswordScreen.tsx`)
- **Register**: `signUp` with `emailRedirectTo` = `<origin>/`. With confirmation on, it returns no session, and the screen says to check email (and junk). The link confirms the account, signs the user in and lands on the catalog.
- **Sign in before confirming**: Supabase returns `email_not_confirmed`. The screen explains it and shows **Resend confirmation email** (`auth.resend({ type: 'signup' })`).
- **Forgot password**: `resetPasswordForEmail` with `redirectTo` = `<origin>/reset-password`. The link opens a recovery session there and the user sets a new password (`updateUser`). An expired or used link shows "invalid or has expired" with a way to request a new one. If the requesting origin isn't an allowed redirect, Supabase sends the link to the Site URL instead. `src/main.tsx` listens for the `PASSWORD_RECOVERY` event at startup and moves the user to `/reset-password` from whichever page the link opened.
- `<origin>` is `window.location.origin`, so links from local dev return to localhost.

## Verified (2026-11-01)
Run against the live project with a throwaway account made with the admin key (`email_confirm: false`) and links from `auth.admin.generateLink`, so no email was sent to a non-existent address. The account was deleted afterwards.

| Check | Result |
|---|---|
| Unconfirmed account cannot sign in (`email_not_confirmed`) | pass |
| Confirmation link redirects to `https://utapantry.xyz/` with a session | pass |
| Account is confirmed after following it, and can sign in | pass |
| Reset link redirects to `/reset-password` with a recovery session | pass |
| Recovery session sets a new password; old password stops working | pass |
| `http://localhost:5173` is an allowed redirect | pass |

**Not yet verified**: that the emails actually arrive in a `@mavs.uta.edu` inbox and not junk. Test with **Forgot password?** on a real account and a fresh registration.

When testing, never register made-up addresses through the app. Each one sends a real email that bounces, and bounces hurt a new domain's sending reputation. Use the admin-key approach above.

## Things to know
- **Accounts from before 2026-11-01 were auto-confirmed** (8 at the time) and keep working. Review them in Authentication → Users if dummy accounts are a concern.
- **One shared email budget**: sign-up confirmations, password resets and stock notification digests (`notifications-plan.md`) all count toward Resend's 100/day. When it runs out, Supabase auth emails fail and notification digests wait for the next day.
- **Junk folder**: new domains have no reputation, so early mail to Microsoft 365 may land in junk. Every screen that sends mail says to check there. Ask early users to mark it "Not junk".
- **Rotating the Resend key** means updating it in two places: Vercel (via the integration) and Supabase's SMTP password.
