import { Link } from '@tanstack/react-router'
import type { CatalogRow, PublicAvailability } from '../../../shared/catalogView'
import { isStale, timeAgo } from '../../../shared/freshness'
import { AvailabilityBadgeFor } from './AvailabilityBadge'
import { AvailabilityWishlistButton } from '../watchlist/AvailabilityWishlistButton'
import { WatchlistButton } from '../watchlist/WatchlistButton'
import { ItemHistory } from './ItemHistory'
import { thumbUrl, useSetStatus } from './useCatalog'

type Props = {
  item: CatalogRow
  userId?: string
  onClose: () => void
  allowWishlistRemoval?: boolean
}

const MARKS: { status: Exclude<PublicAvailability, 'in_stock'>; label: string; cls: string }[] = [
  { status: 'low', label: 'Mark low', cls: 'btn-warning' },
  { status: 'out', label: 'Mark out of stock', cls: 'btn-error' },
]

// Detail view for one item. Marking Low or Out needs no photo; saying an item is in stock does
// (Add item / Update stock on the catalog). One student's report takes effect straight away.
export function ItemDialog({ item, userId, onClose, allowWishlistRemoval = false }: Props) {
  const signedIn = !!userId
  const setStatus = useSetStatus()
  const stale = isStale(item.updated_at)
  const mark = (status: PublicAvailability) => setStatus.mutate({ itemId: item.id, status }, { onSuccess: onClose })

  return (
    <dialog className="modal modal-open" onClose={onClose}>
      <div className="modal-box max-w-sm">
        <figure className="mb-3 aspect-square overflow-hidden rounded-box bg-base-300">
          {item.thumbnail_path && <img src={thumbUrl(item.thumbnail_path)} alt="" className="size-full object-cover" />}
        </figure>
        <h2 className="text-lg font-semibold leading-tight">{item.name}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <AvailabilityBadgeFor availability={item.availability} />
        </div>
        <p className={`mt-1 text-xs ${stale ? 'text-warning' : 'opacity-70'}`}>
          {item.updated_at
            ? `Updated ${timeAgo(item.updated_at)}${item.updated_by_name ? ` by ${item.updated_by_name}` : ''}`
            : 'Not yet verified'}
          {stale && item.updated_at && ' · may be out of date'}
        </p>
        <ItemHistory itemId={item.id} />

        {setStatus.error && <div role="alert" className="alert alert-error alert-soft mt-3 text-sm">{setStatus.error.message}</div>}

        <div className="modal-action flex-col gap-2">
          {signedIn && <WatchlistButton itemId={item.id} name={item.name} userId={userId} item={item} />}
          {userId && <AvailabilityWishlistButton item={item} userId={userId} allowAvailableRemoval={allowWishlistRemoval}/>}
          {!signedIn && <Link to="/login" className="btn btn-outline btn-block">Sign in to save this product</Link>}
          {signedIn && (
            <div className="join w-full">
              {MARKS.filter((m) => m.status !== item.availability).map((m) => (
                <button
                  key={m.status}
                  className={`btn btn-soft join-item flex-1 ${m.cls}`}
                  disabled={setStatus.isPending}
                  onClick={() => mark(m.status)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
          <button className="btn btn-block" onClick={onClose}>Close</button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button aria-label="Close">close</button>
      </form>
    </dialog>
  )
}
