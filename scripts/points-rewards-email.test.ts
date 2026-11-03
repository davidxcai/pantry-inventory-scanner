import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { VisitRequest } from '../shared/visitRewards'
import { buildRewardEmail, rewardMailConfig } from '../api/_lib/rewardEmail'
import { runRewardWorker } from '../api/_lib/rewardWorker'
import handler from '../api/visit-rewards-worker'
const request: VisitRequest = {
  id: '10000000-0000-4000-8000-000000000001', user_id: '00000000-0000-4000-8000-000000000001', cost: 100, status: 'pending',
  created_at: '2026-11-02T18:00:00Z', decided_at: null, decided_by: null, decision_note: null, expires_at: null, used_at: null,
}
beforeEach(() => { vi.stubEnv('VISIT_REVIEW_EMAIL', 'salmanfarse2025@gmail.com'); vi.stubEnv('VISIT_APPOINTMENT_INSTRUCTIONS', '') })
afterEach(() => vi.unstubAllEnvs())
it('addresses review emails with student Reply-To and a non-mutating review link', () => {
  const email = buildRewardEmail('pending', request, { email: 'student@mavs.uta.edu', name: 'Test Student' }, 'https://pantry.example')
  expect(email.to).toBe('salmanfarse2025@gmail.com')
  expect(email.replyTo).toBe('student@mavs.uta.edu')
  expect(email.text).toContain(`https://pantry.example/visit-review?request=${request.id}`)
  expect(email.text).toContain('does not approve')
  expect(email.text).toContain('100 points have been reserved')
})
it('includes expiry, manual instructions, and reviewer notes in decision messages', () => {
  const email = buildRewardEmail('approved', { ...request, status: 'approved', expires_at: '2099-12-02T18:00:00Z', decision_note: 'Call before visiting' }, { email: 'student@mavs.uta.edu', name: 'Student' }, 'https://pantry.example')
  expect(email.to).toBe('student@mavs.uta.edu')
  expect(email.replyTo).toBe('salmanfarse2025@gmail.com')
  expect(email.text).toContain('Reply to the approval email')
  expect(email.text).toContain('100 points were spent')
  expect(email.text).toContain('Call before visiting')
  expect(email.text).toContain('does not book an appointment')
})
it('validates sender configuration before attempting delivery', () => {
  vi.stubEnv('SMTP_USER', ''); vi.stubEnv('SMTP_PASS', ''); vi.stubEnv('APP_URL', '')
  expect(() => rewardMailConfig()).toThrow('Configure')
  vi.stubEnv('SMTP_USER', 'sender@gmail.com'); vi.stubEnv('SMTP_PASS', 'private'); vi.stubEnv('APP_URL', 'http://pantry.example')
  expect(() => rewardMailConfig()).toThrow('HTTPS')
  vi.stubEnv('APP_URL', 'https://pantry.example/path')
  expect(rewardMailConfig().origin).toBe('https://pantry.example')
})
function workerDb(status: VisitRequest['status'] = 'pending', kind = 'pending', confirmed = true) {
  let claimed = false
  const rpc = vi.fn(async (name: string) => {
    if (name === 'claim_visit_reward_mail' && !claimed) {
      claimed = true
      return { data: [{ id: 'mail-id', lease_token: 'lease', request_id: request.id, kind }], error: null }
    }
    return { data: [], error: null }
  })
  const single = vi.fn(async () => ({ data: { ...request, status, expires_at: status === 'approved' ? '2099-12-02T18:00:00Z' : null }, error: null }))
  const getUserById = vi.fn(async () => ({ data: { user: { email: 'student@mavs.uta.edu', email_confirmed_at: confirmed ? request.created_at : null, user_metadata: {} } }, error: null }))
  return { rpc, from: () => ({ select: () => ({ eq: () => ({ single }) }) }), auth: { admin: { getUserById } } }
}
it('records delivery failures for retry without changing request or point state', async () => {
  const db = workerDb()
  const send = vi.fn(async () => { throw new Error('SMTP unavailable') })
  expect(await runRewardWorker(db as unknown as SupabaseClient, () => ({ origin: 'https://pantry.example', send }))).toEqual({ sent: 0, failed: 1, skipped: 0 })
  expect(db.rpc).toHaveBeenCalledWith('finish_visit_reward_mail', expect.objectContaining({ p_id: 'mail-id', p_token: 'lease', p_error: expect.any(String) }))
  expect(db.rpc).not.toHaveBeenCalledWith('request_extra_visit', expect.anything())
})
it('sends once per claimed message and marks completion with the lease token', async () => {
  const db = workerDb()
  const send = vi.fn(async () => {})
  expect(await runRewardWorker(db as unknown as SupabaseClient, () => ({ origin: 'https://pantry.example', send }))).toEqual({ sent: 1, failed: 0, skipped: 0 })
  expect(send).toHaveBeenCalledTimes(1)
  expect(db.rpc).toHaveBeenCalledWith('finish_visit_reward_mail', { p_id: 'mail-id', p_token: 'lease', p_error: null })
})
it('skips stale request emails and refuses unverified student recipients', async () => {
  const send = vi.fn(async () => {})
  const sender = () => ({ origin: 'https://pantry.example', send })
  expect(await runRewardWorker(workerDb('cancelled') as unknown as SupabaseClient, sender)).toMatchObject({ skipped: 1 })
  expect(await runRewardWorker(workerDb('pending', 'pending', false) as unknown as SupabaseClient, sender)).toMatchObject({ failed: 1 })
  expect(send).not.toHaveBeenCalled()
})
it('rejects missing or invalid worker credentials before accessing the database', async () => {
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() }
  vi.stubEnv('CRON_SECRET', '')
  await handler({ method: 'GET', headers: {} } as VercelRequest, res as unknown as VercelResponse)
  expect(res.status).toHaveBeenCalledWith(401)
  vi.stubEnv('CRON_SECRET', 'expected')
  await handler({ method: 'POST', headers: { authorization: 'Bearer wrong' } } as VercelRequest, res as unknown as VercelResponse)
  expect(res.status).toHaveBeenLastCalledWith(401)
})
