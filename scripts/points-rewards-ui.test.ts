import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { PointsSummary } from '../shared/inventoryPoints'
import type { VisitRequest } from '../shared/visitRewards'

const mock = vi.hoisted(() => ({ actions: vi.fn(), reviews: vi.fn(), session: vi.fn() }))
vi.mock('../src/features/points/useVisitRewards', () => ({ useVisitActions: mock.actions, useVisitReviews: mock.reviews }))
vi.mock('../src/features/auth/useSession', () => ({ useSession: mock.session }))
vi.mock('@tanstack/react-router', () => ({ Link: ({ to, search, children }: { to: string; search?: { redirect?: string }; children: ReactNode }) => createElement('a', { href: to + (search?.redirect ? `?redirect=${encodeURIComponent(search.redirect)}` : '') }, children) }))
import { VisitRewards } from '../src/features/points/VisitRewards'
import { VisitReviewScreen } from '../src/features/points/VisitReviewScreen'
const request: VisitRequest = {
  id: '10000000-0000-4000-8000-000000000001', user_id: '00000000-0000-4000-8000-000000000001', cost: 100, status: 'pending',
  created_at: '2026-11-02T18:00:00Z', decided_at: null, decided_by: null, decision_note: null, expires_at: null, used_at: null,
  student_name: 'Test Student', student_email: 'student@mavs.uta.edu',
}
const data: PointsSummary = { device_only: false, sync_warning: null, balance: 100, earned: 100, reserved: 0, spent: 0, reward_threshold: 100, recent_updates: [], requests: [], current_reward: null, redemption_enabled: true, is_approver: false }
const render = (overrides: Partial<PointsSummary> = {}, stale = false) => renderToStaticMarkup(createElement(VisitRewards, { userId: request.user_id, data: { ...data, ...overrides }, stale }))
beforeEach(() => {
  vi.clearAllMocks()
  mock.actions.mockReturnValue({ isPending: false, error: null, mutate: vi.fn() })
  mock.reviews.mockReturnValue({ data: [request], isPending: false, isFetching: false, error: null, refetch: vi.fn() })
  mock.session.mockReturnValue({ user: { id: request.user_id } })
})
it('enables shared requests at 100 available points and blocks low or stale balances', () => {
  expect(render()).toMatch(/<button[^>]*>Request an extra visit · 100 points<\/button>/)
  expect(render()).not.toMatch(/<button[^>]*disabled/)
  for (const html of [render({ balance: 99 }), render({}, true)]) {
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Request an extra visit · 100 points<\/button>/)
  }
})
it('shows reserved points and cancellation while pending and prevents another request', () => {
  const html = render({ balance: 0, reserved: 100, current_reward: request, requests: [request] })
  expect(html).toContain('Pending approval')
  expect(html).toContain('Cancel request and release points')
  expect(html).not.toContain('Request an extra visit · 100 points')
})
it('shows approved validity, manual coordination, and expiry refunds without cancellation', () => {
  const approved = { ...request, status: 'approved' as const, expires_at: '2099-12-02T18:00:00Z' }
  const html = render({ balance: 0, spent: 100, current_reward: approved, requests: [approved] })
  expect(html).toContain('One extra check-in approved')
  expect(html).toContain('Reply to the approval email')
  expect(html).toContain('Unused rewards refund automatically')
  expect(html).not.toContain('Cancel request')
})
it('shows rejection, refund, usage and escaped reviewer notes in history', () => {
  const html = render({ requests: [
    { ...request, status: 'rejected', decision_note: '<script>bad</script>' },
    { ...request, id: '10000000-0000-4000-8000-000000000002', status: 'expired' },
    { ...request, id: '10000000-0000-4000-8000-000000000003', status: 'used', used_at: '2026-11-03T18:00:00Z' },
  ] })
  expect(html).toContain('100 points returned')
  expect(html).toContain('Checked in')
  expect(html).toContain('&lt;script&gt;')
  expect(html).not.toContain('<script>')
})
it('preserves the review link through login and never decides on page load', () => {
  mock.session.mockReturnValue(null)
  const html = renderToStaticMarkup(createElement(VisitReviewScreen, { requestId: request.id }))
  expect(html).toContain(encodeURIComponent(`/visit-review?request=${request.id}`))
  expect(html).toContain('Sign in with your approver account')
  expect(mock.actions).not.toHaveBeenCalled()
})
it('shows review actions only for pending results and hides cached results on authorization error', () => {
  const html = renderToStaticMarkup(createElement(VisitReviewScreen, { requestId: request.id }))
  expect(html).toContain('student@mavs.uta.edu')
  expect(html).toContain('Optional note to student')
  expect(html).toContain('>Approve</button>')
  expect(mock.actions().mutate).not.toHaveBeenCalled()
  mock.reviews.mockReturnValue({ data: [request], error: new Error('Approver access required') })
  const denied = renderToStaticMarkup(createElement(VisitReviewScreen, {}))
  expect(denied).toContain('Approver access required')
  expect(denied).not.toContain('student@mavs.uta.edu')
  expect(denied).not.toContain('>Approve</button>')
})

it('offers a real email draft for eligible device points without spending or creating an approval', () => {
  const html = render({device_only:true,redemption_enabled:true,balance:100})
  expect(html).toContain('mailto:salmanfarse2025@gmail.com')
  expect(html).toContain('Opens an email draft')
  expect(html).toContain('Every extra visit requires approval')
  expect(mock.actions().mutate).not.toHaveBeenCalled()
})
it('offers manual email review when shared requests are unavailable', () => {
  expect(render({redemption_enabled:false,balance:100})).toContain('mailto:salmanfarse2025@gmail.com')
  expect(render({device_only:true,balance:99})).not.toContain('mailto:')
  expect(render({device_only:true,balance:100},true)).not.toContain('mailto:')
})
