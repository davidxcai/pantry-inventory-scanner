import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CatalogRow } from '../shared/catalogView'
import { loadWatchlistState, setWatchlistItem } from '../src/features/watchlist/watchlistData'
import { readDeviceSaves } from '../src/features/watchlist/watchlistStorage'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from } }))
class DeviceStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  clear() { this.values.clear() }
}
const missing = { code: 'PGRST205', message: 'watchlist_items does not exist' }
let deployed = false
let failure: { code: string; message: string } | null = null
let rows: Map<string, { user_id: string; item_id: string; created_at: string }>
let products: Map<string, CatalogRow>
const beans: CatalogRow = { id: 'beans', name: 'Black beans', category: 'canned_jarred', thumbnail_path: null, availability: 'out', updated_at: null, updated_by_name: null }
beforeEach(() => {
  vi.stubGlobal('localStorage', new DeviceStorage())
  deployed = false; failure = null; rows = new Map(); products = new Map([['beans', { ...beans }]])
  from.mockReset().mockImplementation((table: string) => {
    const filters = new Map<string, string>()
    let deleting = false
    const result = () => {
      if (failure) return { data: null, error: failure }
      if (!deployed) return { data: null, error: missing }
      const own = [...rows.values()].filter((row) => [...filters].every(([key, value]) => row[key as 'user_id' | 'item_id'] === value))
      if (deleting) for (const row of own) rows.delete(`${row.user_id}:${row.item_id}`)
      return { data: deleting ? null : own.map(({ item_id, created_at }) => ({ item_id, created_at })), error: null }
    }
    const query = {
      select: () => query, order: () => query,
      eq: (key: string, value: string) => { filters.set(key, value); return query },
      range: async () => result(),
      in: async (_key: string, ids: string[]) => ({ data: ids.flatMap((id) => products.has(id) ? [products.get(id)] : []), error: null }),
      upsert: async (row: { user_id: string; item_id: string; created_at?: string }) => {
        if (failure) return { error: failure }
        if (!deployed) return { error: missing }
        const id = `${row.user_id}:${row.item_id}`
        if (!rows.has(id)) rows.set(id, { ...row, created_at: row.created_at ?? new Date().toISOString() })
        return { error: null }
      },
      delete: () => { deleting = true; return query },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    }
    expect(['watchlist_items', 'available_items']).toContain(table)
    return query
  })
})
afterEach(() => vi.unstubAllGlobals())

it('saves despite the missing table, persists across reads, and uses current stock reports', async () => {
  await setWatchlistItem('alice', 'beans', true)
  await setWatchlistItem('alice', 'beans', true)
  expect(readDeviceSaves('alice')).toHaveLength(1)
  const first = await loadWatchlistState('alice')
  expect(first.deviceOnly).toBe(true)
  expect(first.items[0].item?.availability).toBe('out')
  products.set('beans', { ...beans, availability: 'in_stock' })
  expect((await loadWatchlistState('alice')).items[0].item?.availability).toBe('in_stock')
})
it('keeps device saves private to each account and supports removal', async () => {
  await setWatchlistItem('alice', 'beans', true)
  expect((await loadWatchlistState('bob')).items).toEqual([])
  await setWatchlistItem('bob', 'beans', true)
  await setWatchlistItem('alice', 'beans', false)
  expect((await loadWatchlistState('alice')).items).toEqual([])
  expect((await loadWatchlistState('bob')).items).toHaveLength(1)
})
it('syncs once after the migration and loads account saves after device storage is cleared', async () => {
  await setWatchlistItem('alice', 'beans', true)
  const savedAt = readDeviceSaves('alice')[0].created_at
  deployed = true
  const state = await loadWatchlistState('alice')
  expect(state.deviceOnly).toBe(false)
  expect(state.items).toHaveLength(1)
  expect(rows.get('alice:beans')?.created_at).toBe(savedAt)
  expect(readDeviceSaves('alice')).toEqual([])
  localStorage.clear()
  expect((await loadWatchlistState('alice')).items).toHaveLength(1)
  await loadWatchlistState('alice')
  expect(rows.size).toBe(1)
})
it('does not resurrect a removed device save when account storage becomes available', async () => {
  await setWatchlistItem('alice', 'beans', true)
  deployed = true
  await setWatchlistItem('alice', 'beans', false)
  expect((await loadWatchlistState('alice')).items).toEqual([])
  expect(rows.size).toBe(0)
})
it('retains unlisted device products so they can still be removed after migration', async () => {
  await setWatchlistItem('alice', 'beans', true)
  products.clear(); deployed = true
  const state = await loadWatchlistState('alice')
  expect(state.deviceOnly).toBe(true)
  expect(state.items[0].item).toBe(null)
  expect(rows.size).toBe(0)
  await setWatchlistItem('alice', 'beans', false)
  expect((await loadWatchlistState('alice')).items).toEqual([])
})
it('does not disguise authorization or network errors as successful device saves', async () => {
  failure = { code: '42501', message: 'permission denied' }
  await expect(setWatchlistItem('alice', 'beans', true)).rejects.toEqual(failure)
  await expect(loadWatchlistState('alice')).rejects.toEqual(failure)
  expect(readDeviceSaves('alice')).toEqual([])
})
it('reports blocked device storage instead of claiming the save succeeded', async () => {
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Storage disabled') })
  await expect(setWatchlistItem('alice', 'beans', true)).rejects.toThrow('Allow site storage')
})
it('serializes a sync and removal so the product remains removed', async () => {
  await setWatchlistItem('alice', 'beans', true)
  deployed = true
  await Promise.all([loadWatchlistState('alice'), setWatchlistItem('alice', 'beans', false)])
  expect((await loadWatchlistState('alice')).items).toEqual([])
  expect(rows.size).toBe(0)
})
