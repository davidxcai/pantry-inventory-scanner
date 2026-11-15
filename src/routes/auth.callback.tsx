import { createFileRoute } from '@tanstack/react-router'
import { safeAuthRedirect } from '../../shared/authRedirect'
import { AuthCallbackScreen } from '../features/auth/AuthCallbackScreen'

export const Route = createFileRoute('/auth/callback')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({ redirect: safeAuthRedirect(search.redirect) }),
  component: AuthCallbackScreen,
})
