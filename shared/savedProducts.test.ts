import assert from 'node:assert/strict'
import test from 'node:test'
import { filterSavedProducts, savedProductCounts, type SavedProduct } from './savedProducts'

const saved = (id: string, name: string, availability: 'in_stock' | 'low' | 'out'): SavedProduct => ({
  item_id: id, created_at: '2026-10-26T12:00:00Z',
  item: { id, name, availability, category: 'canned_jarred', thumbnail_path: null, updated_at: null, updated_by_name: null },
})
const entries: SavedProduct[] = [saved('a', 'Café beans', 'out'), saved('b', 'Black beans', 'in_stock'), saved('c', 'Soup', 'low'), { item_id: 'd', created_at: '', item: null }]

test('saved-products search ignores accents and case, matches categories, and preserves saved order', () => {
  assert.deepEqual(filterSavedProducts(entries, 'BEANS', 'all').map((entry) => entry.item_id), ['a', 'b'])
  assert.equal(filterSavedProducts(entries, 'cafe', 'all')[0]?.item_id, 'a')
  assert.equal(filterSavedProducts(entries, 'jarred soup', 'all')[0]?.item_id, 'c')
})

test('availability filters retain out-of-stock and unlisted saved products', () => {
  assert.equal(filterSavedProducts(entries, '', 'out')[0]?.item_id, 'a')
  assert.equal(filterSavedProducts(entries, '', 'unlisted')[0]?.item_id, 'd')
  assert.equal(filterSavedProducts(entries, 'beans', 'in_stock')[0]?.item_id, 'b')
  assert.equal(filterSavedProducts(entries, 'soup', 'out').length, 0)
})

test('stock counts distinguish available, low, out, and unlisted products', () => {
  assert.deepEqual(savedProductCounts(entries), { total: 4, in_stock: 1, low: 1, out: 1, unlisted: 1 })
  assert.deepEqual(savedProductCounts([]), { total: 0, in_stock: 0, low: 0, out: 0, unlisted: 0 })
})
