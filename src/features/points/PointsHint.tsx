import { Link } from '@tanstack/react-router'
import { IconStar } from '@tabler/icons-react'
import { useSession } from '../auth/useSession'
import { pointsUnavailable, usePoints } from './usePoints'

// Uploading alone is not an award. The server records a point only when inventory is updated.
export function PointsHint() {
  const session = useSession()
  const points = usePoints(session?.user.id)
  const unavailable = pointsUnavailable(points.error)
  return (
    <Link to="/points" className="flex items-center gap-3 rounded-box bg-base-200 p-3 text-sm">
      <IconStar size={20} className="shrink-0 text-warning" aria-hidden="true" />
      <span className="flex-1">{points.error && !unavailable ? 'Could not refresh points. Stock updates still save; open Points to retry.' : unavailable ? 'Points are waiting to be enabled. View how earning works.' : 'Earn 1 point per distinct product every seven days. Repeat stock updates still save.'}</span>
      {points.data?.device_only && <span className="badge badge-outline badge-sm">This device</span>}
      <span className="whitespace-nowrap font-medium">{points.data ? `${points.data.balance} points` : 'View points'}</span>
    </Link>
  )
}
