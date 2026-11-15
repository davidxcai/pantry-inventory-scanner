import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ signInWithOAuth: vi.fn(), initialize: vi.fn(), getUser: vi.fn(), signOut: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: { auth } }))
import { completeGoogleSignIn, startGoogleSignIn } from '../src/features/auth/googleAuth'
import { safeAuthRedirect } from '../shared/authRedirect'

beforeEach(() => {
  vi.clearAllMocks()
  auth.signInWithOAuth.mockResolvedValue({ data: {}, error: null })
  auth.initialize.mockResolvedValue({ error: null })
  auth.getUser.mockResolvedValue({ data: { user: { email: 'student@gmail.com', email_confirmed_at: '2026-11-15T12:00:00Z' } }, error: null })
  auth.signOut.mockResolvedValue({ error: null })
})
afterEach(() => vi.unstubAllEnvs())
it.each(['https://utapantry.xyz', 'https://pantry-inventory-scanner.vercel.app', 'http://localhost:5173'])(
  'uses the same-origin callback on %s and requests only basic sign-in scopes', async (origin) => {
    await startGoogleSignIn(origin, '/profile?list=wishlist')
    const request = auth.signInWithOAuth.mock.calls[0][0]
    expect(request.provider).toBe('google')
    expect(request.options.scopes).toBe('openid email profile')
    const callback = new URL(request.options.redirectTo)
    expect(callback.origin).toBe(origin)
    expect(callback.pathname).toBe('/auth/callback')
    expect(callback.searchParams.get('redirect')).toBe('/profile?list=wishlist')
  },
)
it.each(['https://evil.test', '//evil.test', '/\\evil.test', '/\nevil.test', '/%5cevil.test'])(
  'rejects unsafe post-login redirects: %s', async (redirect) => {
    expect(safeAuthRedirect(redirect)).toBeUndefined()
    await startGoogleSignIn('https://utapantry.xyz', redirect)
    expect(new URL(auth.signInWithOAuth.mock.calls[0][0].options.redirectTo).search).toBe('')
    expect(await completeGoogleSignIn(redirect)).toBe('/')
  },
)
it.each(['person@gmail.com', 'person@uta.edu', 'person@mavs.uta.edu'])(
  'finishes sign-in for %s and restores the intended page', async (email) => {
    auth.getUser.mockResolvedValue({ data: { user: { email, email_confirmed_at: '2026-11-15T12:00:00Z' } }, error: null })
    expect(await completeGoogleSignIn('/profile?list=wishlist')).toBe('/profile?list=wishlist')
    expect(auth.signOut).not.toHaveBeenCalled()
  },
)
it('preserves designated reviewer routing without granting it to other Gmail users', async () => {
  auth.getUser.mockResolvedValue({ data: { user: { email: 'salmanfarse2025@gmail.com', email_confirmed_at: '2026-11-15T12:00:00Z' } }, error: null })
  expect(await completeGoogleSignIn()).toBe('/visit-review')
  auth.getUser.mockResolvedValue({ data: { user: { email: 'someone@gmail.com', email_confirmed_at: '2026-11-15T12:00:00Z' } }, error: null })
  expect(await completeGoogleSignIn()).toBe('/')
})
it('reports cancelled or failed callbacks without treating an old session as successful login', async () => {
  auth.initialize.mockResolvedValue({ error: { message: 'Access denied' } })
  await expect(completeGoogleSignIn()).rejects.toThrow('did not finish')
  expect(auth.getUser).not.toHaveBeenCalled()
})
it('rejects unsupported account domains and signs out only the local session', async () => {
  auth.getUser.mockResolvedValue({ data: { user: { email: 'person@other.test', email_confirmed_at: '2026-11-15T12:00:00Z' } }, error: null })
  await expect(completeGoogleSignIn()).rejects.toThrow('@gmail.com')
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
})
it('shows a retryable error when Google sign-in cannot start', async () => {
  auth.signInWithOAuth.mockResolvedValue({ error: { message: 'Offline' } })
  await expect(startGoogleSignIn('https://utapantry.xyz')).rejects.toThrow('Could not start')
})

it('requires a verified email before completing the Google callback', async () => {
  auth.getUser.mockResolvedValue({ data: { user: { email: 'person@gmail.com', email_confirmed_at: null } }, error: null })
  await expect(completeGoogleSignIn()).rejects.toThrow('Verify your email')
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
})
