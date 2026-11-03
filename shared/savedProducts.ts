import type { CatalogRow, PublicAvailability } from './catalogView'

export type SavedProduct = { item_id: string; created_at: string; item: CatalogRow | null }
export type SavedAvailability = 'all' | PublicAvailability | 'unlisted'

const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

// Keep save order, including unavailable items, while helping students plan their next visit.
export function filterSavedProducts(entries: SavedProduct[], search: string, availability: SavedAvailability) {
  const words = normalize(search).split(/\s+/).filter(Boolean)
  return entries.filter(({ item }) => {
    if (availability !== 'all' && (item?.availability ?? 'unlisted') !== availability) return false
    const text = normalize(item ? `${item.name} ${(item.category ?? '').replaceAll('_', ' ')}` : 'Unlisted product')
    return words.every((word) => text.includes(word))
  })
}

export function savedProductCounts(entries: SavedProduct[]) {
  const counts = { total: entries.length, in_stock: 0, low: 0, out: 0, unlisted: 0 }
  for (const { item } of entries) counts[item?.availability ?? 'unlisted']++
  return counts
}
