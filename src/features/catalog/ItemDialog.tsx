import type { CatalogRow, PublicAvailability } from '../../../shared/catalogView'
import { isStale, timeAgo } from '../../../shared/freshness'
import { AvailabilityBadgeFor, availabilityLabel } from './AvailabilityBadge'
import { thumbUrl, useSetStatus } from './useCatalog'

type Props = {
  item: CatalogRow
  signedIn: boolean
  onClose: () => void
}

const MARKS: { status: Exclude<PublicAvailability, 'in_stock'>; label: string; cls: string }[] = [
  { status: 'low', label: 'Mark low', cls: 'btn-warning' },
  { status: 'out', label: 'Mark out of stock', cls: 'btn-error' },
]

// Detail view for one item. Marking Low or Out needs no photo; saying an item is in stock does
// (Add item / Update stock on the catalog).
export function ItemDialog({ item, signedIn, onClose }: Props) {
  const setStatus = useSetStatus()
  const stale = isStale(item.updated_at)

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

        {signedIn && item.pending && (
          <p className="mt-2 text-xs opacity-70">
            {item.availability === 'in_stock'
              ? 'Another student reported this. If you see it on the shelf, confirm it with Update stock.'
              : `Another student reported this. Tap ${availabilityLabel(item.availability)} below if you see the same.`}
          </p>
        )}
        {setStatus.error && <div role="alert" className="alert alert-error alert-soft mt-3 text-sm">{setStatus.error.message}</div>}

        <div className="modal-action flex-col gap-2">
          {signedIn && (
            <div className="join w-full">
              {MARKS.map((m) => (
                <button
                  key={m.status}
                  className={`btn btn-soft join-item flex-1 ${m.cls}`}
                  // Same status and nobody left to confirm it: nothing to do.
                  disabled={setStatus.isPending || (item.availability === m.status && !item.pending)}
                  onClick={() => setStatus.mutate({ itemId: item.id, status: m.status }, { onSuccess: onClose })}
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
