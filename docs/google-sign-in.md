# Google sign-in

The login and registration views offer **Continue with Google** alongside email/password login. Supabase handles Google OAuth and stores the session in the existing browser client. The `/auth/callback` screen waits for that session, verifies the authenticated account with Supabase, and returns to the requested app page. Redirect destinations must be local paths. Cancelling or failing sign-in shows a retry link without exposing tokens.

Allowed account domains are `uta.edu`, `mavs.uta.edu`, and `gmail.com`. The callback requires a server-confirmed email. Google only receives requests for `openid`, `email`, and `profile`; no Gmail inbox, YouTube, or offline-access scopes are requested. Existing users retain their accounts, and Google profile names are supported. Visit-approval privileges remain independently allowlisted; ordinary Gmail registration does not grant approval access. Extra-visit eligibility retains its existing UTA-specific rules.

## Production configuration

The two public hosts currently use Supabase project `xgwddaziykgexcoajvrj`:

- `https://utapantry.xyz`
- `https://pantry-inventory-scanner.vercel.app`

In Google Cloud project `uta-pantry`, create a Web application OAuth client named **Thyme Saver Pantry Web**. Set the two site origins above as authorized JavaScript origins. The authorized redirect URI is the Supabase server callback, **not** the website callback:

```
https://xgwddaziykgexcoajvrj.supabase.co/auth/v1/callback
```

Enable the Google provider in that Supabase project using the client ID and client secret. Keep the client secret in Supabase provider settings; never put it in Vite environment variables or source control. Leave nonce checking and verified-email checks enabled.

In Supabase Auth URL Configuration, retain the existing password-reset/confirmation redirect entries and add these exact callback URLs:

```
https://utapantry.xyz/auth/callback
https://pantry-inventory-scanner.vercel.app/auth/callback
http://localhost:5173/auth/callback
http://127.0.0.1:5173/auth/callback
```

Callback URLs with the optional `redirect` query must also match the project's redirect allowlist. The existing `https://utapantry.xyz/**` entry covers that host; configure the equivalent existing production Vercel origin allowlist if query-specific callback destinations are needed. Keep production wildcards limited to the named app hosts, not arbitrary Vercel deployments.

Apply `supabase/migrations/20261115010000_google_login.sql` after the existing auth/profile migrations. This permits the approved UTA/Gmail account domains at database signup and updates the existing RLS helper to require a confirmed email from `auth.users`. It does not depend on editable user metadata for authorization or create review privileges.

Deploy the source to the existing `davidxcai/pantry-inventory-scanner` repository, whose Vercel integration publishes the project in `davids-projects-0cdca2cb`. Do not create a second Vercel project or change domain ownership as a workaround for missing access.

## Verification

Run `npx vitest run scripts/google-auth*.test.ts scripts/points-approver-auth-ui.test.ts` and `node --import tsx --test shared/*.test.ts`, followed by `npm run build`.

On each production host, open `/login`, choose Continue with Google, select a permitted account, and verify that sign-in returns to the same website with a name in the navigation. Also check sign-in started from a protected page, a cancelled Google consent, an unsupported email domain, and ordinary email/password login. Google provider configuration and the database migration must be in place before live Google sign-in can succeed.

References: [Supabase Google sign-in](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Supabase redirect configuration](https://supabase.com/docs/guides/auth/redirect-urls).
