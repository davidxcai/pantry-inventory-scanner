import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ points: vi.fn(), actions: vi.fn() }))
vi.mock('../src/features/points/useVisitRewards', () => ({ useVisitActions: mock.actions }))
vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
vi.mock('../src/features/auth/useSession', () => ({
  useSession: () => ({ user: { id: 'alice', user_metadata: { display_name: 'Student' } } }),
  displayNameOf: () => 'Student',
}))
vi.mock('@tanstack/react-router', () => ({ Link: ({ to, children }: { to: string; children: ReactNode }) => createElement('a', { href: to }, children) }))
vi.mock('../src/features/points/usePoints', async (original) => ({ ...await original<typeof import('../src/features/points/usePoints')>(), usePoints: mock.points }))
import { PointsScreen } from '../src/features/points/PointsScreen'
import { PointsHint } from '../src/features/points/PointsHint'

function state(balance: number) {
  return { data: { balance, earned: balance, reward_threshold: 100, recent_updates: [], reserved: 0, spent: 0, requests: [], current_reward: null, redemption_enabled: false, is_approver: false }, isPending: false, isFetching: false, error: null, refetch: vi.fn() }
}
beforeEach(() => { mock.points.mockReturnValue(state(0)); mock.actions.mockReturnValue({ isPending: false, error: null, mutate: vi.fn() }) })
it('shows the starting balance and explains how qualifying inventory updates earn points', () => {
  const html = renderToStaticMarkup(createElement(PointsScreen))
  expect(html).toContain('Your available points')
  expect(html).toContain('100 points')
  expect(html).toContain('1 point per distinct product')
  expect(html).toContain('No points yet')
})
it('retains a 100-point balance and offers approval by email', () => {
  mock.points.mockReturnValue(state(100))
  const html = renderToStaticMarkup(createElement(PointsScreen))
  expect(html).toContain('>100</p>')
  expect(html).toContain('Next milestone: 200 points')
  expect(html).not.toContain('Visit rewards are not enabled yet')
  expect(html).toContain('Every extra visit requires approval')
  expect(html).toContain('mailto:salmanfarse2025@gmail.com')
  expect(html).toContain('does not book an appointment')
})
it('does not invent a zero balance when the server feature is not installed', () => {
  mock.points.mockReturnValue({ ...state(0), data: undefined, error: { code: 'PGRST202' } })
  const html = renderToStaticMarkup(createElement(PointsScreen))
  expect(html).toContain('Points are not enabled')
  expect(html).not.toContain('Your available points')
})
it('shows account activity and earned points without introducing a booking action', () => {
  mock.points.mockReturnValue({ ...state(1), data: { ...state(1).data, recent_updates: [{ id: 'award', item_name: 'Penne', created_at: '2026-10-27T17:00:00+00:00' }] } })
  const html = renderToStaticMarkup(createElement(PointsScreen))
  expect(html).toContain('Penne')
  expect(html).toContain('+1 point')
  expect(html).not.toContain('app.pantrysoft.com')
})
it('links the upload and queue hint to the real account balance', () => {
  mock.points.mockReturnValue(state(32))
  const html = renderToStaticMarkup(createElement(PointsHint))
  expect(html).toContain('href="/points"')
  expect(html).toContain('32 points')
})
it('does not promise points on uploads before earning is enabled', () => {
  mock.points.mockReturnValue({ ...state(0), data: undefined, error: { code: 'PGRST202' } })
  const html = renderToStaticMarkup(createElement(PointsHint))
  expect(html).toContain('Points are waiting to be enabled')
  expect(html).not.toContain('Earn 1 point')
})

it('shows the recovered device balance with clear storage and redemption limits', () => {
  mock.points.mockReturnValue({...state(2),data:{...state(2).data,device_only:true,sync_warning:null}})
  const html = renderToStaticMarkup(createElement(PointsScreen))
  expect(html).toContain('>2</p>')
  expect(html).toContain('saved for your account on this device')
  expect(html).toContain('cannot be spent on extra visits')
  expect(html).toContain('rolling seven-day period')
})

it('renders recent points as a collapsed native disclosure', () => {
  const html = renderToStaticMarkup(createElement(PointsScreen))
  expect(html).toMatch(/<details[^>]*><summary[^>]*>Recent points/)
  expect(html).not.toMatch(/<details[^>]*\sopen(?:=|>)/)
})
