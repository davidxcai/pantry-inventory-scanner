import { uuid } from '../../lib/uuid'
import { create } from 'zustand'
import type { PublicAvailability } from '../../../shared/catalogView'
import { loadPending, removePending, savePending, type PendingCapture } from './queueDb'
import { requestIdentify, uploadCapture } from './uploader'

const BATCH_KEY = 'pantry-batch-id'
const readBatchId = () => {
  try {
    return localStorage.getItem(BATCH_KEY) ?? newBatchId()
  } catch {
    return uuid()
  }
}
function newBatchId() {
  const id = uuid()
  try {
    localStorage.setItem(BATCH_KEY, id)
  } catch {
    // private mode: batch just lasts for this page load
  }
  return id
}

const DISMISSED_KEY = 'pantry-dismissed-jobs'
const readDismissed = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
  } catch {
    return []
  }
}

type State = {
  batchId: string
  dismissed: string[] // finished jobs the user cleared from the queue view
  pending: PendingCapture[]
  last: PendingCapture | null // for the "same as last" shortcut
  errors: Record<string, string> // why a capture is still waiting, by capture id
  // The phone refused to store photos (Safari Private Browsing does this), so waiting captures
  // live only in this tab and are lost if it closes before they upload.
  memoryOnly: boolean
  enqueue: (photo: Blob, thumb: Blob, availability: PublicAvailability) => Promise<void>
  newBatch: () => void
  dismiss: (ids: string[]) => void
  discard: (id: string) => Promise<void>
  flush: () => Promise<void>
}

let flushing = false

export const useCaptureQueue = create<State>((set, get) => ({
  batchId: readBatchId(),
  pending: [],
  last: null,
  errors: {},
  memoryOnly: false,
  dismissed: readDismissed(),

  async enqueue(photo, thumb, availability) {
    const capture: PendingCapture = {
      id: uuid(),
      batchId: get().batchId,
      photo,
      thumb,
      availability,
      createdAt: Date.now(),
    }
    try {
      await savePending(capture)
    } catch (err) {
      // Keep going in memory rather than blocking the capture. Uploads are safe to repeat,
      // so the only cost is losing the photo if the tab closes before it uploads.
      console.warn('Could not save capture on this device; keeping it in memory', err)
      set({ memoryOnly: true })
    }
    set((s) => ({ pending: [...s.pending, capture], last: capture }))
    void get().flush()
  },

  newBatch() {
    set({ batchId: newBatchId() })
  },

  // Hide finished jobs from the queue view only; the server records are untouched.
  dismiss(ids) {
    const dismissed = [...new Set([...get().dismissed, ...ids])]
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed))
    } catch {
      // private mode: they come back on reload
    }
    set({ dismissed })
  },

  // Drop a capture that cannot upload. It is removed from the phone, so this cannot be undone.
  async discard(id) {
    await removePending(id).catch(() => {}) // not stored if the phone refused storage
    set((s) => {
      const { [id]: _gone, ...errors } = s.errors
      return { pending: s.pending.filter((p) => p.id !== id), errors }
    })
  },

  async flush() {
    if (flushing) return
    flushing = true
    try {
      for (const capture of [...get().pending]) {
        try {
          await uploadCapture(capture)
        } catch (err) {
          // Keep the reason so the queue can show it; the timer / online event retries.
          const message = err instanceof Error ? err.message : String(err)
          set((s) => ({ errors: { ...s.errors, [capture.id]: message } }))
          continue // one stuck photo must not block the ones behind it
        }
        await removePending(capture.id).catch(() => {}) // uploaded; a leftover copy just re-uploads harmlessly
        set((s) => {
          const { [capture.id]: _done, ...errors } = s.errors
          return { pending: s.pending.filter((p) => p.id !== capture.id), errors }
        })
        void requestIdentify(capture.id).catch(() => {})
      }
    } finally {
      flushing = false
    }
  },
}))

// Restore anything left over from a previous session and keep retrying in the background.
export async function startQueueSync() {
  const left = await loadPending().catch(() => [] as PendingCapture[])
  useCaptureQueue.setState((s) => ({
    pending: [...left.filter((c) => !s.pending.some((p) => p.id === c.id)), ...s.pending],
  }))
  const flush = () => void useCaptureQueue.getState().flush()
  window.addEventListener('online', flush)
  const timer = setInterval(flush, 15_000)
  flush()
  return () => {
    window.removeEventListener('online', flush)
    clearInterval(timer)
  }
}
