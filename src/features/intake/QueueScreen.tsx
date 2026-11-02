import { useEffect, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { REJECT_LABELS } from '../../../shared/guardrail'
import { StatusDot, statusLabel } from './StatusDot'
import { useCaptureQueue } from './useCaptureQueue'
import { useIntakeJobs, type IntakeJob, type JobStatus } from './useIntakeJobs'
import { cancelJob, requestIdentify } from './uploader'
import { availabilityText } from './availability'

const thumbUrl = (jobId: string) => supabase.storage.from('thumbnails').getPublicUrl(`${jobId}.jpg`).data.publicUrl

export function QueueScreen() {
  const { batchId, pending, errors, dismissed, newBatch, dismiss, discard } = useCaptureQueue()
  const { data: allJobs = [], isLoading, error } = useIntakeJobs(batchId)
  const jobs = allJobs.filter((j) => !dismissed.includes(j.id))
  const finished = jobs.filter((j) => j.status === 'green' || j.status === 'rejected')
  const queryClient = useQueryClient()

  // Local photos that have not reached the server yet are shown first.
  const pendingUrls = usePendingUrls(pending)

  const [retryError, setRetryError] = useState<string | null>(null)

  async function retry(job: IntakeJob) {
    setRetryError(null)
    await requestIdentify(job.id).catch((e: Error) => setRetryError(e.message))
    void queryClient.invalidateQueries({ queryKey: ['intake-jobs', batchId] })
  }

  async function cancel(job: IntakeJob) {
    setRetryError(null)
    await cancelJob(job.id).catch((e: Error) => setRetryError(`Could not cancel: ${e.message}`))
    void queryClient.invalidateQueries({ queryKey: ['intake-jobs', batchId] })
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Queue</h1>
        <div className="flex gap-2">
          <Link to="/capture" className="btn btn-sm btn-primary">Add item</Link>
          <button
            className="btn btn-sm btn-ghost"
            disabled={!finished.length}
            onClick={() => dismiss(finished.map((j) => j.id))}
          >
            Clear done
          </button>
          <button className="btn btn-sm btn-ghost" onClick={newBatch}>New batch</button>
        </div>
      </header>

      {error && <div role="alert" className="alert alert-error alert-soft">{error.message}</div>}
      {retryError && <div role="alert" className="alert alert-error alert-soft">{retryError}</div>}
      {isLoading && <span className="loading loading-spinner mx-auto" />}
      {!isLoading && !jobs.length && !pending.length && <p className="opacity-70">Nothing in this batch yet.</p>}

      <ul className="flex flex-col gap-2">
        {pending.map((c) => (
          <li key={c.id} className="flex items-center gap-3 rounded-box bg-base-200 p-2">
            <img src={pendingUrls[c.id]} alt="" className="size-14 rounded-field object-cover" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{errors[c.id] ? 'Upload failed, retrying' : 'Uploading…'}</div>
              <div className="text-sm opacity-70">
                {errors[c.id] ?? `${availabilityText(c.availability ?? 'in_stock')}. Saved on this phone until it uploads.`}
              </div>
            </div>
            {!errors[c.id] && <span className="loading loading-spinner loading-sm" />}
            <button className="btn btn-xs btn-ghost" onClick={() => void discard(c.id)}>Discard</button>
          </li>
        ))}
        {jobs.map((job) => (
          <li key={job.id} className="flex items-center gap-3 rounded-box bg-base-200 p-2">
            <img src={thumbUrl(job.id)} alt="" className="size-14 rounded-field bg-base-300 object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{job.items?.name ?? job.identified?.name ?? statusLabel(job.status)}</div>
              <div className="truncate text-sm opacity-70">
                {availabilityText(job.availability)}
                {job.items && ` · ${job.items.categories.join(', ').replaceAll('_', ' ')}`}
                {job.status === 'red' && job.error && ` · ${job.error}`}
                {job.status === 'rejected' && job.reject_reason && ` · ${REJECT_LABELS[job.reject_reason]}`}
              </div>
            </div>
            {(job.status === 'queued' || job.status === 'red' || job.status === 'waiting_quota') && (
              <button className="btn btn-xs" onClick={() => retry(job)}>Retry</button>
            )}
            {(job.status === 'yellow' || job.status === 'queued' || job.status === 'red' || job.status === 'waiting_quota') && (
              <Link to="/review/$jobId" params={{ jobId: job.id }} className="btn btn-xs btn-outline">
                {job.status === 'yellow' ? 'Review' : 'Enter'}
              </Link>
            )}
            {canCancel(job) && (
              <button className="btn btn-xs btn-ghost" onClick={() => void cancel(job)}>Cancel</button>
            )}
            <StatusDot status={job.status} />
          </li>
        ))}
      </ul>
    </main>
  )
}

// Only photos that never produced an item; once one exists the catalog has already changed.
const CANCELLABLE: JobStatus[] = ['queued', 'processing', 'red', 'waiting_quota', 'yellow']
const canCancel = (job: IntakeJob) => !job.items && CANCELLABLE.includes(job.status)

function usePendingUrls(pending: { id: string; thumb: Blob }[]) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    const next = Object.fromEntries(pending.map((c) => [c.id, URL.createObjectURL(c.thumb)]))
    setUrls(next)
    return () => Object.values(next).forEach(URL.revokeObjectURL)
  }, [pending])
  return urls
}
