import { Link } from '@tanstack/react-router'
import { IconStar, IconRefresh, IconChevronDown } from '@tabler/icons-react'
import { pointsProgress } from '../../../shared/inventoryPoints'
import { displayNameOf, useSession } from '../auth/useSession'
import { VisitRewards } from './VisitRewards'
import { pointsUnavailable, usePoints } from './usePoints'

const dateLabel = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function PointsScreen() {
  const session = useSession()
  const points = usePoints(session?.user.id)
  const data = points.data
  const progress = data && pointsProgress(data.balance, data.reward_threshold)
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-5 p-4">
      <header className="flex items-center justify-between gap-3">
        <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><IconStar className="text-warning" aria-hidden="true" /> Points</h1>
          {session && <p className="mt-1 text-sm opacity-70">{displayNameOf(session)}</p>}
        </div>
        <button type="button" className="btn btn-ghost btn-sm" disabled={points.isFetching} onClick={() => void points.refetch()}><IconRefresh size={18} className={points.isFetching ? 'animate-spin' : ''} /> Refresh</button>
      </header>

      {points.isPending && <p role="status" className="flex items-center gap-2"><span className="loading loading-spinner loading-sm" /> Loading your points…</p>}
      {points.error && <div role="alert" className="alert alert-warning alert-soft">
        <span>{pointsUnavailable(points.error) ? 'Points are not enabled for this pantry yet. Your inventory updates still work; check back when rewards are enabled.' : 'Could not refresh your points. Please try again.'}{data && ' The balance below may be out of date.'}</span>
        <button className="btn btn-sm" disabled={points.isFetching} onClick={() => void points.refetch()}>Retry</button>
      </div>}
      {data?.sync_warning && <p role="alert" className="alert alert-warning alert-soft text-sm">{data.sync_warning}</p>}
      {data && progress && (
        <section className="flex flex-col gap-4 rounded-box bg-base-200 p-5" aria-label="Your points balance">
          <div><div className="mb-1 flex items-center justify-between gap-2"><p className="text-sm opacity-70">Your available points</p>{data.device_only && <span className="badge badge-outline badge-sm">This device</span>}</div><p className="text-5xl font-semibold" aria-live="polite">{data.balance.toLocaleString()}</p></div>
          <div className="flex flex-col gap-2">
            <div className="flex justify-between gap-3 text-sm"><span>Next milestone: {progress.nextMilestone} points</span><span>{progress.remaining} to go</span></div>
            <progress className="progress progress-warning w-full" value={progress.progress} max={data.reward_threshold} aria-label="Progress to next points milestone" />
            {progress.milestones > 0 && <p className="text-sm font-medium text-success">{progress.milestones} {data.reward_threshold}-point {progress.milestones === 1 ? 'milestone reached' : 'milestones reached'}. </p>}
          </div>
        </section>
      )}

      <nav className="flex gap-2" aria-label="Update pantry">
        <Link to="/capture" className="btn btn-primary btn-sm">Add item</Link>
        <Link to="/shelf" className="btn btn-outline btn-sm">Update stock</Link>
      </nav>

      {data && <VisitRewards data={data} userId={session?.user.id} stale={!!points.error} studentName={session ? displayNameOf(session) : ''} studentEmail={session?.user.email} />}
      {!data && !points.isPending && <section className="flex flex-col gap-2 rounded-box bg-base-200 p-4">
        <h2 className="text-lg font-semibold">Extra-visit rewards</h2>
        <button className="btn btn-sm" disabled>Load your points to request review</button>
      </section>}

      {data && <details className="group rounded-box border border-base-300">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-box p-4 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
          Recent points
          <IconChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="flex flex-col gap-3 border-t border-base-300 p-4">
        {!data.recent_updates.length ? <p className="rounded-box bg-base-200 p-4 text-sm opacity-70">No points yet. Update your first product to start earning.</p> :
          <ul className="divide-y divide-base-300 rounded-box border border-base-300">
            {data.recent_updates.map((entry) => <li key={entry.id} className="flex items-center gap-3 p-3"><div className="min-w-0 flex-1"><p className="font-medium break-words">{entry.item_name}</p><p className="text-xs opacity-60">{dateLabel(entry.created_at)}</p></div><span className="badge badge-success badge-soft">+1 point</span></li>)}
          </ul>}
        {data.earned > data.recent_updates.length && <p className="text-xs opacity-60">Showing the latest {data.recent_updates.length} of {data.earned} earned points.</p>}
        </div>
      </details>}
      <details className="group rounded-box border border-base-300">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-box p-4 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
          How points and rewards work
          <IconChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="flex flex-col gap-4 border-t border-base-300 p-4 text-sm">
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">How to earn points</h2>
            <p>Earn 1 point per distinct product you successfully add, restock, or update every seven days. Photos from your camera or library, queue reviews, and confirmed shelf updates all count automatically.</p>
            <p className="opacity-70">Each product earns at most 1 point per account in a rolling seven-day period. Repeat uploads still update stock, without extra points until the cooldown ends. Failed uploads, rejected photos, and saving products do not count.</p>
          </section>
          {data?.device_only && <p>Points are saved for your account on this device. Keep using this browser to retain them. Device points cannot be spent on extra visits automatically. You can email a request for manual approval once you reach 100 points.</p>}
          <section className="flex flex-col gap-2">
            <h2 className="font-medium">Extra visits</h2>
            {data?.redemption_enabled && !data.device_only
              ? <p>Request an extra pantry visit for 100 points. Approval grants one extra app check-in for 30 days. Arrange your appointment manually before visiting; this does not book an appointment or guarantee admission.</p>
              : <p>Reach 100 points to email an extra-visit request for approval. The reviewer confirms eligibility and appointment details by email. Sending a request does not book an appointment or guarantee admission.</p>}
            {data?.redemption_enabled && !data.device_only
              ? <p className="opacity-70">Points are reserved while your request is pending, spent on approval, and released if rejected or cancelled. Unused approved rewards expire and refund automatically.</p>
              : <p className="opacity-70">Send the email draft to submit a request for manual review. Opening a draft does not reserve or spend points, record approval, or unlock an app check-in. Wait for the reviewer to confirm approval and appointment details by email.</p>}
          </section>
          {data && <p className="opacity-70">Total earned: {data.earned} · Reserved: {data.reserved} · Spent: {data.spent}</p>}
        </div>
      </details>
    </main>
  )
}
