import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import type { PointsSummary } from '../../../shared/inventoryPoints'
import { APPOINTMENT_INSTRUCTIONS, manualVisitRequestMailto, rewardDate, rewardStatus } from '../../../shared/visitRewards'
import { useVisitActions } from './useVisitRewards'

export function VisitRewards({ data, userId, stale, studentName = '', studentEmail = '' }: { data: PointsSummary; userId?: string; stale: boolean; studentName?: string; studentEmail?: string }) {
  const action = useVisitActions(userId)
  const [confirming, setConfirming] = useState(false)
  const active = data.current_reward
  const blocked = stale || action.isPending || !userId
  const manualRequest = data.device_only || !data.redemption_enabled
  const emailHref = manualVisitRequestMailto({ userId: userId ?? '', name: studentName, email: studentEmail, points: data.balance, deviceOnly: data.device_only })
  return <section className="flex flex-col gap-3 rounded-box bg-base-200 p-4" aria-labelledby="visit-rewards">
    <h2 id="visit-rewards" className="text-lg font-semibold">Extra-visit rewards</h2>
    <p className="text-sm">Reach 100 points to request an extra visit. Every extra visit requires approval.</p>
    {active?.status === 'pending' && <div className="flex flex-col gap-2">
      <p role="status">Pending approval · 100 points reserved</p>
      <button className="btn btn-outline btn-sm" disabled={blocked} onClick={() => action.mutate({ type: 'cancel', id: active.id })}>Cancel request and release points</button>
    </div>}
    {active?.status === 'approved' && <div role="status" className="flex flex-col gap-2">
      <p className="font-medium">One extra check-in approved</p>
      <p className="text-sm">{APPOINTMENT_INSTRUCTIONS}</p>
      <p className="text-sm">Expires {rewardDate(active.expires_at!)} (America/Chicago). Unused rewards refund automatically. Scan the pantry QR when you arrive. Your normal monthly visit is used first.</p>
    </div>}
    {!active && manualRequest && <>
      {blocked || data.balance < 100
        ? <button className="btn btn-primary btn-sm" disabled>Request an extra visit · 100 points</button>
        : <a className="btn btn-primary btn-sm" href={emailHref}>Request an extra visit · 100 points</a>}
      <p className="text-xs opacity-70">{data.balance < 100 ? `${100 - data.balance} more points to request review.` : 'Opens an email draft. Send it to request approval before visiting.'}</p>
    </>}
    {!active && !manualRequest && !confirming && <button className="btn btn-primary btn-sm" disabled={blocked || data.balance < 100} onClick={() => setConfirming(true)}>Request an extra visit · 100 points</button>}
    {!active && !manualRequest && confirming && <div className="flex flex-col gap-2 rounded-box border border-base-300 p-3">
      <p>Reserve 100 points and email a request for review?</p>
      <p className="text-sm">Approval spends your points. Rejection or cancellation releases them. Approved visits expire after 30 days; unused visits refund 100 points. Only one pending or unused reward is allowed at a time.</p>
      <button className="btn btn-primary btn-sm" disabled={blocked || data.balance < 100} onClick={() => action.mutate({ type: 'request' }, { onSuccess: () => setConfirming(false) })}>Confirm request</button>
      <button className="btn btn-ghost btn-sm" disabled={action.isPending} onClick={() => setConfirming(false)}>Go back</button>
    </div>}
    {action.isPending && <p role="status">Saving request…</p>}
    {action.error && <p role="alert" className="text-error">{action.error.message} Refresh the status before trying again.</p>}
    {data.is_approver && <Link to="/visit-review" className="btn btn-outline btn-sm">Review visit requests</Link>}
    {data.requests.length > 0 && <>
    <h3 className="font-medium">Request history</h3>
    <ul className="flex flex-col gap-2">{data.requests.map(request => <li key={request.id} className="rounded-box border border-base-300 p-3 text-sm">
      <p className="font-medium capitalize">{rewardStatus(request)}</p><p>{rewardDate(request.created_at)} · 100 points</p>
      <p className="break-all text-xs opacity-60">Request {request.id}</p>
      {request.decision_note && <p>Reviewer note: {request.decision_note}</p>}
      {request.decided_at && <p>Reviewed {rewardDate(request.decided_at)}</p>}
      {request.status === 'expired' && <p>100 points returned.</p>}
      {request.used_at && <p>Checked in {rewardDate(request.used_at)}</p>}
    </li>)}</ul>
    </>}
  </section>
}
