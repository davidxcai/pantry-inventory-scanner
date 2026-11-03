import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ session: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/features/auth/useSession', () => ({ useSession: mock.session, displayNameOf: () => 'Reviewer' }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => createElement('a', { href: to }, children),
  useNavigate: () => vi.fn(), useSearch: () => ({}),
}))
import { Navbar } from '../src/features/auth/Navbar'
import { AuthScreen } from '../src/features/auth/AuthScreen'
beforeEach(() => mock.session.mockReturnValue({ user: { email: 'salmanfarse2025@gmail.com' } }))
it('offers review navigation on desktop and mobile for the designated Gmail reviewer', () => {
  const html = renderToStaticMarkup(createElement(Navbar))
  expect(html.match(/href="\/visit-review"/g)).toHaveLength(2)
  expect(html).not.toContain('href="/points"')
  expect(html).not.toContain('href="/queue"')
})
it('keeps normal student navigation', () => {
  mock.session.mockReturnValue({ user: { email: 'student@mavs.uta.edu' } })
  const html = renderToStaticMarkup(createElement(Navbar))
  expect(html).toContain('href="/points"')
  expect(html).toContain('href="/queue"')
  expect(html).not.toContain('href="/visit-review"')
})
it('labels login as Email and explains the designated Gmail exception', () => {
  const html = renderToStaticMarkup(createElement(AuthScreen))
  expect(html).toContain('>Email</span>')
  expect(html).toContain('approved Gmail account')
})
