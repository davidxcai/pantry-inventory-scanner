import { createFileRoute } from '@tanstack/react-router'
import { AuthScreen } from '../features/auth/AuthScreen'

export const Route = createFileRoute('/login')({
  // Where to go after signing in. Same-site paths only.
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === 'string' && /^\/(?![/\\])/.test(search.redirect) ? search.redirect : undefined,
  }),
  component: AuthScreen,
})
