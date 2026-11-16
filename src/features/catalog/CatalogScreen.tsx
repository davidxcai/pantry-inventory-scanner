import { useEffect, useMemo, useState } from 'react'
import { filterCatalog } from '../../../shared/catalogView'
import { pantryStatus } from '../../../shared/pantryGate'
import { loadErrorMessage } from '../../../shared/loadError'
import { Link } from '@tanstack/react-router'
import { IconCamera, IconPhotoScan } from '@tabler/icons-react'
import { useSession } from '../auth/useSession'
import { CATEGORIES, categoryLabel } from '../intake/categories'
import { ShelfScanBanner } from '../shelf/ShelfScanBanner'
import { ItemDialog } from './ItemDialog'
import { ItemCard } from './ItemCard'
import { useCatalog } from './useCatalog'

export function CatalogScreen() {
  const { data: rows = [], isLoading, error } = useCatalog()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [hideOut, setHideOut] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const session = useSession()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const status = pantryStatus(now)

  const openItem = rows.find((r) => r.id === openId)
  const shown = useMemo(() => filterCatalog(rows, { search, category, hideOut }), [rows, search, category, hideOut])

  return (
    <main className="pantry-catalog flex w-full min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Thyme Saver Maverick Pantry</h1>
          <p className="mt-1 text-sm">
            {status.open
              ? <><span className="font-semibold text-success">Open</span> - {status.detail}</>
              : <><span className="font-semibold text-error">Closed</span> - {status.detail}</>}
            {' | '}
            <a
              href="https://www.google.com/maps/search/?api=1&query=UTA%20Maverick%20Pantry%2C%20520%20S%20Center%20St%2C%20Arlington%2C%20TX%2076010"
              className="link text-blue-600"
            >
              Map
            </a>
          </p>
        </div>
        {session && (
          <div className="grid grid-cols-2 gap-3 lg:shrink-0">
            <Link to="/shelf" className="btn btn-primary"><IconPhotoScan size={20} /> Update stock</Link>
            <Link to="/capture" className="btn btn-outline"><IconCamera size={20} /> Add item</Link>
          </div>
        )}
      </header>

      {session && <ShelfScanBanner />}

      <div className="flex flex-col gap-3 rounded-box border border-base-300 bg-base-200/50 p-3 md:flex-row md:flex-wrap md:items-center">
        <input
          type="search"
          className="input w-full min-w-0 md:w-auto md:flex-1"
          placeholder="Search items"
          aria-label="Search items"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="select w-full md:w-56" aria-label="Category" value={category ?? ''} onChange={(e) => setCategory(e.target.value || null)}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
        </select>
        <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm md:w-full xl:w-auto">
          <input type="checkbox" className="checkbox checkbox-sm shrink-0" checked={hideOut} onChange={(e) => setHideOut(e.target.checked)} />
          Hide items that are out of stock
        </label>
      </div>

      {error && (
        <div role="alert" className={`alert alert-soft ${rows.length ? 'alert-warning' : 'alert-error'}`}>
          {loadErrorMessage(error, { what: 'items', hasData: rows.length > 0, online: navigator.onLine })}
        </div>
      )}
      {isLoading && <span className="loading loading-spinner mx-auto" />}
      {!isLoading && !error && !shown.length && <p className="opacity-70">{rows.length ? 'No items match.' : 'No items yet.'}</p>}

      <ul aria-label="Products" className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(12rem,1fr))] sm:gap-4">
        {shown.map((r) => (
          <ItemCard key={r.id} item={r} userId={session?.user.id} onOpen={() => setOpenId(r.id)} />
        ))}
      </ul>

      {openItem && <ItemDialog item={openItem} userId={session?.user.id} onClose={() => setOpenId(null)} />}
    </main>
  )
}
