import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { IconBookmark, IconRefresh, IconSearch, IconChevronDown } from '@tabler/icons-react'
import { filterSavedProducts, savedProductCounts, type SavedAvailability } from '../../../shared/savedProducts'
import { displayNameOf, useSession } from '../auth/useSession'
import { ItemCard } from '../catalog/ItemCard'
import { ItemDialog } from '../catalog/ItemDialog'
import { WatchlistButton } from '../watchlist/WatchlistButton'
import { useAvailabilityWishlist } from '../watchlist/useAvailabilityWishlist'
import { useWishlistEmails } from '../watchlist/useWishlistEmails'
import { useWatchlist } from '../watchlist/useWatchlist'

export function ProfileScreen({ initialTab = 'saved' }: { initialTab?: 'saved' | 'wishlist' }) {
  const session = useSession()
  const watchlist = useWatchlist(session?.user.id)
  const wishlist = useAvailabilityWishlist(session?.user.id)
  const emails = useWishlistEmails(session?.user.id)
  const [tab,setTab] = useState<'saved'|'wishlist'>(initialTab)
  const [openId, setOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [availability, setAvailability] = useState<SavedAvailability>('all')
  const entries = watchlist.data ?? []
  const wishlistIds = new Set(wishlist.query.data?.items.map(row=>row.item_id))
  const tabEntries = tab === 'saved' ? entries : entries.filter(entry=>wishlistIds.has(entry.item_id))
  const shown = filterSavedProducts(tabEntries, search, availability)
  const counts = savedProductCounts(tabEntries)
  const openItem = entries.find((entry) => entry.item_id === openId)?.item

  if (!session) return <main className="p-4"><span role="status" className="loading loading-spinner" aria-label="Loading profile" /></main>

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-4">
      <header className="flex items-center gap-3">
        <IconBookmark size={32} aria-hidden="true" className="shrink-0" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">Saved products</h1>
          <p className="font-medium break-words">{displayNameOf(session)}</p>
        </div>
      </header>

      <div className="tabs tabs-box" role="tablist" aria-label="Saved product lists">
        <button role="tab" aria-selected={tab==='saved'} className={`tab ${tab==='saved'?'tab-active':''}`} onClick={()=>{setTab('saved');setAvailability('all')}}>Saved products ({entries.length})</button>
        <button role="tab" aria-selected={tab==='wishlist'} className={`tab ${tab==='wishlist'?'tab-active':''}`} onClick={()=>{setTab('wishlist');setAvailability('all')}}>Wishlist ({entries.filter(entry=>wishlistIds.has(entry.item_id)).length})</button>
      </div>

      <section aria-labelledby="watchlist-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="watchlist-heading" className="flex items-center gap-2 text-xl font-semibold">
            {tab === 'saved' ? 'Your saved products' : 'Your wishlist'}
            {watchlist.data && <span className="badge badge-neutral">{tabEntries.length}</span>}
          </h2>
          <div className="flex gap-2">
            <button type="button" className="btn btn-ghost btn-sm" disabled={watchlist.isFetching} onClick={() => { void watchlist.refetch(); void wishlist.query.refetch() }} aria-label="Refresh saved products">
              <IconRefresh size={16} aria-hidden="true" className={watchlist.isFetching ? 'animate-spin' : ''} /> Refresh
            </button>
            <Link to="/" className="btn btn-outline btn-sm">Browse items</Link>
          </div>
        </div>
        {tab === 'wishlist' && <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between gap-3 rounded-box bg-base-200 p-3 text-sm">
            <span>Email me when my wishlist products become available</span>
            <input type="checkbox" className="toggle toggle-primary" checked={emails.query.data?.enabled ?? false}
              aria-describedby="wishlist-email-info" aria-busy={emails.mutation.isPending}
              disabled={!emails.query.data?.ready || emails.mutation.isPending || emails.query.isError}
              onChange={event=>emails.mutation.mutate(event.target.checked)}/>
          </label>
          {(emails.query.error||emails.mutation.error||wishlist.query.error) && <p role="alert" className="text-error text-sm">{(emails.query.error||emails.mutation.error||wishlist.query.error)?.message}</p>}
        </div>}
        {tab === 'wishlist' && wishlist.query.isPending && <p role="status">Loading wishlist…</p>}

        {watchlist.data && (
          <>
            <div className="grid grid-cols-3 gap-2" aria-label="Saved product availability">
              {([
                ['in_stock', 'In stock', 'text-success'],
                ['low', 'Low stock', 'text-warning'],
                ['out', 'Out of stock', 'text-error'],
              ] as const).map(([status, label, color]) => (
                <div key={status} className="rounded-box bg-base-200 p-3">
                  <p className={`text-2xl font-semibold ${color}`}>{counts[status]}</p>
                  <p className="text-xs opacity-70">{label}</p>
                </div>
              ))}
            </div>
            {tabEntries.length > 0 && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="input w-full sm:flex-1">
                  <IconSearch size={18} aria-hidden="true" />
                  <input type="search" aria-label={tab==='saved'?'Search saved products':'Search wishlist'} placeholder={tab==='saved'?'Search saved products':'Search wishlist'} value={search} onChange={(event) => setSearch(event.target.value)} />
                </label>
                <select className="select w-full sm:w-44" aria-label="Saved product availability" value={availability} onChange={(event) => setAvailability(event.target.value as SavedAvailability)}>
                  <option value="all">All availability</option>
                  <option value="in_stock">In stock</option>
                  <option value="low">Low stock</option>
                  <option value="out">Out of stock</option>
                  <option value="unlisted">Unlisted</option>
                </select>
              </div>
            )}
          </>
        )}

        {watchlist.isPending && <p role="status" className="flex items-center gap-2"><span className="loading loading-spinner loading-sm" /> Loading saved products…</p>}
        {watchlist.error && (
          <div role="alert" className="alert alert-error alert-soft">
            <span>Could not refresh saved products. Check your connection and try again.{entries.length > 0 && ' The items below may be out of date.'}</span>
            <button type="button" className="btn btn-sm" disabled={watchlist.isFetching} onClick={() => { void watchlist.refetch(); void wishlist.query.refetch() }}>Retry</button>
          </div>
        )}
        {watchlist.isSuccess && !tabEntries.length && (tab==='saved'||wishlist.query.isSuccess) && (
          <div className="rounded-box bg-base-200 p-6 text-center">
            <p className="font-medium">{tab==='saved'?'No saved products yet':'No wishlist products yet'}</p>
            <Link to="/" className="btn btn-primary btn-sm mt-4">Find products</Link>
          </div>
        )}
        {tabEntries.length > 0 && !shown.length && (
          <div className="rounded-box bg-base-200 p-6 text-center">
            <p>No saved products match these filters.</p>
            <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => { setSearch(''); setAvailability('all') }}>Clear filters</button>
          </div>
        )}
        {shown.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {shown.map((entry) => entry.item ? (
              <ItemCard key={entry.item_id} item={entry.item} onOpen={() => setOpenId(entry.item_id)} userId={session.user.id} inWatchlist />
            ) : (
              <li key={entry.item_id} className="flex flex-col gap-3 rounded-box bg-base-200 p-3">
                <p className="text-sm">This saved product is no longer listed in the catalog.</p>
                <WatchlistButton itemId={entry.item_id} name="unlisted product" userId={session.user.id} removeOnly />
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="group rounded-box border border-base-300">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-box p-4 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
          About saved products and email alerts
          <IconChevronDown size={18} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true"/>
        </summary>
        <div className="flex flex-col gap-3 border-t border-base-300 p-4 text-sm">
          <p>Save products in the catalog to keep them here. Open an out-of-stock product’s photo card on the homepage or here, then choose Add to wishlist in its popup to get an availability email. Adding to Wishlist saves the product too. Saving a product alone does not subscribe you to emails.</p>
          <p>Wishlist tracks the out-of-stock saved products you choose. Removing a wishlist choice keeps the product saved. Turn the email toggle off to pause alerts without deleting either list.</p>
          <div id="wishlist-email-info">
            {emails.query.data?.ready
              ? <p>{emails.query.data.enabled ? `Alerts go to ${session.user.email}, your login email.` : `Email alerts are paused. Turn the toggle on to receive availability emails at ${session.user.email}.`}</p>
              : emails.query.isPending ? <p>Loading email preferences…</p>
                : !emails.query.error && <p>Email alerts need server setup. You can still organize your wishlist on this device.</p>}
          </div>
          {watchlist.deviceOnly && entries.length > 0 && <p>Your saves are stored on this device and waiting to sync to your account. Keep using this browser to find them here.</p>}
          {wishlist.query.data?.deviceOnly && <p>Some wishlist choices are saved on this device. Email alerts start after account sync.</p>}
          {watchlist.dataUpdatedAt > 0 && <p className="text-xs opacity-60">Last refreshed {new Date(watchlist.dataUpdatedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}. Products show the latest student reports; check each item’s update time.</p>}
        </div>
      </details>

      {openItem && <ItemDialog item={openItem} userId={session.user.id} onClose={() => setOpenId(null)} allowWishlistRemoval={tab==='wishlist'} />}
    </main>
  )
}
