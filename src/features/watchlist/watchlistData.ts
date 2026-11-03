import { storeAvailabilityWishlist } from './availabilityWishlistStorage'
import type { SavedProduct } from '../../../shared/savedProducts'
import type { CatalogRow } from '../../../shared/catalogView'
import { supabase } from '../../lib/supabase'
import { CATALOG_COLUMNS } from '../catalog/useCatalog'
import { readDeviceSaves, setDeviceSave, type SavedItem } from './watchlistStorage'

export type WatchlistState = { items: SavedProduct[]; deviceOnly: boolean }
const missingTable = (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'PGRST205'

// Serialize syncs and clicks per account so a removal cannot race a pending device-save sync.
const tasks = new Map<string, Promise<unknown>>()
function forAccount<T>(userId: string, action: () => Promise<T>): Promise<T> {
  const result = (tasks.get(userId) ?? Promise.resolve()).catch(() => {}).then(action)
  tasks.set(userId, result)
  void result.finally(() => { if (tasks.get(userId) === result) tasks.delete(userId) }).catch(() => {})
  return result
}

async function readAccountSaves(userId: string): Promise<SavedItem[]> {
  const saved: SavedItem[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.from('watchlist_items')
      .select('item_id, created_at').eq('user_id', userId)
      .order('created_at', { ascending: false }).order('item_id')
      .range(offset, offset + 999)
    if (error) throw error
    saved.push(...(data as SavedItem[]))
    if (data.length < 1000) return saved
  }
}

async function currentProducts(saved: SavedItem[]): Promise<SavedProduct[]> {
  const items = new Map<string, CatalogRow>()
  // Availability is always read from the current catalog, including out-of-stock products.
  for (let offset = 0; offset < saved.length; offset += 100) {
    const { data, error } = await supabase.from('available_items').select(CATALOG_COLUMNS)
      .in('id', saved.slice(offset, offset + 100).map((entry) => entry.item_id))
    if (error) throw error
    for (const item of data as CatalogRow[]) items.set(item.id, item)
  }
  return saved.map((entry) => ({ ...entry, item: items.get(entry.item_id) ?? null }))
}

export function loadWatchlistState(userId: string): Promise<WatchlistState> {
  if (!userId) return Promise.reject(new Error('Sign in to view saved products.'))
  return forAccount(userId, async () => {
    let account: SavedItem[]
    try {
      account = await readAccountSaves(userId)
    } catch (error) {
      if (!missingTable(error)) throw error
      return { items: await currentProducts(readDeviceSaves(userId)), deviceOnly: true }
    }

    const device = await currentProducts(readDeviceSaves(userId))
    for (const entry of device) {
      // Keep an unlisted device save removable locally; it cannot pass the server's catalog policy.
      if (!entry.item) continue
      const { error } = await supabase.from('watchlist_items').upsert(
        { user_id: userId, item_id: entry.item_id, created_at: entry.created_at },
        { onConflict: 'user_id,item_id', ignoreDuplicates: true },
      )
      if (error) throw error
      setDeviceSave(userId, entry.item_id, false)
    }
    if (device.some((entry) => entry.item)) account = await readAccountSaves(userId)
    const remaining = readDeviceSaves(userId)
    const merged = new Map(remaining.map((entry) => [entry.item_id, entry]))
    for (const entry of account) merged.set(entry.item_id, entry)
    const saved = [...merged.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || a.item_id.localeCompare(b.item_id))
    return { items: await currentProducts(saved), deviceOnly: remaining.length > 0 }
  })
}

export async function loadWatchlist(userId: string): Promise<SavedProduct[]> {
  return (await loadWatchlistState(userId)).items
}

export function setWatchlistItem(userId: string, itemId: string, saved: boolean): Promise<void> {
  if (!userId) return Promise.reject(new Error('Sign in to save products.'))
  return forAccount(userId, async () => {
    const result = saved
      ? await supabase.from('watchlist_items').upsert(
        { user_id: userId, item_id: itemId },
        { onConflict: 'user_id,item_id', ignoreDuplicates: true },
      )
      : await supabase.from('watchlist_items').delete().eq('user_id', userId).eq('item_id', itemId)
    if (result.error) {
      if (!missingTable(result.error)) throw result.error
      setDeviceSave(userId, itemId, saved)
      if (!saved) storeAvailabilityWishlist(userId,itemId,false)
      return
    }
    // A successful account save/removal supersedes an unsynced device entry for this product.
    setDeviceSave(userId, itemId, false)
    if (!saved) storeAvailabilityWishlist(userId,itemId,false)
  })
}
