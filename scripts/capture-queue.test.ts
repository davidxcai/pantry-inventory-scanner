import { beforeEach, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ upload: vi.fn(), identify: vi.fn(), save: vi.fn(), remove: vi.fn(), load: vi.fn() }))
vi.mock('../src/features/intake/uploader', () => ({ uploadCapture: mock.upload, requestIdentify: mock.identify }))
vi.mock('../src/features/intake/queueDb', () => ({ savePending: mock.save, removePending: mock.remove, loadPending: mock.load }))
import { useCaptureQueue } from '../src/features/intake/useCaptureQueue'
const capture = (id: string) => ({ id, batchId: 'batch', photo: new Blob(['photo']), thumb: new Blob(['thumb']), availability: 'in_stock' as const, createdAt: 1 })
beforeEach(() => {
  vi.resetAllMocks()
  mock.upload.mockResolvedValue(undefined)
  mock.identify.mockResolvedValue(undefined)
  mock.save.mockResolvedValue(undefined)
  mock.remove.mockResolvedValue(undefined)
  useCaptureQueue.setState({ pending: [], errors: {}, identifyErrors: {}, identifying: [], dismissed: [], batchId: 'batch', last: null })
})
it('keeps identification failures visible after a successful upload leaves the device queue', async () => {
  mock.identify.mockRejectedValue(new Error('Identification service unavailable'))
  useCaptureQueue.setState({ pending: [capture('one')] })
  await useCaptureQueue.getState().flush()
  await vi.waitFor(() => expect(useCaptureQueue.getState().identifyErrors.one).toBe('Identification service unavailable'))
  expect(useCaptureQueue.getState().pending).toEqual([])
  expect(useCaptureQueue.getState().identifying).toEqual([])
  expect(mock.remove).toHaveBeenCalledWith('one')
})
it('retries identification without uploading the same photo again and clears the old error', async () => {
  useCaptureQueue.setState({ identifyErrors: { one: 'Old failure' } })
  await useCaptureQueue.getState().identify('one')
  expect(mock.identify).toHaveBeenCalledExactlyOnceWith('one')
  expect(mock.upload).not.toHaveBeenCalled()
  expect(useCaptureQueue.getState().identifyErrors).toEqual({})
})
it('prevents double retry clicks while the same photo is identifying', async () => {
  let finish!: () => void
  mock.identify.mockReturnValue(new Promise<void>((resolve) => { finish = resolve }))
  const first = useCaptureQueue.getState().identify('one')
  await useCaptureQueue.getState().identify('one')
  expect(mock.identify).toHaveBeenCalledTimes(1)
  expect(useCaptureQueue.getState().identifying).toEqual(['one'])
  finish(); await first
  expect(useCaptureQueue.getState().identifying).toEqual([])
})
it('keeps a failed upload for retry without blocking the next photo', async () => {
  mock.upload.mockRejectedValueOnce(new Error('Photo upload denied'))
  useCaptureQueue.setState({ pending: [capture('one'), capture('two')] })
  await useCaptureQueue.getState().flush()
  expect(useCaptureQueue.getState().pending.map((entry) => entry.id)).toEqual(['one'])
  expect(useCaptureQueue.getState().errors.one).toBe('Photo upload denied')
  expect(mock.identify).toHaveBeenCalledExactlyOnceWith('two')
})
