import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { requestPhotoAnalysis } from '../src/lib/photoApi'
const { getSession, recordJob } = vi.hoisted(() => ({ getSession: vi.fn(), recordJob: vi.fn() }))
vi.mock('../src/features/points/devicePoints', () => ({ recordDeviceJob: recordJob }))
vi.mock('../src/lib/supabase', () => ({ supabase: { auth: { getSession } } }))
const fetcher = vi.fn()
beforeEach(() => {
  recordJob.mockReset().mockResolvedValue(undefined)
  getSession.mockResolvedValue({ data: { session: { access_token: 'test-token' } }, error: null })
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset().mockResolvedValue(Response.json({ status: 'green' }))
})
afterEach(() => vi.unstubAllGlobals())
it('sends the signed-in job to the same-origin identification endpoint', async () => {
  await requestPhotoAnalysis('identify', 'job')
  expect(recordJob).toHaveBeenCalledExactlyOnceWith('job')
  expect(fetcher).toHaveBeenCalledWith('/api/identify', expect.objectContaining({ method: 'POST', body: JSON.stringify({ jobId: 'job' }), headers: expect.objectContaining({ Authorization: 'Bearer test-token' }) }))
})
it('uses the shelf endpoint and scan ID for shelf photos', async () => {
  await requestPhotoAnalysis('shelf', 'scan')
  expect(fetcher).toHaveBeenCalledWith('/api/shelf', expect.objectContaining({ body: JSON.stringify({ scanId: 'scan' }) }))
})
it.each([200, 404])('rejects a frontend HTML/missing-API response with status %s', async (status) => {
  fetcher.mockResolvedValue(new Response('<html>app</html>', { status, headers: { 'Content-Type': 'text/html' } }))
  await expect(requestPhotoAnalysis('identify', 'job')).rejects.toThrow('identification is unavailable')
})
it('keeps retries idempotent when the backend has already claimed the job', async () => {
  fetcher.mockResolvedValue(Response.json({ error: 'already handled' }, { status: 409 }))
  await expect(requestPhotoAnalysis('identify', 'job')).resolves.toBeUndefined()
})
it('surfaces authentication and backend failures clearly', async () => {
  fetcher.mockResolvedValueOnce(Response.json({ error: 'sign in required' }, { status: 401 }))
  await expect(requestPhotoAnalysis('identify', 'job')).rejects.toThrow('sign-in expired')
  expect(recordJob).not.toHaveBeenCalled()
  fetcher.mockResolvedValueOnce(Response.json({ error: 'quota is exhausted' }, { status: 503 }))
  await expect(requestPhotoAnalysis('identify', 'job')).rejects.toThrow('quota is exhausted')
})
it('keeps the saved-photo recovery options in network and invalid-response errors', async () => {
  fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  await expect(requestPhotoAnalysis('identify', 'job')).rejects.toThrow('enter the product details manually')
  fetcher.mockResolvedValueOnce(new Response('{invalid', { headers: { 'Content-Type': 'application/json' } }))
  await expect(requestPhotoAnalysis('identify', 'job')).rejects.toThrow('invalid response')
})
it('does not send an undefined bearer token after sign-out', async () => {
  getSession.mockResolvedValue({ data: { session: null }, error: null })
  await expect(requestPhotoAnalysis('identify', 'job')).rejects.toThrow('Sign in again')
  expect(fetcher).not.toHaveBeenCalled()
})

it('refreshes the active points and receipt queries immediately after identification completes', async () => {
  const { queryClient } = await import('../src/lib/queryClient')
  const spy = vi.spyOn(queryClient,'invalidateQueries')
  await requestPhotoAnalysis('identify','job')
  expect(spy).toHaveBeenCalledWith({queryKey:['inventory-points']})
  expect(spy).toHaveBeenCalledWith({queryKey:['inventory-point-activity']})
  expect(spy).toHaveBeenCalledWith({queryKey:['intake-jobs']})
  spy.mockRestore()
})
