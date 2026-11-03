import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadWatchlist, setWatchlistItem } from '../src/features/watchlist/watchlistData'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../src/lib/supabase', () => ({ supabase: { from } }))

function query(result: { data?: unknown; error?: unknown }) {
  const builder = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue(result), in: vi.fn().mockResolvedValue(result),
    upsert: vi.fn().mockResolvedValue(result), delete: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  return builder
}

beforeEach(() => { from.mockReset() })

describe('saved-products data access', () => {
  it('scopes reads to the signed-in owner and combines them with current catalog availability', async () => {
    const saved = query({ data: [{ item_id: 'p1', created_at: '2026-10-26' }, { item_id: 'hidden', created_at: '2026-10-25' }] })
    const current = { id: 'p1', name: 'Beans', availability: 'out', pending: true }
    const catalog = query({ data: [current] })
    from.mockReturnValueOnce(saved).mockReturnValueOnce(catalog)
    expect(await loadWatchlist('alice')).toEqual([
      { item_id: 'p1', created_at: '2026-10-26', item: current },
      { item_id: 'hidden', created_at: '2026-10-25', item: null },
    ])
    expect(saved.eq).toHaveBeenCalledWith('user_id', 'alice')
    expect(catalog.in).toHaveBeenCalledWith('id', ['p1', 'hidden'])
  })

  it('pages beyond the saved-row limit and batches catalog lookups', async () => {
    const records = Array.from({ length: 1001 }, (_, index) => ({ item_id: `p${index}`, created_at: '2026-10-26' }))
    const pageOne = query({ data: records.slice(0, 1000) })
    const pageTwo = query({ data: records.slice(1000) })
    const catalog = query({ data: [] })
    from.mockReturnValueOnce(pageOne).mockReturnValueOnce(pageTwo).mockReturnValue(catalog)
    expect(await loadWatchlist('alice')).toHaveLength(1001)
    expect(pageOne.range).toHaveBeenCalledWith(0, 999)
    expect(pageTwo.range).toHaveBeenCalledWith(1000, 1999)
    expect(catalog.in).toHaveBeenCalledTimes(11)
    expect(catalog.in.mock.calls.every(([, ids]) => ids.length <= 100)).toBe(true)
  })

  it('skips catalog queries for an empty saved list', async () => {
    from.mockReturnValue(query({ data: [] }))
    expect(await loadWatchlist('alice')).toEqual([])
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('saves idempotently with both ownership keys and never writes inventory', async () => {
    const saved = query({ error: null })
    from.mockReturnValue(saved)
    await setWatchlistItem('alice', 'p1', true)
    expect(from).toHaveBeenCalledExactlyOnceWith('watchlist_items')
    expect(saved.upsert).toHaveBeenCalledWith({ user_id: 'alice', item_id: 'p1' }, { onConflict: 'user_id,item_id', ignoreDuplicates: true })
  })

  it('limits removal to the current owner and product', async () => {
    const saved = query({ error: null })
    from.mockReturnValue(saved)
    await setWatchlistItem('alice', 'p1', false)
    expect(saved.delete).toHaveBeenCalledTimes(1)
    expect(saved.eq.mock.calls).toEqual([['user_id', 'alice'], ['item_id', 'p1']])
  })

  it('rejects signed-out reads and mutations before contacting the database', async () => {
    await expect(loadWatchlist('')).rejects.toThrow('Sign in')
    await expect(setWatchlistItem('', 'p1', true)).rejects.toThrow('Sign in')
    expect(from).not.toHaveBeenCalled()
  })

  it('surfaces storage and catalog errors instead of returning an apparently empty list', async () => {
    const offline = { message: 'Network unavailable' }
    from.mockReturnValueOnce(query({ data: null, error: offline }))
    await expect(loadWatchlist('alice')).rejects.toEqual(offline)
    from.mockReturnValueOnce(query({ data: [{ item_id: 'p1', created_at: '' }] })).mockReturnValueOnce(query({ data: null, error: offline }))
    await expect(loadWatchlist('alice')).rejects.toEqual(offline)
    from.mockReturnValueOnce(query({ error: offline }))
    await expect(setWatchlistItem('alice', 'p1', true)).rejects.toEqual(offline)
  })
})
