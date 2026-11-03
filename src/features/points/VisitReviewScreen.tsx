import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { rewardDate, rewardStatus, type VisitRequest } from '../../../shared/visitRewards'
import { useSession } from '../auth/useSession'
import { useVisitActions, useVisitReviews } from './useVisitRewards'

function ReviewCard({ request, userId }: { request: VisitRequest; userId: string }) {
  const action = useVisitActions(userId)
  const [note, setNote] = useState('')
  const [decision, setDecision] = useState<'approved' | 'rejected' | null>(null)
  return <article className="flex flex-col gap-3 rounded-box border border-base-300 p-4">
    <h2 className="text-lg font-medium break-words">{request.student_name}</h2>
    <p className="break-words">{request.student_email}</p>
    <p className="text-sm break-all">Request {request.id}</p>
    <p className="text-sm">Submitted {rewardDate(request.created_at)} · 100 points</p>
    <p className="font-medium capitalize">{rewardStatus(request)}</p>
    {request.decision_note && <p>Reviewer note: {request.decision_note}</p>}
    {request.expires_at && <p>Expires {rewardDate(request.expires_at)} (America/Chicago)</p>}
    {request.status === 'pending' && <>
      <label className="flex flex-col gap-1">Optional note to student<textarea className="textarea w-full" value={note} maxLength={2000} disabled={action.isPending} onChange={e => setNote(e.target.value)} /></label>
      {!decision ? <div className="flex gap-2">
        <button className="btn btn-primary" onClick={() => setDecision('approved')}>Approve</button>
        <button className="btn btn-outline" onClick={() => setDecision('rejected')}>Reject</button>
      </div> : <div className="flex flex-col gap-2">
        <p>{decision === 'approved' ? 'Spend 100 points and grant one extra check-in valid for 30 days? Coordinate the actual appointment manually.' : 'Reject this request and release the 100 reserved points?'}</p>
        <button className="btn btn-primary" disabled={action.isPending} onClick={() => action.mutate({ type: 'review', id: request.id, decision, note }, { onSuccess: () => setDecision(null) })}>Confirm {decision === 'approved' ? 'approval' : 'rejection'}</button>
        <button className="btn btn-ghost" disabled={action.isPending} onClick={() => setDecision(null)}>Go back</button>
      </div>}
    </>}
    {action.isPending && <p role="status">Saving decision…</p>}
    {action.error && <p role="alert" className="text-error">{action.error.message}</p>}
  </article>
}
export function VisitReviewScreen({ requestId }: { requestId?: string }) {
  const session = useSession()
  const reviews = useVisitReviews(session?.user.id, requestId)
  const redirect = `/visit-review${requestId ? `?request=${encodeURIComponent(requestId)}` : ''}`
  return <main className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
    <h1 className="text-2xl font-semibold">Review extra-visit requests</h1>
    <p className="text-sm">Only designated approvers can review requests. Opening this page does not make a decision.</p>
    {session === undefined && <p role="status">Loading session…</p>}
    {session === null && <Link to="/login" search={{ redirect }} className="btn btn-primary">Sign in with your approver account</Link>}
    {session && <>
      <button className="btn btn-outline btn-sm" disabled={reviews.isFetching} onClick={() => void reviews.refetch()}>Refresh requests</button>
      {reviews.isPending && <p role="status">Loading requests…</p>}
      {reviews.error && <p role="alert" className="text-error">{reviews.error.message}</p>}
      {!reviews.error && reviews.data?.length === 0 && <p>No requests found.</p>}
      {!reviews.error && reviews.data?.map(request => <ReviewCard key={request.id} request={request} userId={session.user.id} />)}
      <Link to="/points" className="btn btn-ghost">Back to points</Link>
    </>}
  </main>
}
