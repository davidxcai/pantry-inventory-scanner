import { Link } from '@tanstack/react-router'
import { WatchlistButton } from '../watchlist/WatchlistButton'
import type { CatalogRow } from '../../../shared/catalogView'
import { isStale, timeAgo } from '../../../shared/freshness'
import { AvailabilityBadgeFor } from './AvailabilityBadge'
import { thumbUrl } from './useCatalog'

type Props = {
  item: CatalogRow
  userId?: string
  inWatchlist?: boolean
  onOpen: () => void
}

export function ItemCard({ item, onOpen, userId, inWatchlist = false }: Props) {
  const out = item.availability === 'out'
  const stale = isStale(item.updated_at)
  return (
    <li className="pantry-product-card card card-sm overflow-hidden bg-base-100">
      <button
        type="button"
        onClick={onOpen}
        className={`card card-sm w-full overflow-hidden bg-transparent text-left ${out ? 'opacity-60' : ''}`}
      >
        <figure className="aspect-square bg-base-300">
          {item.thumbnail_path && <img src={thumbUrl(item.thumbnail_path)} alt="" loading="lazy" className="size-full object-cover" />}
        </figure>
        <div className="card-body gap-1">
          <h2 className="line-clamp-2 text-sm font-medium leading-tight">{item.name}</h2>
          <div className="flex flex-wrap items-center gap-1">
            <AvailabilityBadgeFor availability={item.availability} />
          </div>
          <p className={`text-xs ${stale ? 'text-warning' : 'opacity-70'}`}>
            {item.updated_at
              ? `Updated ${timeAgo(item.updated_at)}${item.updated_by_name ? ` by ${item.updated_by_name}` : ''}`
              : 'Not yet verified'}
            {stale && item.updated_at && ' · may be out of date'}
          </p>
        </div>
      </button>
      <div className="mt-auto px-3 pb-3">
        {userId ? <WatchlistButton itemId={item.id} name={item.name} userId={userId} item={item} removeOnly={inWatchlist} />
          : <Link to="/login" className="btn btn-sm btn-outline w-full">Sign in to save</Link>}
      </div>
    </li>
  )
}
