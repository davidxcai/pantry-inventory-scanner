import { IconBookmark, IconBookmarkFilled } from '@tabler/icons-react'
import type { CatalogRow } from '../../../shared/catalogView'
import { useSetWatchlistItem, useWatchlist } from './useWatchlist'

export function WatchlistButton({ itemId, name, userId, item, removeOnly = false }: { itemId: string; name: string; userId: string | undefined; item?: CatalogRow; removeOnly?: boolean }) {
  const watchlist = useWatchlist(userId)
  const setItem = useSetWatchlistItem(userId, itemId, item)
  if (!userId) return null

  const saved = watchlist.data?.some((entry) => entry.item_id === itemId) ?? false
  const error = setItem.error ?? watchlist.error
  const label = saved ? `Remove ${name} from saved products` : `Save ${name}`

  return (
    <div>
      <button
        type="button"
        className={`btn btn-sm w-full ${saved ? 'btn-primary btn-soft' : 'btn-outline'}`}
        aria-label={label}
        aria-pressed={saved}
        disabled={watchlist.isPending || !!watchlist.error || setItem.isPending}
        onClick={() => setItem.mutate({ saved: !saved })}
      >
        {setItem.isPending
          ? <span className="loading loading-spinner loading-xs" aria-hidden="true" />
          : saved ? <IconBookmarkFilled size={16} aria-hidden="true" /> : <IconBookmark size={16} aria-hidden="true" />}
        {saved ? removeOnly ? 'Remove' : 'Saved' : 'Save'}
      </button>
      {error && (
        <div role="alert" className="mt-1 text-xs text-error">
          {setItem.error ? 'Could not update saved products. Try again.' : 'Could not load saved products.'}
          {watchlist.error && <button type="button" className="link ml-1" onClick={() => void watchlist.refetch()}>Retry</button>}
        </div>
      )}
    </div>
  )
}
