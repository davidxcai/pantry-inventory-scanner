import { Link } from '@tanstack/react-router'
import { IconBell, IconBellOff, IconCheck } from '@tabler/icons-react'
import type { CatalogRow, PublicAvailability } from '../../../shared/catalogView'
import { isStale, timeAgo } from '../../../shared/freshness'
import { AvailabilityBadgeFor, availabilityLabel } from './AvailabilityBadge'
import { WatchlistButton } from '../watchlist/WatchlistButton'
import { ItemHistory } from './ItemHistory'
import { thumbUrl, useSetStatus } from './useCatalog'
import { useToggleWatch, useWatches } from './useWatches'

type Props = {
  item: CatalogRow
  userId?: string
  onClose: () => void
}

const MARKS: { status: Exclude<PublicAvailability, 'in_stock'>; label: string; correction: string; cls: string }[] = [
  { status: 'low', label: 'Mark low', correction: "Actually it's low", cls: 'btn-warning' },
  { status: 'out', label: 'Mark out of stock', correction: "Actually it's out", cls: 'btn-error' },
]

const CONFIRM_CLS: Record<PublicAvailability, string> = {
  in_stock: 'btn-success',
  low: 'btn-warning',
  out: 'btn-error',
}

// Detail view for one item. Marking Low or Out needs no photo; saying an item is in stock does
// (Add item / Update stock on the catalog). A pending report can be confirmed here by anyone but its
// reporter: set_item_status treats the same status from a second student as a confirmation.
export function ItemDialog({ item, userId, onClose }: Props) {
  const signedIn = !!userId
  const setStatus = useSetStatus()
  const watches = useWatches(signedIn)
  const toggleWatch = useToggleWatch()
  const watching = !!watches.data?.some((w) => w.item_id === item.id)
  const stale = isStale(item.updated_at)
  const canConfirm = signedIn && item.pending && !item.reported_by_me
  const label = availabilityLabel(item.availability).toLowerCase()
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
          {item.pending && <span className="badge badge-outline badge-sm">Pending verification</span>}
        </div>
        <p className={`mt-1 text-xs ${stale ? 'text-warning' : 'opacity-70'}`}>
          {item.updated_at
            ? `Updated ${timeAgo(item.updated_at)}${item.updated_by_name ? ` by ${item.updated_by_name}` : ''}`
            : 'Not yet verified'}
          {stale && item.updated_at && ' · may be out of date'}
        </p>
        <ItemHistory itemId={item.id} />

        {canConfirm && (
          <p className="mt-2 text-xs opacity-70">Another student reported this. Is it {label} on the shelf?</p>
        )}
        {signedIn && item.pending && item.reported_by_me && (
          <p className="mt-2 text-xs opacity-70">You reported this. Waiting for another student to confirm.</p>
        )}
        {setStatus.error && <div role="alert" className="alert alert-error alert-soft mt-3 text-sm">{setStatus.error.message}</div>}
        {toggleWatch.error && <div role="alert" className="alert alert-error alert-soft mt-3 text-sm">{toggleWatch.error.message}</div>}

        <div className="modal-action flex-col gap-2">
          {signedIn && <WatchlistButton itemId={item.id} name={item.name} userId={userId} item={item} />}
          {!signedIn && <Link to="/login" className="btn btn-outline btn-block">Sign in to save this product</Link>}
          {canConfirm && (
            <button
              className={`btn btn-block ${CONFIRM_CLS[item.availability]}`}
              disabled={setStatus.isPending}
              onClick={() => mark(item.availability)}
            >
              <IconCheck size={18} /> Yes, it's {label}
            </button>
          )}
          {signedIn && (
            <div className="join w-full">
              {/* The current status is never a correction; confirming it is the button above. */}
              {MARKS.filter((m) => m.status !== item.availability).map((m) => (
                <button
                  key={m.status}
                  className={`btn btn-soft join-item flex-1 ${m.cls}`}
                  disabled={setStatus.isPending}
                  onClick={() => mark(m.status)}
                >
                  {item.pending ? m.correction : m.label}
                </button>
              ))}
            </div>
          )}
          {signedIn ? (
            <button
              className={`btn btn-block ${watching ? 'btn-outline' : 'btn-primary btn-soft'}`}
              disabled={toggleWatch.isPending || watches.isLoading}
              onClick={() => toggleWatch.mutate({ itemId: item.id, watch: !watching })}
            >
              {watching ? <><IconBellOff size={18} /> Stop notifying me</> : <><IconBell size={18} /> Notify me when this changes</>}
            </button>
          ) : (
            <Link to="/login" className="btn btn-block btn-ghost"><IconBell size={18} /> Sign in to get notified</Link>
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
