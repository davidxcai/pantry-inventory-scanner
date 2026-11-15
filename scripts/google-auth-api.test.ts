import { beforeEach, expect, it, vi } from 'vitest'
import type { VercelRequest } from '@vercel/node'
const mock = vi.hoisted(() => ({ getUser: vi.fn() }))
vi.mock('../api/_lib/clients', () => ({ admin: { auth: { getUser: mock.getUser } } }))
import { utaUser } from '../api/_lib/auth'
const request = { headers: { authorization: 'Bearer test-session' } } as VercelRequest
beforeEach(() => vi.clearAllMocks())
it.each(['person@gmail.com', 'person@uta.edu', 'person@mavs.uta.edu'])(
  'allows a verified %s account through the API', async (email) => {
    mock.getUser.mockResolvedValue({ data: { user: { id: 'person', email, email_confirmed_at: '2026-11-15T12:00:00Z' } } })
    expect(await utaUser(request)).toEqual({ id: 'person' })
  },
)
it.each(['person@gmail.com.evil.test', 'person@other.test'])(
  'denies unsupported account domains: %s', async (email) => {
    mock.getUser.mockResolvedValue({ data: { user: { id: 'person', email, email_confirmed_at: '2026-11-15T12:00:00Z' } } })
    expect(await utaUser(request)).toMatchObject({ status: 403 })
  },
)
it('denies unverified accounts and anonymous requests', async () => {
  mock.getUser.mockResolvedValue({ data: { user: { id: 'person', email: 'person@gmail.com', email_confirmed_at: null } } })
  expect(await utaUser(request)).toMatchObject({ status: 403 })
  expect(await utaUser({ headers: {} } as VercelRequest)).toMatchObject({ status: 401 })
})
