import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { loadErrorMessage } from '../../../shared/loadError'
import { useSession } from '../auth/useSession'
import { ItemCard } from './ItemCard'
import { ItemDialog } from './ItemDialog'
import { useCatalog } from './useCatalog'
import { useMarkWatchesSeen, useWatches } from './useWatches'

// Every item the user watches. Items someone else updated since the last visit are flagged, and
// opening this page clears the flags (the in-app fallback when notification emails land in junk).
export function WatchingScreen() {
  const session = useSession()
  const { data: rows = [], isLoading: catalogLoading, error: catalogError } = useCatalog()
  const { data: watches, isLoading, error: watchesError } = useWatches(!!session)
  // Either query failing leaves the list empty or partial, so both count.
  const error = watchesError ?? catalogError
  const markSeen = useMarkWatchesSeen()
  const [openId, setOpenId] = useState<string | null>(null)
  // The flags as they were on arrival, so they stay visible after marking them seen.
  const [changedOnArrival, setChangedOnArrival] = useState<Set<string> | null>(null)

  if (watches && !changedOnArrival) {
    setChangedOnArrival(new Set(watches.filter((w) => w.changed).map((w) => w.item_id)))
  }
  const { mutate: markSeenNow } = markSeen
  useEffect(() => {
    if (changedOnArrival?.size) markSeenNow()
  }, [changedOnArrival, markSeenNow])

  const byId = new Map(rows.map((r) => [r.id, r]))
  const items = (watches ?? []).flatMap((w) => byId.get(w.item_id) ?? [])
  const openItem = items.find((r) => r.id === openId)

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
      <header>
        <h1 className="text-2xl font-semibold">Watching</h1>
        <p className="text-sm opacity-70">We email you when someone updates one of these items.</p>
      </header>

      {error && (
        <div role="alert" className={`alert alert-soft ${items.length ? 'alert-warning' : 'alert-error'}`}>
          {loadErrorMessage(error, { what: 'your watched items', hasData: items.length > 0, online: navigator.onLine })}
        </div>
      )}
      {(isLoading || catalogLoading) && <span className="loading loading-spinner mx-auto" />}
      {!isLoading && !catalogLoading && !error && !items.length && (
        <p className="opacity-70">
          You are not watching anything yet. Open an item in the <Link to="/" className="link">catalog</Link> and tap
          Notify me.
        </p>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((r) => (
          <ItemCard key={r.id} item={r} userId={session?.user.id} watching changed={changedOnArrival?.has(r.id)} onOpen={() => setOpenId(r.id)} />
        ))}
      </ul>

      {openItem && <ItemDialog item={openItem} userId={session?.user.id} onClose={() => setOpenId(null)} />}
    </main>
  )
}
