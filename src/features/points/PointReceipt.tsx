import type { PointActivity } from '../../../shared/pointActivity'
import { rewardDate } from '../../../shared/visitRewards'

export function PointReceipt({ activity }: { activity: PointActivity | undefined }) {
  if (!activity) return null
  return <p role="status" className={`mt-1 text-xs ${activity.outcome === 'earned' ? 'text-success' : 'opacity-70'}`}>
    {activity.outcome === 'earned' ? '+1 point earned' : `Stock saved. No extra point: this product already earned a point within seven days. Eligible again ${rewardDate(activity.next_eligible_at)} (America/Chicago).`}
  </p>
}
