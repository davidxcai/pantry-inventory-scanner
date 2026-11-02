import { supabase } from '../../lib/supabase'
import type { PendingCapture } from './queueDb'

// Upload one capture and create its job. Safe to repeat: storage uses upsert and a duplicate
// job id counts as already done, so a retry after a dropped connection never double-counts.
export async function uploadCapture(c: PendingCapture): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession()
  const session = sessionData.session
  if (!session) throw new Error('signed out')

  // Photos live under the user's id; storage rules only let a user reach their own folder.
  const photoPath = `${session.user.id}/${c.batchId}/${c.id}.jpg`
  const opts = { contentType: 'image/jpeg', upsert: true }
  const [photo, thumb] = await Promise.all([
    supabase.storage.from('intake-photos').upload(photoPath, c.photo, opts),
    supabase.storage.from('thumbnails').upload(`${c.id}.jpg`, c.thumb, opts),
  ])
  if (photo.error) throw photo.error
  if (thumb.error) throw thumb.error

  const { error } = await supabase.from('intake_jobs').insert({
    id: c.id,
    batch_id: c.batchId,
    photo_path: photoPath,
    availability: c.availability ?? 'in_stock',
    created_by: session.user.id,
  })
  if (error && error.code !== '23505') throw error
}

// Cancel a job that never produced an item. The server refuses jobs that are already done, and an
// identify run still in flight drops its result instead of reviving the job.
export async function cancelJob(jobId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_intake_job', { p_job_id: jobId })
  if (error) throw error
}

// Ask the server to identify a job. The result arrives through Realtime, so failures here only
// mean the job stays "queued" until someone retries it from the queue screen.
export async function requestIdentify(jobId: string): Promise<void> {
  const { data } = await supabase.auth.getSession()
  const res = await fetch('/api/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify({ jobId }),
  })
  // A dev server without the API answers with the app's HTML; that is not a success.
  if (!(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new Error(`identify API not reachable (got ${res.status} ${res.headers.get('content-type') ?? 'no content type'}). Is the server running with "vercel dev"?`)
  }
  if (!res.ok && res.status !== 409) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(`identify failed (${res.status})${body?.error ? `: ${body.error}` : ''}`)
  }
}
