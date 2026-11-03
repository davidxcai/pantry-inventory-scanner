import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pointsProgress, PointsSummarySchema } from './inventoryPoints'

test('points milestones keep the complete balance and continue toward the next hundred', () => {
  assert.deepEqual(pointsProgress(0), { milestones: 0, progress: 0, nextMilestone: 100, remaining: 100 })
  assert.deepEqual(pointsProgress(99), { milestones: 0, progress: 99, nextMilestone: 100, remaining: 1 })
  assert.deepEqual(pointsProgress(100), { milestones: 1, progress: 0, nextMilestone: 200, remaining: 100 })
  assert.deepEqual(pointsProgress(235), { milestones: 2, progress: 35, nextMilestone: 300, remaining: 65 })
})
test('rejects malformed summaries instead of displaying invalid balances', () => {
  const summary = { balance: 5, earned: 5, reward_threshold: 100, recent_updates: [] }
  assert.equal(PointsSummarySchema.safeParse(summary).success, true)
  assert.equal(PointsSummarySchema.safeParse({ ...summary, balance: -1 }).success, false)
  assert.equal(PointsSummarySchema.safeParse({ ...summary, balance: 1.5 }).success, false)
  assert.equal(PointsSummarySchema.safeParse({ ...summary, reward_threshold: 0 }).success, false)
  assert.equal(PointsSummarySchema.safeParse({ ...summary, recent_updates: [{ id: 'x', item_name: 'Beans', created_at: 'not a date' }] }).success, false)
})
