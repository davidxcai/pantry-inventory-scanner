import type { SupabaseClient } from '@supabase/supabase-js'
import { VisitRequestSchema } from '../../shared/visitRewards.js'
import { buildRewardEmail, createRewardSender } from './rewardEmail.js'

// At-least-once SMTP delivery: stable Message-ID helps duplicates after a crash,
// but SMTP has no transactional/exactly-once guarantee. Request/points remain idempotent.
export async function runRewardWorker(admin: SupabaseClient, makeSender = createRewardSender) {
  const { error: expiryError } = await admin.rpc('expire_visit_rewards')
  if (expiryError) throw expiryError
  const sender = makeSender() // Validate configuration before claiming mail.
  const started = Date.now()
  const outcomes = { sent: 0, skipped: 0, failed: 0 }
  for (let index = 0; index < 20 && Date.now() - started < 45_000; index++) {
    const { data, error } = await admin.rpc('claim_visit_reward_mail')
    if (error) throw error
    const mail = data?.[0]
    if (!mail) break
    let failure: string | null = null
    try {
      const result = await admin.from('visit_reward_requests').select('*').eq('id', mail.request_id).single()
      if (result.error) throw result.error
      const request = VisitRequestSchema.parse(result.data)
      // Do not send stale requests/approvals after cancellation, expiry or use.
      if ((mail.kind === 'pending' && request.status !== 'pending') || (mail.kind === 'approved' && (request.status !== 'approved' || new Date(request.expires_at!).getTime() <= Date.now()))) {
        outcomes.skipped++
      } else {
        const { data: account, error: accountError } = await admin.auth.admin.getUserById(request.user_id)
        if (accountError || !account.user?.email || !account.user.email_confirmed_at) throw new Error('Verified student email unavailable')
        await sender.send(mail.id, buildRewardEmail(mail.kind, request, {
          email: account.user.email, name: account.user.user_metadata?.display_name || account.user.email,
        }, sender.origin))
        outcomes.sent++
      }
    } catch {
      failure = 'Email delivery failed; verify sender configuration and recipient, then retry.'
      outcomes.failed++
    }
    const { error: finishError } = await admin.rpc('finish_visit_reward_mail', { p_id: mail.id, p_token: mail.lease_token, p_error: failure })
    if (finishError) throw finishError
  }
  return outcomes
}
