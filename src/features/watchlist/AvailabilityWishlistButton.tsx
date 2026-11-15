import { IconBell, IconBellOff } from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import type { CatalogRow } from '../../../shared/catalogView'
import { useAvailabilityWishlist } from './useAvailabilityWishlist'
import { useWishlistEmails } from './useWishlistEmails'

function WishlistEmailStatus({ userId, deviceOnly }: { userId: string; deviceOnly: boolean }) {
  const emails = useWishlistEmails(userId)
  let status = 'Email alerts are not ready yet. Your wishlist choice is saved.'
  if (deviceOnly) status = 'Your wishlist is saved on this device. Email alerts start after it syncs to your account.'
  else if (emails.query.isPending) status = 'Checking email alerts…'
  else if (emails.query.error) status = 'Could not check email alerts. Open your Wishlist to retry.'
  else if (emails.query.data?.ready) status = emails.query.data.enabled
    ? 'Email alerts are on. We’ll email your login address when this product becomes available.'
    : 'Email alerts are paused. Turn them on in your Wishlist to receive an availability email.'
  return (
    <div role="status" className="text-xs">
      <p>{status}</p>
      <Link to="/profile" search={{ list: 'wishlist' }} className="link text-primary">Manage email alerts</Link>
    </div>
  )
}

type Props = { item: CatalogRow; userId: string; allowAvailableRemoval?: boolean; compact?: boolean }

export function AvailabilityWishlistButton({ item, userId, allowAvailableRemoval = false, compact = false }: Props) {
  const { query, mutation } = useAvailabilityWishlist(userId)
  const added = query.data?.items.some(row => row.item_id === item.id) ?? false
  if (item.availability !== 'out' && (!allowAvailableRemoval || !added)) return null
  return (
    <div className={`flex flex-col gap-1 ${compact ? '' : 'mt-2'}`}>
      <button
        type="button"
        className={`btn btn-sm w-full ${added && compact ? 'btn-primary btn-soft' : 'btn-outline'}`}
        aria-pressed={added}
        aria-label={added ? `Remove ${item.name} from wishlist` : `Add ${item.name} to wishlist for an availability email`}
        disabled={query.isPending || !!query.error || mutation.isPending}
        onClick={() => mutation.mutate({ item, enabled: !added })}
      >
        {mutation.isPending
          ? <span className="loading loading-spinner loading-xs" aria-hidden="true" />
          : added ? <IconBellOff size={16} aria-hidden="true" /> : <IconBell size={16} aria-hidden="true" />}
        {added ? compact ? 'Wishlisted' : 'Remove from wishlist' : 'Add to Wishlist'}
      </button>
      {!compact && (
        <>
          {added && item.availability !== 'out' && <p className="text-xs font-medium text-success">Available now</p>}
          {!added && <p className="text-xs opacity-70">Get an email at your login address when this product is back in stock.</p>}
          {added && <WishlistEmailStatus userId={userId} deviceOnly={query.data?.deviceOnly ?? false} />}
        </>
      )}
      {(query.error || mutation.error) && <p role="alert" className="text-xs text-error">{(query.error || mutation.error)?.message}</p>}
    </div>
  )
}
