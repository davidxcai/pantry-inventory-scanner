import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canRegisterAccount, isDesignatedVisitApproverEmail } from './visitApprover'
import { isUtaEmail } from './email'

test('allows the designated Gmail reviewer to register without treating them as a UTA student', () => {
  assert.equal(canRegisterAccount('salmanfarse2025@gmail.com'), true)
  assert.equal(canRegisterAccount(' SALMANFARSE2025@GMAIL.COM '), true)
  assert.equal(isDesignatedVisitApproverEmail('salmanfarse2025@gmail.com'), true)
  assert.equal(isUtaEmail('salmanfarse2025@gmail.com'), false)
  assert.equal(canRegisterAccount('student@mavs.uta.edu'), true)
  assert.equal(canRegisterAccount('staff@uta.edu'), true)
})
test('allows ordinary Gmail sign-in without assigning the approver role', () => {
  for (const email of ['another@gmail.com', 'salmanfarse2025+tag@gmail.com']) {
    assert.equal(canRegisterAccount(email), true)
    assert.equal(isDesignatedVisitApproverEmail(email), false)
  }
})
test('rejects unsupported domains and lookalikes', () => {
  for (const email of ['salmanfarse2025@gmail.com.evil.test', 'salmanfarse2025@googlemail.com', '']) {
    assert.equal(canRegisterAccount(email), false)
    assert.equal(isDesignatedVisitApproverEmail(email), false)
  }
  assert.equal(isDesignatedVisitApproverEmail(undefined), false)
})
