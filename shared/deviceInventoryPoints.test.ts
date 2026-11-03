import assert from 'node:assert/strict'
import { test } from 'node:test'
import { inventoryProductKey, recordPointReports, POINT_COOLDOWN_MS, type PointReport } from './deviceInventoryPoints'
const first: PointReport = { sourceId: 'job:1', jobId: '1', itemId: 'item1', name: 'Barilla Spaghetti 16 oz', brand: 'Barilla', occurredAt: '2026-11-02T18:00:00Z' }

test('normalizes duplicate names, brand repetition, package size, punctuation and word order', () => {
  for (const [name,brand] of [['SPAGHETTI, BARILLA 32 oz.',null],['Barílla Spaghetti','Barilla'],['Spaghetti','Barilla']] as const) {
    assert.equal(inventoryProductKey(name,brand),inventoryProductKey(first.name,first.brand))
  }
  assert.equal(inventoryProductKey('Ritz Crackers'),inventoryProductKey('Ritz Cracker'))
  assert.notEqual(inventoryProductKey('Whole Grain Spaghetti','Barilla'),inventoryProductKey(first.name,first.brand))
  assert.notEqual(inventoryProductKey('Spaghetti','De Cecco'),inventoryProductKey(first.name,first.brand))
  assert.notEqual(inventoryProductKey('Melatonin 5mg'),inventoryProductKey('Melatonin 10mg'))
})
test('awards a successful update once and suppresses retries and duplicate catalog IDs', () => {
  const result = recordPointReports([], [first,first,{ ...first, sourceId: 'job:2', jobId: '2', itemId: 'copy', name: 'SPAGHETTI BARILLA 32 oz.' }])
  assert.equal(result.length,2)
  assert.deepEqual(result.map(entry => entry.outcome),['earned','cooldown'])
  assert.equal(result[1].next_eligible_at,'2026-11-09T18:00:00.000Z')
})
test('renaming an item cannot bypass the cooldown; distinct products earn separately', () => {
  const result = recordPointReports([], [first,{ ...first,sourceId:'job:2',name:'Completely renamed item' },{ ...first,sourceId:'job:3',itemId:'item3',name:'Whole Grain Spaghetti' }])
  assert.deepEqual(result.map(entry => entry.outcome),['earned','cooldown','earned'])
})
test('allows the next point at exactly seven days and never replays an old source for another award', () => {
  const entries = recordPointReports([], [first])
  const before = new Date(Date.parse(first.occurredAt)+POINT_COOLDOWN_MS-1).toISOString()
  const after = new Date(Date.parse(first.occurredAt)+POINT_COOLDOWN_MS).toISOString()
  const result = recordPointReports(entries,[{ ...first,sourceId:'2',occurredAt:before },{ ...first,sourceId:'3',occurredAt:after },{ ...first,occurredAt:after }])
  assert.deepEqual(result.map(entry => entry.outcome),['earned','cooldown','earned'])
})
test('recovering older reports does not duplicate a newer device award or reset saved history', () => {
  const newer = { ...first,sourceId:'newer',occurredAt:'2026-11-03T18:00:00Z' }
  const entries = recordPointReports([], [newer])
  const recovered = recordPointReports(entries,[first])
  assert.deepEqual(recovered.map(entry => entry.outcome),['earned','cooldown'])
  assert.equal(recovered[0].id,'newer')
})
