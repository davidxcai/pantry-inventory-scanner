import assert from 'node:assert/strict'
import { test } from 'node:test'
import { manualVisitRequestMailto } from './visitRewards'

test('prepares a manual review draft with student identity and clear device-credit limitations', () => {
  const url = new URL(manualVisitRequestMailto({userId:'student-id',name:'Test Student',email:'student@mavs.uta.edu',points:100,deviceOnly:true}))
  assert.equal(url.protocol,'mailto:')
  assert.equal(url.pathname,'salmanfarse2025@gmail.com')
  assert.match(url.searchParams.get('subject')!,/approval required/)
  const body=url.searchParams.get('body')!
  assert.match(body,/student@mavs\.uta\.edu/)
  assert.match(body,/Available points: 100/)
  assert.match(body,/device-only development balance; please verify eligibility manually/)
  assert.match(body,/does not book an appointment/)
})
