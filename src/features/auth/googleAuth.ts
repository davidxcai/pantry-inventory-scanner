import { safeAuthRedirect } from '../../../shared/authRedirect'
import { canRegisterAccount, isDesignatedVisitApproverEmail, REGISTRATION_EMAIL_MESSAGE } from '../../../shared/visitApprover'
import { supabase } from '../../lib/supabase'

export async function startGoogleSignIn(origin: string, redirect?: string) {
  const callback = new URL('/auth/callback', origin)
  const destination = safeAuthRedirect(redirect)
  if (destination) callback.searchParams.set('redirect', destination)
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: callback.href,
      scopes: 'openid email profile',
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) throw new Error('Could not start Google sign-in. Please try again.')
}

export async function completeGoogleSignIn(redirect?: string) {
  // The existing browser client consumes the callback and saves the session.
  const initialized = await supabase.auth.initialize()
  if (initialized.error) throw new Error('Google sign-in did not finish. Please try again or use email and password.')
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) throw new Error('Google sign-in did not finish. Please try again.')
  if (!data.user.email_confirmed_at) {
    await supabase.auth.signOut({ scope: 'local' })
    throw new Error('Verify your email address before signing in.')
  }
  if (!canRegisterAccount(data.user.email ?? '')) {
    await supabase.auth.signOut({ scope: 'local' })
    throw new Error(REGISTRATION_EMAIL_MESSAGE)
  }
  return safeAuthRedirect(redirect) ?? (isDesignatedVisitApproverEmail(data.user.email) ? '/visit-review' : '/')
}
