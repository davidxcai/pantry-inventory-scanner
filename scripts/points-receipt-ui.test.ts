import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it } from 'vitest'
import { PointReceipt } from '../src/features/points/PointReceipt'
const activity = {id:'1',item_id:'item1',job_id:'job1',item_name:'Spaghetti',outcome:'earned' as const,created_at:'2026-11-02T18:00:00Z',next_eligible_at:'2026-11-09T18:00:00Z'}
it('shows an earned point only when confirmed activity exists', () => {
  expect(renderToStaticMarkup(createElement(PointReceipt,{activity}))).toContain('+1 point earned')
  expect(renderToStaticMarkup(createElement(PointReceipt,{activity:undefined}))).toBe('')
})
it('explains a duplicate cooldown while confirming stock still saved', () => {
  const html=renderToStaticMarkup(createElement(PointReceipt,{activity:{...activity,outcome:'cooldown'}}))
  expect(html).toContain('Stock saved. No extra point')
  expect(html).toContain('within seven days')
  expect(html).toContain('Eligible again')
  expect(html).toContain('America/Chicago')
  expect(html).not.toContain('+1 point earned')
})
