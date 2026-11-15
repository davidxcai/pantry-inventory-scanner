import { createFileRoute } from '@tanstack/react-router'
import { AuthScreen } from '../features/auth/AuthScreen'
import { safeAuthRedirect } from '../../shared/authRedirect'

export const Route = createFileRoute('/login')({
  // Where to go after signing in. Same-site paths only.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: safeAuthRedirect(search.redirect),
  }),
  component: AuthScreen,
})
